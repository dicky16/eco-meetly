export type LanguageMode = 'fixed' | 'bilingual' | 'auto';
export type SttEngine = 'whisper' | 'parakeet';
export type LlmProvider = 'builtin-llama' | 'ollama';
export type ThemeMode = 'light' | 'dark' | 'system';

export interface AppSettings {
  theme: ThemeMode;
  // Storage & Audio Recording
  storageDir: string;
  modelsDir: string;
  saveRecordedAudio: boolean;
  // Meeting Language Controls
  languageMode: LanguageMode;
  primaryLanguage: string; // ISO 639-1 code e.g. 'id', 'en'
  secondaryLanguage: string; // ISO 639-1 code e.g. 'en', 'id'
  autoTranslateToEnglish: boolean;
  // Local STT
  sttEngine: SttEngine;
  whisperModel: string;
  selectedMicDeviceId: string;
  // Local Summary LLM
  llmProvider: LlmProvider;
  builtinModelId: string;
  ollamaUrl: string;
  ollamaModel: string;
  summaryTemplateId: string;
}

export interface Meeting {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  durationSeconds: number;
  folderPath: string;
  audioPath: string | null;
  languageMode: LanguageMode;
  primaryLanguage: string;
  secondaryLanguage: string;
  status: 'recording' | 'completed';
}

export interface TranscriptSegment {
  id: string;
  meetingId: string;
  startTimeMs: number;
  endTimeMs: number;
  text: string;
  detectedLanguage: string | null;
  speaker: string | null;
  createdAt: string;
}

export interface MeetingSummary {
  id: string;
  meetingId: string;
  templateId: string;
  provider: LlmProvider;
  modelName: string;
  content: string;
  createdAt: string;
}

export interface WhisperModelInfo {
  id: string;
  name: string;
  hfModelId: string;
  sizeLabel: string;
  description: string;
  downloaded: boolean;
}

export interface BuiltinLlmModelInfo {
  id: string;
  name: string;
  filename: string;
  downloadUrl: string;
  sizeLabel: string;
  preset: 'qwen35_summary' | 'gemma3_instruct' | 'tight_structured';
  downloaded: boolean;
}

export interface SummaryTemplate {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
}
