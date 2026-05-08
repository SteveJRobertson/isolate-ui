import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { Octokit } from '@octokit/rest';
import { OrchestratorGraph } from '@isolate-ui/ai-orchestrator';
import { verifyHmac } from '../security/hmac';
import { handleApprove } from '../commands/approve';
import { handleFix } from '../commands/fix';
import { handleQuery } from '../commands/query';
import { CommandContext } from '../commands/context';

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
  comment: { body: string; user: { login: string } };
}

/**
 * Register the POST /api/webhook route.
 *
 * Pipeline:
 * 1. Filter: only process 'issue_comment' events
 * 2. HMAC verification → 401 on failure
 * 3. Require X-GitHub-Delivery header → 400 if absent
 * 4. Parse payload; skip non-'created' actions → 200
 * 5. Deduplication: INSERT delivery ID → 200 if already seen
 * 6. Dispatch to command handler (/approve, /fix, /query)
 * 7. Reply 200
 */
export async function webhookRoute(
  fastify: FastifyInstance,
  opts: WebhookRouteOptions,
): Promise<void> {
  const { db, graph, octokit, owner, repo } = opts;
  const secret = process.env['WEBHOOK_SECRET'];
  if (!secret || secret.length < 32) {
    throw new Error(
      'WEBHOOK_SECRET must be set and at least 32 characters. Refusing to start.',
    );
  }

  fastify.post(
    '/api/webhook',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Step 1: event type filter
      const event = request.headers['x-github-event'] as string | undefined;
      if (event !== 'issue_comment') {
        return reply.status(200).send({ ok: true, skipped: true });
      }

      // Step 2: HMAC verification
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

      // Step 3: require X-GitHub-Delivery header — GitHub always sends it;
      // absence indicates a malformed or non-GitHub request. Rejecting here
      // also ensures every processed request has a dedup key.
      const deliveryId = request.headers['x-github-delivery'] as
        | string
        | undefined;
      if (!deliveryId) {
        return reply
          .status(400)
          .send({ error: 'Missing X-GitHub-Delivery header' });
      }

      // Step 4: filter to 'created' actions before claiming the delivery ID
      // so non-'created' events (edited, deleted) don't pollute the deliveries
      // table with rows for events we never act on.
      const payload = request.body as IssueCommentPayload;
      if (payload.action !== 'created') {
        return reply.status(200).send({ ok: true, skipped: true });
      }

      // Step 5: deduplication — claim the delivery ID.
      // INSERT after the action filter so only actionable events are tracked.
      // Two concurrent identical deliveries: only the request whose INSERT
      // changes a row proceeds; the other returns 200 immediately.
      const inserted = db
        .prepare('INSERT OR IGNORE INTO deliveries (delivery_id) VALUES (?)')
        .run(deliveryId);
      if (inserted.changes === 0) {
        return reply.status(200).send({ ok: true, duplicate: true });
      }

      // Step 6 detail: parse comment details
      const issueNumber = payload.issue.number;
      const commentBody = payload.comment.body.trim();
      const username = payload.comment.user.login;
      const threadId = `issue-${issueNumber}`;

      const ctx: CommandContext = {
        db,
        graph,
        octokit,
        owner,
        repo,
        issueNumber,
        threadId,
        username,
      };

      // Step 6: dispatch command.
      // If dispatch fails, delete the delivery row so GitHub can retry.
      // Keeping the row on failure would permanently drop the command.
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

      // Step 7: reply 200 (delivery already claimed in step 5)
      return reply.status(200).send({ ok: true });
    },
  );
}
