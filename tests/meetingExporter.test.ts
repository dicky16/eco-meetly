import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportMeetingArtifacts } from '../electron/services/meetingExporter';
import { Meeting, MeetingSummary, TranscriptSegment } from '../electron/types';

describe('exportMeetingArtifacts', () => {
  let tmpDir = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-meetly-export-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes transcript.txt, summary.md, and meeting-notes.md into meeting.folderPath', () => {
    const meeting: Meeting = {
      id: 'm-1',
      title: 'Product Sync',
      createdAt: '2026-11-23T10:00:00.000Z',
      updatedAt: '2026-11-23T10:05:00.000Z',
      durationSeconds: 300,
      folderPath: path.join(tmpDir, '2026-11-23_Product-Sync'),
      audioPath: null,
      languageMode: 'bilingual',
      primaryLanguage: 'id',
      secondaryLanguage: 'en',
      status: 'completed',
    };

    const segments: TranscriptSegment[] = [
      {
        id: 's-1',
        meetingId: 'm-1',
        startTimeMs: 0,
        endTimeMs: 5000,
        text: 'Kita bahas roadmap minggu ini.',
        detectedLanguage: 'id',
        speaker: 'Speaker 1',
        createdAt: '2026-11-23T10:00:05.000Z',
      },
    ];

    const summary: MeetingSummary = {
      id: 'sum-1',
      meetingId: 'm-1',
      templateId: 'executive-action',
      provider: 'builtin-llama',
      modelName: 'Qwen 2.5 3B',
      content: '## Executive Summary\nRoadmap finalized.',
      createdAt: '2026-11-23T10:05:00.000Z',
    };

    exportMeetingArtifacts(meeting, segments, summary);

    const transcript = fs.readFileSync(path.join(meeting.folderPath, 'transcript.txt'), 'utf-8');
    const summaryMd = fs.readFileSync(path.join(meeting.folderPath, 'summary.md'), 'utf-8');
    const notesMd = fs.readFileSync(path.join(meeting.folderPath, 'meeting-notes.md'), 'utf-8');
    const timestampedFiles = fs.readdirSync(meeting.folderPath).filter((f) => /^summary_\d{8}-\d{6}\.md$/.test(f));

    expect(transcript).toContain('[00:00 - 00:05] [Speaker 1] [ID] Kita bahas roadmap minggu ini.');
    expect(summaryMd).toContain('Roadmap finalized.');
    expect(timestampedFiles).toHaveLength(1);
    expect(notesMd).toContain('# Product Sync');
    expect(notesMd).toContain('Roadmap finalized.');
    expect(notesMd).toContain('Kita bahas roadmap minggu ini.');
  });
});
