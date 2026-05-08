import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

/**
 * Walk up from startDir until a directory containing nx.json is found.
 * Mirrors the implementation in libs/ai-orchestrator/src/config/agent-parser.ts
 * so the resolution is consistent across runtimes and build output layouts.
 */
function findWorkspaceRoot(startDir: string): string {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'nx.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error(
    `Could not locate workspace root (no nx.json found). Started from: ${startDir}`,
  );
}

/**
 * Resolve the SQLite database path.
 *
 * Uses DATABASE_PATH env var when set; otherwise walks up from __dirname to
 * find the workspace root (via nx.json marker) and derives the default path
 * from there — robust across compiled (dist/apps/webhook-listener/...) and
 * development (src/db/schema.ts) layouts.
 */
export function resolveDbPath(): string {
  if (process.env['DATABASE_PATH']) {
    return process.env['DATABASE_PATH'];
  }
  const workspaceRoot = findWorkspaceRoot(__dirname);
  return path.join(
    workspaceRoot,
    'libs',
    'ai-orchestrator',
    'data',
    'state.db',
  );
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
