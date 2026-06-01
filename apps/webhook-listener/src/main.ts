import Fastify from 'fastify';
import rawBody from 'fastify-raw-body';
import { OrchestratorGraph } from '@isolate-ui/ai-orchestrator';
import { validateEnv } from './config/env-validation';
import { openDb } from './db/schema';
import { registerHealthRoute } from './routes/health';
import { webhookRoute } from './routes/webhook';
import { runStartupSync } from './sync/startup';
import { getAuthenticatedOctokit } from './auth/hybrid-auth';

async function start() {
  // Validate all environment variables at startup.
  // This ensures DATABASE_PATH, GITHUB_TOKEN, WEBHOOK_SECRET, and other critical
  // variables are present and valid BEFORE any server/database operations begin.
  // process.exit(1) is called if validation fails with a clear error message.
  const env = validateEnv();
  const server = Fastify({ logger: true });

  // Register fastify-raw-body BEFORE the JSON content-type parser so that
  // rawBody is populated on every request (required for HMAC verification).
  await server.register(rawBody, {
    field: 'rawBody',
    global: true,
    encoding: false, // keep as Buffer, not string
    runFirst: true,
  });

  // Open the database using the pre-resolved absolute path from env validation.
  // This ensures all PM2 cluster workers use the same database file path.
  const db = openDb(env.resolvedDatabasePath);
  const octokit = await getAuthenticatedOctokit();
  const graph = new OrchestratorGraph(
    env.resolvedDatabasePath,
    undefined,
    octokit,
  );

  // Sync the graph's GitHub repo target so the human_review pause comment
  // is posted to the same repo this service is configured to watch.
  graph.setGitHubRepo(env.GITHUB_OWNER, env.GITHUB_REPO);

  // Register the health check endpoint (no dependencies; stateless)
  await server.register(registerHealthRoute);

  // Register the webhook route with its dependencies
  await server.register(webhookRoute, {
    db,
    graph,
    octokit,
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPO,
  });

  // Run startup sync before accepting traffic so missed commands are replayed
  await runStartupSync(
    db,
    graph,
    octokit,
    env.GITHUB_OWNER,
    env.GITHUB_REPO,
    env.STARTUP_SYNC_WINDOW_MS,
  );

  // Start listening
  server.listen({ port: env.PORT, host: env.HOST }, (err) => {
    if (err) {
      server.log.error(err);
      process.exit(1);
    } else {
      console.log(`[ ready ] http://${env.HOST}:${env.PORT}`);
    }
  });
}

start().catch((err) => {
  console.error('[webhook-listener] Fatal startup error:', err);
  process.exit(1);
});
