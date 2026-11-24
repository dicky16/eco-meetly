import { ChildProcess, fork } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AppSettings, BuiltinLlmModelInfo, SummaryTemplate, TranscriptSegment } from '../types';
import { getModelsBaseDir } from './settings';

export const SUMMARY_TEMPLATES: SummaryTemplate[] = [
  {
    id: 'executive-action',
    name: 'Executive Summary & Action Items',
    description: 'Concise overview, key decisions, and assigned action items.',
    systemPrompt:
      'You are an expert meeting assistant. Summarize the meeting transcript clearly in Markdown with these sections:\n' +
      '## Executive Summary\n(2-4 sentences)\n\n' +
      '## Key Decisions\n- Bullet list of decisions made\n\n' +
      '## Action Items\n- [ ] Task — Owner (if mentioned)\n\n' +
      '## Open Questions & Follow-ups\n- Any unresolved topics',
  },
  {
    id: 'detailed-notes',
    name: 'Detailed Meeting Notes',
    description: 'Topic-by-topic breakdown with thorough context and takeaways.',
    systemPrompt:
      'You are a meticulous note-taker. Produce structured, detailed meeting notes in Markdown with:\n' +
      '## Overview\n\n## Discussion Topics\n(Group by topic with bullet points)\n\n## Key Takeaways\n\n## Next Steps',
  },
  {
    id: 'standup',
    name: 'Daily Standup / Sync',
    description: 'Short format covering progress, blockers, and next steps.',
    systemPrompt:
      'Summarize this sync meeting concisely in Markdown:\n' +
      '## Progress & Updates\n\n## Blockers & Risks\n\n## Next Steps',
  },
];

export const BUILTIN_LLM_MODELS: Omit<BuiltinLlmModelInfo, 'downloaded'>[] = [
  {
    id: 'qwen2.5-3b-instruct-q4_k_m',
    name: 'Qwen 2.5 3B Instruct (Q4_K_M)',
    filename: 'qwen2.5-3b-instruct-q4_k_m.gguf',
    downloadUrl:
      'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf',
    sizeLabel: '~2.1 GB',
    preset: 'qwen35_summary',
  },
  {
    id: 'gemma-2-2b-it-q4_k_m',
    name: 'Gemma 2 2B Instruct (Q4_K_M)',
    filename: 'gemma-2-2b-it-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf',
    sizeLabel: '~1.6 GB',
    preset: 'gemma3_instruct',
  },
];

const SUMMARY_LANG_NAMES: Record<string, string> = {
  id: 'Indonesian (Bahasa Indonesia)',
  en: 'English',
  ms: 'Malay',
  jv: 'Javanese',
  su: 'Sundanese',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  ar: 'Arabic',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
};

export function detectDominantLanguage(
  segments: Pick<TranscriptSegment, 'text' | 'detectedLanguage'>[],
  fallbackLanguage: string
): string {
  const scores = new Map<string, number>();

  for (const seg of segments) {
    const words = seg.text.trim().split(/\s+/).filter(Boolean).length;
    if (words === 0) continue;

    if (seg.detectedLanguage && seg.detectedLanguage !== 'auto') {
      scores.set(seg.detectedLanguage, (scores.get(seg.detectedLanguage) ?? 0) + words);
    }

    const lower = seg.text.toLowerCase();
    const idHits = (lower.match(/\b(yang|dan|di|ke|dari|untuk|ini|itu|dengan|tidak|ada|kita|kami|saya|sudah|bisa|akan|jadi|atau|karena|kalau|ya|oke|baik|juga|dalam|pada)\b/g) ?? []).length;
    const enHits = (lower.match(/\b(the|and|is|are|to|of|in|for|that|this|with|we|you|have|will|can|not|but|on|at|from|they|it|let|our)\b/g) ?? []).length;

    if (idHits > enHits) {
      scores.set('id', (scores.get('id') ?? 0) + idHits * 2);
    } else if (enHits > idHits) {
      scores.set('en', (scores.get('en') ?? 0) + enHits * 2);
    }
  }

  let bestLang = fallbackLanguage;
  let bestScore = 0;
  for (const [lang, score] of scores.entries()) {
    if (score > bestScore) {
      bestScore = score;
      bestLang = lang;
    }
  }
  return bestLang;
}

export class SummaryService {
  private activeChild: ChildProcess | null = null;

  dispose(): void {
    if (this.activeChild) {
      this.activeChild.kill();
      this.activeChild = null;
    }
  }

  private getLlmDir(modelsDir?: string): string {
    return path.join(modelsDir || getModelsBaseDir(), 'llm');
  }

  listBuiltinModels(modelsDir?: string): BuiltinLlmModelInfo[] {
    const dir = this.getLlmDir(modelsDir);
    return BUILTIN_LLM_MODELS.map((m) => ({
      ...m,
      downloaded: fs.existsSync(path.join(dir, m.filename)),
    }));
  }

  async downloadBuiltinModel(
    modelId: string,
    modelsDir: string | undefined,
    onProgress: (percent: number, message: string) => void
  ): Promise<string> {
    const model = BUILTIN_LLM_MODELS.find((m) => m.id === modelId);
    if (!model) throw new Error(`Unknown built-in model: ${modelId}`);

    const dir = this.getLlmDir(modelsDir);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, model.filename);
    const tmpDest = `${dest}.downloading`;

    onProgress(0, `Starting download for ${model.name}...`);
    const response = await fetch(model.downloadUrl);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download model (${response.status} ${response.statusText})`);
    }

    const totalBytes = Number(response.headers.get('content-length') ?? 0);
    let receivedBytes = 0;
    let lastEmitAt = 0;
    let lastPct = -1;
    const fileStream = fs.createWriteStream(tmpDest);
    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fileStream.write(Buffer.from(value));
        receivedBytes += value.byteLength;
        if (totalBytes > 0) {
          const pct = Math.min(99, Math.round((receivedBytes / totalBytes) * 100));
          const now = Date.now();
          if (pct !== lastPct || now - lastEmitAt >= 200) {
            lastPct = pct;
            lastEmitAt = now;
            const mbDone = (receivedBytes / (1024 * 1024)).toFixed(0);
            const mbTotal = (totalBytes / (1024 * 1024)).toFixed(0);
            onProgress(pct, `Downloading ${model.name} (${mbDone} / ${mbTotal} MB)`);
          }
        }
      }
      fileStream.end();
      await new Promise<void>((resolve) => fileStream.on('finish', resolve));
      fs.renameSync(tmpDest, dest);
      onProgress(100, `${model.name} downloaded`);
      return dest;
    } catch (err) {
      fileStream.close();
      if (fs.existsSync(tmpDest)) fs.unlinkSync(tmpDest);
      throw err;
    }
  }

  async checkOllama(ollamaUrl: string): Promise<{ available: boolean; models: string[] }> {
    try {
      const res = await fetch(`${ollamaUrl.replace(/\/$/, '')}/api/tags`);
      if (!res.ok) return { available: false, models: [] };
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      return {
        available: true,
        models: (data.models ?? []).map((m) => m.name),
      };
    } catch {
      return { available: false, models: [] };
    }
  }

  async generateSummary(
    transcriptText: string,
    settings: AppSettings,
    onToken: (chunk: string) => void,
    customPrompt?: string,
    dominantLanguage?: string
  ): Promise<{ content: string; modelName: string }> {
    const template =
      SUMMARY_TEMPLATES.find((t) => t.id === settings.summaryTemplateId) ?? SUMMARY_TEMPLATES[0];

    const targetLang = dominantLanguage || settings.primaryLanguage;
    const langName = SUMMARY_LANG_NAMES[targetLang] ?? targetLang;
    const extraInstruction = customPrompt?.trim()
      ? `\n\nAdditional user instructions:\n${customPrompt.trim()}`
      : '';

    const userPrompt =
      `Here is the meeting transcript. Produce a clear, accurate summary following your instructions. ` +
      `IMPORTANT: Write the entire summary in ${langName}.${extraInstruction}\n\n` +
      `Transcript:\n${transcriptText}`;

    const result =
      settings.llmProvider === 'ollama'
        ? await this.generateWithOllama(
            settings.ollamaUrl,
            settings.ollamaModel,
            template.systemPrompt,
            userPrompt,
            onToken
          )
        : await this.generateWithBuiltinLlama(
            settings.builtinModelId,
            settings.modelsDir,
            template.systemPrompt,
            userPrompt,
            onToken
          );

    if (!result.content || !result.content.trim()) {
      throw new Error('The AI model returned an empty summary. Please try again.');
    }
    return result;
  }

  private async generateWithOllama(
    ollamaUrl: string,
    model: string,
    systemPrompt: string,
    userPrompt: string,
    onToken: (chunk: string) => void
  ): Promise<{ content: string; modelName: string }> {
    const base = ollamaUrl.replace(/\/$/, '');
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Ollama request failed (${res.status}). Make sure Ollama is running locally.`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value, { stream: true }).split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const json = JSON.parse(line) as { message?: { content?: string } };
          const token = json.message?.content ?? '';
          if (token) {
            fullText += token;
            onToken(token);
          }
        } catch {
          // Ignore partial NDJSON line
        }
      }
    }

    return { content: fullText.trim(), modelName: model };
  }

  private async generateWithBuiltinLlama(
    modelId: string,
    modelsDir: string | undefined,
    systemPrompt: string,
    userPrompt: string,
    onToken: (chunk: string) => void
  ): Promise<{ content: string; modelName: string }> {
    const modelDef = BUILTIN_LLM_MODELS.find((m) => m.id === modelId);
    if (!modelDef) throw new Error(`Built-in model not found: ${modelId}`);

    const modelPath = path.join(this.getLlmDir(modelsDir), modelDef.filename);
    if (!fs.existsSync(modelPath)) {
      throw new Error(
        `Model "${modelDef.name}" is not downloaded yet. Please download it in Settings -> AI Models.`
      );
    }

    const temperature =
      modelDef.preset === 'qwen35_summary'
        ? 0.5
        : modelDef.preset === 'gemma3_instruct'
          ? 0.7
          : 0.1;
    const topK = modelDef.preset === 'gemma3_instruct' ? 64 : 20;
    const topP = modelDef.preset === 'gemma3_instruct' ? 0.95 : 0.85;

    const workerPath = path.join(__dirname, '../workers/llamaWorker.js');
    const child = fork(workerPath, [], {
      execPath: process.env.NODE_EXEC_PATH || 'node',
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
    this.activeChild = child;

    const reqId = crypto.randomUUID();
    const content = await new Promise<string>((resolve, reject) => {
      let settled = false;
      let stderrLog = '';

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderrLog += text;
        console.error('[llamaWorker]', text.trim());
      });

      child.on('message', (msg: { type: string; reqId: string; token?: string; content?: string; error?: string }) => {
        if (msg.reqId !== reqId) return;
        if (msg.type === 'token') {
          if (msg.token) {
            onToken(msg.token);
          }
          return;
        }
        if (msg.type !== 'result' && msg.type !== 'error') return;
        settled = true;
        this.activeChild = null;
        child.kill();
        if (msg.type === 'error') {
          reject(new Error(msg.error ?? 'Local LLM worker failed'));
        } else {
          resolve(msg.content ?? '');
        }
      });

      child.on('error', (err) => {
        if (!settled) {
          settled = true;
          reject(new Error(`Failed to start local LLM worker: ${err.message}`));
        }
      });

      child.on('exit', (code) => {
        if (!settled) {
          reject(new Error(`Local LLM worker exited unexpectedly (code ${code}): ${stderrLog.slice(-300)}`));
        }
      });

      child.send({
        id: reqId,
        modelPath,
        systemPrompt,
        userPrompt,
        temperature,
        topK,
        topP,
      });
    });

    return { content, modelName: modelDef.name };
  }
}
