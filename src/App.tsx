import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Edit3,
  FileAudio,
  FolderOpen,
  Leaf,
  Mic,
  Pause,
  Play,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { AudioCapturePipeline } from './audio/audioPipeline';
import { LanguagePill } from './components/LanguagePill';
import { SettingsModal } from './components/SettingsModal';
import {
  AppSettings,
  LanguageMode,
  Meeting,
  MeetingSummary,
  SummaryTemplate,
  TranscriptSegment,
} from './types';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatMs(ms: number): string {
  return formatDuration(Math.floor(ms / 1000));
}

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  const [streamingSummary, setStreamingSummary] = useState('');
  const [templates, setTemplates] = useState<SummaryTemplate[]>([]);

  // Search, Edit Title, Summary Edit & Custom Prompt
  const [meetingSearch, setMeetingSearch] = useState('');
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');

  const [editingSpeaker, setEditingSpeaker] = useState<{ segmentId: string; oldName: string } | null>(null);
  const [speakerDraft, setSpeakerDraft] = useState('');

  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [includeSystemAudio, setIncludeSystemAudio] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isBusy, setIsBusy] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const pipelineRef = useRef<AudioCapturePipeline | null>(null);
  const activeMeetingRef = useRef<Meeting | null>(null);
  const selectedMeetingIdRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    selectedMeetingIdRef.current = selectedMeeting?.id ?? null;
  }, [selectedMeeting?.id]);

  useEffect(() => {
    if (isRecording) {
      transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [segments.length, isRecording]);

  useEffect(() => {
    Promise.all([
      window.ecoMeetly.getSettings(),
      window.ecoMeetly.listMeetings(),
      window.ecoMeetly.getSummaryTemplates(),
    ]).then(([s, list, tmpls]) => {
      setSettings(s);
      setMeetings(list);
      setTemplates(tmpls);
      if (list.length > 0) {
        loadMeeting(list[0].id);
      }
    });

    const unsubToken = window.ecoMeetly.onSummaryToken(({ meetingId, token }) => {
      if (activeMeetingRef.current?.id === meetingId || selectedMeetingIdRef.current === meetingId) {
        setStreamingSummary((prev) => prev + token);
      }
    });

    return () => {
      unsubToken();
    };
  }, []);

  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = settings.theme === 'dark' || (settings.theme === 'system' && prefersDark);
    root.classList.toggle('dark', isDark);
  }, [settings?.theme]);

  const filteredMeetings = useMemo(() => {
    const q = meetingSearch.trim().toLowerCase();
    if (!q) return meetings;
    return meetings.filter((m) => m.title.toLowerCase().includes(q));
  }, [meetings, meetingSearch]);

  const filteredSegments = useMemo(() => {
    const q = transcriptSearch.trim().toLowerCase();
    if (!q) return segments;
    return segments.filter((s) => s.text.toLowerCase().includes(q));
  }, [segments, transcriptSearch]);

  const loadMeeting = async (meetingId: string) => {
    const details = await window.ecoMeetly.getMeetingDetails(meetingId);
    if (!details) return;
    setSelectedMeeting(details.meeting);
    setSegments(details.segments);
    setSummary(details.summary);
    setStreamingSummary('');
    setEditingTitle(false);
    setEditingSummary(false);
    setErrorMsg(null);
  };

  const handleUpdateSettings = async (partial: Partial<AppSettings>) => {
    const updated = await window.ecoMeetly.updateSettings(partial);
    setSettings(updated);
  };

  const handleSaveTitle = async () => {
    if (!selectedMeeting) return;
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== selectedMeeting.title) {
      await window.ecoMeetly.updateMeetingTitle(selectedMeeting.id, trimmed);
      setSelectedMeeting({ ...selectedMeeting, title: trimmed });
      setMeetings((prev) => prev.map((m) => (m.id === selectedMeeting.id ? { ...m, title: trimmed } : m)));
    }
    setEditingTitle(false);
  };

  const emitSpeechSegment = async (meetingId: string, seg16k: Float32Array, startMs: number, endMs: number) => {
    try {
      const added = await window.ecoMeetly.transcribeSpeechSegment16k({
        meetingId,
        samples: seg16k,
        startTimeMs: startMs,
        endTimeMs: endMs,
      });
      if (added.length > 0) {
        setSegments((prev) => [...prev, ...added]);
      }
    } catch (err) {
      console.error('Transcription error:', err);
    }
  };

  const handleSaveSpeakerRename = async () => {
    if (!editingSpeaker || !selectedMeeting) return;
    const trimmed = speakerDraft.trim();
    if (trimmed && trimmed !== editingSpeaker.oldName) {
      const updated = await window.ecoMeetly.renameSpeaker(selectedMeeting.id, editingSpeaker.oldName, trimmed);
      setSegments(updated);
    }
    setEditingSpeaker(null);
  };

  const handleStartRecording = async () => {
    setErrorMsg(null);
    try {
      const meeting = await window.ecoMeetly.startRecording();
      activeMeetingRef.current = meeting;
      setSelectedMeeting(meeting);
      setSegments([]);
      setSummary(null);
      setStreamingSummary('');
      setElapsedSec(0);
      setIsPaused(false);
      setIsRecording(true);

      const pipeline = new AudioCapturePipeline();
      pipelineRef.current = pipeline;

      await pipeline.start({
        includeSystemAudio,
        micDeviceId: settings?.selectedMicDeviceId,
        onLevel: (lvl) => setAudioLevel(lvl),
        onChunk48k: (chunk) => window.ecoMeetly.sendAudioChunk48k(chunk),
        onSpeechSegment16k: (seg16k, startMs, endMs) => {
          void emitSpeechSegment(meeting.id, seg16k, startMs, endMs);
        },
      });

      timerRef.current = window.setInterval(() => {
        setElapsedSec((prev) => prev + 1);
      }, 1000);

      setMeetings(await window.ecoMeetly.listMeetings());
    } catch (err) {
      if (activeMeetingRef.current) {
        await window.ecoMeetly.stopRecording(activeMeetingRef.current.id, 0).catch(() => {});
        activeMeetingRef.current = null;
      }
      setIsRecording(false);
      setIsPaused(false);
      setErrorMsg(err instanceof Error ? err.message : 'Failed to start recording');
    }
  };

  const handleTogglePause = () => {
    if (!pipelineRef.current || !activeMeetingRef.current) return;
    if (isPaused) {
      pipelineRef.current.resume();
      timerRef.current = window.setInterval(() => {
        setElapsedSec((prev) => prev + 1);
      }, 1000);
      setIsPaused(false);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      const meetingId = activeMeetingRef.current.id;
      pipelineRef.current.pause((seg16k, startMs, endMs) => {
        void emitSpeechSegment(meetingId, seg16k, startMs, endMs);
      });
      setIsPaused(true);
    }
  };

  const handleStopRecording = async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const meeting = activeMeetingRef.current;
    if (pipelineRef.current && meeting) {
      await pipelineRef.current.stop(async (seg16k, startMs, endMs) => {
        await emitSpeechSegment(meeting.id, seg16k, startMs, endMs);
      });
    }

    if (meeting) {
      const finalized = await window.ecoMeetly.stopRecording(meeting.id, elapsedSec);
      if (finalized) {
        setSelectedMeeting(finalized);
      }
    }

    activeMeetingRef.current = null;
    pipelineRef.current = null;
    setIsRecording(false);
    setIsPaused(false);
    setAudioLevel(0);
    setMeetings(await window.ecoMeetly.listMeetings());
  };

  const handleImportAudio = async () => {
    setErrorMsg(null);
    setIsBusy('Importing & transcribing audio...');
    try {
      const meeting = await window.ecoMeetly.importAudioFile();
      if (meeting) {
        setMeetings(await window.ecoMeetly.listMeetings());
        await loadMeeting(meeting.id);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to import audio');
    } finally {
      setIsBusy(null);
    }
  };

  const handleRetranscribe = async () => {
    if (!selectedMeeting) return;
    setErrorMsg(null);
    setIsBusy('Re-transcribing saved audio...');
    try {
      const newSegments = await window.ecoMeetly.retranscribeMeeting(selectedMeeting.id);
      setSegments(newSegments);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to re-transcribe');
    } finally {
      setIsBusy(null);
    }
  };

  const handleGenerateSummary = async () => {
    if (!selectedMeeting) return;
    setErrorMsg(null);
    setIsSummarizing(true);
    setEditingSummary(false);
    setStreamingSummary('');
    try {
      const result = await window.ecoMeetly.generateSummary(selectedMeeting.id, customPrompt);
      setSummary(result);
      setStreamingSummary('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate summary');
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleCancelSummary = async () => {
    await window.ecoMeetly.cancelSummary();
    setIsSummarizing(false);
  };

  const handleSaveEditedSummary = async () => {
    if (!summary || !selectedMeeting) return;
    const updated = await window.ecoMeetly.updateSummary(summary.id, selectedMeeting.id, summaryDraft);
    if (updated) {
      setSummary(updated);
    }
    setEditingSummary(false);
  };

  const handleDeleteMeeting = async (id: string) => {
    await window.ecoMeetly.deleteMeeting(id);
    const updated = await window.ecoMeetly.listMeetings();
    setMeetings(updated);
    if (selectedMeeting?.id === id) {
      setSelectedMeeting(updated[0] ?? null);
      if (updated[0]) {
        await loadMeeting(updated[0].id);
      } else {
        setSegments([]);
        setSummary(null);
      }
    }
  };

  if (!settings) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <span className="text-sm text-muted-foreground">Starting Eco Meetly...</span>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside className="w-72 border-r bg-card flex flex-col">
        <div className="p-4 border-b flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Leaf className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight">Eco Meetly</h1>
            <p className="text-[11px] text-muted-foreground">Offline AI Meeting Notes</p>
          </div>
        </div>

        <div className="p-3 space-y-2 border-b">
          <button
            disabled={isRecording || Boolean(isBusy)}
            onClick={handleStartRecording}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-50"
          >
            <Mic className="h-4 w-4" />
            New Recording
          </button>
          <button
            disabled={isRecording || Boolean(isBusy)}
            onClick={handleImportAudio}
            className="w-full flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" />
            Import Audio File
          </button>
          <div className="relative pt-1">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-3.5 text-muted-foreground" />
            <input
              type="text"
              value={meetingSearch}
              onChange={(e) => setMeetingSearch(e.target.value)}
              placeholder="Search meetings..."
              className="w-full rounded-lg border bg-background pl-8 pr-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Meetings ({filteredMeetings.length})
          </div>
          {filteredMeetings.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">
              {meetings.length === 0 ? 'No meetings recorded yet.' : 'No matching meetings found.'}
            </p>
          ) : (
            filteredMeetings.map((m) => {
              const active = selectedMeeting?.id === m.id;
              return (
                <div
                  key={m.id}
                  onClick={() => !isRecording && loadMeeting(m.id)}
                  className={`group flex items-center justify-between rounded-lg px-2.5 py-2 text-sm cursor-pointer transition-colors ${
                    active
                      ? 'bg-secondary text-secondary-foreground font-medium'
                      : 'hover:bg-muted/70 text-foreground'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{m.title}</div>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                      <span>{formatDuration(m.durationSeconds)}</span>
                      <span>•</span>
                      <span>{m.primaryLanguage.toUpperCase()}</span>
                    </div>
                  </div>
                  {!isRecording && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteMeeting(m.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 hover:text-destructive"
                      title="Delete meeting"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="p-3 border-t">
          <button
            onClick={() => setSettingsOpen(true)}
            className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            <Settings className="h-4 w-4 text-primary" />
            Settings
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top Toolbar */}
        <header className="border-b bg-card px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {isRecording ? (
              <div className="flex items-center gap-2.5">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    isPaused ? 'bg-amber-500' : 'bg-emerald-500 animate-pulse'
                  }`}
                />
                <span className="font-mono text-sm font-semibold text-primary">
                  {formatDuration(elapsedSec)} {isPaused && '(Paused)'}
                </span>
                <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-75"
                    style={{ width: `${Math.round(audioLevel * 100)}%` }}
                  />
                </div>
              </div>
            ) : selectedMeeting ? (
              editingTitle ? (
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    type="text"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveTitle();
                      if (e.key === 'Escape') setEditingTitle(false);
                    }}
                    className="rounded-md border bg-background px-2.5 py-1 text-sm font-semibold outline-none focus:ring-1 focus:ring-primary"
                  />
                  <button
                    onClick={handleSaveTitle}
                    className="rounded p-1 text-primary hover:bg-secondary"
                    title="Save title"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setEditingTitle(false)}
                    className="rounded p-1 text-muted-foreground hover:bg-muted"
                    title="Cancel"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setTitleDraft(selectedMeeting.title);
                    setEditingTitle(true);
                  }}
                  className="group flex items-center gap-2 text-base font-semibold truncate hover:text-primary"
                  title="Click to rename meeting"
                >
                  <span className="truncate">{selectedMeeting.title}</span>
                  <Edit3 className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 text-muted-foreground" />
                </button>
              )
            ) : (
              <h2 className="text-base font-semibold">Ready to Record</h2>
            )}
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <LanguagePill
              settings={settings}
              disabled={isRecording}
              onChangeMode={(mode: LanguageMode) => handleUpdateSettings({ languageMode: mode })}
              onOpenSettings={() => setSettingsOpen(true)}
            />

            <button
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
              title="Click to configure storage folder and audio saving"
            >
              <FileAudio className="h-3.5 w-3.5 text-primary" />
              Audio Save: <strong>{settings.saveRecordedAudio ? 'ON' : 'OFF'}</strong>
            </button>

            {!isRecording && (
              <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeSystemAudio}
                  onChange={(e) => setIncludeSystemAudio(e.target.checked)}
                  className="accent-primary rounded"
                />
                System Audio
              </label>
            )}

            {isRecording ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleTogglePause}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted"
                >
                  {isPaused ? <Play className="h-3.5 w-3.5 text-primary" /> : <Pause className="h-3.5 w-3.5" />}
                  {isPaused ? 'Resume' : 'Pause'}
                </button>
                <button
                  onClick={handleStopRecording}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-4 py-1.5 text-sm font-semibold text-destructive-foreground hover:opacity-90"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  Stop Recording
                </button>
              </div>
            ) : (
              <button
                disabled={Boolean(isBusy)}
                onClick={handleStartRecording}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <Mic className="h-4 w-4" />
                Record
              </button>
            )}
          </div>
        </header>

        {(errorMsg || isBusy) && (
          <div className="px-6 py-2 text-xs border-b flex items-center justify-between bg-secondary/50">
            <span className={errorMsg ? 'text-destructive font-medium' : 'text-secondary-foreground font-medium'}>
              {errorMsg ?? isBusy}
            </span>
            {errorMsg && (
              <button onClick={() => setErrorMsg(null)} className="underline">
                Dismiss
              </button>
            )}
          </div>
        )}

        {/* Workspace Split */}
        {!selectedMeeting ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="h-14 w-14 rounded-2xl bg-secondary text-primary flex items-center justify-center mb-4">
              <Leaf className="h-7 w-7" />
            </div>
            <h3 className="text-lg font-semibold">Welcome to Eco Meetly</h3>
            <p className="text-sm text-muted-foreground max-w-md mt-1">
              100% offline meeting transcription and AI summaries. Click <strong>Record</strong> to start a new
              meeting or <strong>Import Audio File</strong> to transcribe an existing recording.
            </p>
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 min-h-0 divide-y lg:divide-y-0 lg:divide-x">
            {/* Transcript Column */}
            <section className="flex flex-col min-h-0">
              <div className="px-5 py-3 border-b space-y-2.5 bg-muted/20">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Transcript ({segments.length})</h3>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {segments.length > 0 && (
                      <button
                        onClick={() =>
                          navigator.clipboard.writeText(
                            segments
                              .map((s) => `[${formatMs(s.startTimeMs)}]${s.speaker ? ` [${s.speaker}]` : ''} ${s.text}`)
                              .join('\n')
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                        title="Copy full transcript"
                      >
                        <Copy className="h-3 w-3" /> Copy
                      </button>
                    )}
                    <button
                      onClick={() => window.ecoMeetly.openFolder(selectedMeeting.folderPath)}
                      className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-muted"
                      title="Open this meeting's storage folder"
                    >
                      <FolderOpen className="h-3.5 w-3.5 text-primary" />
                      Meeting Folder
                    </button>
                    {selectedMeeting.audioPath && (
                      <button
                        disabled={isRecording || Boolean(isBusy)}
                        onClick={handleRetranscribe}
                        className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Re-transcribe
                      </button>
                    )}
                  </div>
                </div>

                {selectedMeeting.audioPath && !isRecording && (
                  <audio
                    controls
                    src={`eco-audio://local?path=${encodeURIComponent(selectedMeeting.audioPath)}`}
                    className="w-full h-8"
                  />
                )}

                {segments.length > 0 && (
                  <div className="relative">
                    <Search className="h-3.5 w-3.5 absolute left-2.5 top-2 text-muted-foreground" />
                    <input
                      type="text"
                      value={transcriptSearch}
                      onChange={(e) => setTranscriptSearch(e.target.value)}
                      placeholder="Filter transcript..."
                      className="w-full rounded-md border bg-background pl-8 pr-3 py-1 text-xs outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-3">
                {filteredSegments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {isRecording
                      ? 'Listening for speech...'
                      : segments.length === 0
                        ? 'No transcript segments yet.'
                        : 'No matching transcript segments.'}
                  </p>
                ) : (
                  filteredSegments.map((seg) => {
                    const spkName = seg.speaker || 'Speaker 1';
                    const spkNum = parseInt(spkName.replace(/\D/g, ''), 10) || 1;
                    const badgePalette = [
                      'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
                      'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
                      'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
                      'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
                    ];
                    const badgeClass = badgePalette[(spkNum - 1) % badgePalette.length];

                    return (
                      <div key={seg.id} className="rounded-lg border bg-card p-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                          <div className="flex items-center gap-2">
                            {editingSpeaker?.segmentId === seg.id ? (
                              <span className="inline-flex items-center gap-1">
                                <input
                                  autoFocus
                                  type="text"
                                  value={speakerDraft}
                                  onChange={(e) => setSpeakerDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') void handleSaveSpeakerRename();
                                    if (e.key === 'Escape') setEditingSpeaker(null);
                                  }}
                                  className="w-28 rounded border bg-background px-1.5 py-0.5 text-[11px] font-semibold text-foreground outline-none focus:ring-1 focus:ring-primary"
                                />
                                <button
                                  onClick={() => void handleSaveSpeakerRename()}
                                  className="text-primary hover:underline"
                                >
                                  Save
                                </button>
                              </span>
                            ) : (
                              <button
                                onClick={() => {
                                  setEditingSpeaker({ segmentId: seg.id, oldName: spkName });
                                  setSpeakerDraft(spkName);
                                }}
                                className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-opacity hover:opacity-80 ${badgeClass}`}
                                title="Click to rename speaker"
                              >
                                {spkName}
                              </button>
                            )}
                            <span className="font-mono">
                              {formatMs(seg.startTimeMs)} – {formatMs(seg.endTimeMs)}
                            </span>
                          </div>
                          {seg.detectedLanguage && (
                            <span className="rounded bg-secondary px-1.5 py-0.5 font-semibold text-secondary-foreground uppercase">
                              {seg.detectedLanguage}
                            </span>
                          )}
                        </div>
                        <p className="text-sm leading-relaxed">{seg.text}</p>
                      </div>
                    );
                  })
                )}
                <div ref={transcriptEndRef} />
              </div>
            </section>

            {/* Summary Column */}
            <section className="flex flex-col min-h-0">
              <div className="px-5 py-3 border-b space-y-2.5 bg-muted/20">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Local AI Summary</h3>
                  <div className="flex items-center gap-2">
                    <select
                      value={settings.summaryTemplateId}
                      onChange={(e) => handleUpdateSettings({ summaryTemplateId: e.target.value })}
                      className="rounded-md border bg-background px-2 py-1 text-xs"
                    >
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    {isSummarizing ? (
                      <button
                        onClick={handleCancelSummary}
                        className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
                      >
                        <X className="h-3.5 w-3.5" /> Cancel
                      </button>
                    ) : (
                      <button
                        disabled={segments.length === 0 || isRecording}
                        onClick={handleGenerateSummary}
                        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {summary ? 'Regenerate' : 'Summarize'}
                      </button>
                    )}
                  </div>
                </div>

                <input
                  type="text"
                  disabled={isSummarizing}
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="Optional focus prompt (e.g., Focus on action items and deadlines)..."
                  className="w-full rounded-md border bg-background px-2.5 py-1 text-xs outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
              </div>

              <div className="flex-1 overflow-y-auto p-5">
                {errorMsg && !isSummarizing && !streamingSummary && !summary && (
                  <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                    {errorMsg}
                  </div>
                )}

                {streamingSummary || summary ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        Model: <strong>{summary?.modelName ?? settings.builtinModelId}</strong>
                      </span>
                      <div className="flex items-center gap-2">
                        {summary && !isSummarizing && !editingSummary && (
                          <button
                            onClick={() => {
                              setSummaryDraft(summary.content);
                              setEditingSummary(true);
                            }}
                            className="inline-flex items-center gap-1 rounded border px-2 py-1 hover:bg-muted"
                          >
                            <Edit3 className="h-3 w-3" /> Edit
                          </button>
                        )}
                        <button
                          onClick={() => navigator.clipboard.writeText(streamingSummary || summary?.content || '')}
                          className="inline-flex items-center gap-1 rounded border px-2 py-1 hover:bg-muted"
                        >
                          <Copy className="h-3 w-3" /> Copy
                        </button>
                      </div>
                    </div>

                    {editingSummary ? (
                      <div className="space-y-2">
                        <textarea
                          value={summaryDraft}
                          onChange={(e) => setSummaryDraft(e.target.value)}
                          rows={14}
                          className="w-full rounded-lg border bg-card p-3 font-sans text-sm leading-relaxed outline-none focus:ring-1 focus:ring-primary"
                        />
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setEditingSummary(false)}
                            className="rounded-md border px-3 py-1 text-xs hover:bg-muted"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleSaveEditedSummary}
                            className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90"
                          >
                            Save Summary
                          </button>
                        </div>
                      </div>
                    ) : (
                      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed rounded-lg border bg-card p-4">
                        {streamingSummary || summary?.content}
                      </pre>
                    )}
                  </div>
                ) : isSummarizing ? (
                  <div className="rounded-lg border border-primary/30 bg-secondary/50 p-4 text-sm text-secondary-foreground">
                    Loading local AI model and generating summary...
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {segments.length === 0
                      ? 'Record or import audio with speech first to enable AI summary.'
                      : 'Click Summarize to generate structured meeting notes offline using your local AI model.'}
                  </p>
                )}
              </div>
            </section>
          </div>
        )}
      </main>

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onUpdate={handleUpdateSettings}
      />
    </div>
  );
}
export default App;
