import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultSettings } from '../electron/services/settings';
import { BUILTIN_LLM_MODELS, detectDominantLanguage, SUMMARY_TEMPLATES, SummaryService } from '../electron/services/summary';

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => path.join(os.tmpdir(), 'eco-meetly-mock', name),
  },
}));

describe('SummaryService', () => {
  let tmpModelsDir = '';

  beforeEach(() => {
    tmpModelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-meetly-llm-'));
  });

  afterEach(() => {
    fs.rmSync(tmpModelsDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('exposes curated summary templates and built-in GGUF models', () => {
    expect(SUMMARY_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    expect(BUILTIN_LLM_MODELS.length).toBeGreaterThanOrEqual(2);
  });

  it('detects downloaded GGUF models inside custom modelsDir', () => {
    const svc = new SummaryService();
    const llmDir = path.join(tmpModelsDir, 'llm');
    fs.mkdirSync(llmDir, { recursive: true });
    fs.writeFileSync(path.join(llmDir, BUILTIN_LLM_MODELS[0].filename), 'gguf-stub');

    const list = svc.listBuiltinModels(tmpModelsDir);
    expect(list[0].downloaded).toBe(true);
    expect(list[1].downloaded).toBe(false);
  });

  it('throws a clear error when built-in GGUF model is missing', async () => {
    const svc = new SummaryService();
    const settings = { ...getDefaultSettings(), modelsDir: tmpModelsDir, llmProvider: 'builtin-llama' as const };
    await expect(svc.generateSummary('Hello world', settings, () => {})).rejects.toThrow(/not downloaded yet/i);
  });

  it('streams summary tokens from local Ollama server', async () => {
    const ndjson = [
      JSON.stringify({ message: { content: '## Summary\n' } }),
      JSON.stringify({ message: { content: 'All tasks assigned.' } }),
    ].join('\n');

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(ndjson));
        controller.close();
      },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: stream,
      })
    );

    const svc = new SummaryService();
    const settings = {
      ...getDefaultSettings(),
      llmProvider: 'ollama' as const,
      ollamaModel: 'qwen2.5:3b',
    };

    const tokens: string[] = [];
    const res = await svc.generateSummary('Meeting transcript here', settings, (t) => tokens.push(t));
    expect(tokens.join('')).toBe('## Summary\nAll tasks assigned.');
    expect(res.content).toBe('## Summary\nAll tasks assigned.');
    expect(res.modelName).toBe('qwen2.5:3b');
  });

  it('detects dominant meeting language for summary output (English vs Indonesian)', () => {
    const enSegments = [
      { text: 'We need to finalize the release timeline for next week.', detectedLanguage: 'en' },
      { text: 'Let us review the action items and assign owners.', detectedLanguage: 'en' },
      { text: 'Oke siap.', detectedLanguage: 'id' },
    ];
    expect(detectDominantLanguage(enSegments, 'id')).toBe('en');

    const idSegments = [
      { text: 'Kita harus selesaikan rilis aplikasi minggu ini.', detectedLanguage: 'auto' },
      { text: 'Untuk bagian backend dan database sudah aman.', detectedLanguage: 'auto' },
    ];
    expect(detectDominantLanguage(idSegments, 'en')).toBe('id');
  });
});
