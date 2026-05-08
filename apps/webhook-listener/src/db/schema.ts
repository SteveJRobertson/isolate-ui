import * as path from 'path';
import Database from 'better-sqlite3';

/**
 * Resolve the SQLite database path.
 *
 * Uses DATABASE_PATH env var when set; otherwise falls back to the path used
 * by OrchestratorGraph's own default (libs/ai-orchestrator/data/state.db)
 * derived from the workspace root. Exporting this function lets main.ts
 * compute the path once and pass it to both openDb() and new OrchestratorGraph()
 * so both always use the same file.
 */
export function resolveDbPath(): string {
  if (process.env['DATABASE_PATH']) {
    return process.env['DATABASE_PATH'];
  }
  // Walk up to the workspace root from this file's location in dist/
  // by looking for the nx.json marker, mirroring OrchestratorGraph's approach.
  // At runtime the compiled file is at dist/apps/webhook-listener/main.js;
  // the workspace root is 3 levels up from that.
  const candidates = [
    // Runtime (compiled): dist/apps/webhook-listener/src/db/schema.js → root is ../../../../
    path.resolve(__dirname, '../../../../libs/ai-orchestrator/data/state.db'),
    // Development (ts-node / nx serve): src/db/schema.ts → root is ../../../../
    path.resolve(__dirname, '../../../../libs/ai-orchestrator/data/state.db'),
  ];
  return candidates[0];
}

/**
 * Open the shared SQLite database and ensure the webhook-specific tables exist.
 *
 * Uses the same database file as ai-orchestrator so deliveries and checkpoints
 * are co-located — no extra DB connection or file required.
 *
 * Pass the resolved path explicitly (from resolveDbPath()) so the caller can
 * share the same path with OrchestratorGraph.
 */
export function openDb(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? resolveDbPath();

  const db = new Database(resolvedPath);
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
