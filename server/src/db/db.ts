import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * SQLite via Node's built-in driver. One file, WAL mode — enough for a single
 * server. Migrations are append-only: never edit an applied step, add a new one.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );
  CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    lang TEXT NOT NULL,
    intent_json TEXT NOT NULL,
    status TEXT NOT NULL,
    result_json TEXT,
    error TEXT,
    usage_json TEXT,
    created_at INTEGER NOT NULL,
    finished_at INTEGER
  );
  CREATE INDEX runs_user_created ON runs(user_id, created_at DESC);
  CREATE INDEX runs_created ON runs(created_at);
  CREATE TABLE run_events (
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (run_id, seq)
  );
  CREATE TABLE cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE attempts (
    key TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  CREATE INDEX attempts_key ON attempts(key, at);
  `,
]

export type Db = DatabaseSync

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)')
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null }
  const current = row.v ?? 0
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[i])
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(i + 1, Date.now())
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  return db
}

/* ---------------- small cache table (pages, search results, API calls) ---------------- */

export function cacheGet<T>(db: Db, key: string): T | undefined {
  const row = db.prepare('SELECT value, expires_at FROM cache WHERE key = ?').get(key) as
    | { value: string; expires_at: number }
    | undefined
  if (!row) return undefined
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM cache WHERE key = ?').run(key)
    return undefined
  }
  return JSON.parse(row.value) as T
}

export function cacheSet(db: Db, key: string, value: unknown, ttlMs: number) {
  db.prepare('INSERT INTO cache (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at').run(
    key,
    JSON.stringify(value),
    Date.now() + ttlMs,
  )
}

export async function cached<T>(db: Db, key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cacheGet<T>(db, key)
  if (hit !== undefined) return hit
  const v = await load()
  cacheSet(db, key, v, ttlMs)
  return v
}

export function pruneExpired(db: Db) {
  const now = Date.now()
  db.prepare('DELETE FROM cache WHERE expires_at < ?').run(now)
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now)
  db.prepare('DELETE FROM tokens WHERE expires_at < ?').run(now)
  db.prepare('DELETE FROM attempts WHERE at < ?').run(now - 24 * 3600_000)
}

/* ---------------- attempt counter (login throttling etc.) ---------------- */

export function countAttempts(db: Db, key: string, windowMs: number): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE key = ? AND at > ?').get(key, Date.now() - windowMs) as { n: number }
  return row.n
}

export function recordAttempt(db: Db, key: string) {
  db.prepare('INSERT INTO attempts (key, at) VALUES (?, ?)').run(key, Date.now())
}

export function clearAttempts(db: Db, key: string) {
  db.prepare('DELETE FROM attempts WHERE key = ?').run(key)
}
