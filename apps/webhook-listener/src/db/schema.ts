import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

/**
 * Resolve the default database path by walking up to find the workspace root.
 * Used as a fallback if no path is provided to openDb().
 */
function resolveDefaultDatabasePath(): string {
  let dir = __dirname;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'nx.json'))) {
      return path.join(dir, 'libs', 'ai-orchestrator', 'data', 'state.db');
    }
    dir = path.dirname(dir);
  }
  throw new Error(
    `Could not locate workspace root (no nx.json found). Started from: ${__dirname}`,
  );
}

/**
 * Open the shared SQLite database and ensure the webhook-specific tables exist.
 *
 * Uses the same database file as ai-orchestrator so deliveries and checkpoints
 * are co-located — no extra DB connection or file required.
 *
 * The dbPath parameter should be the pre-resolved absolute path from validateEnv().
 * This ensures all PM2 cluster workers use the exact same database file.
 *
 * If dbPath is not provided, attempts to resolve it from DATABASE_PATH env var
 * or by walking up to find the workspace root — useful for backward compatibility
 * or local development, but in production the path should always be pre-resolved.
 */
export function openDb(dbPath?: string): Database.Database {
  // Attempt to use the provided path, or fall back to resolving from env/workspace
  const resolvedPath =
    dbPath ?? process.env['DATABASE_PATH'] ?? resolveDefaultDatabasePath();

  // Ensure the parent directory exists before opening the DB file.
  // new Database() will throw if the directory is missing; this mirrors
  // LangGraphSqliteSaver's behaviour so both connections are consistent.
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Match the busy_timeout set in LangGraphSqliteSaver so both connections
  // give writers a grace period before erroring on SQLITE_BUSY.
  db.pragma('busy_timeout = 5000');

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

    -- Advisory lock table: ensures at most one instance runs startup sync
    -- in a PM2 cluster. Rows expire after LOCK_TTL_MS and are cleaned up
    -- eagerly on the next acquisition attempt.
    -- Timestamps are stored as Unix milliseconds (INTEGER) to avoid timezone
    -- and datetime string format issues across Node.js and SQLite.
    CREATE TABLE IF NOT EXISTS startup_lock (
      lock_id      TEXT     PRIMARY KEY,
      acquired_at  INTEGER  NOT NULL,
      expires_at   INTEGER  NOT NULL
    );
  `);
}
