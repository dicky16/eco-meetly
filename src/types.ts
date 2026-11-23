import type { EcoMeetlyAPI } from '../electron/preload';

export type {
  AppSettings,
  BuiltinLlmModelInfo,
  LanguageMode,
  LlmProvider,
  Meeting,
  MeetingSummary,
  SttEngine,
  SummaryTemplate,
  ThemeMode,
  TranscriptSegment,
  WhisperModelInfo,
} from '../electron/types';

declare global {
  interface Window {
    ecoMeetly: EcoMeetlyAPI;
  }
}

export const LANGUAGE_OPTIONS = [
  { code: 'id', label: 'Indonesian (id)' },
  { code: 'en', label: 'English (en)' },
  { code: 'ms', label: 'Malay (ms)' },
  { code: 'jv', label: 'Javanese (jv)' },
  { code: 'su', label: 'Sundanese (su)' },
  { code: 'zh', label: 'Chinese (zh)' },
  { code: 'ja', label: 'Japanese (ja)' },
  { code: 'ko', label: 'Korean (ko)' },
  { code: 'ar', label: 'Arabic (ar)' },
  { code: 'es', label: 'Spanish (es)' },
  { code: 'fr', label: 'French (fr)' },
  { code: 'de', label: 'German (de)' },
];
