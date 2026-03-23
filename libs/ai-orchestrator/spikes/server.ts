import Fastify from 'fastify';
import { langgraphApp } from './langgraph-spike';

const fastify = Fastify({ logger: true });

/**
 * Endpoint to resume a paused LangGraph thread.
 * Simulates a hit from a Tailscale Funnel via a GitHub Webhook.
 */
fastify.post('/resume', async (request, reply) => {
  const { thread_id, approve } = request.body as {
    thread_id: string;
    approve: boolean;
  };

  if (!thread_id) {
    return reply.status(400).send({ error: 'Missing thread_id' });
  }

  console.log(`[Server] Resuming thread: ${thread_id}. Approved: ${approve}`);

  try {
    // Resume the graph by providing the manual approval state
    const result = await langgraphApp.invoke(
      { is_human_approved: approve },
      { configurable: { thread_id } },
    );

    return { status: 'resumed', result };
  } catch (error) {
    console.error(`[Server] Resume failed:`, error);
    return reply.status(500).send({ error: 'Failed to resume graph' });
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000 });
    console.log('[Server] Fastify listening on port 3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

if (require.main === module) {
  start();
}
