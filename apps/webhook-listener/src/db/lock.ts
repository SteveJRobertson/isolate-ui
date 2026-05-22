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
 *   3. Return the acquired_at timestamp (ownership token) on success, or
 *      null if the lock is already held by another instance.
 *
 * The ownership token is required when releasing the lock so a holder that
 * ran past its TTL cannot accidentally release a newer instance's lock.
 */

/**
 * Returns true when the error is a SQLite UNIQUE/PRIMARY KEY constraint
 * violation. Used to distinguish "lock already held" from real DB failures
 * (e.g. SQLITE_BUSY, disk I/O errors, schema mismatches).
 */
function isSqliteConstraintError(err: unknown): boolean {
  return (
    err != null &&
    typeof err === 'object' &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string' &&
    (err as { code: string }).code.startsWith('SQLITE_CONSTRAINT')
  );
}

/**
 * Try to acquire an advisory lock with the given TTL.
 *
 * @param db      - Open SQLite database instance.
 * @param lockId  - Unique identifier for this lock (e.g. 'startup_sync').
 * @param ttlMs   - Time-to-live in milliseconds. Lock expires after this duration.
 * @returns       The acquired_at timestamp (ownership token) if acquired, or
 *                `null` if the lock is already held by another instance.
 * @throws        Re-throws non-constraint SQLite errors (e.g. SQLITE_BUSY,
 *                disk failures) so they surface as real failures rather than
 *                silent lock skips.
 */
export function acquireLock(
  db: Database.Database,
  lockId: string,
  ttlMs: number,
): number | null {
  const now = Date.now();
  const expiresAt = now + ttlMs;

  // Eager cleanup: remove all expired locks before attempting acquisition.
  db.prepare(`DELETE FROM startup_lock WHERE expires_at <= ?`).run(now);

  try {
    db.prepare(
      `INSERT INTO startup_lock (lock_id, acquired_at, expires_at) VALUES (?, ?, ?)`,
    ).run(lockId, now, expiresAt);
    return now;
  } catch (err: unknown) {
    // Only treat PRIMARY KEY/UNIQUE constraint violations as "lock already held".
    // Other errors (SQLITE_BUSY, disk failures, schema issues) are rethrown so
    // startup failures are visible and actionable rather than silently skipped.
    if (isSqliteConstraintError(err)) {
      return null;
    }
    throw err;
  }
}

/**
 * Release a previously acquired lock using the ownership token returned by
 * acquireLock. Safe to call even if the lock no longer exists (no-op).
 *
 * The acquired_at token ensures a holder that ran past its TTL cannot
 * accidentally release a lock that was re-acquired by a newer instance.
 *
 * @param db          - Open SQLite database instance.
 * @param lockId      - Identifier of the lock to release.
 * @param acquiredAt  - Ownership token returned by acquireLock.
 */
export function releaseLock(
  db: Database.Database,
  lockId: string,
  acquiredAt: number,
): void {
  db.prepare(
    `DELETE FROM startup_lock WHERE lock_id = ? AND acquired_at = ?`,
  ).run(lockId, acquiredAt);
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
