import { describe, expect, it } from 'vitest';
import { downsample48kTo16k, prepareSpeechForWhisper, resampleTo16k } from '../src/audio/audioPipeline';

describe('audioPipeline helpers', () => {
  it('downsamples 48 kHz audio to 16 kHz by averaging 3-sample windows', () => {
    const input = new Float32Array([0.3, 0.6, 0.9, -0.3, 0.0, 0.3]);
    const output = downsample48kTo16k(input);

    expect(output.length).toBe(2);
    expect(output[0]).toBeCloseTo(0.6, 5);
    expect(output[1]).toBeCloseTo(0.0, 5);
  });

  it('resamples 44.1 kHz audio to 16 kHz accurately', () => {
    const input = new Float32Array(44100).fill(0.25);
    const output = resampleTo16k(input, 44100);
    expect(output.length).toBe(16000);
    expect(output[0]).toBeCloseTo(0.25, 5);
  });

  it('normalizes quiet speech and adds 150ms silence padding', () => {
    const input = new Float32Array(1600);
    for (let i = 0; i < input.length; i++) {
      input[i] = i % 2 === 0 ? 0.1 : -0.1;
    }
    const prepared = prepareSpeechForWhisper(input);
    // 1600 + 2 * 2400 = 6400 samples
    expect(prepared.length).toBe(6400);
    // Leading & trailing padding should be silent
    expect(prepared[0]).toBe(0);
    expect(prepared[prepared.length - 1]).toBe(0);
    // Speech region boosted toward ~0.4 (4x gain)
    expect(Math.abs(prepared[2400])).toBeCloseTo(0.4, 2);
  });
});
