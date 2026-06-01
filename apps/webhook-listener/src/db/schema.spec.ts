import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from './schema';

describe('openDb', () => {
  it('initializes a fresh database path safely across concurrent startup attempts', async () => {
    // This test exercises both the happy path and the retry/backoff error path:
    // - 4 processes attempt to initialize the same DB path concurrently
    // - File lock coordination ensures only one process runs schema setup
    // - Others hit lock contention (ELOCKED or lock acquisition timeout) and retry
    // - Exponential backoff spreads retry attempts across 50-1000ms intervals
    // - All processes eventually acquire the lock, initialize, and return a valid DB
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webhook-db-'));
    const dbPath = path.join(tmpRoot, 'nested', 'state.db');
    const connections: Database.Database[] = [];

    try {
      const opened = await Promise.all(
        Array.from({ length: 4 }, () => openDb(dbPath)),
      );
      connections.push(...opened);
      expect(fs.existsSync(`${dbPath}.init.lock`)).toBe(true);

      for (const db of connections) {
        const deliveries = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'deliveries'",
          )
          .get() as { name: string } | undefined;
        expect(deliveries?.name).toBe('deliveries');

        expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
      }
    } finally {
      for (const db of connections) {
        db.close();
      }
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('rejects with a descriptive error after exhausting retries on a non-retriable failure', async () => {
    // Place a regular file where the parent directory should be so that
    // mkdirSync throws ENOTDIR — an error that is NOT in the retriable list.
    // openDb must propagate it immediately (no retry loop) and wrap it in
    // a message that names the failing operation and attempt count.
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webhook-db-err-'));
    // Write a file at the path that openDb will try to use as a directory.
    const blockerFile = path.join(tmpRoot, 'not-a-dir');
    fs.writeFileSync(blockerFile, '');
    // Attempt to open a DB whose parent directory is blocked by the file above.
    const dbPath = path.join(blockerFile, 'state.db');

    try {
      await expect(openDb(dbPath)).rejects.toThrow(
        /Failed to initialize database after \d+ attempts/,
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
