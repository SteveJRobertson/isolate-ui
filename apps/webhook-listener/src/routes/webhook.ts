import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { Octokit } from '@octokit/rest';
import { OrchestratorGraph } from '@isolate-ui/ai-orchestrator';
import { verifyHmac } from '../security/hmac';
import { handleApprove } from '../commands/approve';
import { handleFix } from '../commands/fix';
import { handleQuery } from '../commands/query';
import { CommandContext, addReactionToComment } from '../commands/context';

interface WebhookRouteOptions {
  db: Database.Database;
  graph: OrchestratorGraph;
  octokit: Octokit;
  owner: string;
  repo: string;
}

interface IssueCommentPayload {
  action: string;
  issue: { number: number };
  comment: {
    id: number;
    body: string;
    user: { login: string };
    // GitHub's association of the commenter with the repo.
    // Only OWNER, MEMBER, and COLLABORATOR may run orchestrator commands.
    author_association: string;
  };
}

// Minimum association required to run /approve, /fix, /query.
// GitHub values: OWNER > MEMBER > COLLABORATOR > CONTRIBUTOR > NONE
const AUTHORIZED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/**
 * Register the POST /api/webhook route.
 *
 * Pipeline for issue_comment events:
 * 1. Filter: only process 'issue_comment' events
 * 2. HMAC verification → 401 on failure
 * 3. Require X-GitHub-Delivery header → 400 if absent
 * 4. Parse payload; skip non-'created' actions → 200
 * 5. Deduplication: INSERT delivery ID → 200 if already seen
 * 6. Dispatch to command handler (/approve, /fix, /query)
 * 7. Reply 200
 *
 * Pipeline for issues.labeled events (thread bootstrapping):
 * 1. Filter: only process 'issues' events with 'labeled' action
 * 2. HMAC verification → 401 on failure
 * 3. Require X-GitHub-Delivery header → 400 if absent
 * 4. Deduplication: INSERT delivery ID → 200 if already seen
 * 5. Check label whitelist (component, bug) → 200 skipped if not whitelisted
 * 6. Authorization: issue author must be OWNER, MEMBER, or COLLABORATOR → 403 if not
 * 7. Call graph.run() to bootstrap new thread
 * 8. Post "Starting analysis" comment
 * 9. Reply 202 Accepted
 */
export async function webhookRoute(
  fastify: FastifyInstance,
  opts: WebhookRouteOptions,
): Promise<void> {
  const { db, graph, octokit, owner, repo } = opts;
  // WEBHOOK_SECRET is guaranteed to be set and ≥32 chars by startup validation (validateEnv).
  // No need to re-validate here; if it were missing/invalid, the app would have exited at startup.
  const secret = process.env['WEBHOOK_SECRET']!;

  // Whitelist of labels that trigger thread bootstrapping
  const BOOTSTRAP_LABELS = new Set(['component', 'bug']);

  fastify.post(
    '/api/webhook',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Step 1: event type filter
      const event = request.headers['x-github-event'] as string | undefined;

      // Step 2: HMAC verification (applies to both event types)
      const signature = request.headers['x-hub-signature-256'] as
        | string
        | undefined;
      const rawBody = (request as any).rawBody;
      if (!Buffer.isBuffer(rawBody)) {
        return reply
          .status(400)
          .send({ error: 'Raw body unavailable — HMAC cannot be verified' });
      }
      if (!verifyHmac(secret, rawBody, signature)) {
        return reply.status(401).send({ error: 'Invalid signature' });
      }

      // Step 3: require X-GitHub-Delivery header
      const deliveryId = request.headers['x-github-delivery'] as
        | string
        | undefined;
      if (!deliveryId) {
        return reply
          .status(400)
          .send({ error: 'Missing X-GitHub-Delivery header' });
      }

      // Handle issue_comment events (existing flow)
      if (event === 'issue_comment') {
        // Filter to 'created' actions before claiming the delivery ID
        const payload = request.body as IssueCommentPayload;
        if (payload.action !== 'created') {
          return reply.status(200).send({ ok: true, skipped: true });
        }

        // Deduplication — claim the delivery ID
        const inserted = db
          .prepare('INSERT OR IGNORE INTO deliveries (delivery_id) VALUES (?)')
          .run(deliveryId);
        if (inserted.changes === 0) {
          return reply.status(200).send({ ok: true, duplicate: true });
        }

        // Parse comment details
        const issueNumber = payload.issue.number;
        const commentId = payload.comment.id;
        const commentBody = payload.comment.body.trim();
        const username = payload.comment.user.login;
        const authorAssociation = payload.comment.author_association;
        const threadId = `issue-${issueNumber}`;

        // Authorization check
        if (!AUTHORIZED_ASSOCIATIONS.has(authorAssociation)) {
          db.prepare('DELETE FROM deliveries WHERE delivery_id = ?').run(
            deliveryId,
          );
          return reply.status(200).send({ ok: true, skipped: true });
        }

        const ctx: CommandContext = {
          db,
          graph,
          octokit,
          owner,
          repo,
          issueNumber,
          threadId,
          username,
          commentId,
        };

        // Phase 3: Add immediate reaction feedback (async, does not block command)
        addReactionToComment(ctx, 'rocket').catch(() => {
          // Silently ignore reaction failures — they don't block command processing
        });

        // Dispatch command
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
            // Not a bot command — release the delivery claim and ignore silently.
            db.prepare('DELETE FROM deliveries WHERE delivery_id = ?').run(
              deliveryId,
            );
            return reply.status(200).send({ ok: true, skipped: true });
          }
        } catch (dispatchErr) {
          // Delete the claimed delivery row so GitHub can retry successfully.
          db.prepare('DELETE FROM deliveries WHERE delivery_id = ?').run(
            deliveryId,
          );
          throw dispatchErr;
        }

        // Reply 200 (delivery already claimed)
        return reply.status(200).send({ ok: true });
      }

      // Handle issues.labeled events (thread bootstrapping)
      if (event === 'issues') {
        const payload = request.body as any;

        // Deduplication — claim the delivery ID first
        const inserted = db
          .prepare('INSERT OR IGNORE INTO deliveries (delivery_id) VALUES (?)')
          .run(deliveryId);
        if (inserted.changes === 0) {
          return reply.status(202).send({ ok: true, skipped: true });
        }

        // Filter to 'labeled' action only
        if (payload.action !== 'labeled') {
          return reply.status(202).send({ ok: true, skipped: true });
        }

        // Check label whitelist
        const labelName = payload.label?.name;
        if (!labelName || !BOOTSTRAP_LABELS.has(labelName)) {
          return reply.status(202).send({ ok: true, skipped: true });
        }

        // Authorization check: issue author must be authorized
        const issueNumber = payload.issue.number;
        const authorAssociation = payload.issue?.author_association;
        if (!AUTHORIZED_ASSOCIATIONS.has(authorAssociation)) {
          return reply.status(403).send({ error: 'Unauthorized' });
        }

        // Bootstrap the thread by calling graph.run()
        const threadId = `issue-${issueNumber}`;
        try {
          await graph.run(threadId, {});

          // Post comment to acknowledge
          await octokit.issues.createComment({
            owner,
            repo,
            issue_number: issueNumber,
            body: `✅ Starting analysis on #${issueNumber} with **${labelName}** label`,
          });
        } catch (err) {
          // Non-retriable errors: log and mark processed
          // Retriable errors: re-throw for GitHub retry
          if (err instanceof Error && err.message.includes('SQLITE')) {
            throw err; // Retriable: SQLite error
          }
          // Log non-retriable errors
          console.error(
            `[webhook] Failed to bootstrap thread for #${issueNumber}:`,
            err,
          );
        }

        return reply.status(202).send({ ok: true });
      }

      // Unknown event type
      return reply.status(200).send({ ok: true, skipped: true });
    },
  );
}
