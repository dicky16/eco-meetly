import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, FolderOpen, HardDrive, Languages, Cpu, Sun, Moon, X } from 'lucide-react';
import {
  AppSettings,
  BuiltinLlmModelInfo,
  LANGUAGE_OPTIONS,
  LanguageMode,
  LlmProvider,
  SttEngine,
  ThemeMode,
  WhisperModelInfo,
} from '../types';

interface SettingsModalProps {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onUpdate: (partial: Partial<AppSettings>) => Promise<void>;
}

type TabKey = 'storage' | 'language' | 'models' | 'appearance';

export function SettingsModal({ open, settings, onClose, onUpdate }: SettingsModalProps) {
  const [tab, setTab] = useState<TabKey>('storage');
  const [whisperModels, setWhisperModels] = useState<WhisperModelInfo[]>([]);
  const [llmModels, setLlmModels] = useState<BuiltinLlmModelInfo[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState<{ available: boolean; models: string[] } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ status: string; progress?: number } | null>(null);
  const [micDevices, setMicDevices] = useState<Array<{ deviceId: string; label: string }>>([]);

  useEffect(() => {
    if (!open) return;
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) => {
        const inputs = devices
          .filter((d) => d.kind === 'audioinput')
          .map((d, idx) => ({
            deviceId: d.deviceId,
            label: d.label || `Microphone ${idx + 1}`,
          }));
        setMicDevices(inputs);
      })
      .catch(() => {});
    window.ecoMeetly.listWhisperModels().then(setWhisperModels);
    window.ecoMeetly.listBuiltinLlmModels().then(setLlmModels);
    window.ecoMeetly.checkOllama(settings.ollamaUrl).then(setOllamaStatus);

    const unsub = window.ecoMeetly.onModelProgress((data) => {
      setDownloadProgress((prev) => {
        // Prevent backward percentage jumps from concurrent file callbacks
        const nextPct =
          typeof data.progress === 'number'
            ? data.progress === 100
              ? 100
              : Math.max(prev?.progress ?? 0, data.progress)
            : prev?.progress;
        return { status: data.status, progress: nextPct };
      });
      if (data.progress === 100) {
        window.ecoMeetly.listWhisperModels().then(setWhisperModels);
        window.ecoMeetly.listBuiltinLlmModels().then(setLlmModels);
        setTimeout(() => setDownloadProgress(null), 2500);
      }
    });
    return unsub;
  }, [open, settings.ollamaUrl]);

  if (!open) return null;

  const handlePickFolder = async () => {
    const picked = await window.ecoMeetly.pickStorageFolder();
    if (picked) {
      await onUpdate({ storageDir: picked });
    }
  };

  const handlePickModelsFolder = async () => {
    const picked = await window.ecoMeetly.pickModelsFolder();
    if (picked) {
      await onUpdate({ modelsDir: picked });
      window.ecoMeetly.listWhisperModels().then(setWhisperModels);
      window.ecoMeetly.listBuiltinLlmModels().then(setLlmModels);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl rounded-xl border bg-card text-card-foreground shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Settings</h2>
            <p className="text-xs text-muted-foreground">Configure offline AI models, storage, language, and theme</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex border-b bg-muted/40 px-6 gap-2">
          {[
            { id: 'storage', label: 'Storage & Audio', icon: HardDrive },
            { id: 'language', label: 'Meeting Language', icon: Languages },
            { id: 'models', label: 'Local AI Models', icon: Cpu },
            { id: 'appearance', label: 'Appearance', icon: Sun },
          ].map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setTab(item.id as TabKey)}
                className={`flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
                  active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {tab === 'storage' && (
            <div className="space-y-6">
              <div className="rounded-lg border p-4 space-y-3">
                <h3 className="font-medium">Meeting Storage Folder</h3>
                <p className="text-xs text-muted-foreground">
                  Choose where recorded meeting folders and audio files are saved on your computer.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={settings.storageDir}
                    className="flex-1 rounded-lg border bg-muted/50 px-3 py-2 text-sm font-mono"
                  />
                  <button
                    onClick={handlePickFolder}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                  >
                    Change Folder
                  </button>
                  <button
                    onClick={() => window.ecoMeetly.openFolder(settings.storageDir)}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-muted"
                  >
                    <FolderOpen className="h-4 w-4" />
                    Open
                  </button>
                </div>
              </div>

              <div className="rounded-lg border p-4 flex items-center justify-between gap-4">
                <div>
                  <h3 className="font-medium">Save Recorded Audio</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    When enabled, saves the 48 kHz mixed WAV recording to your storage folder for playback and
                    re-transcription. Disable to keep only transcripts and summaries.
                  </p>
                </div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={settings.saveRecordedAudio}
                    onChange={(e) => onUpdate({ saveRecordedAudio: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="h-6 w-11 rounded-full bg-muted peer-checked:bg-primary after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-5" />
                </label>
              </div>

              <div className="rounded-lg border p-4 space-y-2">
                <h3 className="font-medium">Microphone Input Device</h3>
                <p className="text-xs text-muted-foreground">
                  Select which microphone to use when recording meetings.
                </p>
                <select
                  value={settings.selectedMicDeviceId}
                  onChange={(e) => onUpdate({ selectedMicDeviceId: e.target.value })}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                >
                  <option value="default">System Default Microphone</option>
                  {micDevices
                    .filter((d) => d.deviceId !== 'default')
                    .map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          )}

          {tab === 'language' && (
            <div className="space-y-5">
              {settings.sttEngine === 'parakeet' && (
                <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                  <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Parakeet Engine Selected</p>
                    <p className="text-xs text-muted-foreground">
                      Granular language controls require a local Whisper model.{' '}
                      <button
                        onClick={() => onUpdate({ sttEngine: 'whisper' })}
                        className="text-primary underline font-medium"
                      >
                        Switch to Whisper
                      </button>
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">Detection Mode</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    {
                      id: 'fixed',
                      title: 'Primary Language Only',
                      desc: 'Best accuracy for single-language meetings (e.g., Indonesian only).',
                    },
                    {
                      id: 'bilingual',
                      title: 'Bilingual (Smart Auto)',
                      desc: 'Prevents misdetection during mixed Primary + Secondary speech.',
                    },
                    {
                      id: 'auto',
                      title: 'Full Auto-Detect',
                      desc: 'Unconstrained detection across all supported Whisper languages.',
                    },
                  ].map((mode) => (
                    <button
                      key={mode.id}
                      onClick={() => onUpdate({ languageMode: mode.id as LanguageMode })}
                      className={`rounded-lg border p-3 text-left transition-all ${
                        settings.languageMode === mode.id
                          ? 'border-primary bg-secondary ring-1 ring-primary'
                          : 'hover:bg-muted/60'
                      }`}
                    >
                      <div className="text-sm font-semibold">{mode.title}</div>
                      <div className="text-xs text-muted-foreground mt-1">{mode.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Primary Language</label>
                  <select
                    value={settings.primaryLanguage}
                    onChange={(e) => onUpdate({ primaryLanguage: e.target.value })}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                  >
                    {LANGUAGE_OPTIONS.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.label}
                      </option>
                    ))}
                  </select>
                </div>

                {settings.languageMode === 'bilingual' && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Secondary Language</label>
                    <select
                      value={settings.secondaryLanguage}
                      onChange={(e) => onUpdate({ secondaryLanguage: e.target.value })}
                      className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                    >
                      {LANGUAGE_OPTIONS.map((lang) => (
                        <option key={lang.code} value={lang.code}>
                          {lang.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {settings.languageMode === 'auto' && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.autoTranslateToEnglish}
                    onChange={(e) => onUpdate({ autoTranslateToEnglish: e.target.checked })}
                    className="rounded border-input accent-primary"
                  />
                  Translate detected speech to English automatically
                </label>
              )}
            </div>
          )}

          {tab === 'models' && (
            <div className="space-y-6">
              <div className="rounded-lg border p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">AI Models Storage Folder (SSD / Custom Path)</h3>
                    <p className="text-xs text-muted-foreground">
                      Store large Whisper &amp; GGUF models on an external SSD or custom directory.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={settings.modelsDir}
                    className="flex-1 rounded-lg border bg-muted/50 px-3 py-1.5 text-xs font-mono"
                  />
                  <button
                    onClick={handlePickModelsFolder}
                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                  >
                    Change Folder
                  </button>
                  <button
                    onClick={() => window.ecoMeetly.openFolder(settings.modelsDir)}
                    className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs hover:bg-muted"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    Open
                  </button>
                </div>
              </div>

              {downloadProgress && (
                <div className="rounded-lg border border-primary/40 bg-secondary p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-medium text-secondary-foreground truncate">{downloadProgress.status}</span>
                    {typeof downloadProgress.progress === 'number' && (
                      <span className="font-mono tabular-nums font-semibold text-primary shrink-0">
                        {downloadProgress.progress}%
                      </span>
                    )}
                  </div>
                  <div className="h-2 w-full rounded-full bg-background/70 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-200 ease-out"
                      style={{ width: `${downloadProgress.progress ?? 5}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Local Speech-to-Text (Whisper)</h3>
                  <select
                    value={settings.sttEngine}
                    onChange={(e) => onUpdate({ sttEngine: e.target.value as SttEngine })}
                    className="rounded-md border bg-background px-2.5 py-1 text-xs"
                  >
                    <option value="whisper">Whisper (Local ONNX)</option>
                    <option value="parakeet">Parakeet (Preview)</option>
                  </select>
                </div>

                <div className="space-y-2">
                  {whisperModels.map((m) => {
                    const selected = settings.whisperModel === m.id;
                    return (
                      <div
                        key={m.id}
                        className={`flex items-center justify-between rounded-lg border p-3 ${
                          selected ? 'border-primary bg-secondary/60' : ''
                        }`}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{m.name}</span>
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono">{m.sizeLabel}</span>
                            {m.downloaded && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-primary font-medium">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Cached
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{m.description}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {!m.downloaded && (
                            <button
                              onClick={() => window.ecoMeetly.downloadWhisperModel(m.id)}
                              className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs hover:bg-muted"
                            >
                              <Download className="h-3.5 w-3.5" /> Download
                            </button>
                          )}
                          <button
                            onClick={() => onUpdate({ whisperModel: m.id })}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                              selected
                                ? 'bg-primary text-primary-foreground'
                                : 'border hover:bg-muted'
                            }`}
                          >
                            {selected ? 'Selected' : 'Use'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3 border-t pt-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Local Summary LLM Provider</h3>
                  <select
                    value={settings.llmProvider}
                    onChange={(e) => onUpdate({ llmProvider: e.target.value as LlmProvider })}
                    className="rounded-md border bg-background px-2.5 py-1 text-xs"
                  >
                    <option value="builtin-llama">Built-in Local AI (llama.cpp GGUF)</option>
                    <option value="ollama">Local Ollama Server</option>
                  </select>
                </div>

                {settings.llmProvider === 'builtin-llama' ? (
                  <div className="space-y-2">
                    {llmModels.map((m) => {
                      const selected = settings.builtinModelId === m.id;
                      return (
                        <div
                          key={m.id}
                          className={`flex items-center justify-between rounded-lg border p-3 ${
                            selected ? 'border-primary bg-secondary/60' : ''
                          }`}
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{m.name}</span>
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono">{m.sizeLabel}</span>
                              {m.downloaded && (
                                <span className="inline-flex items-center gap-1 text-[11px] text-primary font-medium">
                                  <CheckCircle2 className="h-3.5 w-3.5" /> Ready
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {!m.downloaded && (
                              <button
                                onClick={() => window.ecoMeetly.downloadBuiltinLlmModel(m.id)}
                                className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs hover:bg-muted"
                              >
                                <Download className="h-3.5 w-3.5" /> Download
                              </button>
                            )}
                            <button
                              onClick={() => onUpdate({ builtinModelId: m.id })}
                              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                                selected ? 'bg-primary text-primary-foreground' : 'border hover:bg-muted'
                              }`}
                            >
                              {selected ? 'Selected' : 'Use'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span>
                        Ollama Status:{' '}
                        <strong className={ollamaStatus?.available ? 'text-primary' : 'text-destructive'}>
                          {ollamaStatus?.available ? 'Connected' : 'Not Detected'}
                        </strong>
                      </span>
                      <button
                        onClick={() => window.ecoMeetly.checkOllama(settings.ollamaUrl).then(setOllamaStatus)}
                        className="text-primary underline"
                      >
                        Refresh
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium">Ollama URL</label>
                        <input
                          type="text"
                          value={settings.ollamaUrl}
                          onChange={(e) => onUpdate({ ollamaUrl: e.target.value })}
                          className="mt-1 w-full rounded-lg border bg-background px-3 py-1.5 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium">Model Name</label>
                        {ollamaStatus && ollamaStatus.models.length > 0 ? (
                          <select
                            value={settings.ollamaModel}
                            onChange={(e) => onUpdate({ ollamaModel: e.target.value })}
                            className="mt-1 w-full rounded-lg border bg-background px-3 py-1.5 text-sm"
                          >
                            {ollamaStatus.models.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={settings.ollamaModel}
                            onChange={(e) => onUpdate({ ollamaModel: e.target.value })}
                            className="mt-1 w-full rounded-lg border bg-background px-3 py-1.5 text-sm"
                          />
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'appearance' && (
            <div className="space-y-4">
              <h3 className="font-medium">Theme</h3>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { id: 'light', label: 'Light (MyEco Mint)', icon: Sun },
                  { id: 'dark', label: 'Dark (MyEco Forest)', icon: Moon },
                  { id: 'system', label: 'System Default', icon: Cpu },
                ].map((t) => {
                  const Icon = t.icon;
                  const active = settings.theme === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => onUpdate({ theme: t.id as ThemeMode })}
                      className={`flex items-center gap-2 rounded-lg border p-3 text-sm font-medium ${
                        active ? 'border-primary bg-secondary text-secondary-foreground' : 'hover:bg-muted'
                      }`}
                    >
                      <Icon className="h-4 w-4 text-primary" />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
