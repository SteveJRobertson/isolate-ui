import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { webhookRoute } from './webhook';
import Database from 'better-sqlite3';

vi.mock('../security/hmac');
vi.mock('../commands/approve');
vi.mock('../commands/fix');
vi.mock('../commands/query');

// WEBHOOK_SECRET must be at least 32 characters
const WEBHOOK_SECRET = 'a'.repeat(32);

describe('webhookRoute', () => {
  let fastify;
  let db;

  beforeEach(async () => {
    fastify = Fastify();

    db = new Database(':memory:');

    // Initialize database schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS deliveries (
        delivery_id   TEXT    PRIMARY KEY,
        processed_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS webhook_sync (
        key    TEXT PRIMARY KEY,
        value  TEXT NOT NULL
      );
    `);

    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await fastify.register(webhookRoute, {
      db,
      graph: { getState: vi.fn(), invoke: vi.fn() } as any,
      octokit: { rest: { issues: { createComment: vi.fn() } } } as any,
      owner: 'owner',
      repo: 'repo',
    });
  });

  afterEach(async () => {
    await fastify.close();
  });

  it('registers the POST /api/webhook route successfully', async () => {
    // Just verify the route was registered without errors
    expect(fastify.hasRoute({ method: 'POST', url: '/api/webhook' })).toBe(
      true,
    );
  });
});
