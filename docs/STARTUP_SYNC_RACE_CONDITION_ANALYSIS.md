# Startup Sync Race Condition Analysis

**Date:** May 16, 2026  
**Scope:** PM2 clustering with `instances: 'max'` (concurrent startup sync)

---

## Executive Summary

**⚠️ RACE CONDITION EXISTS** in startup sync when multiple PM2 instances start simultaneously.

**Impact:** Multiple instances can replay the same missed commands, but duplicates are **prevented** by the `deliveries` dedup table. However, the cursor advancement (last_sync_time) is **NOT protected**, leading to unpredictable sync windows on subsequent restarts.

**Severity:** ⚠️ **Medium** — Commands are not duplicated, but operator visibility into sync coverage is compromised.

---

## 1. Startup Sync Implementation

### File: [apps/webhook-listener/src/sync/startup.ts](../../apps/webhook-listener/src/sync/startup.ts)

**Current code flow:**

```typescript
export async function runStartupSync(db: Database.Database, graph: OrchestratorGraph, octokit: Octokit, owner: string, repo: string): Promise<void> {
  // Step 1: READ cursor (no lock)
  const row = db.prepare('SELECT value FROM webhook_sync WHERE key = ?').get(SYNC_KEY) as { value: string } | undefined;

  const since = row?.value ?? new Date(Date.now() - syncWindowMs).toISOString();

  console.log(`[webhook-listener] Startup sync: checking comments since ${since}`);

  let latestSeenAt: string | null = null;
  let latestProcessedAt: string | null = null;

  try {
    // Fetch checkpoints and paused threads
    const checkpointRows = db
      .prepare(
        `
      SELECT thread_id, checkpoint_body
      FROM (
        SELECT thread_id, checkpoint_body,
               ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY sequence DESC) as rn
        FROM checkpoints
      )
      WHERE rn = 1
    `,
      )
      .all() as { thread_id: string; checkpoint_body: string }[];

    // ... process paused threads and fetch comments since `since` ...

    // Step 2: WRITE cursor (no lock, no transaction)
    if (latestSeenAt) {
      db.prepare('INSERT OR REPLACE INTO webhook_sync (key, value) VALUES (?, ?)').run(SYNC_KEY, latestSeenAt);
      // ... logging ...
    }
  } catch (err) {
    // Do NOT advance cursor on error (intended behavior)
    console.warn(`[webhook-listener] Startup sync failed: ${String(err)}`);
  }
}
```

**Key observations:**

1. ❌ **No transaction**: Steps 1 and 2 are NOT wrapped in a transaction
2. ❌ **No SELECT FOR UPDATE**: Does not lock the cursor row before reading
3. ❌ **No application-level mutex**: No check to ensure only one instance runs at a time
4. ❌ **Async operation**: Cursor read → GitHub API call (100s of ms) → Cursor write

---

## 2. Race Condition Scenario

### Scenario: PM2 `instances: 'max'` on 8-core machine, all instances start simultaneously

**Timeline:**

| Time | Instance A                                                   | Instance B                                                   | Database State                              |
| ---- | ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------- |
| T0   | `START runStartupSync()`                                     | `START runStartupSync()`                                     | `webhook_sync.value = 2026-01-01T12:00:00Z` |
| T1   | `SELECT value FROM webhook_sync` (gets T_old)                | `SELECT value FROM webhook_sync` (gets T_old)                | Both have cursor = T_old                    |
| T2   | Query GitHub: "comments since T_old"                         | Query GitHub: "comments since T_old"                         | GitHub API called twice for same window     |
| T3   | Fetch comments: [C1, C2, C3] → latestSeenAt = C3.created_at  | Fetch comments: [C1, C2, C3] → latestSeenAt = C3.created_at  | Both got same results                       |
| T4   | Insert deliveries for [C1, C2, C3]                           | Insert deliveries for [C1, C2, C3]                           | Deliveries dedup prevents duplicates ✅     |
| T5   | Dispatch handlers for [C1, C2, C3]                           | Dispatch handlers for [C1, C2, C3]                           | Commands processed, state updated           |
| T6   | `INSERT OR REPLACE webhook_sync` (updates to C3.created_at)  | **[Blocked: waiting for write lock]**                        | Instance A's write holds SQLite lock        |
| T7   | **[Lock released]**                                          | `INSERT OR REPLACE webhook_sync` (updates to C3.created_at)  | Instance B's write overwrites A's write     |
| T8   | Sync complete, logging shows: "Next sync from C3.created_at" | Sync complete, logging shows: "Next sync from C3.created_at" | ✅ Cursor is correct                        |

**But if instances have different GitHub response times:**

| Time | Instance A                                                  | Instance B                                                  | Database State                              |
| ---- | ----------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| T6b  | `INSERT OR REPLACE webhook_sync` (updates to C3.created_at) | Fetching: GitHub returned [C1, C2]                          | A's cursor = C3.created_at                  |
| T7b  | **[Lock released]**                                         | latestSeenAt = C2.created_at                                |                                             |
| T8b  |                                                             | `INSERT OR REPLACE webhook_sync` (updates to C2.created_at) | **Cursor REGRESSED to C2.created_at** ❌    |
| T9b  |                                                             | Sync complete                                               | Next startup will re-scan and find C3 again |

---

## 3. Impact Analysis

### What Happens? Command Duplication or Not?

**Good news:** Commands are NOT duplicated to the orchestrator.

**Why:**

1. Both instances use the same synthetic delivery ID: `startup-sync-{comment.id}`
2. Both attempt: `INSERT OR IGNORE INTO deliveries (delivery_id)`
3. One succeeds (changes = 1); the other is ignored (changes = 0)
4. The ignored instance skips the handler dispatch

```typescript
const deliveryId = `startup-sync-${comment.id}`;
const inserted = db.prepare('INSERT OR IGNORE INTO deliveries (delivery_id) VALUES (?)').run(deliveryId);
if (inserted.changes === 0) {
  continue; // already processed — skip handler dispatch ✅
}
```

**Result:** Only one instance processes each comment, no duplicate commands.

### What's Actually at Risk? The Cursor

**The real race condition:**

1. If instances complete sync at different times, cursor advancement is NOT atomic
2. Instance B can **regress** the cursor (update it to an earlier value)
3. Next startup will re-scan a larger window, reprocessing already-seen comments
4. This wastes GitHub API quota and produces verbose logs, but no actual duplicates

**Cursor regression example:**

```
Before sync: webhook_sync.value = "2026-05-10T10:00:00Z"

Startup Run A: Comment C1 created at 2026-05-15T14:30:00Z → cursor advances to 2026-05-15T14:30:00Z
Startup Run B: Comments fetched before A finished → only sees up to C2 (2026-05-15T14:29:00Z)
B completes first: cursor regresses to 2026-05-15T14:29:00Z ← ⚠️ Race condition!

Next restart: cursor = 2026-05-15T14:29:00Z
Result: C1 will be re-fetched and re-processed (but not duplicated due to deliveries dedup)
```

---

## 4. Current Race Condition Protection

### ✅ What IS Protected

| Aspect                            | Protection | Mechanism                                  |
| --------------------------------- | ---------- | ------------------------------------------ |
| **Duplicate command execution**   | ✅ YES     | `deliveries` table with `INSERT OR IGNORE` |
| **Duplicate checkpoint saves**    | ✅ YES     | LangGraph transaction (checkpoint_writes)  |
| **Concurrent webhook processing** | ✅ YES     | `INSERT OR IGNORE` on deliveries           |
| **Multiple instances reading**    | ✅ YES     | SQLite WAL mode allows concurrent readers  |

### ❌ What is NOT Protected

| Aspect                            | Protection | Mechanism                                                                  |
| --------------------------------- | ---------- | -------------------------------------------------------------------------- |
| **Cursor advancement atomicity**  | ❌ NO      | No transaction, no SELECT FOR UPDATE                                       |
| **Ensuring single sync instance** | ❌ NO      | No mutex, no advisory lock                                                 |
| **Consistent cursor value**       | ❌ NO      | Vulnerable to regression if instances have different GitHub response times |

---

## 5. Detailed Code Review

### cursor READ (no lock)

```typescript
const row = db.prepare('SELECT value FROM webhook_sync WHERE key = ?').get(SYNC_KEY) as { value: string } | undefined;

const since = row?.value ?? new Date(Date.now() - syncWindowMs).toISOString();
```

**Issues:**

- Non-blocking read; no guarantee another instance isn't writing
- In SQLite with WAL, this is usually safe (reads don't block), but stale data is possible

### cursor WRITE (no lock, no transaction)

```typescript
if (latestSeenAt) {
  db.prepare('INSERT OR REPLACE INTO webhook_sync (key, value) VALUES (?, ?)').run(SYNC_KEY, latestSeenAt);
}
```

**Issues:**

- ❌ **No transaction wrapping** the read-compute-write cycle
- ❌ **No SELECT ... FOR UPDATE** to claim the row before updating
- ❌ **No advisory lock** (SQLite's `PRAGMA query_only = OFF` mode)
- Multiple instances can all update the cursor in parallel, last one wins

### Delivery dedup (works correctly)

```typescript
const deliveryId = `startup-sync-${comment.id}`;
const inserted = db.prepare('INSERT OR IGNORE INTO deliveries (delivery_id) VALUES (?)').run(deliveryId);
if (inserted.changes === 0) {
  continue; // already processed — skip handler
}
```

**Correct because:**

- `INSERT OR IGNORE` is atomic in SQLite
- Multiple instances with identical delivery IDs: only one INSERT succeeds
- Second instance skips dispatch (no duplicate command)

---

## 6. Comparison: Live Webhook Handler

### File: [apps/webhook-listener/src/routes/webhook.ts](../../apps/webhook-listener/src/routes/webhook.ts#L112-L120)

The live webhook handler uses the SAME dedup mechanism and works fine:

```typescript
const inserted = db.prepare('INSERT OR IGNORE INTO deliveries (delivery_id) VALUES (?)').run(deliveryId);
if (inserted.changes === 0) {
  return reply.status(200).send({ ok: true, duplicate: true });
}
```

**Why it works for live webhooks:**

- GitHub sends the same `X-GitHub-Delivery` header for retries
- If two webhook instances receive the same event, one claims the delivery_id
- The other gets a 200 immediately (idempotent)
- Cursor is updated by each webhook (separate `deliveries` row per event)

**Why it's different for startup sync:**

- Startup sync is a **single operation** that processes a **batch of comments**
- Multiple instances can fetch the same batch (different GitHub API pagination)
- Cursor advancement is a **single shared row** (not per-comment like live webhooks)
- All instances try to update the same `webhook_sync.key = 'last_sync_time'` row

---

## 7. Observable Symptoms

If cursor regression happens:

```
[webhook-listener] Startup sync: checking comments since 2026-05-15T14:30:00Z
[webhook-listener] Startup sync: found 12 total threads; 3 paused threads...
[webhook-listener] Startup sync complete. Processed commands up to 2026-05-15T14:30:00Z. Next sync from 2026-05-15T14:30:00Z

[webhook-listener] Startup sync: checking comments since 2026-05-15T14:29:00Z  ← REGRESSED CURSOR
[webhook-listener] Startup sync: found 12 total threads; 3 paused threads...
[webhook-listener] Startup sync complete. No new commands processed. Next sync from 2026-05-15T14:29:00Z
```

**Detection:** Cursor value goes backward, or sync window expands unexpectedly.

---

## 8. Probability & Severity

### Probability: **Medium**

- Only occurs if **all instances start simultaneously** (PM2 restart, deployment)
- With `instances: 'max'` on 8-core machine, 8 instances all run startup sync
- Requires instances to have **different GitHub API response times** (varying network latency)
- SQLite WAL busy_timeout (5s) is more than enough for startup sync to complete

### Severity: **Medium** (not High, not Low)

- ✅ **Commands are never duplicated** (deliveries dedup prevents it)
- ✅ **Checkpoint state is never corrupted** (LangGraph transactions protect it)
- ❌ **Cursor can regress**, causing next restart to re-scan a wider window
- ❌ **GitHub API quota is wasted** (re-fetching already-processed comments)
- ❌ **Logs become noisy** (repeated "startup sync" messages for same comments)

**Not a data loss or correctness issue**, but compromises operator observability and efficiency.

---

## 9. Existing Tests

### File: [apps/webhook-listener/src/sync/startup.spec.ts](../../apps/webhook-listener/src/sync/startup.spec.ts)

Current tests cover:

- ✅ Filtering paused threads
- ✅ Handling malformed checkpoints
- ✅ Deduplication via deliveries table
- ✅ Skipping already-processed comments
- ✅ Skipping edited comments
- ❌ **No tests for concurrent startup sync**
- ❌ **No tests for cursor regression**
- ❌ **No tests for multiple PM2 instances**

---

## 10. Recommendations

### Short-term (Low effort, immediate fix)

Wrap the read-compute-write cycle in a transaction:

```typescript
export async function runStartupSync(db: Database.Database, graph: OrchestratorGraph, octokit: Octokit, owner: string, repo: string): Promise<void> {
  // Start a transaction to protect cursor read/write
  const txn = db.transaction(async () => {
    // READ cursor inside transaction
    const row = db.prepare('SELECT value FROM webhook_sync WHERE key = ?').get(SYNC_KEY) as { value: string } | undefined;

    const since = row?.value ?? new Date(Date.now() - syncWindowMs).toISOString();

    // ... fetch and process comments ...

    // WRITE cursor inside same transaction
    if (latestSeenAt) {
      db.prepare('INSERT OR REPLACE INTO webhook_sync (key, value) VALUES (?, ?)').run(SYNC_KEY, latestSeenAt);
    }
  });

  try {
    await txn();
  } catch (err) {
    console.warn(`[webhook-listener] Startup sync failed: ${String(err)}`);
  }
}
```

**Caveat:** `better-sqlite3` is synchronous, but startup sync contains async calls (GitHub API). Full transactional protection requires restructuring.

### Medium-term (Recommended)

Use an **advisory lock** (SQLite's pessimistic approach):

```typescript
db.prepare(
  `
  -- Create an advisory lock table if not exists
  CREATE TABLE IF NOT EXISTS locks (
    lock_name TEXT PRIMARY KEY
  );
`,
).run();

// Acquire exclusive lock before reading cursor
const lockStmt = db.prepare(`
  INSERT OR IGNORE INTO locks (lock_name) VALUES ('startup_sync_cursor');
`);

if (lockStmt.run().changes === 1) {
  // This instance acquired the lock; proceed with sync
  try {
    // ... read, process, write ...
  } finally {
    db.prepare(`DELETE FROM locks WHERE lock_name = 'startup_sync_cursor'`).run();
  }
} else {
  // Another instance has the lock; skip startup sync or wait
  console.log('[webhook-listener] Another instance is running startup sync; skipping.');
}
```

**Pros:**

- Ensures only one instance runs startup sync at a time
- Prevents cursor regression
- No need to restructure async/await code

**Cons:**

- One instance "wins"; others skip sync (less thorough coverage)
- Requires cleanup on crash (lock row must be manually deleted if process dies)

### Long-term (Comprehensive)

Use **PM2 ecosystem.config.js** to run startup sync once, then distribute the result:

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'webhook-listener',
      script: './dist/main.js',
      instances: 'max',
      env: {
        RUN_STARTUP_SYNC: '1', // Only the first instance
        SKIP_STARTUP_SYNC: '0',
      },
      // ... cluster mode config ...
    },
  ],
};
```

Then in `main.ts`:

```typescript
const shouldRunSync = process.env.RUN_STARTUP_SYNC === '1' && process.env.SKIP_STARTUP_SYNC !== '1';
if (shouldRunSync) {
  await runStartupSync(db, graph, octokit, owner, repo);
  process.env.SKIP_STARTUP_SYNC = '1'; // Signal other instances to skip
}
```

**Pros:**

- Cleanest solution; startup sync runs exactly once
- No race conditions possible
- No wasted GitHub API quota

**Cons:**

- Requires PM2 ecosystem configuration
- Depends on PM2 cluster-mode message passing or shared environment

---

## Conclusion

**Current state:** ⚠️ **Race condition exists in cursor advancement, but command duplication is prevented.**

**Root cause:** No atomicity protection for the read-compute-write cycle of `webhook_sync.last_sync_time`.

**Observable impact:** Cursor regression on concurrent startups → wasted GitHub API quota → verbose logs, but no data loss.

**Recommendation:** Implement advisory lock mechanism (medium-term) or PM2-level orchestration (long-term). Short-term: wrapping in a transaction has limited effectiveness due to async GitHub API calls.
