import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import Fastify from 'fastify';
import { registerHealthRoute } from './health';

describe('registerHealthRoute', () => {
  let fastify;

  beforeEach(async () => {
    fastify = Fastify();
    await fastify.register(registerHealthRoute);
  });

  afterEach(async () => {
    await fastify.close();
  });

  it('returns HTTP 200 for GET /health', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
  });

  it('returns JSON response with status: ok', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/health',
    });

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('status', 'ok');
  });

  it('returns JSON response with valid ISO timestamp', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/health',
    });

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('timestamp');

    // Validate that timestamp is a valid ISO string
    const timestamp = new Date(body.timestamp);
    expect(timestamp instanceof Date && !isNaN(timestamp.getTime())).toBe(true);
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('returns response with both status and timestamp properties', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/health',
    });

    const body = JSON.parse(response.body);
    expect(Object.keys(body).sort()).toEqual(['status', 'timestamp']);
  });
});
