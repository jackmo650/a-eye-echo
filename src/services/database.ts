// ============================================================================
// Database — SQLite storage for transcript sessions and segments
// Offline-first: all data persisted locally, never loses transcripts.
// ============================================================================

import * as SQLite from 'expo-sqlite';
import type {
  TranscriptSession,
  TranscriptSegment,
  Speaker,
} from '../types';

let _db: SQLite.SQLiteDatabase | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync('captioncast.db');
  await _db.execAsync(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      startedAt TEXT NOT NULL,
      endedAt TEXT,
      audioSourceType TEXT NOT NULL,
      audioSourceDeviceId TEXT,
      modelUsed TEXT NOT NULL,
      segmentCount INTEGER DEFAULT 0,
      durationMs INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS segments (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      text TEXT NOT NULL,
      startMs INTEGER NOT NULL,
      endMs INTEGER NOT NULL,
      speakerId TEXT,
      isFinal INTEGER NOT NULL DEFAULT 1,
      confidence REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (sessionId) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS speakers (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      label TEXT NOT NULL,
      color TEXT NOT NULL,
      thumbnailUri TEXT,
      FOREIGN KEY (sessionId) REFERENCES sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_segments_session ON segments(sessionId);
    CREATE INDEX IF NOT EXISTS idx_speakers_session ON speakers(sessionId);
  `);
  return _db;
}

// ── Sessions ────────────────────────────────────────────────────────────────

export async function saveSession(session: TranscriptSession): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO sessions (id, title, startedAt, endedAt, audioSourceType, modelUsed, segmentCount, durationMs)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    session.id,
    session.title,
    session.startedAt,
    session.endedAt,
    session.audioSource.type,
    session.modelUsed,
    session.segmentCount,
    session.durationMs,
  );
}

export async function getSessions(): Promise<TranscriptSession[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    title: string;
    startedAt: string;
    endedAt: string | null;
    audioSourceType: string;
    modelUsed: string;
    segmentCount: number;
    durationMs: number;
  }>('SELECT * FROM sessions ORDER BY startedAt DESC');

  return rows.map(row => ({
    id: row.id,
    title: row.title,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    audioSource: { type: row.audioSourceType as 'microphone' | 'system-audio' | 'bluetooth' },
    modelUsed: row.modelUsed as TranscriptSession['modelUsed'],
    segmentCount: row.segmentCount,
    durationMs: row.durationMs,
  }));
}

export async function deleteSession(sessionId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM segments WHERE sessionId = ?', sessionId);
  await db.runAsync('DELETE FROM speakers WHERE sessionId = ?', sessionId);
  await db.runAsync('DELETE FROM sessions WHERE id = ?', sessionId);
}

// ── Segments ────────────────────────────────────────────────────────────────

export async function saveSegment(
  sessionId: string,
  segment: TranscriptSegment,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO segments (id, sessionId, text, startMs, endMs, speakerId, isFinal, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    segment.id,
    sessionId,
    segment.text,
    segment.startMs,
    segment.endMs,
    segment.speakerId,
    segment.isFinal ? 1 : 0,
    segment.confidence,
  );
}

export async function getSegments(sessionId: string): Promise<TranscriptSegment[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    text: string;
    startMs: number;
    endMs: number;
    speakerId: string | null;
    isFinal: number;
    confidence: number;
  }>('SELECT * FROM segments WHERE sessionId = ? ORDER BY startMs', sessionId);

  return rows.map(row => ({
    id: row.id,
    text: row.text,
    startMs: row.startMs,
    endMs: row.endMs,
    speakerId: row.speakerId,
    isFinal: row.isFinal === 1,
    confidence: row.confidence,
  }));
}

// ── Speakers ────────────────────────────────────────────────────────────────

export async function saveSpeaker(
  sessionId: string,
  speaker: Speaker,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO speakers (id, sessionId, label, color, thumbnailUri)
     VALUES (?, ?, ?, ?, ?)`,
    speaker.id,
    sessionId,
    speaker.label,
    speaker.color,
    speaker.thumbnailUri,
  );
}

export async function getSpeakers(sessionId: string): Promise<Speaker[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    label: string;
    color: string;
    thumbnailUri: string | null;
  }>('SELECT * FROM speakers WHERE sessionId = ?', sessionId);

  return rows.map(row => ({
    id: row.id,
    label: row.label,
    color: row.color,
    thumbnailUri: row.thumbnailUri,
    embedding: null, // Embeddings not persisted to DB (privacy)
  }));
}
