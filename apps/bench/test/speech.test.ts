import { describe, expect, it } from 'vitest';

import { wavDurationSeconds } from '../src/speech.js';

/** Build a minimal mono 16-bit PCM WAV of exactly `seconds` of silence. */
function makeWav(seconds: number, sampleRate = 16_000): Uint8Array {
  const bytesPerSample = 2;
  const dataBytes = Math.round(seconds * sampleRate * bytesPerSample);
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  return new Uint8Array(buffer);
}

describe('wavDurationSeconds', () => {
  it('reads duration from the header rather than assuming a sample rate', () => {
    expect(wavDurationSeconds(makeWav(2, 16_000))).toBeCloseTo(2, 3);
  });

  it('honours a different sample rate', () => {
    // A hardcoded 16 kHz would report this as 1 s instead of the real 0.5 s.
    expect(wavDurationSeconds(makeWav(0.5, 48_000))).toBeCloseTo(0.5, 3);
  });

  it('returns zero instead of throwing on a non-WAV buffer', () => {
    expect(wavDurationSeconds(new Uint8Array([1, 2, 3, 4]))).toBe(0);
  });

  it('does not read past the end when the declared size is truncated', () => {
    const wav = makeWav(1);
    expect(wavDurationSeconds(wav.subarray(0, wav.byteLength - 4_000))).toBeLessThan(1);
  });
});
