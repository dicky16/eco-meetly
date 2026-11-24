import { ChildProcess, execFile, fork } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { AppSettings, WhisperModelInfo } from '../types';
import { getModelsBaseDir } from './settings';

const execFileAsync = promisify(execFile);

export const WHISPER_MODELS: Omit<WhisperModelInfo, 'downloaded'>[] = [
  {
    id: 'Xenova/whisper-tiny',
    name: 'Whisper Tiny',
    hfModelId: 'Xenova/whisper-tiny',
    sizeLabel: '~150 MB',
    description: 'Fastest local model. Best for quick notes on low-resource machines.',
  },
  {
    id: 'Xenova/whisper-base',
    name: 'Whisper Base',
    hfModelId: 'Xenova/whisper-base',
    sizeLabel: '~290 MB',
    description: 'Balanced speed and accuracy for everyday meetings.',
  },
  {
    id: 'Xenova/whisper-small',
    name: 'Whisper Small (Recommended)',
    hfModelId: 'Xenova/whisper-small',
    sizeLabel: '~500 MB',
    description: 'Great accuracy for Indonesian & bilingual Indonesian–English meetings.',
  },
  {
    id: 'Xenova/whisper-medium',
    name: 'Whisper Medium',
    hfModelId: 'Xenova/whisper-medium',
    sizeLabel: '~1.5 GB',
    description: 'High accuracy for complex terminology and noisy environments.',
  },
];

// Map ISO 639-1 codes to Whisper language names
const WHISPER_LANG_MAP: Record<string, string> = {
  id: 'indonesian',
  en: 'english',
  ms: 'malay',
  jv: 'javanese',
  su: 'sundanese',
  zh: 'chinese',
  ja: 'japanese',
  ko: 'korean',
  ar: 'arabic',
  es: 'spanish',
  fr: 'french',
  de: 'german',
};

export function toWhisperLanguage(code: string): string {
  return WHISPER_LANG_MAP[code] ?? code;
}

export interface TranscriptionResult {
  text: string;
  detectedLanguage: string | null;
}

type ProgressCallback = (info: { status: string; progress?: number; file?: string }) => void;

export class TranscriptionService {
  private worker: ChildProcess | null = null;
  private pending = new Map<
    string,
    {
      resolve: (data: { text?: string; ok?: boolean }) => void;
      reject: (err: Error) => void;
      onProgress?: ProgressCallback;
    }
  >();

  dispose(): void {
    if (this.worker) {
      this.worker.kill();
      this.worker = null;
    }
    for (const [, entry] of this.pending) {
      entry.reject(new Error('Transcription service shut down'));
    }
    this.pending.clear();
  }

  private getCacheDir(modelsDir?: string): string {
    return path.join(modelsDir || getModelsBaseDir(), 'whisper');
  }

  private getWorker(): ChildProcess {
    if (this.worker && this.worker.connected) {
      return this.worker;
    }

    const workerPath = path.join(__dirname, '../workers/whisperWorker.js');
    // Run in a clean Node.js process (system `node` in dev, or Electron-as-Node if packaged)
    const child = fork(workerPath, [], {
      execPath: process.env.NODE_EXEC_PATH || 'node',
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    child.on('message', (msg: { type: string; reqId: string; status?: string; progress?: number; file?: string; data?: { text?: string; ok?: boolean }; error?: string }) => {
      const entry = this.pending.get(msg.reqId);
      if (!entry) return;

      if (msg.type === 'progress') {
        entry.onProgress?.({
          status: msg.status ?? 'loading',
          progress: msg.progress,
          file: msg.file,
        });
        return;
      }

      this.pending.delete(msg.reqId);
      if (msg.type === 'error') {
        entry.reject(new Error(msg.error ?? 'Whisper worker error'));
      } else {
        entry.resolve(msg.data ?? {});
      }
    });

    child.on('exit', (code) => {
      for (const [, entry] of this.pending) {
        entry.reject(new Error(`Whisper worker exited unexpectedly (code ${code})`));
      }
      this.pending.clear();
      this.worker = null;
    });

    this.worker = child;
    return child;
  }

  private callWorker(
    payload: Record<string, unknown>,
    onProgress?: ProgressCallback
  ): Promise<{ text?: string; ok?: boolean }> {
    const id = crypto.randomUUID();
    const worker = this.getWorker();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      worker.send({ id, ...payload });
    });
  }

  listModels(modelsDir?: string): WhisperModelInfo[] {
    const cacheDir = this.getCacheDir(modelsDir);
    return WHISPER_MODELS.map((m) => {
      const modelFolder = path.join(cacheDir, m.hfModelId.replace('/', '--'));
      const legacyFolder = path.join(cacheDir, ...m.hfModelId.split('/'));
      const downloaded =
        (fs.existsSync(modelFolder) && fs.readdirSync(modelFolder).length > 0) ||
        (fs.existsSync(legacyFolder) && fs.readdirSync(legacyFolder).length > 0);
      return { ...m, downloaded };
    });
  }

  async ensureModelLoaded(modelId: string, modelsDir?: string, onProgress?: ProgressCallback): Promise<void> {
    const cacheDir = this.getCacheDir(modelsDir);
    await this.callWorker({ type: 'load', modelId, cacheDir }, onProgress);
  }

  private async runWhisper(
    audio16k: Float32Array,
    settings: AppSettings,
    options: { language?: string; task: 'transcribe' | 'translate' },
    onProgress?: ProgressCallback
  ): Promise<string> {
    const buf = Buffer.from(audio16k.buffer, audio16k.byteOffset, audio16k.byteLength);
    const res = await this.callWorker(
      {
        type: 'transcribe',
        modelId: settings.whisperModel,
        cacheDir: this.getCacheDir(settings.modelsDir),
        audioBase64: buf.toString('base64'),
        language: options.language,
        task: options.task,
      },
      onProgress
    );
    return String(res.text ?? '').trim();
  }

  /**
   * Transcribes a 16 kHz mono Float32Array audio segment using the configured language mode:
   * - `fixed`: forces `primaryLanguage`
   * - `bilingual`: uses smart detection constrained/biased toward `{primaryLanguage, secondaryLanguage}`,
   *   falling back to `primaryLanguage` if detection drifts to unrelated languages
   * - `auto`: unconstrained auto-detect (with optional translate-to-English)
   */
  async transcribeFloat32(
    audio16k: Float32Array,
    settings: AppSettings,
    onProgress?: ProgressCallback
  ): Promise<TranscriptionResult> {
    if (audio16k.length < 1600) {
      return { text: '', detectedLanguage: null };
    }

    const primaryName = toWhisperLanguage(settings.primaryLanguage);
    const secondaryName = toWhisperLanguage(settings.secondaryLanguage);

    if (settings.languageMode === 'fixed') {
      const text = await this.runWhisper(audio16k, settings, { language: primaryName, task: 'transcribe' }, onProgress);
      return {
        text,
        detectedLanguage: settings.primaryLanguage,
      };
    }

    if (settings.languageMode === 'bilingual') {
      const rawText = await this.runWhisper(audio16k, settings, { task: 'transcribe' }, onProgress);
      const detected = this.inferLanguageFromText(rawText, settings.primaryLanguage, settings.secondaryLanguage);

      if (!rawText || (detected !== settings.primaryLanguage && detected !== settings.secondaryLanguage)) {
        const fallbackText = await this.runWhisper(
          audio16k,
          settings,
          { language: primaryName, task: 'transcribe' },
          onProgress
        );
        return {
          text: fallbackText,
          detectedLanguage: settings.primaryLanguage,
        };
      }

      const words = rawText.split(/\s+/).filter(Boolean);
      if (words.length <= 2 && detected !== settings.primaryLanguage && secondaryName !== primaryName) {
        const primaryText = await this.runWhisper(
          audio16k,
          settings,
          { language: primaryName, task: 'transcribe' },
          onProgress
        );
        if (primaryText.length > 0) {
          return { text: primaryText, detectedLanguage: settings.primaryLanguage };
        }
      }

      return { text: rawText, detectedLanguage: detected };
    }

    // Full Auto-Detect mode
    const text = await this.runWhisper(
      audio16k,
      settings,
      { task: settings.autoTranslateToEnglish ? 'translate' : 'transcribe' },
      onProgress
    );
    return {
      text,
      detectedLanguage: 'auto',
    };
  }

  /**
   * Decodes an audio file (wav, mp3, m4a, ogg, webm) into 16 kHz mono Float32 PCM using ffmpeg.
   */
  async decodeAudioFileTo16k(filePath: string): Promise<Float32Array> {
    const tmpRaw = path.join(path.dirname(filePath), `.tmp_16k_${Date.now()}.f32`);
    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-i',
        filePath,
        '-ac',
        '1',
        '-ar',
        '16000',
        '-f',
        'f32le',
        tmpRaw,
      ]);
      const buf = fs.readFileSync(tmpRaw);
      const floatArray = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      return new Float32Array(floatArray);
    } finally {
      if (fs.existsSync(tmpRaw)) {
        fs.unlinkSync(tmpRaw);
      }
    }
  }

  private inferLanguageFromText(text: string, primary: string, secondary: string): string {
    const latinLangs = new Set(['id', 'en', 'ms', 'jv', 'su', 'es', 'fr', 'de']);
    if (latinLangs.has(primary) && latinLangs.has(secondary)) {
      // Reject non-Latin script hallucinations (e.g. Cyrillic, CJK, Arabic) when expecting Latin languages
      const nonLatinChars = (text.match(/[^\u0000-\u024F\s\d.,!?'"():;\-–—]/g) ?? []).length;
      if (nonLatinChars > Math.max(2, text.length * 0.15)) {
        return 'unknown';
      }
    }

    const lower = text.toLowerCase();
    // Common Indonesian markers to prevent drift on mixed meetings
    const idMarkers = /\b(yang|dan|di|ke|dari|untuk|ini|itu|dengan|tidak|ada|kita|kami|saya|sudah|bisa|akan|jadi|atau|karena|kalau|ya|oke|baik|juga|dalam|pada|mereka|belum|mau)\b/;
    const enMarkers = /\b(the|and|is|are|to|of|in|for|that|this|with|we|you|have|will|can|not|but|on|at|from|they|it)\b/;

    const hasId = idMarkers.test(lower);
    const hasEn = enMarkers.test(lower);

    if (primary === 'id' || secondary === 'id') {
      if (hasId && !hasEn) return 'id';
      if (hasEn && !hasId) return 'en';
      if (hasId) return 'id';
      const wordCount = lower.split(/\s+/).filter(Boolean).length;
      if (wordCount >= 3 && !hasId && !hasEn) {
        return 'unknown';
      }
    }
    return primary;
  }
}

export interface Pcm16kSegment {
  samples: Float32Array;
  startTimeMs: number;
  endTimeMs: number;
}

/**
 * Splits a 16 kHz mono PCM buffer at low-energy pauses (between 16s and 26s),
 * skips silent windows, normalizes quiet speech, and adds 150ms silence padding.
 */
export function segmentPcm16kSmart(pcm16k: Float32Array): Pcm16kSegment[] {
  const sr = 16000;
  const minChunk = sr * 16;
  const targetChunk = sr * 22;
  const maxChunk = sr * 26;
  const winSize = 1600; // 100ms energy window
  const segments: Pcm16kSegment[] = [];

  let offset = 0;
  while (offset < pcm16k.length) {
    let end = Math.min(offset + targetChunk, pcm16k.length);

    // Search for the quietest 100ms pause between 16s and 26s so words are not cut mid-syllable
    if (offset + maxChunk < pcm16k.length) {
      let bestPos = end;
      let lowestEnergy = Infinity;
      const searchStart = offset + minChunk;
      const searchEnd = Math.min(offset + maxChunk, pcm16k.length - winSize);
      for (let pos = searchStart; pos <= searchEnd; pos += winSize) {
        let sumSq = 0;
        for (let i = 0; i < winSize; i++) {
          const s = pcm16k[pos + i];
          sumSq += s * s;
        }
        const rms = Math.sqrt(sumSq / winSize);
        if (rms < lowestEnergy) {
          lowestEnergy = rms;
          bestPos = pos + Math.floor(winSize / 2);
        }
      }
      end = bestPos;
    }

    const slice = pcm16k.subarray(offset, end);
    let sumSq = 0;
    let mean = 0;
    for (let i = 0; i < slice.length; i++) {
      mean += slice[i];
    }
    mean /= Math.max(1, slice.length);

    let peak = 0;
    for (let i = 0; i < slice.length; i++) {
      const centered = slice[i] - mean;
      sumSq += centered * centered;
      const abs = Math.abs(centered);
      if (abs > peak) peak = abs;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, slice.length));

    if (slice.length >= 3200 && rms >= 0.002) {
      const gain = peak > 0.005 && peak < 0.7 ? Math.min(4.0, 0.7 / peak) : 1.0;
      const pad = 2400; // 150ms
      const prepared = new Float32Array(slice.length + pad * 2);
      for (let i = 0; i < slice.length; i++) {
        prepared[pad + i] = Math.max(-1, Math.min(1, (slice[i] - mean) * gain));
      }
      segments.push({
        samples: prepared,
        startTimeMs: Math.round((offset / sr) * 1000),
        endTimeMs: Math.round((end / sr) * 1000),
      });
    }

    offset = end;
  }

  return segments;
}
