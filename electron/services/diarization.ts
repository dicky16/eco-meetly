/**
 * Lightweight offline acoustic speaker diarization for 16 kHz mono Float32 speech.
 * Extracts a 14-dimensional L2-normalized voiceprint (12 log-mel spectral bands +
 * fundamental pitch F0 + spectral centroid) and clusters turns via cosine similarity.
 */

export interface Voiceprint {
  vector: Float32Array;
  pitchHz: number;
}

const NUM_BANDS = 12;
const SAMPLE_RATE = 16000;

/**
 * Estimates fundamental frequency (F0) in Hz using normalized autocorrelation
 * over human speech pitch range (75 Hz – 350 Hz).
 */
export function estimatePitchHz(samples: Float32Array): number {
  const frameSize = Math.min(1024, samples.length);
  if (frameSize < 256) return 150;

  const start = Math.floor((samples.length - frameSize) / 2);
  const minLag = Math.floor(SAMPLE_RATE / 350); // ~45 samples
  const maxLag = Math.min(Math.floor(SAMPLE_RATE / 75), frameSize - 1); // ~213 samples

  let energy0 = 0;
  for (let i = 0; i < frameSize; i++) {
    const s = samples[start + i];
    energy0 += s * s;
  }
  if (energy0 < 1e-6) return 150;

  let bestLag = minLag;
  let bestCorr = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < frameSize - lag; i++) {
      corr += samples[start + i] * samples[start + i + lag];
    }
    const norm = corr / energy0;
    if (norm > bestCorr) {
      bestCorr = norm;
      bestLag = lag;
    }
  }

  return bestCorr > 0.25 ? SAMPLE_RATE / bestLag : 150;
}

/**
 * Extracts a 14-dim L2-normalized speaker voiceprint from 16 kHz mono audio.
 */
export function extractVoiceprint(samples: Float32Array): Voiceprint {
  const fftSize = 256;
  const halfBins = fftSize / 2;
  const bandEnergies = new Float64Array(NUM_BANDS);
  const numFrames = Math.max(1, Math.min(20, Math.floor(samples.length / fftSize)));
  const step = Math.max(fftSize, Math.floor(samples.length / numFrames));

  let spectralCentroidSum = 0;
  let totalMagSum = 0;

  // Compute average log-band spectrum across representative speech frames
  for (let f = 0; f < numFrames; f++) {
    const offset = f * step;
    if (offset + fftSize > samples.length) break;

    for (let k = 1; k < halfBins; k++) {
      let re = 0;
      let im = 0;
      const angleStep = (-2 * Math.PI * k) / fftSize;
      for (let n = 0; n < fftSize; n++) {
        // Hann window
        const win = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (fftSize - 1)));
        const x = samples[offset + n] * win;
        const angle = angleStep * n;
        re += x * Math.cos(angle);
        im += x * Math.sin(angle);
      }
      const mag = Math.sqrt(re * re + im * im);
      const freq = (k * SAMPLE_RATE) / fftSize;
      spectralCentroidSum += freq * mag;
      totalMagSum += mag;

      // Map bin 1..127 logarithmically into 12 spectral bands (100 Hz – 7500 Hz)
      const bandIdx = Math.min(
        NUM_BANDS - 1,
        Math.max(0, Math.floor((Math.log2(Math.max(100, freq) / 100) / Math.log2(75)) * NUM_BANDS))
      );
      bandEnergies[bandIdx] += mag;
    }
  }

  // Convert to log-energy and mean-normalize (removes microphone volume differences)
  const vec = new Float32Array(NUM_BANDS + 2);
  let meanLog = 0;
  for (let b = 0; b < NUM_BANDS; b++) {
    vec[b] = Math.log1p(bandEnergies[b] / numFrames);
    meanLog += vec[b];
  }
  meanLog /= NUM_BANDS;
  for (let b = 0; b < NUM_BANDS; b++) {
    vec[b] -= meanLog;
  }

  const pitchHz = estimatePitchHz(samples);
  const centroidHz = totalMagSum > 0 ? spectralCentroidSum / totalMagSum : 1500;
  vec[NUM_BANDS] = (pitchHz - 160) / 100;
  vec[NUM_BANDS + 1] = (centroidHz - 1800) / 1200;

  // L2-normalize
  let normSq = 0;
  for (let i = 0; i < vec.length; i++) {
    normSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(normSq) || 1;
  for (let i = 0; i < vec.length; i++) {
    vec[i] /= norm;
  }

  return { vector: vec, pitchHz };
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Tracks speakers across a single meeting and assigns consistent labels ("Speaker 1", "Speaker 2", ...).
 */
export class SpeakerTracker {
  private speakers: Array<{ label: string; centroid: Float32Array; count: number }> = [];
  private readonly similarityThreshold: number;
  private readonly maxSpeakers: number;

  constructor(similarityThreshold = 0.84, maxSpeakers = 8) {
    this.similarityThreshold = similarityThreshold;
    this.maxSpeakers = maxSpeakers;
  }

  identifySpeaker(samples16k: Float32Array): string {
    const { vector } = extractVoiceprint(samples16k);

    if (this.speakers.length === 0) {
      this.speakers.push({ label: 'Speaker 1', centroid: new Float32Array(vector), count: 1 });
      return 'Speaker 1';
    }

    let bestIdx = 0;
    let bestSim = -1;
    for (let i = 0; i < this.speakers.length; i++) {
      const sim = cosineSimilarity(vector, this.speakers[i].centroid);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }

    if (bestSim >= this.similarityThreshold || this.speakers.length >= this.maxSpeakers) {
      const spk = this.speakers[bestIdx];
      // Update centroid with gentle exponential moving average
      let normSq = 0;
      for (let i = 0; i < spk.centroid.length; i++) {
        spk.centroid[i] = spk.centroid[i] * 0.8 + vector[i] * 0.2;
        normSq += spk.centroid[i] * spk.centroid[i];
      }
      const norm = Math.sqrt(normSq) || 1;
      for (let i = 0; i < spk.centroid.length; i++) {
        spk.centroid[i] /= norm;
      }
      spk.count++;
      return spk.label;
    }

    const newLabel = `Speaker ${this.speakers.length + 1}`;
    this.speakers.push({ label: newLabel, centroid: new Float32Array(vector), count: 1 });
    return newLabel;
  }

  reset(): void {
    this.speakers = [];
  }
}

/**
 * Splits a multi-sentence Whisper transcript into individual sentences so each
 * transcript bubble represents 1 speaker and 1 clean sentence.
 */
export function splitIntoSentences(text: string): string[] {
  const cleaned = text.trim();
  if (!cleaned) return [];
  const parts = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [cleaned];
}
