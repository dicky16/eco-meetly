import { describe, expect, it } from 'vitest';
import { estimatePitchHz, SpeakerTracker, splitIntoSentences } from '../electron/services/diarization';

function makeVoiceWave(f0Hz: number, harmonicBoost: number, durationSec = 0.5): Float32Array {
  const sr = 16000;
  const len = Math.floor(sr * durationSec);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    out[i] =
      0.4 * Math.sin(2 * Math.PI * f0Hz * t) +
      harmonicBoost * Math.sin(2 * Math.PI * f0Hz * 3 * t) +
      0.1 * Math.sin(2 * Math.PI * f0Hz * 5 * t);
  }
  return out;
}

describe('Offline Speaker Diarization', () => {
  it('estimates fundamental pitch accurately for low vs high voices', () => {
    const lowVoice = makeVoiceWave(110, 0.15);
    const highVoice = makeVoiceWave(240, 0.15);

    expect(estimatePitchHz(lowVoice)).toBeGreaterThan(95);
    expect(estimatePitchHz(lowVoice)).toBeLessThan(125);
    expect(estimatePitchHz(highVoice)).toBeGreaterThan(215);
    expect(estimatePitchHz(highVoice)).toBeLessThan(265);
  });

  it('clusters same speaker consistently and separates distinct voices', () => {
    const tracker = new SpeakerTracker(0.84, 8);
    const voiceA1 = makeVoiceWave(110, 0.1);
    const voiceA2 = makeVoiceWave(112, 0.12);
    const voiceB1 = makeVoiceWave(250, 0.35);

    const spk1 = tracker.identifySpeaker(voiceA1);
    const spk2 = tracker.identifySpeaker(voiceB1);
    const spk3 = tracker.identifySpeaker(voiceA2);

    expect(spk1).toBe('Speaker 1');
    expect(spk2).toBe('Speaker 2');
    expect(spk3).toBe('Speaker 1');
  });

  it('splits multi-sentence text into individual sentence turns', () => {
    const sentences = splitIntoSentences('Halo semuanya. Hari ini kita bahas API! Apakah sudah siap?');
    expect(sentences).toEqual([
      'Halo semuanya.',
      'Hari ini kita bahas API!',
      'Apakah sudah siap?',
    ]);
  });
});
