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

describe('DatabaseService', () => {
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-meetly-db-'));
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('creates, updates, lists, and deletes meetings with segments and summaries', async () => {
    const { DatabaseService } = await import('../electron/services/database');
    const db = new DatabaseService();
    await db.init();

    const now = new Date().toISOString();
    db.createMeeting({
      id: 'm1',
      title: 'Weekly Sync',
      createdAt: now,
      updatedAt: now,
      durationSeconds: 0,
      folderPath: path.join(tmpRoot, 'm1'),
      audioPath: null,
      languageMode: 'bilingual',
      primaryLanguage: 'id',
      secondaryLanguage: 'en',
      status: 'recording',
    });

    db.addSegment({
      id: 's1',
      meetingId: 'm1',
      startTimeMs: 0,
      endTimeMs: 3000,
      text: 'Halo semuanya, let us start.',
      detectedLanguage: 'id',
      speaker: 'Speaker 1',
      createdAt: now,
    });

    db.saveSummary({
      id: 'sum1',
      meetingId: 'm1',
      templateId: 'executive-action',
      provider: 'builtin-llama',
      modelName: 'Qwen 2.5 3B',
      content: '## Executive Summary\nTeam aligned.',
      createdAt: now,
    });

    db.updateMeeting('m1', { status: 'completed', durationSeconds: 120, audioPath: '/tmp/rec.wav' });

    // Reload from disk to verify persistence
    const db2 = new DatabaseService();
    await db2.init();

    const meeting = db2.getMeeting('m1');
    expect(meeting?.status).toBe('completed');
    expect(meeting?.durationSeconds).toBe(120);
    expect(meeting?.audioPath).toBe('/tmp/rec.wav');

    expect(db2.getSegments('m1')).toHaveLength(1);
    expect(db2.getLatestSummary('m1')?.content).toContain('Team aligned.');

    const updatedSum = db2.updateSummaryContent('sum1', '## Executive Summary\nEdited notes.');
    expect(updatedSum?.content).toContain('Edited notes.');

    db2.createMeeting({
      id: 'm-stale',
      title: 'Interrupted Meeting',
      createdAt: now,
      updatedAt: now,
      durationSeconds: 10,
      folderPath: path.join(tmpRoot, 'm-stale'),
      audioPath: null,
      languageMode: 'fixed',
      primaryLanguage: 'id',
      secondaryLanguage: 'en',
      status: 'recording',
    });
    db2.finalizeStaleRecordings();
    expect(db2.getMeeting('m-stale')?.status).toBe('completed');
    db2.deleteMeeting('m-stale');

    db2.clearSegments('m1');
    expect(db2.getSegments('m1')).toHaveLength(0);

    db2.deleteMeeting('m1');
    expect(db2.listMeetings()).toHaveLength(0);
  });
});
