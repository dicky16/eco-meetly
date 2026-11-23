import { contextBridge, ipcRenderer } from 'electron';
import {
  AppSettings,
  BuiltinLlmModelInfo,
  Meeting,
  MeetingSummary,
  SummaryTemplate,
  TranscriptSegment,
  WhisperModelInfo,
} from './types';

export interface EcoMeetlyAPI {
  // Settings & Storage
  getSettings: () => Promise<AppSettings>;
  updateSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>;
  pickStorageFolder: () => Promise<string | null>;
  pickModelsFolder: () => Promise<string | null>;
  openFolder: (folderPath: string) => Promise<void>;
  openFileLocation: (filePath: string) => Promise<void>;

  // Meetings
  listMeetings: () => Promise<Meeting[]>;
  getMeetingDetails: (meetingId: string) => Promise<{
    meeting: Meeting;
    segments: TranscriptSegment[];
    summary: MeetingSummary | null;
  } | null>;
  updateMeetingTitle: (meetingId: string, title: string) => Promise<void>;
  deleteMeeting: (meetingId: string) => Promise<void>;

  // Recording Lifecycle
  startRecording: (title?: string) => Promise<Meeting>;
  sendAudioChunk48k: (samples: Float32Array) => void;
  transcribeSpeechSegment16k: (payload: {
    meetingId: string;
    samples: Float32Array;
    startTimeMs: number;
    endTimeMs: number;
  }) => Promise<TranscriptSegment | null>;
  stopRecording: (meetingId: string, durationSeconds: number) => Promise<Meeting | null>;

  // Import & Re-transcribe
  importAudioFile: () => Promise<Meeting | null>;
  retranscribeMeeting: (meetingId: string) => Promise<TranscriptSegment[]>;

  // Models & Summary
  listWhisperModels: () => Promise<WhisperModelInfo[]>;
  downloadWhisperModel: (modelId: string) => Promise<void>;
  listBuiltinLlmModels: () => Promise<BuiltinLlmModelInfo[]>;
  downloadBuiltinLlmModel: (modelId: string) => Promise<void>;
  checkOllama: (url: string) => Promise<{ available: boolean; models: string[] }>;
  getSummaryTemplates: () => Promise<SummaryTemplate[]>;
  generateSummary: (meetingId: string, customPrompt?: string) => Promise<MeetingSummary>;
  updateSummary: (summaryId: string, meetingId: string, content: string) => Promise<MeetingSummary | null>;
  cancelSummary: () => Promise<void>;

  // Events
  onModelProgress: (cb: (data: { kind: 'whisper' | 'llm'; status: string; progress?: number }) => void) => () => void;
  onSummaryToken: (cb: (data: { meetingId: string; token: string }) => void) => () => void;
}

const api: EcoMeetlyAPI = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (partial) => ipcRenderer.invoke('settings:update', partial),
  pickStorageFolder: () => ipcRenderer.invoke('storage:pick-folder'),
  pickModelsFolder: () => ipcRenderer.invoke('models:pick-folder'),
  openFolder: (folderPath) => ipcRenderer.invoke('storage:open-folder', folderPath),
  openFileLocation: (filePath) => ipcRenderer.invoke('storage:show-item', filePath),

  listMeetings: () => ipcRenderer.invoke('meetings:list'),
  getMeetingDetails: (meetingId) => ipcRenderer.invoke('meetings:details', meetingId),
  updateMeetingTitle: (meetingId, title) => ipcRenderer.invoke('meetings:update-title', meetingId, title),
  deleteMeeting: (meetingId) => ipcRenderer.invoke('meetings:delete', meetingId),

  startRecording: (title) => ipcRenderer.invoke('recording:start', title),
  sendAudioChunk48k: (samples) => ipcRenderer.send('recording:audio-48k', samples),
  transcribeSpeechSegment16k: (payload) => ipcRenderer.invoke('recording:transcribe-16k', payload),
  stopRecording: (meetingId, durationSeconds) => ipcRenderer.invoke('recording:stop', meetingId, durationSeconds),

  importAudioFile: () => ipcRenderer.invoke('audio:import'),
  retranscribeMeeting: (meetingId) => ipcRenderer.invoke('audio:retranscribe', meetingId),

  listWhisperModels: () => ipcRenderer.invoke('models:whisper-list'),
  downloadWhisperModel: (modelId) => ipcRenderer.invoke('models:whisper-download', modelId),
  listBuiltinLlmModels: () => ipcRenderer.invoke('models:llm-list'),
  downloadBuiltinLlmModel: (modelId) => ipcRenderer.invoke('models:llm-download', modelId),
  checkOllama: (url) => ipcRenderer.invoke('ollama:check', url),
  getSummaryTemplates: () => ipcRenderer.invoke('summary:templates'),
  generateSummary: (meetingId, customPrompt) => ipcRenderer.invoke('summary:generate', meetingId, customPrompt),
  updateSummary: (summaryId, meetingId, content) => ipcRenderer.invoke('summary:update', summaryId, meetingId, content),
  cancelSummary: () => ipcRenderer.invoke('summary:cancel'),

  onModelProgress: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, data: { kind: 'whisper' | 'llm'; status: string; progress?: number }) =>
      cb(data);
    ipcRenderer.on('model:progress', handler);
    return () => ipcRenderer.removeListener('model:progress', handler);
  },
  onSummaryToken: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, data: { meetingId: string; token: string }) => cb(data);
    ipcRenderer.on('summary:token', handler);
    return () => ipcRenderer.removeListener('summary:token', handler);
  },
};

contextBridge.exposeInMainWorld('ecoMeetly', api);
