import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  RECORDING_SAMPLE_RATE,
  describeMediaError,
  encodeWav,
  formatSeconds,
  startRecording,
} from './audio-recorder';

function fakeAudioContext() {
  const node = { connect: vi.fn(), disconnect: vi.fn() };
  return class {
    readonly sampleRate = 16_000;
    readonly destination = node;
    resume = vi.fn(async () => undefined);
    close = vi.fn(async () => undefined);
    createMediaStreamSource = vi.fn(() => ({ ...node }));
    createScriptProcessor = vi.fn(() => ({ ...node, onaudioprocess: null }));
  };
}

function ascii(view: DataView, offset: number, length: number): string {
  let text = '';
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(view.getUint8(offset + index));
  }
  return text;
}

describe('encodeWav', () => {
  it('writes a 16-bit mono PCM header the model server can parse', () => {
    const samples = new Float32Array([0, 0.5, -0.5]);
    const view = new DataView(encodeWav(samples, RECORDING_SAMPLE_RATE));

    expect(ascii(view, 0, 4)).toBe('RIFF');
    expect(ascii(view, 8, 4)).toBe('WAVE');
    expect(ascii(view, 12, 4)).toBe('fmt ');
    expect(ascii(view, 36, 4)).toBe('data');

    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(RECORDING_SAMPLE_RATE);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(28, true)).toBe(RECORDING_SAMPLE_RATE * 2);
  });

  it('sizes the container from the sample count', () => {
    const samples = new Float32Array(800);
    const buffer = encodeWav(samples, RECORDING_SAMPLE_RATE);
    const view = new DataView(buffer);

    expect(buffer.byteLength).toBe(44 + samples.length * 2);
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
    expect(view.getUint32(4, true)).toBe(buffer.byteLength - 8);
  });

  it('clamps out-of-range samples instead of wrapping them', () => {
    const view = new DataView(encodeWav(new Float32Array([2, -2]), 16_000));

    expect(view.getInt16(44, true)).toBe(32_767);
    expect(view.getInt16(46, true)).toBe(-32_767);
  });
});

describe('describeMediaError', () => {
  it('turns a denied permission into an actionable message', () => {
    expect(describeMediaError({ name: 'NotAllowedError' })).toEqual({
      kind: 'permission',
      message: expect.stringContaining('permission was denied'),
    });
  });

  it('reports a missing device as unavailable', () => {
    expect(describeMediaError({ name: 'NotFoundError' }).kind).toBe('unavailable');
  });

  it('reports a busy device as in use', () => {
    expect(describeMediaError({ name: 'NotReadableError' }).kind).toBe('inUse');
  });

  it('names a secure connection when the browser hides media capture', () => {
    const described = describeMediaError({ name: 'NotSupportedError' });
    expect(described.kind).toBe('not-secure');
    expect(described.message).toContain('HTTPS');
  });

  it('falls back to a generic message for an unknown rejection', () => {
    expect(describeMediaError(new Error('boom')).kind).toBe('unknown');
  });
});

describe('formatSeconds', () => {
  it('renders a clock that always shows seconds', () => {
    expect(formatSeconds(0)).toBe('0:00');
    expect(formatSeconds(61.4)).toBe('1:01');
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('startRecording cancellation', () => {
  it('releases the microphone when the signal aborts during the prompt', async () => {
    const stop = vi.fn();
    const abort = new AbortController();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          abort.abort();
          return {
            getTracks: () => [{ stop }],
            getAudioTracks: () => [],
          } as unknown as MediaStream;
        }),
      },
    });
    // Without a working AudioContext the recorder throws for the wrong reason
    // and the assertion would pass even with the abort guard deleted.
    vi.stubGlobal('AudioContext', fakeAudioContext());

    await expect(startRecording({ signal: abort.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(stop).toHaveBeenCalled();
  });
});
