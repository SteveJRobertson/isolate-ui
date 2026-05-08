import Database from 'better-sqlite3';
import { Octokit } from '@octokit/rest';
import { OrchestratorGraph } from '@isolate-ui/ai-orchestrator';
import { handleApprove } from '../commands/approve';
import { handleFix } from '../commands/fix';
import { handleQuery } from '../commands/query';
import { CommandContext } from '../commands/context';

const SYNC_KEY = 'last_sync_time';
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

  const since = row?.value ?? new Date(Date.now() - syncWindowMs).toISOString();

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

  try {
    // Iterate all threads that have an active checkpoint in the DB
    const threads = db
      .prepare(`SELECT DISTINCT thread_id FROM checkpoints`)
      .all() as { thread_id: string }[];

    for (const { thread_id } of threads) {
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
        // (including already-processed and non-command ones) so the cursor
        // can advance even when no new commands are processed.
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

        // Claim the delivery ID first (INSERT before dispatch) so that a crash
        // after a successful handler but before the INSERT doesn't replay the
        // same command on the next restart. Mirrors the webhook route semantics.
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
        // Without this, any GitHub user whose command falls in the scan window
        // would be processed during a restart.
        if (!AUTHORIZED_ASSOCIATIONS.has(authorAssociation)) {
          // Release the claimed delivery row so the dedup table doesn't fill
          // with comments from unauthorized users.
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
            // Not a recognized command — release the claimed row so the dedup
            // table doesn't fill with non-command comments (mirrors webhook route).
            db.prepare('DELETE FROM deliveries WHERE delivery_id = ?').run(
              deliveryId,
            );
            continue;
          }
        } catch (handlerErr) {
          // Handler threw (and already posted an error reply). Delete the
          // claimed delivery row so the next startup can retry this command.
          db.prepare('DELETE FROM deliveries WHERE delivery_id = ?').run(
            deliveryId,
          );
          console.warn(
            `[webhook-listener] Startup sync: handler failed for comment ${comment.id}: ${String(handlerErr)}`,
          );
          continue;
        }

        // Mark the claimed delivery as processed (INSERT was done above).
        // Advance the cursor to the latest processed comment's timestamp.
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
  }
}
