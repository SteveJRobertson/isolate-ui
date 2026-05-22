import Database from 'better-sqlite3';

/**
 * Advisory lock mechanism for startup sync in PM2 cluster mode.
 *
 * Uses the `startup_lock` SQLite table as a lightweight mutual-exclusion
 * device. Only one instance in a cluster may hold a given lock at a time.
 * Locks expire after the specified TTL so a crashed instance cannot block
 * others permanently.
 *
 * Acquisition strategy:
 *   1. Delete all expired locks (eager cleanup).
 *   2. INSERT the new lock row; SQLite PRIMARY KEY constraint ensures
 *      at most one holder (concurrent attempts produce a constraint error).
 *   3. Return true on success, false if the row already exists.
 */

/**
 * Try to acquire an advisory lock with the given TTL.
 *
 * @param db      - Open SQLite database instance.
 * @param lockId  - Unique identifier for this lock (e.g. 'startup_sync').
 * @param ttlMs   - Time-to-live in milliseconds. Lock expires after this duration.
 * @returns       `true` if the lock was acquired, `false` if already held.
 */
export function acquireLock(
  db: Database.Database,
  lockId: string,
  ttlMs: number,
): boolean {
  const now = Date.now();
  const expiresAt = now + ttlMs;

  // Eager cleanup: remove all expired locks before attempting acquisition.
  db.prepare(`DELETE FROM startup_lock WHERE expires_at <= ?`).run(now);

  try {
    db.prepare(
      `INSERT INTO startup_lock (lock_id, acquired_at, expires_at) VALUES (?, ?, ?)`,
    ).run(lockId, now, expiresAt);
    return true;
  } catch {
    // PRIMARY KEY constraint violation — another instance holds the lock.
    return false;
  }
}

/**
 * Release a previously acquired lock, allowing other instances to acquire it.
 * Safe to call even if the lock does not exist (no-op).
 *
 * @param db      - Open SQLite database instance.
 * @param lockId  - Identifier of the lock to release.
 */
export function releaseLock(db: Database.Database, lockId: string): void {
  db.prepare(`DELETE FROM startup_lock WHERE lock_id = ?`).run(lockId);
}

/**
 * Check whether a valid (non-expired) lock is currently held.
 * Intended for monitoring and testing; not used in the acquisition flow.
 *
 * @param db      - Open SQLite database instance.
 * @param lockId  - Identifier of the lock to check.
 * @returns       `true` if the lock exists and has not expired.
 */
export function isLockHeld(db: Database.Database, lockId: string): boolean {
  const row = db
    .prepare(
      `SELECT lock_id FROM startup_lock WHERE lock_id = ? AND expires_at > ?`,
    )
    .get(lockId, Date.now());
  return row != null;
}
