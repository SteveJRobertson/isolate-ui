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
 * 3. Deduplication via X-GitHub-Delivery header → 200 no-op if seen before
 * 4. Parse issue number, comment body, and commenter login
 * 5. Dispatch to command handler (/approve, /fix, /query)
 * 6. Mark delivery as processed
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

      // Step 3: deduplication — claim the delivery ID up-front.
      // INSERT OR IGNORE before dispatching ensures that two concurrent
      // identical deliveries never both execute the command. Only the
      // request whose INSERT actually changed a row proceeds; the other
      // returns 200 immediately.
      const deliveryId = request.headers['x-github-delivery'] as
        | string
        | undefined;
      if (deliveryId) {
        const inserted = db
          .prepare('INSERT OR IGNORE INTO deliveries (delivery_id) VALUES (?)')
          .run(deliveryId);
        if (inserted.changes === 0) {
          return reply.status(200).send({ ok: true, duplicate: true });
        }
      }

      // Step 4: parse payload
      const payload = request.body as IssueCommentPayload;
      if (payload.action !== 'created') {
        return reply.status(200).send({ ok: true, skipped: true });
      }

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

      // Step 5: dispatch command
      const [command, ...rest] = commentBody.split(/\s+/);
      const args = rest.join(' ');

      if (command === '/approve') {
        await handleApprove(ctx);
      } else if (command === '/fix') {
        await handleFix(ctx, args);
      } else if (command === '/query') {
        await handleQuery(ctx, args);
      } else {
        // Not a bot command — ignore silently
        return reply.status(200).send({ ok: true, skipped: true });
      }

      // Step 6: reply 200 (delivery already claimed in step 3)
      return reply.status(200).send({ ok: true });
    },
  );
}
