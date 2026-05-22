import Database from 'better-sqlite3';
import { Octokit } from '@octokit/rest';
import {
  OrchestratorGraph,
  deserializeCheckpointBody,
} from '@isolate-ui/ai-orchestrator';
import type { AgentState } from '@isolate-ui/ai-orchestrator';
import { handleApprove } from '../commands/approve';
import { handleFix } from '../commands/fix';
import { handleQuery } from '../commands/query';
import { CommandContext } from '../commands/context';
import { acquireLock, releaseLock } from '../db/lock';

const SYNC_KEY = 'last_sync_time';
const LOCK_ID = 'startup_sync';
// TTL for the advisory lock. If the lock-holder instance crashes, the lock
// expires after this window and other instances can proceed.
const LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes
// Default fallback window. Override with STARTUP_SYNC_WINDOW_MS env var so
// operators can widen the window when the server may be offline for longer
// periods. If the server was down longer than this window, a warning is logged.
const DEFAULT_SYNC_WINDOW_MS = 3_600_000; // 1 hour

// Minimum association required to run /approve, /fix, /query during startup sync.
// Must match the check in routes/webhook.ts.
const AUTHORIZED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/**
 * On server startup, poll GitHub for any issue_comment events that arrived
 * while the server was offline and process commands that were not yet seen.
 *
 * Uses the last_sync_time stored in the webhook_sync table as the lower bound
 * for the GitHub API query. Defaults to 1 hour ago when no record exists.
 */
export async function runStartupSync(
  db: Database.Database,
  graph: OrchestratorGraph,
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<void> {
  // Acquire the advisory lock to ensure at most one PM2 instance runs startup
  // sync at a time. Non-holders skip sync gracefully.
  const lockAcquired = acquireLock(db, LOCK_ID, LOCK_TTL_MS);
  if (!lockAcquired) {
    console.warn(
      '[webhook-listener] startup sync skipped: another instance holds the startup lock. ' +
        'This instance will rely on the live webhook route for new events.',
    );
    return;
  }

  try {
    const row = db
      .prepare('SELECT value FROM webhook_sync WHERE key = ?')
      .get(SYNC_KEY) as { value: string } | undefined;

    const rawSyncWindow = process.env['STARTUP_SYNC_WINDOW_MS'];
    const parsedSyncWindow = rawSyncWindow ? Number(rawSyncWindow) : NaN;
    const syncWindowMs =
      Number.isFinite(parsedSyncWindow) && parsedSyncWindow > 0
        ? parsedSyncWindow
        : DEFAULT_SYNC_WINDOW_MS;
    if (rawSyncWindow && syncWindowMs === DEFAULT_SYNC_WINDOW_MS) {
      console.warn(
        `[webhook-listener] Startup sync: STARTUP_SYNC_WINDOW_MS="${rawSyncWindow}" is not a valid positive number — using default ${DEFAULT_SYNC_WINDOW_MS}ms.`,
      );
    }

    const since =
      row?.value ?? new Date(Date.now() - syncWindowMs).toISOString();

    // Warn when falling back to the default window so operators know they may
    // have missed commands from a longer outage.
    if (!row?.value) {
      console.warn(
        `[webhook-listener] Startup sync: no cursor found — defaulting to ${syncWindowMs}ms window. ` +
          'Commands posted before this window may have been missed. ' +
          'Set STARTUP_SYNC_WINDOW_MS to widen the window if needed.',
      );
    }

    console.log(
      `[webhook-listener] Startup sync: checking comments since ${since}`,
    );

    // latestSeenAt: max timestamp of any comment fetched in this scan,
    // regardless of whether it was a bot command or already deduped.
    // Advancing the cursor to this value prevents re-scanning the same window
    // on every restart when only non-command or already-deduped comments are
    // present, avoiding wasted GitHub API quota.
    let latestSeenAt: string | null = null;
    // latestProcessedAt: max timestamp of actually-processed commands,
    // retained for informational logging only.
    let latestProcessedAt: string | null = null;
    // Query latest checkpoint per thread (window function)
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

    const totalThreads = checkpointRows.length;
    const pausedThreads: { thread_id: string; state: AgentState }[] = [];
    let malformedCount = 0;

    for (const { thread_id, checkpoint_body } of checkpointRows) {
      try {
        const state = deserializeCheckpointBody(checkpoint_body) as AgentState;
        if (state.pause_context != null) {
          pausedThreads.push({ thread_id, state });
        }
      } catch (err) {
        malformedCount++;
        console.warn(
          `[webhook-listener] Startup sync: skipped thread "${thread_id}" (malformed checkpoint_body: ${String(err)})`,
        );
      }
    }

    console.log(
      `[webhook-listener] Startup sync: found ${totalThreads} total threads; ` +
        `${pausedThreads.length} paused threads will be checked for missed commands` +
        (malformedCount > 0
          ? `; ${malformedCount} malformed checkpoints skipped`
          : ''),
    );

    for (const { thread_id } of pausedThreads) {
      // thread_id is 'issue-<number>' — extract the issue number
      const match = thread_id.match(/^issue-(\d+)$/);
      if (!match) continue;
      const issueNumber = parseInt(match[1], 10);

      const comments = await octokit.paginate(octokit.issues.listComments, {
        owner,
        repo,
        issue_number: issueNumber,
        since,
        per_page: 100,
      });

      for (const comment of comments) {
        // Track the latest timestamp from every comment we've seen
        if (comment.created_at) {
          if (!latestSeenAt || comment.created_at > latestSeenAt) {
            latestSeenAt = comment.created_at;
          }
        }

        // The `since` parameter uses `updated_at` semantics in GitHub's API,
        // so edited comments can appear even if they were originally created
        // before the window. Skip edits (updated_at !== created_at) to match
        // the live webhook handler's `action === 'created'` guard.
        if (comment.updated_at !== comment.created_at) {
          continue;
        }

        const deliveryId = `startup-sync-${comment.id}`;

        // Claim the delivery ID first (INSERT before dispatch)
        const inserted = db
          .prepare('INSERT OR IGNORE INTO deliveries (delivery_id) VALUES (?)')
          .run(deliveryId);
        if (inserted.changes === 0) {
          continue; // already processed in a prior startup
        }

        const commentBody = (comment.body ?? '').trim();
        const username = comment.user?.login ?? 'unknown';
        const authorAssociation = comment.author_association ?? '';

        // Apply the same authorization check as the live webhook route.
        if (!AUTHORIZED_ASSOCIATIONS.has(authorAssociation)) {
          db.prepare('DELETE FROM deliveries WHERE delivery_id = ?').run(
            deliveryId,
          );
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
            db.prepare('DELETE FROM deliveries WHERE delivery_id = ?').run(
              deliveryId,
            );
            continue;
          }
        } catch (handlerErr) {
          db.prepare('DELETE FROM deliveries WHERE delivery_id = ?').run(
            deliveryId,
          );
          console.warn(
            `[webhook-listener] Startup sync: handler failed for comment ${comment.id}: ${String(handlerErr)}`,
          );
          continue;
        }

        if (comment.created_at) {
          if (!latestProcessedAt || comment.created_at > latestProcessedAt) {
            latestProcessedAt = comment.created_at;
          }
        }
      }
    }

    // Advance the cursor to the latest comment we've seen — even if all
    // were non-commands or already deduped — so the next startup doesn't
    // re-scan the same window and waste GitHub API quota.
    if (latestSeenAt) {
      db.prepare(
        'INSERT OR REPLACE INTO webhook_sync (key, value) VALUES (?, ?)',
      ).run(SYNC_KEY, latestSeenAt);

      if (latestProcessedAt) {
        console.log(
          `[webhook-listener] Startup sync complete. Processed commands up to ${latestProcessedAt}. Next sync from ${latestSeenAt}`,
        );
      } else {
        console.log(
          `[webhook-listener] Startup sync complete. No new commands processed. Next sync from ${latestSeenAt}`,
        );
      }
    } else {
      console.log(
        `[webhook-listener] Startup sync complete. No comments in window.`,
      );
    }
  } catch (err) {
    // Non-fatal — log and continue server startup.
    // Cursor is intentionally NOT advanced so the next startup re-processes
    // the same window and avoids permanently skipping missed commands.
    console.warn(`[webhook-listener] Startup sync failed: ${String(err)}`);
  } finally {
    releaseLock(db, LOCK_ID);
  }
}
