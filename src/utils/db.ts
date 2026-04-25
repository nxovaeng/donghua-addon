import Database from 'better-sqlite3';
import { config } from '../config';
import fs from 'fs';
import path from 'path';

const dbDir = path.dirname(config.DATABASE_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(config.DATABASE_PATH);
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS meta_cache (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stream_cache (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS id_mappings (
    imdb_id TEXT,
    tmdb_id INTEGER,
    bgm_id INTEGER,
    type TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (imdb_id, type)
  );

  CREATE INDEX IF NOT EXISTS idx_meta_expires ON meta_cache(expires_at);
  CREATE INDEX IF NOT EXISTS idx_stream_expires ON stream_cache(expires_at);
`);

export function purgeExpired() {
  const now = Math.floor(Date.now() / 1000);
  db.prepare('DELETE FROM meta_cache WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM stream_cache WHERE expires_at < ?').run(now);
}
