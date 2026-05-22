import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach } from 'vitest';
import { acquireLock, releaseLock, isLockHeld } from './lock';

const LOCK_ID = 'startup_sync';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS startup_lock (
      lock_id      TEXT     PRIMARY KEY,
      acquired_at  INTEGER  NOT NULL,
      expires_at   INTEGER  NOT NULL
    );
  `);
  return db;
}

describe('acquireLock', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('returns a number (ownership token) when no lock exists', () => {
    const token = acquireLock(db, LOCK_ID, 300_000);
    expect(typeof token).toBe('number');
    expect(token).not.toBeNull();
  });

  it('inserts a row with a future expires_at', () => {
    const before = Date.now();
    acquireLock(db, LOCK_ID, 300_000);
    const row = db
      .prepare('SELECT expires_at FROM startup_lock WHERE lock_id = ?')
      .get(LOCK_ID) as { expires_at: number } | undefined;
    expect(row).toBeDefined();
    expect(row!.expires_at).toBeGreaterThanOrEqual(before + 300_000);
  });

  it('returns null when a valid (non-expired) lock already exists', () => {
    acquireLock(db, LOCK_ID, 300_000); // first acquire
    expect(acquireLock(db, LOCK_ID, 300_000)).toBeNull(); // second attempt fails
  });

  it('returns true and cleans up an expired lock', () => {
    // Insert a lock that expired in the past (Unix ms timestamp)
    const expiredAt = Date.now() - 1000;
    db.prepare(
      'INSERT INTO startup_lock (lock_id, acquired_at, expires_at) VALUES (?, ?, ?)',
    ).run(LOCK_ID, Date.now() - 2000, expiredAt);

    expect(acquireLock(db, LOCK_ID, 300_000)).not.toBeNull();
    const row = db
      .prepare('SELECT expires_at FROM startup_lock WHERE lock_id = ?')
      .get(LOCK_ID) as { expires_at: number } | undefined;
    expect(row!.expires_at).toBeGreaterThan(Date.now());
  });

  it('cleans up ALL expired locks (not just the one being acquired)', () => {
    const expiredAt = Date.now() - 1000;
    db.prepare(
      'INSERT INTO startup_lock (lock_id, acquired_at, expires_at) VALUES (?, ?, ?)',
    ).run('other_lock', Date.now() - 2000, expiredAt);

    acquireLock(db, LOCK_ID, 300_000);

    const stale = db
      .prepare('SELECT lock_id FROM startup_lock WHERE lock_id = ?')
      .get('other_lock');
    expect(stale).toBeUndefined();
  });

  it('two concurrent attempts: only one receives a token', async () => {
    // Simulate two attempts arriving at the same time
    const result1 = acquireLock(db, LOCK_ID, 300_000);
    const result2 = acquireLock(db, LOCK_ID, 300_000);
    const tokens = [result1, result2].filter((r) => r !== null);
    expect(tokens).toHaveLength(1);
    expect(typeof tokens[0]).toBe('number');
  });

  it('rethrows non-constraint errors (e.g. unexpected DB failure)', () => {
    // Drop the table to force a real SQLite error (not a constraint violation)
    db.exec('DROP TABLE startup_lock');
    expect(() => acquireLock(db, LOCK_ID, 300_000)).toThrow();
  });
});

describe('releaseLock', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('deletes the lock row when called with the correct ownership token', () => {
    const token = acquireLock(db, LOCK_ID, 300_000) as number;
    releaseLock(db, LOCK_ID, token);
    const row = db
      .prepare('SELECT lock_id FROM startup_lock WHERE lock_id = ?')
      .get(LOCK_ID);
    expect(row).toBeUndefined();
  });

  it('does not delete the lock when called with a wrong ownership token', () => {
    acquireLock(db, LOCK_ID, 300_000);
    // Use a different timestamp to simulate a stale/wrong token
    releaseLock(db, LOCK_ID, 0);
    const row = db
      .prepare('SELECT lock_id FROM startup_lock WHERE lock_id = ?')
      .get(LOCK_ID);
    // Lock should still exist — wrong token should not release it
    expect(row).toBeDefined();
  });

  it('does not throw when lock does not exist', () => {
    expect(() => releaseLock(db, LOCK_ID, Date.now())).not.toThrow();
  });

  it('allows re-acquisition after release', () => {
    const token = acquireLock(db, LOCK_ID, 300_000) as number;
    releaseLock(db, LOCK_ID, token);
    expect(acquireLock(db, LOCK_ID, 300_000)).not.toBeNull();
  });
});

describe('isLockHeld', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('returns false when no lock row exists', () => {
    expect(isLockHeld(db, LOCK_ID)).toBe(false);
  });

  it('returns true when a valid lock exists', () => {
    acquireLock(db, LOCK_ID, 300_000);
    expect(isLockHeld(db, LOCK_ID)).toBe(true);
  });

  it('returns false when lock has expired', () => {
    const expiredAt = Date.now() - 1000;
    db.prepare(
      'INSERT INTO startup_lock (lock_id, acquired_at, expires_at) VALUES (?, ?, ?)',
    ).run(LOCK_ID, Date.now() - 2000, expiredAt);
    expect(isLockHeld(db, LOCK_ID)).toBe(false);
  });
});
