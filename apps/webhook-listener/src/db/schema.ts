import * as path from 'path';
import Database from 'better-sqlite3';

/**
 * Open the shared SQLite database and ensure the webhook-specific tables exist.
 *
 * Uses the same database file as ai-orchestrator so deliveries and checkpoints
 * are co-located — no extra DB connection or file required.
 *
 * DATABASE_PATH env var overrides the default path (useful in tests).
 */
export function openDb(): Database.Database {
  const dbPath =
    process.env['DATABASE_PATH'] ??
    path.resolve(
      __dirname,
      '../../../../libs/ai-orchestrator/data/state.db',
    );

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  applyMigrations(db);

  return db;
}

function applyMigrations(db: Database.Database): void {
  db.exec(`
    -- Deduplication table: tracks X-GitHub-Delivery header values.
    -- Prevents replay attacks and duplicate processing of the same webhook event.
    CREATE TABLE IF NOT EXISTS deliveries (
      delivery_id   TEXT    PRIMARY KEY,
      processed_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Startup sync table: records the last time we polled GitHub for missed
    -- comments while the server was offline.
    CREATE TABLE IF NOT EXISTS webhook_sync (
      key    TEXT PRIMARY KEY,
      value  TEXT NOT NULL
    );
  `);
}
