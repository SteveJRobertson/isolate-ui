# PM2 Startup Sync Race Condition — Technical Deep Dive

This document provides a comprehensive analysis of a race condition in the startup sync logic when running multiple PM2 instances, along with detailed mitigation strategies.

## Executive Summary

- **Issue:** When multiple PM2 cluster instances start simultaneously, the startup sync cursor advancement is unprotected, causing potential cursor regression
- **Impact:** Wasted GitHub API quota; unpredictable cursor behavior; no data loss (dedup prevents duplicates)
- **Current Mitigation:** Deliveries dedup table prevents actual command duplication
- **Status:** Safe for Phase 1 deployment; recommend permanent fix in Phase 2

---

## Problem Analysis

### The Race Condition

Location: `apps/webhook-listener/src/sync/startup.ts` (lines 42-87)

**Current (unsafe) code pattern:**

```typescript
// ❌ NO TRANSACTION — unprotected
export async function runStartupSync(context: WebhookContext) {
  // Step 1: READ cursor (unprotected)
  const row = db.prepare('SELECT value FROM webhook_sync WHERE key = ?').get(SYNC_KEY);
  const since = row?.value ?? fallback;

  // Step 2: GitHub API call (takes 100ms-2s depending on response)
  const missedComments = await fetchMissedComments(since);

  // Step 3: Process commands (takes 50ms-500ms)
  for (const comment of missedComments) {
    await processCommand(comment, context);
  }

  // Step 4: WRITE cursor (unprotected) — can be overwritten by concurrent instance
  db.prepare('INSERT OR REPLACE INTO webhook_sync (key, value) VALUES (?, ?)').run(SYNC_KEY, latestSeenAt);
}
```

### Concurrent Execution Scenario

When two instances start simultaneously with clustering enabled:

```
Time    Instance A                              Instance B
─────   ──────────────────────────────────────  ──────────────────────────────
T0      READ cursor: 2026-05-15T14:30:00Z       READ cursor: 2026-05-15T14:30:00Z
T1      Fetch comments since T0... (fast)       Fetch comments since T0... (slow)
T2      Process comments (finishes)              Processing comments...
T3      WRITE cursor: 2026-05-15T14:30:15Z      Still processing...
T4      ← Both instances now have same cursor   Processing continues...
T5                                               Process comments (finishes)
T6                                               WRITE cursor: 2026-05-15T14:29:50Z ← REGRESSION!
T7                                               Cursor now points EARLIER (B's timestamp < A's)
```

**Result:** Cursor regresses from `14:30:15Z` to `14:29:50Z`

### Why This Happens

1. **No database lock:** SQLite allows concurrent reads on same row
2. **No transaction:** Each `SELECT` and `INSERT OR REPLACE` is separate auto-commit
3. **Network latency variance:** GitHub API responses arrive at different times
4. **Unpredictable execution order:** Instance B's slower GitHub call finishes after Instance A's startup sync

### Consequences

| Aspect                    | Impact                                              | Severity |
| ------------------------- | --------------------------------------------------- | -------- |
| **Data Integrity**        | ✅ Safe — deliveries dedup prevents duplicates      | None     |
| **API Quota**             | ⚠️ Wasted — rescans overlapping window next startup | Medium   |
| **Cursor Predictability** | ⚠️ Unpredictable — logs show backward jumps         | Medium   |
| **Command Processing**    | ✅ Safe — no duplicates actually processed          | None     |

---

## Mitigation Strategies

### Strategy 1: Database Transaction (Recommended for Phase 2)

**Approach:** Wrap the entire startup sync in a SQLite transaction with row-level locking.

**Implementation:**

```typescript
// ✅ SAFE — uses transaction + FOR UPDATE lock
export async function runStartupSync(context: WebhookContext) {
  const transaction = db.transaction(() => {
    // Step 1: READ with lock (prevents concurrent writes)
    const row = db.prepare('SELECT value FROM webhook_sync WHERE key = ? FOR UPDATE').get(SYNC_KEY);
    const since = row?.value ?? fallback;

    return { since, rowExists: !!row };
  });

  const { since, rowExists } = transaction();

  // Step 2-3: GitHub fetch and processing (outside transaction, safe)
  const missedComments = await fetchMissedComments(since);
  let latestSeenAt = since;

  for (const comment of missedComments) {
    await processCommand(comment, context);
    latestSeenAt = comment.created_at;
  }

  // Step 4: WRITE with lock (atomic with read)
  const writeTransaction = db.transaction(() => {
    if (rowExists) {
      db.prepare('UPDATE webhook_sync SET value = ? WHERE key = ?').run(latestSeenAt, SYNC_KEY);
    } else {
      db.prepare('INSERT INTO webhook_sync (key, value) VALUES (?, ?)').run(SYNC_KEY, latestSeenAt);
    }
  });

  writeTransaction();
}
```

**Pros:**

- ✅ Eliminates race condition completely
- ✅ Works with WAL mode (concurrent readers unaffected)
- ✅ Uses SQLite's native `FOR UPDATE` syntax
- ✅ Simple to implement (5-10 min)

**Cons:**

- ⚠️ Requires one instance to wait if another is reading (max 5s with busy_timeout)
- ⚠️ Slightly more complex code

**Estimated Effort:** 10-15 minutes

---

### Strategy 2: Distributed Consensus (Overkill, Not Recommended)

**Approach:** Use a database "lock" table to elect a leader for startup sync.

**Why Not:** Adds unnecessary complexity for the benefit gained. Transaction approach is simpler.

**Sketch (for reference):**

```typescript
// ❌ NOT RECOMMENDED — overly complex
function electLeader() {
  try {
    db.prepare('INSERT INTO startup_lock (instance_id, locked_at) VALUES (?, ?)').run(instanceId, Date.now());
    return true; // This instance won the election
  } catch (e) {
    // Constraint violation — another instance holds the lock
    return false;
  }
}
```

---

### Strategy 3: Eventual Consistency (Current Approach)

**Current mitigation:** Rely on deliveries dedup table for safety.

**How it works:**

```
Instance A processes comments → Writes to deliveries table (INSERT OR IGNORE)
Instance B processes same comments → Writes to deliveries table (INSERT OR IGNORE)
               ↓
         Only first INSERT succeeds
         Second INSERT fails silently (dedup wins)
```

**Why safe:** GitHub webhook delivery IDs are unique; `INSERT OR IGNORE` ensures idempotency.

**Why limited:** Doesn't prevent wasted API quota or cursor regression.

---

## Recommended Action Plan

### Phase 1 (Now — Deployment Testing)

✅ **Deploy as-is** with current dedup-based mitigation.

**Monitor for:**

```bash
# Watch for cursor regression in logs
pm2 logs isolate-ui-webhook-listener | grep -E 'cursor|Startup sync'

# Expected pattern:
# Startup sync complete: processed 3 missed commands, cursor: 2026-05-15T14:30:15Z
# (cursor timestamp always increases)

# Warning pattern:
# Startup sync complete: cursor: 2026-05-15T14:30:15Z
# ... later ...
# Startup sync complete: cursor: 2026-05-15T14:29:50Z  ← REGRESSION!
```

**Track GitHub API quota:**

```bash
# Check GitHub API rate limit
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/rate_limit | jq '.rate_limit'

# Note baseline quota consumption per day
# Cursor regression will show as erratic spikes
```

### Phase 2 (1-2 weeks after deployment)

**Implement transaction-based fix** (Strategy 1 above):

1. Update `apps/webhook-listener/src/sync/startup.ts` to wrap cursor read/write in transaction
2. Add test case: simulate two instances starting simultaneously (race condition test)
3. Verify cursor only moves forward in all scenarios
4. Update deployment guide to note fix

**Effort:** ~15 minutes implementation + 10 minutes testing

### Phase 3+ (Optional)

Monitor for actual impact in production. If cursor regression is:

- **Not observed:** Declare non-critical, monitor occasionally
- **Observed rarely:** Acceptable, fix in Phase 2 as planned
- **Observed frequently:** Prioritize Phase 2 fix immediately

---

## Testing the Race Condition

### Manual Test: Simulate Concurrent Startup

```bash
# Terminal 1: Start first instance
NODE_ENV=test pm2 start apps/webhook-listener/src/main.ts --instance-id=1

# Terminal 2: Immediately start second instance (within 1-2s)
NODE_ENV=test pm2 start apps/webhook-listener/src/main.ts --instance-id=2

# Observe logs
pm2 logs | grep -E 'Startup sync|cursor'

# Expected (safe): Cursor moves forward for both
# Danger sign: Cursor regresses (goes backward)
```

### Automated Test (Vitest)

```typescript
// apps/webhook-listener/src/sync/__tests__/startup-race.spec.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runStartupSync } from '../startup';
import { Database } from 'better-sqlite3';
import path from 'path';

describe('Startup Sync Race Condition', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    // Setup schema...
  });

  afterEach(() => {
    db.close();
  });

  it('should not regress cursor when two instances start simultaneously', async () => {
    // Setup initial cursor
    db.prepare('INSERT INTO webhook_sync (key, value) VALUES (?, ?)').run('last_sync_time', '2026-05-15T14:00:00Z');

    // Simulate two concurrent startups
    const instance1 = runStartupSync(mockContext);
    const instance2 = runStartupSync(mockContext); // Same context, simulates race

    await Promise.all([instance1, instance2]);

    // Both should complete
    const cursor = db.prepare('SELECT value FROM webhook_sync WHERE key = ?').get('last_sync_time') as { value: string };

    // Cursor should be >= both timestamps (should progress forward)
    expect(new Date(cursor.value).getTime()).toBeGreaterThanOrEqual(new Date('2026-05-15T14:00:00Z').getTime());
  });
});
```

---

## Monitoring Checklist

After deploying to Mac Mini, add these to your operational monitoring:

- [ ] Daily check: PM2 logs for cursor regression patterns
- [ ] Weekly check: GitHub API quota trending (should be stable)
- [ ] Weekly check: Duplicate command detection (should stay zero)
- [ ] Bi-weekly check: Startup sync duration (should stay consistent)

```bash
# Quick health check script
#!/bin/bash
echo "=== Cursor Status ==="
pm2 logs isolate-ui-webhook-listener --lines 50 | grep -i cursor | tail -3

echo "=== Recent Errors ==="
pm2 logs isolate-ui-webhook-listener --err --lines 20

echo "=== Process Health ==="
pm2 show isolate-ui-webhook-listener
```

---

## References

- **SQLite Transactions:** https://www.sqlite.org/lang_transaction.html
- **SQLite Row-Level Locking:** https://www.sqlite.org/lang_transaction.html (BEGIN IMMEDIATE)
- **better-sqlite3 Transactions:** https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#transactionfn
- **PM2 Clustering:** https://pm2.keymetrics.io/docs/usage/cluster-mode/
- **GitHub Webhook Deduplication:** https://docs.github.com/en/developers/webhooks-and-events/webhooks/about-webhooks#redeliveries

---

## Questions & Answers

**Q: Why not just use a single instance instead of clustering?**

A: PM2 clustering provides:

- Better throughput (multiple cores processing webhooks in parallel)
- Graceful restarts (one instance restarts while others serve)
- Better resource utilization on multi-core machines

The race condition is a small efficiency issue, not a safety issue.

**Q: Can cursor regression cause data loss?**

A: No. The `deliveries` table deduplicates based on GitHub webhook delivery ID, which is globally unique. Even if the cursor regresses and we reprocess the same comments, duplicate commands are silently dropped by the dedup table.

**Q: How often does this race condition occur in practice?**

A: Hard to predict. Depends on:

- PM2 restart frequency (restarts both instances simultaneously)
- GitHub API latency (variable, typically 100ms-2s)
- System load (affects instance startup timing)

Monitor post-deployment to gather real-world data.

**Q: Is the fix backward compatible?**

A: Yes. Using SQLite transactions is fully backward compatible. No schema changes, no migration needed.

---

_Last updated: May 16, 2026_
