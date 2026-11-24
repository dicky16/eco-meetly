import fs from 'node:fs';
import path from 'node:path';

type WorkerRequest =
  | { id: string; type: 'load'; modelId: string; cacheDir: string }
  | {
      id: string;
      type: 'transcribe';
      modelId: string;
      cacheDir: string;
      audioBase64: string;
      language?: string;
      task: 'transcribe' | 'translate';
    };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transcriber: any = null;
let loadedModelId: string | null = null;
let loadedCacheDir: string | null = null;
let loadingPromise: Promise<void> | null = null;
let inferQueue: Promise<void> = Promise.resolve();

function send(msg: Record<string, unknown>): void {
  if (process.send) {
    process.send(msg);
  }
}

async function ensureLoaded(modelId: string, cacheDir: string, reqId: string): Promise<void> {
  if (transcriber && loadedModelId === modelId && loadedCacheDir === cacheDir) return;
  if (loadingPromise) {
    await loadingPromise;
    if (loadedModelId === modelId && loadedCacheDir === cacheDir) return;
  }

  loadingPromise = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    fs.mkdirSync(cacheDir, { recursive: true });
    env.cacheDir = cacheDir;
    env.allowLocalModels = true;

    const loadPipeline = async () => {
      const fileProgress = new Map<string, { loaded: number; total: number }>();
      let lastEmitAt = 0;
      let lastPct = -1;

      return pipeline('automatic-speech-recognition', modelId, {
        dtype: 'q8',
        progress_callback: (data: {
          status?: string;
          progress?: number;
          file?: string;
          loaded?: number;
          total?: number;
        }) => {
          const fileName = data.file ? path.basename(data.file) : 'model';
          if (data.status === 'progress' && typeof data.loaded === 'number' && typeof data.total === 'number' && data.total > 0) {
            fileProgress.set(fileName, { loaded: data.loaded, total: data.total });
          } else if (data.status === 'done' && fileProgress.has(fileName)) {
            const entry = fileProgress.get(fileName)!;
            fileProgress.set(fileName, { loaded: entry.total, total: entry.total });
          }

          let sumLoaded = 0;
          let sumTotal = 0;
          for (const entry of fileProgress.values()) {
            sumLoaded += entry.loaded;
            sumTotal += entry.total;
          }

          const computedPct =
            sumTotal > 1_000_000
              ? Math.min(99, Math.round((sumLoaded / sumTotal) * 100))
              : undefined;

          const now = Date.now();
          if (now - lastEmitAt < 180 && computedPct === lastPct) return;
          if (now - lastEmitAt < 120 && data.status === 'progress') return;

          lastEmitAt = now;
          if (typeof computedPct === 'number') lastPct = computedPct;

          const mbLoaded = (sumLoaded / (1024 * 1024)).toFixed(1);
          const mbTotal = (sumTotal / (1024 * 1024)).toFixed(1);
          const detail = sumTotal > 0 ? ` (${mbLoaded} / ${mbTotal} MB)` : '';

          send({
            type: 'progress',
            reqId,
            status: `Downloading ${path.basename(modelId)} — ${fileName}${detail}`,
            progress: computedPct,
            file: data.file,
          });
        },
      });
    };

    try {
      transcriber = await loadPipeline();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/protobuf parsing failed|onnx/i.test(msg)) {
        // Auto-recover from partially downloaded/corrupt ONNX cache
        const modelCacheA = path.join(cacheDir, ...modelId.split('/'));
        const modelCacheB = path.join(cacheDir, modelId.replace('/', '--'));
        fs.rmSync(modelCacheA, { recursive: true, force: true });
        fs.rmSync(modelCacheB, { recursive: true, force: true });
        send({
          type: 'progress',
          reqId,
          status: `Repairing corrupt cache for ${path.basename(modelId)}...`,
          progress: 0,
        });
        transcriber = await loadPipeline();
      } else {
        throw err;
      }
    }

    loadedModelId = modelId;
    loadedCacheDir = cacheDir;
  })();

  try {
    await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

function cleanWhisperOutput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // Drop common Whisper silence & YouTube-outro hallucinations
  const hallucinations = [
    /^(\[blank_audio\]|\(musik\)|\(music\)|\[music\]|\.+|[^\p{L}\p{N}]+)$/iu,
    /^(terima kasih(\s+telah\s+menonton|\s+banyak)?\.?|sampai\s+jumpa\.?|jangan\s+lupa\s+(like|subscribe).*|thank you(\s+for\s+watching)?\.?|thanks\s+for\s+watching\.?|subtitles?\s+by.*)$/i,
  ];
  if (hallucinations.some((re) => re.test(trimmed))) {
    return '';
  }
  // Reject pathological single-word repetition loops (e.g. "ya ya ya ya ya")
  const words = trimmed.toLowerCase().split(/\s+/);
  if (words.length >= 5 && new Set(words).size === 1) {
    return '';
  }
  return trimmed;
}

process.on('message', async (msg: WorkerRequest) => {
  try {
    if (msg.type === 'load') {
      send({ type: 'progress', reqId: msg.id, status: `Preparing ${path.basename(msg.modelId)}...`, progress: 0 });
      await ensureLoaded(msg.modelId, msg.cacheDir, msg.id);
      send({ type: 'progress', reqId: msg.id, status: `${path.basename(msg.modelId)} ready`, progress: 100 });
      send({ type: 'result', reqId: msg.id, data: { ok: true } });
      return;
    }

    if (msg.type === 'transcribe') {
      const task = inferQueue.then(async () => {
        const buf = Buffer.from(msg.audioBase64, 'base64');
        const floatArray = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

        // Skip pure silence segments to save CPU and avoid hallucinations
        let sumSq = 0;
        for (let i = 0; i < floatArray.length; i++) {
          sumSq += floatArray[i] * floatArray[i];
        }
        const rms = Math.sqrt(sumSq / Math.max(1, floatArray.length));
        if (floatArray.length < 1600 || rms < 0.0015) {
          send({ type: 'result', reqId: msg.id, data: { text: '' } });
          return;
        }

        await ensureLoaded(msg.modelId, msg.cacheDir, msg.id);

        const options: Record<string, unknown> = {
          task: msg.task,
          chunk_length_s: 30,
          stride_length_s: 5,
          num_beams: 3,
          no_repeat_ngram_size: 3,
          temperature: 0.0,
          condition_on_prev_text: false,
        };
        if (msg.language) {
          options.language = msg.language;
        }

        const out = await transcriber(floatArray, options);
        const cleaned = cleanWhisperOutput(String(out?.text ?? ''));
        send({
          type: 'result',
          reqId: msg.id,
          data: { text: cleaned },
        });
      });
      inferQueue = task.catch(() => {});
      await task;
    }
  } catch (err) {
    send({
      type: 'error',
      reqId: msg.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
