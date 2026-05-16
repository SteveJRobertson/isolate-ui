# Startup Sync Code — Race Condition Details

## The Issue: No Locking on Cursor Advancement

### Current Implementation (VULNERABLE)

**File:** [apps/webhook-listener/src/sync/startup.ts](../../apps/webhook-listener/src/sync/startup.ts#L39-L244)

```typescript
export async function runStartupSync(db: Database.Database, graph: OrchestratorGraph, octokit: Octokit, owner: string, repo: string): Promise<void> {
  // ❌ STEP 1: READ cursor (unprotected)
  const row = db.prepare('SELECT value FROM webhook_sync WHERE key = ?').get(SYNC_KEY) as { value: string } | undefined;

  const rawSyncWindow = process.env['STARTUP_SYNC_WINDOW_MS'];
  const parsedSyncWindow = rawSyncWindow ? Number(rawSyncWindow) : NaN;
  const syncWindowMs = Number.isFinite(parsedSyncWindow) && parsedSyncWindow > 0 ? parsedSyncWindow : DEFAULT_SYNC_WINDOW_MS;
  if (rawSyncWindow && syncWindowMs === DEFAULT_SYNC_WINDOW_MS) {
    console.warn(`[webhook-listener] Startup sync: STARTUP_SYNC_WINDOW_MS="${rawSyncWindow}" is not a valid positive number — using default ${DEFAULT_SYNC_WINDOW_MS}ms.`);
  }

  // Cursor defaults to 1 hour ago if not found
  const since = row?.value ?? new Date(Date.now() - syncWindowMs).toISOString();

  if (!row?.value) {
    console.warn(`[webhook-listener] Startup sync: no cursor found — defaulting to ${syncWindowMs}ms window. ` + 'Commands posted before this window may have been missed. ' + 'Set STARTUP_SYNC_WINDOW_MS to widen the window if needed.');
  }

  console.log(`[webhook-listener] Startup sync: checking comments since ${since}`);

  let latestSeenAt: string | null = null;
  let latestProcessedAt: string | null = null;

  try {
    // Query latest checkpoint per thread
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

    // ... process paused threads ...

    for (const { thread_id } of pausedThreads) {
      const match = thread_id.match(/^issue-(\d+)$/);
      if (!match) continue;
      const issueNumber = parseInt(match[1], 10);

      // ⚠️ ASYNC OPERATION: GitHub API call
      // While we're waiting here, other instances might also be fetching
      const comments = await octokit.paginate(octokit.issues.listComments, {
        owner,
        repo,
        issue_number: issueNumber,
        since, // All instances using same `since` value
        per_page: 100,
      });

      for (const comment of comments) {
        // Track the latest timestamp from every comment we've seen
        if (comment.created_at) {
          if (!latestSeenAt || comment.created_at > latestSeenAt) {
            latestSeenAt = comment.created_at;
          }
        }

        // Skip edited comments
        if (comment.updated_at !== comment.created_at) {
          continue;
        }

        const deliveryId = `startup-sync-${comment.id}`;

        // ✅ DEDUPLICATION: This prevents actual command duplication
        const inserted = db.prepare('INSERT OR IGNORE INTO deliveries (delivery_id) VALUES (?)').run(deliveryId);
        if (inserted.changes === 0) {
          continue; // Already processed in a prior startup ← Protected by dedup table
        }

        const commentBody = (comment.body ?? '').trim();
        const username = comment.user?.login ?? 'unknown';
        const authorAssociation = comment.author_association ?? '';

        if (!AUTHORIZED_ASSOCIATIONS.has(authorAssociation)) {
          db.prepare('DELETE FROM deliveries WHERE delivery_id = ?').run(deliveryId);
          continue;
        }

        const ctx: CommandContext = {
          db,
          graph,
          octokit,
          owner,
          repo,
          issueNumber,
          threadId: thread_id,
          username,
        };

        const [command, ...rest] = commentBody.split(/\s+/);
        const args = rest.join(' ');

        try {
          if (command === '/approve') {
            await handleApprove(ctx);
          } else if (command === '/fix') {
            await handleFix(ctx, args);
          } else if (command === '/query') {
            await handleQuery(ctx, args);
          } else {
            db.prepare('DELETE FROM deliveries WHERE delivery_id = ?').run(deliveryId);
            continue;
          }
        } catch (handlerErr) {
          db.prepare('DELETE FROM deliveries WHERE delivery_id = ?').run(deliveryId);
          console.warn(`[webhook-listener] Startup sync: handler failed for comment ${comment.id}: ${String(handlerErr)}`);
          continue;
        }

        if (comment.created_at) {
          if (!latestProcessedAt || comment.created_at > latestProcessedAt) {
            latestProcessedAt = comment.created_at;
          }
        }
      }
    }

    // ❌ STEP 2: WRITE cursor (unprotected, vulnerable to race)
    if (latestSeenAt) {
      // NO LOCKING, NO TRANSACTION
      // Multiple instances can execute this simultaneously
      // Last writer wins → cursor value depends on execution order
      db.prepare('INSERT OR REPLACE INTO webhook_sync (key, value) VALUES (?, ?)').run(SYNC_KEY, latestSeenAt);

      if (latestProcessedAt) {
        console.log(`[webhook-listener] Startup sync complete. Processed commands up to ${latestProcessedAt}. Next sync from ${latestSeenAt}`);
      } else {
        console.log(`[webhook-listener] Startup sync complete. No new commands processed. Next sync from ${latestSeenAt}`);
      }
    } else {
      console.log(`[webhook-listener] Startup sync complete. No comments in window.`);
    }
  } catch (err) {
    // On error: cursor is NOT advanced (intentional)
    console.warn(`[webhook-listener] Startup sync failed: ${String(err)}`);
  }
}
```

---

## The Database Schema

**File:** [apps/webhook-listener/src/db/schema.ts](../../apps/webhook-listener/src/db/schema.ts#L77-L90)

```typescript
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
```

**Problem:** No schema features for locking (e.g., `SELECT ... FOR UPDATE` is not used).

---

## How Multiple PM2 Instances Attack This

### Instance A (completes quickly):

```
[webhook-listener] Startup sync: checking comments since 2026-05-15T14:00:00Z
[webhook-listener] Startup sync: found 3 paused threads...
[webhook-listener] Startup sync: handler success for comments [101, 102, 103]
[webhook-listener] Startup sync complete. Processed commands up to 2026-05-15T14:30:00Z. Next sync from 2026-05-15T14:30:00Z
```

### Instance B (slower GitHub API):

```
[webhook-listener] Startup sync: checking comments since 2026-05-15T14:00:00Z  ← Same as A
[webhook-listener] Startup sync: found 3 paused threads...
[webhook-listener] Startup sync: handler success for comments [101, 102]  ← Only 2, A's 103 not yet fetched
[webhook-listener] Startup sync complete. Processed commands up to 2026-05-15T14:29:00Z. Next sync from 2026-05-15T14:29:00Z
```

### What Happens in SQLite

```sql
-- Both instances run the same UPDATE
INSERT OR REPLACE INTO webhook_sync (key, value) VALUES ('last_sync_time', '2026-05-15T14:30:00Z');
INSERT OR REPLACE INTO webhook_sync (key, value) VALUES ('last_sync_time', '2026-05-15T14:29:00Z');

-- Final value depends on execution order
-- If B executes last: webhook_sync.value = '2026-05-15T14:29:00Z'  ← REGRESSED ❌
```

### Next Server Restart

```
[webhook-listener] Startup sync: checking comments since 2026-05-15T14:29:00Z  ← Went backward!
[webhook-listener] Startup sync: handler success for comments [103]  ← Re-processes comment 103
[webhook-listener] Startup sync: skipped (already in deliveries table)  ← But: no duplicate command ✅
```

**Result:**

- ✅ Command is NOT duplicated (deliveries dedup protects it)
- ❌ Cursor regressed → next sync covers a wider window → wasted GitHub API quota
- ❌ Logs show duplicate "startup sync" entries for same comment

---

## Race Condition: The Core Problem

### What's NOT Protected

**There is NO atomicity between:**

1. Reading `webhook_sync.value` (line ~37)
2. Computing `latestSeenAt` from GitHub API (lines ~120-170)
3. Writing `webhook_sync.value` (line ~225)

**If the write happens at the same time across multiple instances:**

- Instance A wrote value T_A
- Instance B wrote value T_B (different because GitHub API returned different results)
- Final value in database = T_min(T_A, T_B) if T_B executes last

---

## How Duplicates ARE Prevented (The Dedup Table Works)

**File:** [apps/webhook-listener/src/sync/startup.ts](../../apps/webhook-listener/src/sync/startup.ts#L155-L162)

```typescript
const deliveryId = `startup-sync-${comment.id}`;

// ✅ This is atomic in SQLite
const inserted = db.prepare('INSERT OR IGNORE INTO deliveries (delivery_id) VALUES (?)').run(deliveryId);
if (inserted.changes === 0) {
  continue; // Already processed in a prior startup
}
```

**Why this works:**

- SQLite's `INSERT OR IGNORE` is a single atomic operation
- Two concurrent inserts with same `delivery_id`: only one succeeds
- Defeated instance skips the handler dispatch
- Result: Handler runs exactly once, despite both instances trying to process it

**Example with comment ID 103:**

```
Instance A:
  INSERT OR IGNORE INTO deliveries VALUES ('startup-sync-103');
  → inserted.changes = 1 ✅
  → Dispatch handler for comment 103

Instance B (exact same comment):
  INSERT OR IGNORE INTO deliveries VALUES ('startup-sync-103');
  → inserted.changes = 0 (already exists)
  → Skip handler dispatch ✅
```

**So: Duplicate COMMANDS are prevented, but duplicate SYNC SCANS are not.**

---

## Comparison: Live Webhook Handler (Also Uses Dedup, Works Fine)

**File:** [apps/webhook-listener/src/routes/webhook.ts](../../apps/webhook-listener/src/routes/webhook.ts#L112-L120)

```typescript
// Two concurrent identical webhook deliveries (GitHub retry)
const inserted = db.prepare('INSERT OR IGNORE INTO deliveries (delivery_id) VALUES (?)').run(deliveryId);
if (inserted.changes === 0) {
  return reply.status(200).send({ ok: true, duplicate: true });
}

// Step 6: dispatch command.
```

**Why this doesn't have a race condition problem:**

- Each webhook has a unique `X-GitHub-Delivery` header
- Cursor is updated **per webhook**, not globally
- No shared "last_sync_time" row that multiple instances try to advance

**But startup sync is different:**

- Multiple instances all update the **same** `webhook_sync.key = 'last_sync_time'` row
- No per-comment cursor; one cursor for the entire batch

---

## Missing Protections

### ❌ No SELECT ... FOR UPDATE

SQLite doesn't support `SELECT ... FOR UPDATE`, but better-sqlite3 could use:

```typescript
// Pessimistic locking pattern (not currently implemented)
const row = db
  .prepare(
    `
  SELECT value FROM webhook_sync 
  WHERE key = ? 
  LIMIT 1
`,
  )
  .get(SYNC_KEY);
// ← Between this read and the write, another instance can execute
```

### ❌ No Transaction Wrapping

The read-compute-write cycle is NOT in a transaction:

```typescript
// ❌ NOT wrapped in transaction
const row = db.prepare(...).get(SYNC_KEY);  // Read
// ... async GitHub API call ...
db.prepare('INSERT OR REPLACE ...').run(...);  // Write
```

**Why a transaction alone doesn't help:**

- Transactions in SQLite (with WAL) only prevent the write from being interrupted
- They do NOT prevent another instance from reading stale data between the read and write
- The async GitHub API call happens outside the transaction, so you can't wrap it

### ❌ No Advisory Lock

No application-level mutex to ensure only one instance runs startup sync:

```typescript
// Could use a lock table, but not currently implemented
CREATE TABLE IF NOT EXISTS locks (lock_name TEXT PRIMARY KEY);

// Before startup sync:
const acquired = db.prepare(`
  INSERT OR IGNORE INTO locks VALUES ('startup_sync');
`).run();

if (acquired.changes === 1) {
  // This instance owns the lock
  try {
    await runStartupSync(...);
  } finally {
    db.prepare(`DELETE FROM locks WHERE lock_name = 'startup_sync'`).run();
  }
} else {
  // Another instance has it; skip
  console.log('Startup sync already running; skipping.');
}
```

---

## Summary Table

| Aspect               | Current                | Protected? | Issue                                        |
| -------------------- | ---------------------- | ---------- | -------------------------------------------- |
| Cursor read          | Uncontrolled read      | ❌ NO      | Multiple instances see same cursor value     |
| GitHub API fetch     | Concurrent async calls | ❌ NO      | Each instance fetches comments independently |
| Delivery dedup       | `INSERT OR IGNORE`     | ✅ YES     | Commands not duplicated to orchestrator      |
| Cursor write         | Uncontrolled write     | ❌ NO      | Last writer wins; cursor can regress         |
| Single sync instance | No enforcement         | ❌ NO      | Multiple instances run sync simultaneously   |

---

## What Would Happen If We Had Multiple Instances

### Scenario: PM2 cluster with 8 instances on startup

```
t=0s:  All 8 instances call runStartupSync() simultaneously
t=0.1s: All 8 read webhook_sync.value = "2026-05-10T12:00:00Z"
t=0.2s: All 8 start fetching comments since "2026-05-10T12:00:00Z"
t=1.0s: Instances finish fetching (varying speeds due to network)
t=1.5s: All 8 dispatch handlers (INSERT OR IGNORE prevents duplicates)
t=2.0s: All 8 try to update webhook_sync
        → Instance 3 writes "2026-05-15T14:30:15Z" ✅
        → Instance 5 writes "2026-05-15T14:29:50Z" ❌ (regresses by 25 seconds)
        → Final value: "2026-05-15T14:29:50Z"
t=3.0s: Server is running; next sync window is narrower than intended
```

**On next restart:**

```
t=0s: runStartupSync() reads cursor = "2026-05-15T14:29:50Z"
t=0.1s: Queries comments since "2026-05-15T14:29:50Z" (wider window!)
t=1.0s: Fetches comment "2026-05-15T14:30:00Z" again
t=1.5s: INSERT OR IGNORE returns changes=0 (already in deliveries)
        → No duplicate command ✅
        → But we wasted GitHub API quota re-fetching it ❌
```

---

## Conclusion

**The startup sync has a real race condition in cursor advancement, but duplicate prevention (the deliveries dedup table) is working correctly.**

The consequences are:

1. ✅ **Commands are never duplicated** — the dedup table prevents this
2. ❌ **Cursor can regress** — allowing wider sync windows on next restart
3. ❌ **GitHub API quota is wasted** — re-fetching already-seen comments
4. ❌ **Operator visibility is compromised** — cursor movements are unpredictable

**Fixes exist** (see the full analysis document for recommendations), ranging from simple (advisory lock) to comprehensive (PM2 orchestration).
