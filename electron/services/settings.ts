import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { AppSettings } from '../types';

export function getDefaultStorageDir(): string {
  return path.join(app.getPath('documents'), 'EcoMeetly');
}

export function getModelsBaseDir(): string {
  return path.join(app.getPath('userData'), 'models');
}

export function getDefaultSettings(): AppSettings {
  return {
    theme: 'light',
    storageDir: getDefaultStorageDir(),
    modelsDir: getModelsBaseDir(),
    saveRecordedAudio: true,
    languageMode: 'bilingual',
    primaryLanguage: 'id',
    secondaryLanguage: 'en',
    autoTranslateToEnglish: false,
    sttEngine: 'whisper',
    whisperModel: 'Xenova/whisper-small',
    selectedMicDeviceId: 'default',
    llmProvider: 'builtin-llama',
    builtinModelId: 'qwen2.5-3b-instruct-q4_k_m',
    ollamaUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'qwen2.5:3b',
    summaryTemplateId: 'executive-action',
  };
}

export class SettingsService {
  private configPath: string;
  private settings: AppSettings;

  constructor() {
    this.configPath = path.join(app.getPath('userData'), 'settings.json');
    this.settings = this.load();
    this.ensureDirectories();
  }

  private load(): AppSettings {
    const defaults = getDefaultSettings();
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<AppSettings>;
        return { ...defaults, ...parsed };
      }
    } catch (err) {
      console.error('[SettingsService] Failed to load settings, using defaults:', err);
    }
    return defaults;
  }

  private ensureDirectories(): void {
    try {
      const modelsBase = this.settings.modelsDir || getModelsBaseDir();
      fs.mkdirSync(this.settings.storageDir, { recursive: true });
      fs.mkdirSync(path.join(modelsBase, 'whisper'), { recursive: true });
      fs.mkdirSync(path.join(modelsBase, 'llm'), { recursive: true });
    } catch (err) {
      console.error('[SettingsService] Failed to create directories:', err);
    }
  }

  getSettings(): AppSettings {
    return { ...this.settings };
  }

  updateSettings(partial: Partial<AppSettings>): AppSettings {
    this.settings = { ...this.settings, ...partial };
    this.ensureDirectories();
    try {
      fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
      fs.writeFileSync(this.configPath, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (err) {
      console.error('[SettingsService] Failed to save settings:', err);
    }
    return this.getSettings();
  }
}
