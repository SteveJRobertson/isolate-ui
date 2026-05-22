import { FastifyInstance } from 'fastify';

/**
 * Register the GET /health endpoint.
 *
 * Returns HTTP 200 with a JSON payload containing:
 * - status: 'ok' (constant)
 * - timestamp: ISO 8601 timestamp of the response
 *
 * This endpoint is used by PM2's http_proxy liveness probe to detect
 * zombie processes (listening but unresponsive). It has no dependencies
 * (no DB, auth, or external calls) and is always healthy.
 *
 * @param fastify - Fastify instance to register the route on
 */
export async function registerHealthRoute(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  });
}
