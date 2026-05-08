import Database from 'better-sqlite3';
import { Octokit } from '@octokit/rest';
import { OrchestratorGraph } from '@isolate-ui/ai-orchestrator';
import { handleApprove } from '../commands/approve';
import { handleFix } from '../commands/fix';
import { handleQuery } from '../commands/query';
import { CommandContext } from '../commands/context';

const SYNC_KEY = 'last_sync_time';
const ONE_HOUR_MS = 3_600_000;

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

  const since = row?.value ?? new Date(Date.now() - ONE_HOUR_MS).toISOString();

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

        const deliveryId = `startup-sync-${comment.id}`;

        // Skip already-processed comments
        const existing = db
          .prepare('SELECT 1 FROM deliveries WHERE delivery_id = ?')
          .get(deliveryId);
        if (existing) continue;

        const commentBody = (comment.body ?? '').trim();
        const username = comment.user?.login ?? 'unknown';
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
            continue; // not a bot command
          }
        } catch (handlerErr) {
          // Handler threw (and already posted an error reply). Skip the
          // deliveries INSERT so the next startup can retry this command.
          console.warn(
            `[webhook-listener] Startup sync: handler failed for comment ${comment.id}: ${String(handlerErr)}`,
          );
          continue;
        }

        // Mark as processed so we don't replay if the server restarts again
        db.prepare(
          'INSERT OR IGNORE INTO deliveries (delivery_id) VALUES (?)',
        ).run(deliveryId);

        // Advance the cursor to the latest processed comment's timestamp so
        // we never skip a comment created in the window between fetching and
        // writing the cursor (as would happen if we advanced to `now`).
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
