import fs from 'node:fs';
import path from 'node:path';
import { Meeting, MeetingSummary, TranscriptSegment } from '../types';

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Writes human-readable meeting artifacts (`transcript.txt`, `summary.md`, `meeting-notes.md`)
 * into the meeting's configured storage folder so the Meeting Storage Folder always contains
 * the user's notes even when "Save Recorded Audio" is disabled.
 */
export function exportMeetingArtifacts(
  meeting: Meeting,
  segments: TranscriptSegment[],
  summary: MeetingSummary | null
): void {
  if (!meeting.folderPath) return;
  fs.mkdirSync(meeting.folderPath, { recursive: true });

  const transcriptLines = segments.map((seg) => {
    const lang = seg.detectedLanguage ? ` [${seg.detectedLanguage.toUpperCase()}]` : '';
    return `[${formatTimestamp(seg.startTimeMs)} - ${formatTimestamp(seg.endTimeMs)}]${lang} ${seg.text}`;
  });
  const transcriptBody = transcriptLines.join('\n');

  fs.writeFileSync(path.join(meeting.folderPath, 'transcript.txt'), transcriptBody, 'utf-8');

  if (summary) {
    fs.writeFileSync(path.join(meeting.folderPath, 'summary.md'), summary.content, 'utf-8');
    const d = new Date(summary.createdAt);
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    fs.writeFileSync(path.join(meeting.folderPath, `summary_${stamp}.md`), summary.content, 'utf-8');
  }

  const combined = [
    `# ${meeting.title}`,
    '',
    `- **Date:** ${new Date(meeting.createdAt).toLocaleString('en-US')}`,
    `- **Duration:** ${Math.floor(meeting.durationSeconds / 60)}m ${meeting.durationSeconds % 60}s`,
    `- **Language Mode:** ${meeting.languageMode} (${meeting.primaryLanguage.toUpperCase()}${
      meeting.languageMode === 'bilingual' ? ` + ${meeting.secondaryLanguage.toUpperCase()}` : ''
    })`,
    meeting.audioPath ? `- **Audio File:** ${path.basename(meeting.audioPath)}` : '- **Audio File:** Not saved',
    '',
    '---',
    '',
    '## AI Summary',
    '',
    summary ? summary.content : '_No summary generated yet._',
    '',
    '---',
    '',
    '## Transcript',
    '',
    transcriptBody || '_No transcript segments._',
    '',
  ].join('\n');

  fs.writeFileSync(path.join(meeting.folderPath, 'meeting-notes.md'), combined, 'utf-8');
}
