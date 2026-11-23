/**
 * Microphone capture that produces a WAV the model server can actually read.
 *
 * `MediaRecorder` gives WebM/Opus in Chromium and MP4/AAC in Safari. llama.cpp's
 * audio path wants a WAV container, and re-encoding with ffmpeg is not something
 * a browser can do, so this records raw PCM with Web Audio and writes the RIFF
 * header itself.
 *
 * Everything here is browser API plus arithmetic; no DOM and no React.
 */

/** Whisper-family models are trained at 16 kHz mono (LFM3-Omni uses a Whisper encoder). */
export const RECORDING_SAMPLE_RATE = 16_000;
/** 16-bit linear PCM. */
const BYTES_PER_SAMPLE = 2;
const HEADER_BYTES = 44;
/** This app's per-attachment ceiling; the recorder allocates against it up front. */
export const RECORDER_MAX_SECONDS = 120;

export const ERROR_MESSAGES = {
  permission: 'Microphone permission was denied. Allow it in the browser and try again.',
  unavailable: 'No microphone is available on this device.',
  'not-secure': 'Recording audio needs a secure context (https or localhost).',
  inUse: 'The microphone is busy in another app. Close it and try again.',
  unsupported: 'This browser cannot record audio here.',
  unknown: 'The recording could not be captured.',
} as const;

export type RecorderErrorKind = keyof typeof ERROR_MESSAGES;

/** Map a `getUserMedia` rejection onto something a person can act on. */
export function describeMediaError(error: unknown): {
  readonly kind: RecorderErrorKind;
  readonly message: string;
} {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';
  const kind: RecorderErrorKind =
    name === 'NotAllowedError' || name === 'SecurityError'
      ? 'permission'
      : name === 'NotFoundError' || name === 'OverconstrainedError'
        ? 'unavailable'
        : name === 'NotReadableError' || name === 'AbortError'
          ? 'inUse'
          : name === 'NotSupportedError'
            ? 'not-secure'
            : 'unknown';
  return { kind, message: ERROR_MESSAGES[kind] };
}

/** 16-bit PCM WAV from mono float samples. Values are clamped, not wrapped. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataBytes = samples.length * BYTES_PER_SAMPLE;
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, HEADER_BYTES - 8 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * BYTES_PER_SAMPLE, true);
  view.setUint16(32, BYTES_PER_SAMPLE, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(HEADER_BYTES + index * BYTES_PER_SAMPLE, Math.round(sample * 0x7fff), true);
  }
  return buffer;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

export interface Recording {
  readonly wav: Blob;
  readonly seconds: number;
  /** What to call it in the transcript; a recording has no filename. */
  readonly name: string;
}

export interface AudioRecorder {
  stop(): Promise<Recording>;
  cancel(): void;
  /** True once the backing tracks ended outside our control (device unplugged). */
  readonly lost: boolean;
}

/**
 * Line up one recording. The returned object is the only handle on the stream:
 * `stop` and `cancel` both release the microphone, so no path can leave it
 * recording after the dialog closes.
 */
export async function startRecording(
  options: { readonly maxSeconds?: number; readonly signal?: AbortSignal } = {},
): Promise<AudioRecorder> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error(ERROR_MESSAGES.unsupported), { name: 'NotSupportedError' });
  }
  const maxSeconds = options.maxSeconds ?? RECORDER_MAX_SECONDS;
  const { signal } = options;
  const aborted = () => Object.assign(new Error(ERROR_MESSAGES.unknown), { name: 'AbortError' });
  if (signal?.aborted) throw aborted();

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  // A cancel that lands while the permission prompt is up cannot reach the
  // stream through the handle, because the caller does not have one yet.
  if (signal?.aborted) {
    stream.getTracks().forEach((track) => track.stop());
    throw aborted();
  }

  const AudioContextCtor = window.AudioContext ?? undefined;
  if (!AudioContextCtor) {
    stream.getTracks().forEach((track) => track.stop());
    throw Object.assign(new Error(ERROR_MESSAGES.unsupported), { name: 'NotSupportedError' });
  }

  const context = new AudioContextCtor({ sampleRate: RECORDING_SAMPLE_RATE });
  // The permission prompt is awaited, so the creating task is no longer a
  // user gesture and Chromium may hand back a suspended context.
  await context.resume().catch(() => undefined);
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);

  const chunks: Float32Array[] = [];
  let captured = 0;
  let timer: number | undefined;
  let lost = false;
  let finished = false;

  const release = () => {
    if (finished) return;
    finished = true;
    if (timer !== undefined) window.clearTimeout(timer);
    stream.getTracks().forEach((track) => track.stop());
    source.disconnect();
    processor.disconnect();
    void context.close().catch(() => undefined);
  };

  // Tolerance rather than a guarantee: a browser may flush a final block after
  // stop(), and the cap is about memory, not exact duration.
  const limit = maxSeconds * context.sampleRate;

  processor.onaudioprocess = (event) => {
    if (captured >= limit) return;
    const input = event.inputBuffer.getChannelData(0);
    const copy = new Float32Array(input.length);
    copy.set(input);
    chunks.push(copy);
    captured += copy.length;
  };

  source.connect(processor);
  processor.connect(context.destination);

  timer = window.setTimeout(() => {
    // Stop collecting but leave the decision to the UI; the stream is released
    // when the dialog finishes, so a forgotten dialog cannot record forever.
    captured = limit;
  }, maxSeconds * 1000);

  stream.getAudioTracks()[0]?.addEventListener('ended', () => {
    lost = true;
  });

  const collect = (): Float32Array => {
    const total = Math.min(
      captured,
      chunks.reduce((sum, chunk) => sum + chunk.length, 0),
    );
    const merged = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      if (offset >= total) break;
      const slice = chunk.subarray(0, Math.min(chunk.length, total - offset));
      merged.set(slice, offset);
      offset += slice.length;
    }
    return merged;
  };

  return {
    get lost() {
      return lost;
    },
    async stop() {
      release();
      const samples = collect();
      const seconds = samples.length / RECORDING_SAMPLE_RATE;
      const wav = new Blob([encodeWav(samples, RECORDING_SAMPLE_RATE)], { type: 'audio/wav' });
      return { wav, seconds, name: `Microphone recording, ${formatSeconds(seconds)}` };
    },
    cancel() {
      release();
      chunks.length = 0;
      captured = 0;
    },
  };
}

export function formatSeconds(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
