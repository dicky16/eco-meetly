import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs, { Database } from 'sql.js';
import { Meeting, MeetingSummary, TranscriptSegment } from '../types';

export class DatabaseService {
  private db: Database | null = null;
  private dbPath: string;

  constructor() {
    this.dbPath = path.join(app.getPath('userData'), 'eco-meetly.sqlite');
  }

  async init(): Promise<void> {
    const SQL = await initSqlJs();
    if (fs.existsSync(this.dbPath)) {
      const fileBuffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(fileBuffer);
    } else {
      this.db = new SQL.Database();
    }
    this.createTables();
    this.persist();
  }

  private ensureDb(): Database {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  private createTables(): void {
    const db = this.ensureDb();
    db.run(`
      CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        duration_seconds INTEGER DEFAULT 0,
        folder_path TEXT NOT NULL,
        audio_path TEXT,
        language_mode TEXT NOT NULL,
        primary_language TEXT NOT NULL,
        secondary_language TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transcript_segments (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        start_time_ms INTEGER NOT NULL,
        end_time_ms INTEGER NOT NULL,
        text TEXT NOT NULL,
        detected_language TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS summaries (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        template_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model_name TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
      );
    `);
  }

  private persist(): void {
    const db = this.ensureDb();
    const data = db.export();
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  createMeeting(meeting: Meeting): Meeting {
    const db = this.ensureDb();
    db.run(
      `INSERT INTO meetings (
        id, title, created_at, updated_at, duration_seconds,
        folder_path, audio_path, language_mode, primary_language, secondary_language, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        meeting.id,
        meeting.title,
        meeting.createdAt,
        meeting.updatedAt,
        meeting.durationSeconds,
        meeting.folderPath,
        meeting.audioPath,
        meeting.languageMode,
        meeting.primaryLanguage,
        meeting.secondaryLanguage,
        meeting.status,
      ]
    );
    this.persist();
    return meeting;
  }

  updateMeeting(id: string, fields: Partial<Pick<Meeting, 'title' | 'durationSeconds' | 'audioPath' | 'status' | 'updatedAt'>>): void {
    const db = this.ensureDb();
    const sets: string[] = [];
    const values: (string | number | null)[] = [];

    if (fields.title !== undefined) {
      sets.push('title = ?');
      values.push(fields.title);
    }
    if (fields.durationSeconds !== undefined) {
      sets.push('duration_seconds = ?');
      values.push(fields.durationSeconds);
    }
    if (fields.audioPath !== undefined) {
      sets.push('audio_path = ?');
      values.push(fields.audioPath);
    }
    if (fields.status !== undefined) {
      sets.push('status = ?');
      values.push(fields.status);
    }
    sets.push('updated_at = ?');
    values.push(fields.updatedAt ?? new Date().toISOString());
    values.push(id);

    db.run(`UPDATE meetings SET ${sets.join(', ')} WHERE id = ?`, values);
    this.persist();
  }

  listMeetings(): Meeting[] {
    const db = this.ensureDb();
    const res = db.exec(`SELECT * FROM meetings ORDER BY created_at DESC`);
    if (!res.length) return [];
    const cols = res[0].columns;
    return res[0].values.map((row) => {
      const obj: Record<string, unknown> = {};
      cols.forEach((c, idx) => {
        obj[c] = row[idx];
      });
      return {
        id: String(obj.id),
        title: String(obj.title),
        createdAt: String(obj.created_at),
        updatedAt: String(obj.updated_at),
        durationSeconds: Number(obj.duration_seconds ?? 0),
        folderPath: String(obj.folder_path),
        audioPath: obj.audio_path ? String(obj.audio_path) : null,
        languageMode: obj.language_mode as Meeting['languageMode'],
        primaryLanguage: String(obj.primary_language),
        secondaryLanguage: String(obj.secondary_language),
        status: obj.status as Meeting['status'],
      };
    });
  }

  getMeeting(id: string): Meeting | null {
    return this.listMeetings().find((m) => m.id === id) ?? null;
  }

  deleteMeeting(id: string): void {
    const db = this.ensureDb();
    db.run(`DELETE FROM transcript_segments WHERE meeting_id = ?`, [id]);
    db.run(`DELETE FROM summaries WHERE meeting_id = ?`, [id]);
    db.run(`DELETE FROM meetings WHERE id = ?`, [id]);
    this.persist();
  }

  finalizeStaleRecordings(): void {
    const db = this.ensureDb();
    db.run(`UPDATE meetings SET status = 'completed', updated_at = ? WHERE status = 'recording'`, [
      new Date().toISOString(),
    ]);
    this.persist();
  }

  addSegment(segment: TranscriptSegment): TranscriptSegment {
    const db = this.ensureDb();
    db.run(
      `INSERT INTO transcript_segments (
        id, meeting_id, start_time_ms, end_time_ms, text, detected_language, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        segment.id,
        segment.meetingId,
        segment.startTimeMs,
        segment.endTimeMs,
        segment.text,
        segment.detectedLanguage,
        segment.createdAt,
      ]
    );
    this.persist();
    return segment;
  }

  clearSegments(meetingId: string): void {
    const db = this.ensureDb();
    db.run(`DELETE FROM transcript_segments WHERE meeting_id = ?`, [meetingId]);
    this.persist();
  }

  getSegments(meetingId: string): TranscriptSegment[] {
    const db = this.ensureDb();
    const stmt = db.prepare(`SELECT * FROM transcript_segments WHERE meeting_id = ? ORDER BY start_time_ms ASC`);
    stmt.bind([meetingId]);
    const rows: TranscriptSegment[] = [];
    while (stmt.step()) {
      const obj = stmt.getAsObject();
      rows.push({
        id: String(obj.id),
        meetingId: String(obj.meeting_id),
        startTimeMs: Number(obj.start_time_ms),
        endTimeMs: Number(obj.end_time_ms),
        text: String(obj.text),
        detectedLanguage: obj.detected_language ? String(obj.detected_language) : null,
        createdAt: String(obj.created_at),
      });
    }
    stmt.free();
    return rows;
  }

  saveSummary(summary: MeetingSummary): MeetingSummary {
    const db = this.ensureDb();
    db.run(
      `INSERT INTO summaries (
        id, meeting_id, template_id, provider, model_name, content, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        summary.id,
        summary.meetingId,
        summary.templateId,
        summary.provider,
        summary.modelName,
        summary.content,
        summary.createdAt,
      ]
    );
    this.persist();
    return summary;
  }

  getLatestSummary(meetingId: string): MeetingSummary | null {
    const db = this.ensureDb();
    const stmt = db.prepare(
      `SELECT * FROM summaries WHERE meeting_id = ? AND LENGTH(TRIM(content)) > 0 ORDER BY created_at DESC LIMIT 1`
    );
    stmt.bind([meetingId]);
    let result: MeetingSummary | null = null;
    if (stmt.step()) {
      const obj = stmt.getAsObject();
      result = {
        id: String(obj.id),
        meetingId: String(obj.meeting_id),
        templateId: String(obj.template_id),
        provider: obj.provider as MeetingSummary['provider'],
        modelName: String(obj.model_name),
        content: String(obj.content),
        createdAt: String(obj.created_at),
      };
    }
    stmt.free();
    return result;
  }

  updateSummaryContent(summaryId: string, content: string): MeetingSummary | null {
    const db = this.ensureDb();
    db.run(`UPDATE summaries SET content = ? WHERE id = ?`, [content, summaryId]);
    this.persist();
    const stmt = db.prepare(`SELECT * FROM summaries WHERE id = ? LIMIT 1`);
    stmt.bind([summaryId]);
    let result: MeetingSummary | null = null;
    if (stmt.step()) {
      const obj = stmt.getAsObject();
      result = {
        id: String(obj.id),
        meetingId: String(obj.meeting_id),
        templateId: String(obj.template_id),
        provider: obj.provider as MeetingSummary['provider'],
        modelName: String(obj.model_name),
        content: String(obj.content),
        createdAt: String(obj.created_at),
      };
    }
    stmt.free();
    return result;
  }
}
