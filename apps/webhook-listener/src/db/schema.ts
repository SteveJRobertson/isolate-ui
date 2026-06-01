import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

import lockfile from 'proper-lockfile';

const DB_BUSY_TIMEOUT_MS = 5000;
const DB_INIT_MAX_ATTEMPTS = 6;
const DB_INIT_INITIAL_BACKOFF_MS = 50;
const DB_INIT_MAX_BACKOFF_MS = 1000;
const DB_INIT_LOCK_STALE_MS = 30_000;

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
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableInitError(err: unknown): boolean {
  const sqliteCode =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code)
      : '';
  const message = err instanceof Error ? err.message : String(err);
  return (
    sqliteCode === 'SQLITE_BUSY' ||
    sqliteCode === 'SQLITE_CANTOPEN' ||
    sqliteCode === 'ENOENT' ||
    sqliteCode === 'ELOCKED' ||
    message.includes('directory does not exist') ||
    message.includes('SQLITE_BUSY') ||
    message.includes('database is locked') ||
    message.includes('SQLITE_CANTOPEN')
  );
}

function ensureFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.closeSync(fs.openSync(filePath, 'a'));
  }
}

async function initializeWithFileLock(
  db: Database.Database,
  resolvedPath: string,
): Promise<void> {
  const lockPath = `${resolvedPath}.init.lock`;
  ensureFile(lockPath);

  const release = await lockfile.lock(lockPath, {
    realpath: false,
    stale: DB_INIT_LOCK_STALE_MS,
    retries: 0,
  });

  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
  } finally {
    await release();
  }
}

export async function openDb(dbPath?: string): Promise<Database.Database> {
  // Attempt to use the provided path, or fall back to resolving from env/workspace
  const resolvedPath =
    dbPath ?? process.env['DATABASE_PATH'] ?? resolveDefaultDatabasePath();

  let backoffMs = DB_INIT_INITIAL_BACKOFF_MS;
  let lastError: unknown;
  for (let attempt = 1; attempt <= DB_INIT_MAX_ATTEMPTS; attempt++) {
    let db: Database.Database | null = null;
    try {
      // Ensure the parent directory exists before opening the DB file.
      // new Database() will throw if the directory is missing; this mirrors
      // LangGraphSqliteSaver's behaviour so both connections are consistent.
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

      db = new Database(resolvedPath);
      // Set as early as possible to reduce SQLITE_BUSY failures during startup.
      db.pragma(`busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);

      await initializeWithFileLock(db, resolvedPath);

      return db;
    } catch (err) {
      lastError = err;
      if (db) {
        try {
          db.close();
        } catch {
          // Ignore close errors in failure paths; connection may already be invalid.
        }
      }

      const shouldRetry =
        attempt < DB_INIT_MAX_ATTEMPTS && isRetriableInitError(err);
      if (!shouldRetry) {
        break;
      }
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, DB_INIT_MAX_BACKOFF_MS);
    }
  }

  if (lastError instanceof Error) {
    throw new Error(
      `[webhook-listener] Failed to initialize database after ${DB_INIT_MAX_ATTEMPTS} attempts: ${lastError.message}`,
    );
  }

  throw new Error(
    `[webhook-listener] Failed to initialize database after ${DB_INIT_MAX_ATTEMPTS} attempts`,
  );
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
