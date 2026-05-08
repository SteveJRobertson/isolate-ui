import Fastify from 'fastify';
import rawBody from 'fastify-raw-body';
import { Octokit } from '@octokit/rest';
import { OrchestratorGraph } from '@isolate-ui/ai-orchestrator';
import { openDb, resolveDbPath } from './db/schema';
import { webhookRoute } from './routes/webhook';
import { runStartupSync } from './sync/startup';

const host = process.env.HOST ?? 'localhost';
const port = process.env.PORT ? Number(process.env.PORT) : 8080;
const owner = process.env.GITHUB_OWNER ?? 'SteveJRobertson';
const repo = process.env.GITHUB_REPO ?? 'isolate-ui';

// GITHUB_TOKEN is required: startup sync and all error replies depend on it.
// Fail immediately with a clear message so misconfiguration is obvious.
if (!process.env['GITHUB_TOKEN']) {
  console.error(
    '[webhook-listener] GITHUB_TOKEN is not set. ' +
      'Set it to a PAT with `repo` scope before starting the service.',
  );
  process.exit(1);
}

async function start() {
  const server = Fastify({ logger: true });

  // Register fastify-raw-body BEFORE the JSON content-type parser so that
  // rawBody is populated on every request (required for HMAC verification).
  await server.register(rawBody, {
    field: 'rawBody',
    global: true,
    encoding: false, // keep as Buffer, not string
    runFirst: true,
  });

  // Resolve the DB path once so both openDb() and OrchestratorGraph use the
  // same SQLite file (important when DATABASE_PATH env var is set).
  const dbPath = resolveDbPath();
  const db = openDb(dbPath);
  const octokit = new Octokit({ auth: process.env['GITHUB_TOKEN'] });
  const graph = new OrchestratorGraph(dbPath);

  // Sync the graph's GitHub repo target so the human_review pause comment
  // is posted to the same repo this service is configured to watch.
  graph.setGitHubRepo(owner, repo);

  // Register the webhook route with its dependencies
  await server.register(webhookRoute, { db, graph, octokit, owner, repo });

  // Run startup sync before accepting traffic so missed commands are replayed
  await runStartupSync(db, graph, octokit, owner, repo);

  // Start listening
  server.listen({ port, host }, (err) => {
    if (err) {
      server.log.error(err);
      process.exit(1);
    } else {
      console.log(`[ ready ] http://${host}:${port}`);
    }
  });
}

start();
