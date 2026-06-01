import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from './schema';

describe('openDb', () => {
  it('initializes a fresh database path safely across concurrent startup attempts', async () => {
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
});
