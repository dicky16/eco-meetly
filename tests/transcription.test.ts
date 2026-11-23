import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultSettings } from '../electron/services/settings';
import { toWhisperLanguage, TranscriptionService } from '../electron/services/transcription';

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => path.join(os.tmpdir(), 'eco-meetly-mock', name),
  },
}));

describe('TranscriptionService', () => {
  let tmpModelsDir = '';

  beforeEach(() => {
    tmpModelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-meetly-stt-'));
  });

  afterEach(() => {
    fs.rmSync(tmpModelsDir, { recursive: true, force: true });
  });

  it('maps ISO language codes to Whisper language names', () => {
    expect(toWhisperLanguage('id')).toBe('indonesian');
    expect(toWhisperLanguage('en')).toBe('english');
    expect(toWhisperLanguage('unknown')).toBe('unknown');
  });

  it('detects cached Whisper models inside custom SSD modelsDir', () => {
    const svc = new TranscriptionService();
    const whisperCache = path.join(tmpModelsDir, 'whisper', 'Xenova--whisper-small');
    fs.mkdirSync(whisperCache, { recursive: true });
    fs.writeFileSync(path.join(whisperCache, 'config.json'), '{}');

    const models = svc.listModels(tmpModelsDir);
    const small = models.find((m) => m.id === 'Xenova/whisper-small');
    const tiny = models.find((m) => m.id === 'Xenova/whisper-tiny');
    expect(small?.downloaded).toBe(true);
    expect(tiny?.downloaded).toBe(false);
  });

  it('skips audio shorter than 1600 samples', async () => {
    const svc = new TranscriptionService();
    const settings = getDefaultSettings();
    const res = await svc.transcribeFloat32(new Float32Array(500), settings);
    expect(res).toEqual({ text: '', detectedLanguage: null });
  });

  it('handles fixed, bilingual, and auto language modes correctly', async () => {
    const svc = new TranscriptionService();
    const runSpy = vi
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(svc as any, 'runWhisper')
      .mockImplementation(async (...args: unknown[]) => {
        const opts = args[2] as { language?: string; task: string };
        if (opts.language === 'indonesian') return 'Kita mulai rapat hari ini.';
        if (opts.task === 'translate') return 'We start the meeting today.';
        return 'The project timeline is ready.';
      });

    const audio = new Float32Array(16000);

    // Fixed mode
    const fixedSettings = { ...getDefaultSettings(), languageMode: 'fixed' as const, primaryLanguage: 'id' };
    const fixedRes = await svc.transcribeFloat32(audio, fixedSettings);
    expect(fixedRes).toEqual({ text: 'Kita mulai rapat hari ini.', detectedLanguage: 'id' });

    // Bilingual mode detecting English
    const biSettings = {
      ...getDefaultSettings(),
      languageMode: 'bilingual' as const,
      primaryLanguage: 'id',
      secondaryLanguage: 'en',
    };
    const biRes = await svc.transcribeFloat32(audio, biSettings);
    expect(biRes).toEqual({ text: 'The project timeline is ready.', detectedLanguage: 'en' });

    // Auto translate mode
    const autoSettings = {
      ...getDefaultSettings(),
      languageMode: 'auto' as const,
      autoTranslateToEnglish: true,
    };
    const autoRes = await svc.transcribeFloat32(audio, autoSettings);
    expect(autoRes).toEqual({ text: 'We start the meeting today.', detectedLanguage: 'auto' });

    expect(runSpy).toHaveBeenCalled();
  });
});
