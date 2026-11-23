import type { ModelClient } from '@displayer/agent';

/**
 * Speech output benchmark.
 *
 * Two numbers matter for a local TTS: how long the user waits, and how fast the
 * audio is produced relative to its own playback length. A real-time factor
 * above 1 means the model synthesises faster than the clip plays, so streaming
 * playback would never underrun.
 */
export interface SpeechMeasurement {
  readonly text: string;
  readonly latencyMs: number;
  readonly bytes: number;
  readonly durationSeconds: number;
  readonly realTimeFactor: number;
}

export interface SpeechReport {
  readonly attempts: readonly SpeechMeasurement[];
  readonly latencyMs: number;
  readonly durationSeconds: number;
  readonly realTimeFactor: number;
  readonly bytesPerSecond: number;
}

/**
 * Duration from a PCM WAV header.
 *
 * Parsed rather than assumed: llama-server picks the sample rate, so a hardcoded
 * 16 kHz would silently mis-report the real-time factor if that ever changes.
 */
export function wavDurationSeconds(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 12) return 0;
  const riff = String.fromCharCode(...bytes.subarray(0, 4));
  const wave = String.fromCharCode(...bytes.subarray(8, 12));
  if (riff !== 'RIFF' || wave !== 'WAVE') return 0;

  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= view.byteLength) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      byteRate = view.getUint32(offset + 16, true);
    }
    if (id === 'data') {
      if (byteRate === 0) return 0;
      // The declared size can exceed the buffer when a writer truncates.
      const available = Math.min(size, view.byteLength - (offset + 8));
      return available / byteRate;
    }
    offset += 8 + size + (size % 2);
  }
  return 0;
}

export async function runSpeech(
  client: ModelClient,
  text: string,
  repeats = 3,
): Promise<SpeechReport> {
  const attempts: SpeechMeasurement[] = [];
  for (let index = 0; index < Math.max(1, repeats); index += 1) {
    const started = performance.now();
    const audio = await client.speak(text, { voice: 'female', format: 'wav' });
    const latencyMs = performance.now() - started;
    const durationSeconds = wavDurationSeconds(audio);
    attempts.push({
      text,
      latencyMs,
      bytes: audio.byteLength,
      durationSeconds,
      // Guard against a zero-length clip rather than reporting Infinity.
      realTimeFactor: latencyMs > 0 ? (durationSeconds * 1000) / latencyMs : 0,
    });
  }

  const latencies = attempts
    .map((attempt) => attempt.latencyMs)
    .sort((left, right) => left - right);
  const middle = latencies[Math.floor(latencies.length / 2)] ?? 0;
  const duration = attempts[0]?.durationSeconds ?? 0;
  const bytes = attempts[0]?.bytes ?? 0;

  return {
    attempts,
    latencyMs: middle,
    durationSeconds: duration,
    realTimeFactor: duration > 0 && middle > 0 ? (duration * 1000) / middle : 0,
    bytesPerSecond: duration > 0 ? bytes / duration : 0,
  };
}
