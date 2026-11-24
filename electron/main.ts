import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, net, protocol, session, shell, systemPreferences } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseService } from './services/database';
import { SpeakerTracker, splitIntoSentences } from './services/diarization';
import { exportMeetingArtifacts } from './services/meetingExporter';
import { RecordingSaver } from './services/recordingSaver';
import { SettingsService } from './services/settings';
import { detectDominantLanguage, SUMMARY_TEMPLATES, SummaryService } from './services/summary';
import { segmentPcm16kSmart, TranscriptionService } from './services/transcription';
import { AppSettings, Meeting, TranscriptSegment } from './types';

let mainWindow: BrowserWindow | null = null;
const settingsService = new SettingsService();
const dbService = new DatabaseService();
const recordingSaver = new RecordingSaver();
const transcriptionService = new TranscriptionService();
const summaryService = new SummaryService();

let activeMeetingId: string | null = null;
let activeAudioPath: string | null = null;
const speakerTrackers = new Map<string, SpeakerTracker>();

function getSpeakerTracker(meetingId: string): SpeakerTracker {
  let tracker = speakerTrackers.get(meetingId);
  if (!tracker) {
    tracker = new SpeakerTracker();
    speakerTrackers.set(meetingId, tracker);
  }
  return tracker;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: 'Eco Meetly',
    backgroundColor: '#0B1310',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Main] Renderer process gone:', details.reason, details.exitCode);
  });

  if (process.env.VITE_DEV_SERVER_URL || !app.isPackaged) {
    const devUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';
    mainWindow.loadURL(devUrl).catch(() => {
      mainWindow?.loadFile(path.join(__dirname, '../dist/index.html'));
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

function sanitizeFolderName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_ ]/g, '').trim().replace(/\s+/g, '-') || 'meeting';
}

async function transcribePcm16kSegments(
  meetingId: string,
  pcm16k: Float32Array,
  settings: AppSettings
): Promise<TranscriptSegment[]> {
  speakerTrackers.set(meetingId, new SpeakerTracker());
  const tracker = getSpeakerTracker(meetingId);
  const smartSegments = segmentPcm16kSmart(pcm16k);
  const created: TranscriptSegment[] = [];
  for (const segInfo of smartSegments) {
    const speaker = tracker.identifySpeaker(segInfo.samples);
    const res = await transcriptionService.transcribeFloat32(segInfo.samples, settings, (info) => {
      mainWindow?.webContents.send('model:progress', { kind: 'whisper', ...info });
    });
    if (res.text) {
      const sentences = splitIntoSentences(res.text);
      const totalMs = Math.max(1, segInfo.endTimeMs - segInfo.startTimeMs);
      const stepMs = Math.floor(totalMs / sentences.length);
      sentences.forEach((sentence, idx) => {
        const seg = dbService.addSegment({
          id: crypto.randomUUID(),
          meetingId,
          startTimeMs: segInfo.startTimeMs + idx * stepMs,
          endTimeMs: idx === sentences.length - 1 ? segInfo.endTimeMs : segInfo.startTimeMs + (idx + 1) * stepMs,
          text: sentence,
          detectedLanguage: res.detectedLanguage,
          speaker,
          createdAt: new Date().toISOString(),
        });
        created.push(seg);
      });
    }
  }
  speakerTrackers.delete(meetingId);
  return created;
}

function registerIpcHandlers(): void {
  ipcMain.handle('settings:get', () => settingsService.getSettings());
  ipcMain.handle('settings:update', (_e, partial: Partial<AppSettings>) => settingsService.updateSettings(partial));

  ipcMain.handle('storage:pick-folder', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Meeting Storage Folder',
      defaultPath: settingsService.getSettings().storageDir,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('models:pick-folder', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select AI Models Folder (e.g., External SSD)',
      defaultPath: settingsService.getSettings().modelsDir,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('storage:open-folder', async (_e, folderPath: string) => {
    fs.mkdirSync(folderPath, { recursive: true });
    await shell.openPath(folderPath);
  });

  ipcMain.handle('storage:show-item', (_e, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle('meetings:list', () => dbService.listMeetings());
  ipcMain.handle('meetings:details', (_e, meetingId: string) => {
    const meeting = dbService.getMeeting(meetingId);
    if (!meeting) return null;
    return {
      meeting,
      segments: dbService.getSegments(meetingId),
      summary: dbService.getLatestSummary(meetingId),
    };
  });

  ipcMain.handle('meetings:update-title', (_e, meetingId: string, title: string) => {
    dbService.updateMeeting(meetingId, { title });
    const meeting = dbService.getMeeting(meetingId);
    if (meeting) {
      exportMeetingArtifacts(meeting, dbService.getSegments(meetingId), dbService.getLatestSummary(meetingId));
    }
  });

  ipcMain.handle('meetings:delete', (_e, meetingId: string) => {
    dbService.deleteMeeting(meetingId);
  });

  ipcMain.handle('meetings:rename-speaker', (_e, meetingId: string, oldSpeaker: string, newSpeaker: string) => {
    dbService.renameSpeaker(meetingId, oldSpeaker, newSpeaker);
    const meeting = dbService.getMeeting(meetingId);
    const updatedSegments = dbService.getSegments(meetingId);
    if (meeting) {
      exportMeetingArtifacts(meeting, updatedSegments, dbService.getLatestSummary(meetingId));
    }
    return updatedSegments;
  });

  // Recording Lifecycle
  ipcMain.handle('recording:start', async (_e, customTitle?: string) => {
    if (process.platform === 'darwin') {
      const micStatus = systemPreferences.getMediaAccessStatus('microphone');
      if (micStatus === 'not-determined') {
        await systemPreferences.askForMediaAccess('microphone');
      } else if (micStatus === 'denied' || micStatus === 'restricted') {
        throw new Error('Microphone permission is denied. Enable it in System Settings -> Privacy & Security -> Microphone.');
      }
    }

    const settings = settingsService.getSettings();
    const now = new Date();
    const id = crypto.randomUUID();
    const defaultTitle = customTitle?.trim() || `Meeting ${now.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`;
    const datePrefix = now.toISOString().slice(0, 10);
    const folderName = `${datePrefix}_${sanitizeFolderName(defaultTitle)}_${id.slice(0, 6)}`;
    const folderPath = path.join(settings.storageDir, folderName);

    let audioPath: string | null = null;
    if (settings.saveRecordedAudio) {
      audioPath = recordingSaver.start(folderPath, 'recording.wav');
    }

    activeMeetingId = id;
    activeAudioPath = audioPath;

    const meeting: Meeting = {
      id,
      title: defaultTitle,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      durationSeconds: 0,
      folderPath,
      audioPath,
      languageMode: settings.languageMode,
      primaryLanguage: settings.primaryLanguage,
      secondaryLanguage: settings.secondaryLanguage,
      status: 'recording',
    };

    return dbService.createMeeting(meeting);
  });

  ipcMain.on('recording:audio-48k', (_e, samples: Float32Array) => {
    if (!activeMeetingId || !activeAudioPath) return;
    recordingSaver.appendFloat32Chunk(samples);
  });

  ipcMain.handle(
    'recording:transcribe-16k',
    async (
      _e,
      payload: { meetingId: string; samples: Float32Array; startTimeMs: number; endTimeMs: number }
    ): Promise<TranscriptSegment[]> => {
      const settings = settingsService.getSettings();
      const speaker = getSpeakerTracker(payload.meetingId).identifySpeaker(payload.samples);
      const result = await transcriptionService.transcribeFloat32(payload.samples, settings, (info) => {
        mainWindow?.webContents.send('model:progress', { kind: 'whisper', ...info });
      });

      if (!result.text) return [];

      const sentences = splitIntoSentences(result.text);
      const totalMs = Math.max(1, payload.endTimeMs - payload.startTimeMs);
      const stepMs = Math.floor(totalMs / sentences.length);
      return sentences.map((sentence, idx) =>
        dbService.addSegment({
          id: crypto.randomUUID(),
          meetingId: payload.meetingId,
          startTimeMs: payload.startTimeMs + idx * stepMs,
          endTimeMs: idx === sentences.length - 1 ? payload.endTimeMs : payload.startTimeMs + (idx + 1) * stepMs,
          text: sentence,
          detectedLanguage: result.detectedLanguage,
          speaker,
          createdAt: new Date().toISOString(),
        })
      );
    }
  );

  ipcMain.handle('recording:stop', (_e, meetingId: string, durationSeconds: number) => {
    const savedPath = recordingSaver.stop();
    activeMeetingId = null;
    activeAudioPath = null;
    speakerTrackers.delete(meetingId);

    dbService.updateMeeting(meetingId, {
      status: 'completed',
      durationSeconds,
      audioPath: savedPath ?? undefined,
    });
    const meeting = dbService.getMeeting(meetingId);
    if (meeting) {
      exportMeetingArtifacts(meeting, dbService.getSegments(meetingId), dbService.getLatestSummary(meetingId));
    }
    return meeting;
  });

  // Import Audio File
  ipcMain.handle('audio:import', async () => {
    if (!mainWindow) return null;
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Audio File',
      properties: ['openFile'],
      filters: [{ name: 'Audio Files', extensions: ['wav', 'mp3', 'm4a', 'ogg', 'webm', 'flac'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;

    const sourceFile = picked.filePaths[0];
    const settings = settingsService.getSettings();
    const now = new Date();
    const id = crypto.randomUUID();
    const baseTitle = path.basename(sourceFile, path.extname(sourceFile));
    const folderPath = path.join(settings.storageDir, `${now.toISOString().slice(0, 10)}_${sanitizeFolderName(baseTitle)}_${id.slice(0, 6)}`);

    let savedAudioPath: string | null = null;
    if (settings.saveRecordedAudio) {
      fs.mkdirSync(folderPath, { recursive: true });
      savedAudioPath = path.join(folderPath, path.basename(sourceFile));
      fs.copyFileSync(sourceFile, savedAudioPath);
    }

    const pcm16k = await transcriptionService.decodeAudioFileTo16k(sourceFile);
    const durationSeconds = Math.round(pcm16k.length / 16000);

    const meeting = dbService.createMeeting({
      id,
      title: baseTitle,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      durationSeconds,
      folderPath,
      audioPath: savedAudioPath,
      languageMode: settings.languageMode,
      primaryLanguage: settings.primaryLanguage,
      secondaryLanguage: settings.secondaryLanguage,
      status: 'completed',
    });

    await transcribePcm16kSegments(meeting.id, pcm16k, settings);

    exportMeetingArtifacts(meeting, dbService.getSegments(meeting.id), null);
    return meeting;
  });

  ipcMain.handle('audio:retranscribe', async (_e, meetingId: string) => {
    const meeting = dbService.getMeeting(meetingId);
    if (!meeting || !meeting.audioPath || !fs.existsSync(meeting.audioPath)) {
      throw new Error('No saved audio file found for this meeting.');
    }
    const settings = settingsService.getSettings();
    const pcm16k = await transcriptionService.decodeAudioFileTo16k(meeting.audioPath);
    dbService.clearSegments(meetingId);

    const newSegments = await transcribePcm16kSegments(meetingId, pcm16k, settings);
    exportMeetingArtifacts(meeting, newSegments, dbService.getLatestSummary(meetingId));
    return newSegments;
  });

  // Models & Summary
  ipcMain.handle('models:whisper-list', () => transcriptionService.listModels(settingsService.getSettings().modelsDir));
  ipcMain.handle('models:whisper-download', async (_e, modelId: string) => {
    await transcriptionService.ensureModelLoaded(modelId, settingsService.getSettings().modelsDir, (info) => {
      mainWindow?.webContents.send('model:progress', { kind: 'whisper', ...info });
    });
  });

  ipcMain.handle('models:llm-list', () => summaryService.listBuiltinModels(settingsService.getSettings().modelsDir));
  ipcMain.handle('models:llm-download', async (_e, modelId: string) => {
    await summaryService.downloadBuiltinModel(modelId, settingsService.getSettings().modelsDir, (progress, status) => {
      mainWindow?.webContents.send('model:progress', { kind: 'llm', status, progress });
    });
  });

  ipcMain.handle('ollama:check', (_e, url: string) => summaryService.checkOllama(url));
  ipcMain.handle('summary:templates', () => SUMMARY_TEMPLATES);

  ipcMain.handle('summary:generate', async (_e, meetingId: string, customPrompt?: string) => {
    const segments = dbService.getSegments(meetingId);
    if (segments.length === 0) {
      throw new Error('No transcript segments available to summarize.');
    }

    const transcriptText = segments.map((s) => `${s.speaker ? `[${s.speaker}]: ` : ''}${s.text}`).join('\n');
    const settings = settingsService.getSettings();
    const dominantLanguage = detectDominantLanguage(segments, settings.primaryLanguage);

    const { content, modelName } = await summaryService.generateSummary(
      transcriptText,
      settings,
      (token) => {
        mainWindow?.webContents.send('summary:token', { meetingId, token });
      },
      customPrompt,
      dominantLanguage
    );

    const saved = dbService.saveSummary({
      id: crypto.randomUUID(),
      meetingId,
      templateId: settings.summaryTemplateId,
      provider: settings.llmProvider,
      modelName,
      content,
      createdAt: new Date().toISOString(),
    });
    const meeting = dbService.getMeeting(meetingId);
    if (meeting) {
      exportMeetingArtifacts(meeting, segments, saved);
    }
    return saved;
  });

  ipcMain.handle('summary:update', (_e, summaryId: string, meetingId: string, content: string) => {
    const updated = dbService.updateSummaryContent(summaryId, content);
    const meeting = dbService.getMeeting(meetingId);
    if (meeting && updated) {
      exportMeetingArtifacts(meeting, dbService.getSegments(meetingId), updated);
    }
    return updated;
  });

  ipcMain.handle('summary:cancel', () => {
    summaryService.dispose();
  });
}

app.whenReady().then(async () => {
  await dbService.init();
  dbService.finalizeStaleRecordings();

  // Stream local audio files safely to Renderer <audio> player
  protocol.handle('eco-audio', (request) => {
    const url = new URL(request.url);
    const filePath = url.searchParams.get('path');
    if (!filePath || !fs.existsSync(filePath)) {
      return new Response('Audio file not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });

  // Enable system audio capture via getDisplayMedia in Electron safely
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    if (process.platform === 'darwin') {
      const screenStatus = systemPreferences.getMediaAccessStatus('screen');
      if (screenStatus === 'denied' || screenStatus === 'restricted') {
        callback({});
        return;
      }
    }

    desktopCapturer
      .getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
      .then((sources) => {
        if (!sources || sources.length === 0) {
          callback({});
          return;
        }
        callback({ video: sources[0], audio: 'loopback' });
      })
      .catch(() => {
        callback({});
      });
  });

  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (activeMeetingId) {
    const savedPath = recordingSaver.stop();
    dbService.updateMeeting(activeMeetingId, {
      status: 'completed',
      audioPath: savedPath ?? undefined,
    });
    const meeting = dbService.getMeeting(activeMeetingId);
    if (meeting) {
      exportMeetingArtifacts(meeting, dbService.getSegments(activeMeetingId), dbService.getLatestSummary(activeMeetingId));
    }
    activeMeetingId = null;
  }
  transcriptionService.dispose();
  summaryService.dispose();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
