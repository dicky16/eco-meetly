import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpRoot = '';

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => path.join(tmpRoot, name),
  },
}));

describe('SettingsService', () => {
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-meetly-settings-'));
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('initializes with sensible defaults and creates required directories', async () => {
    const { SettingsService } = await import('../electron/services/settings');
    const svc = new SettingsService();
    const s = svc.getSettings();

    expect(s.saveRecordedAudio).toBe(true);
    expect(s.languageMode).toBe('bilingual');
    expect(s.primaryLanguage).toBe('id');
    expect(s.secondaryLanguage).toBe('en');
    expect(fs.existsSync(s.storageDir)).toBe(true);
    expect(fs.existsSync(path.join(s.modelsDir, 'whisper'))).toBe(true);
    expect(fs.existsSync(path.join(s.modelsDir, 'llm'))).toBe(true);
  });

  it('persists updated storageDir, modelsDir, and saveRecordedAudio across instances', async () => {
    const { SettingsService } = await import('../electron/services/settings');
    const svc1 = new SettingsService();
    const customStorage = path.join(tmpRoot, 'ssd-meetings');
    const customModels = path.join(tmpRoot, 'ssd-models');

    svc1.updateSettings({
      storageDir: customStorage,
      modelsDir: customModels,
      saveRecordedAudio: false,
      languageMode: 'fixed',
    });

    const svc2 = new SettingsService();
    const loaded = svc2.getSettings();
    expect(loaded.storageDir).toBe(customStorage);
    expect(loaded.modelsDir).toBe(customModels);
    expect(loaded.saveRecordedAudio).toBe(false);
    expect(loaded.languageMode).toBe('fixed');
    expect(fs.existsSync(path.join(customModels, 'whisper'))).toBe(true);
    expect(fs.existsSync(path.join(customModels, 'llm'))).toBe(true);
  });
});
