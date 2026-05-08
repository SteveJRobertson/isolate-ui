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
  const now = new Date().toISOString();

  console.log(
    `[webhook-listener] Startup sync: checking comments since ${since}`,
  );

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

        if (command === '/approve') {
          await handleApprove(ctx);
        } else if (command === '/fix') {
          await handleFix(ctx, args);
        } else if (command === '/query') {
          await handleQuery(ctx, args);
        } else {
          continue; // not a bot command
        }

        // Mark as processed so we don't replay if the server restarts again
        db.prepare(
          'INSERT OR IGNORE INTO deliveries (delivery_id) VALUES (?)',
        ).run(deliveryId);
      }
    }
  } catch (err) {
    // Non-fatal — log and continue server startup
    console.warn(`[webhook-listener] Startup sync failed: ${String(err)}`);
  }

  // Update last_sync_time regardless of errors so we don't re-process the
  // same window on the next restart.
  db.prepare(
    'INSERT OR REPLACE INTO webhook_sync (key, value) VALUES (?, ?)',
  ).run(SYNC_KEY, now);

  console.log(
    `[webhook-listener] Startup sync complete. Next sync from ${now}`,
  );
}
