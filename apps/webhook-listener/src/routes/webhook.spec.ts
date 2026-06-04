import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { webhookRoute } from './webhook';
import Database from 'better-sqlite3';
import rawBody from 'fastify-raw-body';

vi.mock('../security/hmac');
vi.mock('../commands/approve');
vi.mock('../commands/fix');
vi.mock('../commands/query');

// WEBHOOK_SECRET must be at least 32 characters
const WEBHOOK_SECRET = 'a'.repeat(32);

/**
 * Create a minimal valid IssueCommentPayload.
 */
function makePayload(overrides: Record<string, any> = {}) {
  return {
    action: 'created',
    issue: { number: 42 },
    comment: {
      body: '/approve',
      user: { login: 'testuser' },
      author_association: 'OWNER',
    },
    ...overrides,
  };
}

/**
 * Create webhook headers for a request.
 */
function makeHeaders(overrides: Record<string, any> = {}) {
  return {
    'x-github-event': 'issue_comment',
    'x-github-delivery': 'test-delivery-id-1',
    'content-type': 'application/json',
    ...overrides,
  };
}

describe('webhookRoute', () => {
  let fastify;
  let db;
  let mockGraph;
  let previousWebhookSecret: string | undefined;
  let previousAllowedBootstrapLabels: string | undefined;

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

    previousWebhookSecret = process.env.WEBHOOK_SECRET;
    previousAllowedBootstrapLabels = process.env['ALLOWED_BOOTSTRAP_LABELS'];
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
    // Note: ALLOWED_BOOTSTRAP_LABELS may be undefined, letting the route use the default

    // Clear all mocks to prevent test state pollution
    vi.clearAllMocks();

    // Register the rawBody plugin so fastify.inject() can work with request.rawBody.
    // The plugin runs before JSON parsing and captures the raw request bytes.
    await fastify.register(rawBody, {
      field: 'rawBody',
      global: true,
      encoding: false, // keep as Buffer
      runFirst: true, // must run before JSON parser
    });

    // Set up command handler mocks to return resolved promises by default
    const { handleApprove } = await import('../commands/approve');
    const { handleFix } = await import('../commands/fix');
    const { handleQuery } = await import('../commands/query');
    vi.mocked(handleApprove).mockResolvedValue(undefined);
    vi.mocked(handleFix).mockResolvedValue(undefined);
    vi.mocked(handleQuery).mockResolvedValue(undefined);

    mockGraph = {
      getState: vi.fn(),
      invoke: vi.fn(),
      run: vi.fn().mockResolvedValue(undefined),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await fastify.register(webhookRoute, {
      db,
      graph: mockGraph as any,
      octokit: { rest: { issues: { createComment: vi.fn() } } } as any,
      owner: 'owner',
      repo: 'repo',
    });
  });

  afterEach(async () => {
    await fastify.close();
    if (previousWebhookSecret === undefined) {
      delete process.env.WEBHOOK_SECRET;
    } else {
      process.env.WEBHOOK_SECRET = previousWebhookSecret;
    }
    if (previousAllowedBootstrapLabels === undefined) {
      delete process.env['ALLOWED_BOOTSTRAP_LABELS'];
    } else {
      process.env['ALLOWED_BOOTSTRAP_LABELS'] = previousAllowedBootstrapLabels;
    }
  });

  it('registers the POST /api/webhook route successfully', async () => {
    // Just verify the route was registered without errors
    expect(fastify.hasRoute({ method: 'POST', url: '/api/webhook' })).toBe(
      true,
    );
  });

  describe('Phase 1: HMAC Verification', () => {
    it('returns 401 when HMAC signature is invalid', async () => {
      // Mock verifyHmac to return false
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(false);

      const payload = makePayload();
      const rawBody = Buffer.from(JSON.stringify(payload));
      const invalidSignature = 'sha256=' + 'b'.repeat(64); // Wrong signature

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: makeHeaders({
          'x-hub-signature-256': invalidSignature,
        }),
        payload: rawBody, // Send raw buffer so rawBody plugin captures it
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.payload)).toEqual({
        error: 'Invalid signature',
      });
    });

    it('returns 401 when x-hub-signature-256 header is missing', async () => {
      // Mock verifyHmac - shouldn't be called, but set up anyway
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(false);

      const payload = makePayload();
      const rawBody = Buffer.from(JSON.stringify(payload));

      // Create headers without the signature header
      const headers = makeHeaders();
      delete headers['x-hub-signature-256'];

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers,
        payload: rawBody,
      });

      // Route should return 401 because signature is missing
      expect(response.statusCode).toBe(401);
    });

    it('returns 400 when raw body is unavailable (HMAC cannot be verified)', async () => {
      // Create a new Fastify instance WITHOUT the rawBody plugin to ensure rawBody is undefined
      const fastifyNoRawBody = Fastify();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await fastifyNoRawBody.register(webhookRoute, {
        db,
        graph: { getState: vi.fn(), invoke: vi.fn() } as any,
        octokit: { rest: { issues: { createComment: vi.fn() } } } as any,
        owner: 'owner',
        repo: 'repo',
      });

      const payload = makePayload();
      const rawBody = Buffer.from(JSON.stringify(payload));

      const response = await fastifyNoRawBody.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: makeHeaders(),
        payload: rawBody,
      });

      // Without rawBody plugin, request.rawBody is undefined → 400
      expect(response.statusCode).toBe(400);
      const responseBody = JSON.parse(response.payload);
      expect(responseBody.error).toMatch(/raw body unavailable/i);

      await fastifyNoRawBody.close();
    });

    it('returns 200 and processes request when HMAC signature is valid', async () => {
      // Mock verifyHmac to return true (valid signature)
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const payload = makePayload();
      const rawBody = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: makeHeaders({
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64), // Doesn't matter, mocked anyway
        }),
        payload: rawBody,
      });

      // With valid HMAC and valid payload, should return 200 and process the request
      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.payload);
      expect(responseBody.ok).toBe(true);
    });

    it('returns 401 when HMAC signature has invalid format', async () => {
      // Mock verifyHmac to return false (invalid signature format)
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(false);

      const payload = makePayload();
      const rawBody = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: makeHeaders({
          'x-hub-signature-256': 'invalid-signature-format', // Missing sha256= prefix
        }),
        payload: rawBody,
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Phase 2: Event Type & Action Filtering', () => {
    it('returns 200 skipped when event type is not issue_comment', async () => {
      // Mock verifyHmac to return true so we pass HMAC check
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const payload = makePayload();
      const rawBody = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: makeHeaders({
          'x-github-event': 'push', // Different event type, not issue_comment
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
        }),
        payload: rawBody,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.payload);
      expect(responseBody.skipped).toBe(true);
    });

    it('returns 200 skipped when action is not created', async () => {
      // Mock verifyHmac to return true so we pass HMAC check
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const payload = makePayload({ action: 'edited' }); // Action is 'edited', not 'created'
      const rawBody = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: makeHeaders({
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
        }),
        payload: rawBody,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.payload);
      expect(responseBody.skipped).toBe(true);
    });

    it('returns 400 when x-github-delivery header is missing', async () => {
      // Mock verifyHmac to return true so we pass HMAC check
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const payload = makePayload();
      const rawBody = Buffer.from(JSON.stringify(payload));

      // Create headers without the delivery ID
      const headers = makeHeaders();
      delete headers['x-github-delivery'];

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers,
        payload: rawBody,
      });

      expect(response.statusCode).toBe(400);
      const responseBody = JSON.parse(response.payload);
      expect(responseBody.error).toMatch(/delivery/i);
    });

    it('returns 400 when x-github-delivery header is present but empty', async () => {
      // Mock verifyHmac to return true so we pass HMAC check
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const payload = makePayload();
      const rawBody = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: makeHeaders({
          'x-github-delivery': '', // Empty string
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
        }),
        payload: rawBody,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Phase 3: Deduplication & Delivery Tracking', () => {
    it('inserts delivery ID on first valid request', async () => {
      // Mock verifyHmac and command handlers
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const deliveryId = 'test-delivery-id-1';
      const payload = makePayload();
      const rawBody = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: makeHeaders({
          'x-github-delivery': deliveryId,
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
        }),
        payload: rawBody,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.payload);
      expect(responseBody.ok).toBe(true);
      expect(responseBody.duplicate).toBeUndefined(); // First request, not a duplicate

      // Verify the delivery ID was inserted into the database
      const deliveryRow = db
        .prepare('SELECT * FROM deliveries WHERE delivery_id = ?')
        .get(deliveryId);
      expect(deliveryRow).toBeDefined();
    });

    it('returns duplicate: true for repeated delivery ID', async () => {
      // Mock verifyHmac
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const deliveryId = 'test-delivery-id-dup';
      const payload = makePayload();
      const rawBody = Buffer.from(JSON.stringify(payload));

      // First request - inserts the delivery ID
      await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: makeHeaders({
          'x-github-delivery': deliveryId,
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
        }),
        payload: rawBody,
      });

      // Second request with same delivery ID - should be detected as duplicate
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: makeHeaders({
          'x-github-delivery': deliveryId,
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
        }),
        payload: rawBody,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.payload);
      expect(responseBody.duplicate).toBe(true);
    });

    it('deletes delivery row when command dispatch fails', async () => {
      // Mock verifyHmac and a command handler that throws
      const { verifyHmac } = await import('../security/hmac');
      const { handleApprove } = await import('../commands/approve');
      vi.mocked(verifyHmac).mockReturnValue(true);
      vi.mocked(handleApprove).mockRejectedValue(new Error('Dispatch error'));

      const deliveryId = 'test-delivery-id-error';
      const payload = makePayload({
        comment: { ...makePayload().comment, body: '/approve' },
      });
      const rawBody = Buffer.from(JSON.stringify(payload));

      // Make the request - it should fail and delete the delivery row
      try {
        await fastify.inject({
          method: 'POST',
          url: '/api/webhook',
          headers: makeHeaders({
            'x-github-delivery': deliveryId,
            'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
          }),
          payload: rawBody,
        });
      } catch {
        // Error is expected
      }

      // Verify the delivery row was deleted (cleanup)
      const deliveryRow = db
        .prepare('SELECT * FROM deliveries WHERE delivery_id = ?')
        .get(deliveryId);
      expect(deliveryRow).toBeUndefined(); // Should be deleted on error
    });

    it('reuses delivery ID after unauthorized comment releases it', async () => {
      // Verify that when we release a delivery ID (unauthorized case),
      // a subsequent request with the same ID can reuse it (not a duplicate)
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const deliveryId = 'test-delivery-id-reuse';

      // First request - unauthorized user, delivery is released
      const unauthorizedPayload = {
        action: 'created',
        issue: { number: 42 },
        comment: {
          body: '/approve',
          user: { login: 'testuser' },
          author_association: 'NONE', // Unauthorized
        },
      };
      const rawBody1 = Buffer.from(JSON.stringify(unauthorizedPayload));

      const response1 = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: {
          'x-github-event': 'issue_comment',
          'x-github-delivery': deliveryId,
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
          'content-type': 'application/json',
        },
        payload: rawBody1,
      });

      expect(response1.statusCode).toBe(200);
      const responseBody1 = JSON.parse(response1.payload);
      expect(responseBody1.skipped).toBe(true);

      // Verify delivery was released (deleted)
      let deliveryRow = db
        .prepare('SELECT * FROM deliveries WHERE delivery_id = ?')
        .get(deliveryId);
      expect(deliveryRow).toBeUndefined();

      // Second request with same delivery ID from authorized user
      // Since first request released the ID, this should claim it (not a duplicate)
      const authorizedPayload = {
        action: 'created',
        issue: { number: 42 },
        comment: {
          body: '/approve',
          user: { login: 'testuser' },
          author_association: 'OWNER', // Authorized
        },
      };
      const rawBody2 = Buffer.from(JSON.stringify(authorizedPayload));

      const response2 = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: {
          'x-github-event': 'issue_comment',
          'x-github-delivery': deliveryId,
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
          'content-type': 'application/json',
        },
        payload: rawBody2,
      });

      expect(response2.statusCode).toBe(200);
      const responseBody2 = JSON.parse(response2.payload);
      // Not a duplicate — should be claimed (duplicate is undefined)
      expect(responseBody2.duplicate).toBeUndefined();
      expect(responseBody2.ok).toBe(true);

      // Delivery should now be claimed
      deliveryRow = db
        .prepare('SELECT * FROM deliveries WHERE delivery_id = ?')
        .get(deliveryId);
      expect(deliveryRow).toBeDefined();
    });
  });

  describe('Phase 4: Authorization Checks', () => {
    it('allows OWNER to dispatch commands', async () => {
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const payload = {
        action: 'created',
        issue: { number: 42 },
        comment: {
          body: '/approve',
          user: { login: 'testuser' },
          author_association: 'OWNER',
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: makeHeaders({
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
        }),
        payload: rawBody,
      });

      // With OWNER association and valid command, should process (handler will be called)
      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.payload);
      expect(responseBody.ok).toBe(true);
    });

    it('allows MEMBER to dispatch commands', async () => {
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const payload = {
        action: 'created',
        issue: { number: 42 },
        comment: {
          body: '/approve',
          user: { login: 'testuser' },
          author_association: 'MEMBER',
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: makeHeaders({
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
        }),
        payload: rawBody,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.payload);
      expect(responseBody.ok).toBe(true);
    });

    it('allows COLLABORATOR to dispatch commands', async () => {
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const payload = {
        action: 'created',
        issue: { number: 42 },
        comment: {
          body: '/approve',
          user: { login: 'testuser' },
          author_association: 'COLLABORATOR',
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: makeHeaders({
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
        }),
        payload: rawBody,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.payload);
      expect(responseBody.ok).toBe(true);
    });

    it('rejects NONE (unauthorized) and returns 200 skipped', async () => {
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const deliveryId = 'test-delivery-auth-none';
      const payload = {
        action: 'created',
        issue: { number: 42 },
        comment: {
          body: '/approve',
          user: { login: 'testuser' },
          author_association: 'NONE',
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: {
          'x-github-event': 'issue_comment',
          'x-github-delivery': deliveryId,
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
          'content-type': 'application/json',
        },
        payload: rawBody,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.payload);
      expect(responseBody.skipped).toBe(true);

      // Verify delivery row was deleted (released) after auth check
      const deliveryRow = db
        .prepare('SELECT * FROM deliveries WHERE delivery_id = ?')
        .get(deliveryId);
      expect(deliveryRow).toBeUndefined();
    });

    it('rejects FIRST_TIME_CONTRIBUTOR (unauthorized) and deletes delivery', async () => {
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const deliveryId = 'test-delivery-auth-ftc';
      const payload = {
        action: 'created',
        issue: { number: 42 },
        comment: {
          body: '/approve',
          user: { login: 'testuser' },
          author_association: 'FIRST_TIME_CONTRIBUTOR',
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: {
          'x-github-event': 'issue_comment',
          'x-github-delivery': deliveryId,
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
          'content-type': 'application/json',
        },
        payload: rawBody,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.payload);
      expect(responseBody.skipped).toBe(true);

      // Verify delivery row was deleted
      const deliveryRow = db
        .prepare('SELECT * FROM deliveries WHERE delivery_id = ?')
        .get(deliveryId);
      expect(deliveryRow).toBeUndefined();
    });
  });

  describe('Phase 5: Command Dispatch & Error Handling', () => {
    it('routes /approve command to handleApprove', async () => {
      const { verifyHmac } = await import('../security/hmac');
      const { handleApprove } = await import('../commands/approve');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const payload = {
        action: 'created',
        issue: { number: 42 },
        comment: {
          body: '/approve',
          user: { login: 'testuser' },
          author_association: 'OWNER',
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: makeHeaders({
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
        }),
        payload: rawBody,
      });

      expect(response.statusCode).toBe(200);
      // Verify handleApprove was called
      expect(vi.mocked(handleApprove)).toHaveBeenCalled();
    });

    it('routes /fix command to handleFix with arguments', async () => {
      const { verifyHmac } = await import('../security/hmac');
      const { handleFix } = await import('../commands/fix');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const payload = {
        action: 'created',
        issue: { number: 42 },
        comment: {
          body: '/fix some arguments here',
          user: { login: 'testuser' },
          author_association: 'OWNER',
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: makeHeaders({
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
        }),
        payload: rawBody,
      });

      expect(response.statusCode).toBe(200);
      // Verify handleFix was called with context and arguments
      expect(vi.mocked(handleFix)).toHaveBeenCalled();
      const call = vi.mocked(handleFix).mock.calls[0];
      expect(call[1]).toBe('some arguments here');
    });

    it('routes /query command to handleQuery with arguments', async () => {
      const { verifyHmac } = await import('../security/hmac');
      const { handleQuery } = await import('../commands/query');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const payload = {
        action: 'created',
        issue: { number: 42 },
        comment: {
          body: '/query search term',
          user: { login: 'testuser' },
          author_association: 'OWNER',
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: makeHeaders({
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
        }),
        payload: rawBody,
      });

      expect(response.statusCode).toBe(200);
      // Verify handleQuery was called with context and arguments
      expect(vi.mocked(handleQuery)).toHaveBeenCalled();
      const call = vi.mocked(handleQuery).mock.calls[0];
      expect(call[1]).toBe('search term');
    });

    it('skips non-command comments and releases delivery claim', async () => {
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const deliveryId = 'test-delivery-non-command';
      const payload = {
        action: 'created',
        issue: { number: 42 },
        comment: {
          body: 'just a regular comment, not a command',
          user: { login: 'testuser' },
          author_association: 'OWNER',
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: {
          'x-github-event': 'issue_comment',
          'x-github-delivery': deliveryId,
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
          'content-type': 'application/json',
        },
        payload: rawBody,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.payload);
      expect(responseBody.skipped).toBe(true);

      // Delivery should be released (deleted)
      const deliveryRow = db
        .prepare('SELECT * FROM deliveries WHERE delivery_id = ?')
        .get(deliveryId);
      expect(deliveryRow).toBeUndefined();
    });

    it('deletes delivery row when command handler throws an error', async () => {
      const { verifyHmac } = await import('../security/hmac');
      const { handleApprove } = await import('../commands/approve');
      vi.mocked(verifyHmac).mockReturnValue(true);
      vi.mocked(handleApprove).mockRejectedValue(new Error('Handler error'));

      const deliveryId = 'test-delivery-error';
      const payload = {
        action: 'created',
        issue: { number: 42 },
        comment: {
          body: '/approve',
          user: { login: 'testuser' },
          author_association: 'OWNER',
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: {
          'x-github-event': 'issue_comment',
          'x-github-delivery': deliveryId,
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
          'content-type': 'application/json',
        },
        payload: rawBody,
      });

      // Handler error results in 500 response
      expect(response.statusCode).toBe(500);
      // Verify handler was invoked
      expect(vi.mocked(handleApprove)).toHaveBeenCalled();

      // Delivery row should be deleted on error (cleanup for retry)
      const deliveryRow = db
        .prepare('SELECT * FROM deliveries WHERE delivery_id = ?')
        .get(deliveryId);
      expect(deliveryRow).toBeUndefined();
    });

    it('parses command arguments correctly when multiple words present', async () => {
      const { verifyHmac } = await import('../security/hmac');
      const { handleFix } = await import('../commands/fix');
      vi.mocked(verifyHmac).mockReturnValue(true);
      vi.mocked(handleFix).mockClear(); // Clear previous calls

      const payload = {
        action: 'created',
        issue: { number: 42 },
        comment: {
          body: '  /fix   multiple   words   here  ',
          user: { login: 'testuser' },
          author_association: 'OWNER',
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: makeHeaders({
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
        }),
        payload: rawBody,
      });

      // Command processed successfully
      expect(response.statusCode).toBe(200);

      // Verify arguments are parsed correctly
      // The route splits on /\s+/ which normalizes multiple spaces to single spaces
      expect(vi.mocked(handleFix)).toHaveBeenCalled();
      const call = vi.mocked(handleFix).mock.calls[0];
      expect(call[1]).toBe('multiple words here');
    });
  });

  describe('Phase 2: Support issues.labeled events (thread bootstrapping)', () => {
    it('accepts issues.labeled event with authorized issue author', async () => {
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const payload = {
        action: 'labeled',
        issue: {
          number: 99,
          title: 'New feature request',
          body: 'New feature for the component library.',
          user: { login: 'owner-user' },
          author_association: 'OWNER',
          labels: [{ name: 'component' }],
        },
        label: { name: 'component' },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: {
          'x-github-event': 'issues',
          'x-github-delivery': 'test-labeled-1',
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
          'content-type': 'application/json',
        },
        payload: rawBody,
      });

      expect(response.statusCode).toBe(202);
    });

    it('rejects labeled event from unauthorized user (author_association NONE)', async () => {
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const payload = {
        action: 'labeled',
        issue: {
          number: 99,
          title: 'Some issue',
          body: null,
          user: { login: 'unauthorized-user' },
          author_association: 'NONE',
          labels: [{ name: 'component' }],
        },
        label: { name: 'component' },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: {
          'x-github-event': 'issues',
          'x-github-delivery': 'test-labeled-2',
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
          'content-type': 'application/json',
        },
        payload: rawBody,
      });

      expect(response.statusCode).toBe(403);
    });

    it('filters labeled events by whitelist (only component and bug trigger bootstrap)', async () => {
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const payload = {
        action: 'labeled',
        issue: {
          number: 99,
          title: 'Documentation request',
          body: null,
          user: { login: 'owner-user' },
          author_association: 'OWNER',
          labels: [{ name: 'documentation' }],
        },
        label: { name: 'documentation' },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: {
          'x-github-event': 'issues',
          'x-github-delivery': 'test-labeled-3',
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
          'content-type': 'application/json',
        },
        payload: rawBody,
      });

      // Accepted (dedup'd) but not processed
      expect(response.statusCode).toBe(202);
      const responseBody = JSON.parse(response.payload);
      expect(responseBody.skipped).toBe(true);
    });

    it('prevents duplicate labeled event bootstrap via dedup check', async () => {
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const deliveryId = 'test-labeled-dedup-1';
      const payload = {
        action: 'labeled',
        issue: {
          number: 99,
          title: 'Add button component',
          body: 'A new button component is needed.',
          user: { login: 'owner-user' },
          author_association: 'OWNER',
          labels: [{ name: 'component' }],
        },
        label: { name: 'component' },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));

      // First request
      const response1 = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: {
          'x-github-event': 'issues',
          'x-github-delivery': deliveryId,
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
          'content-type': 'application/json',
        },
        payload: rawBody,
      });

      expect(response1.statusCode).toBe(202);

      // Duplicate with same delivery ID
      const response2 = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: {
          'x-github-event': 'issues',
          'x-github-delivery': deliveryId,
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
          'content-type': 'application/json',
        },
        payload: rawBody,
      });

      // Should be skipped
      expect(response2.statusCode).toBe(202);
      const responseBody = JSON.parse(response2.payload);
      expect(responseBody.skipped).toBe(true);
    });

    it('posts "Starting analysis" comment on successful labeled event bootstrap', async () => {
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const mockCreateComment = vi.fn().mockResolvedValue({});
      const mockRun = vi.fn().mockResolvedValue(undefined);

      const fastifyForBootstrap = Fastify();
      await fastifyForBootstrap.register(rawBody, {
        field: 'rawBody',
        global: true,
        encoding: false,
        runFirst: true,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await fastifyForBootstrap.register(webhookRoute, {
        db,
        graph: { getState: vi.fn(), invoke: vi.fn(), run: mockRun } as any,
        octokit: {
          rest: { issues: { createComment: mockCreateComment } },
        } as any,
        owner: 'owner',
        repo: 'repo',
      });

      const payload = {
        action: 'labeled',
        issue: {
          number: 99,
          title: 'Add button component',
          body: 'A new button component is needed.',
          user: { login: 'owner-user' },
          author_association: 'OWNER',
          labels: [{ name: 'component' }],
        },
        label: { name: 'component' },
      };
      const rawBodyBuffer = Buffer.from(JSON.stringify(payload));

      const response = await fastifyForBootstrap.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: {
          'x-github-event': 'issues',
          'x-github-delivery': 'test-labeled-comment-bootstrap-1',
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
          'content-type': 'application/json',
        },
        payload: rawBodyBuffer,
      });

      expect(response.statusCode).toBe(202);
      expect(mockRun).toHaveBeenCalledWith('issue-99', {
        next_recipient: 'po',
        pause_context: null,
        rejectionCount: 0,
        signoffs: {},
        messages: [
          {
            type: 'human',
            content:
              'Issue #99: Add button component\n\nA new button component is needed.',
          },
        ],
      });
      expect(mockCreateComment).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 99,
        body: '✅ Starting analysis on #99 with **component** label',
      });

      await fastifyForBootstrap.close();
    });

    it('ignores non-labeled actions on issues event', async () => {
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const payload = {
        action: 'opened', // Not 'labeled'
        issue: {
          number: 99,
          title: 'Some issue',
          body: null,
          user: { login: 'owner-user' },
          author_association: 'OWNER',
          labels: [{ name: 'component' }],
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: {
          'x-github-event': 'issues',
          'x-github-delivery': 'test-labeled-action-1',
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
          'content-type': 'application/json',
        },
        payload: rawBody,
      });

      expect(response.statusCode).toBe(202);
      const responseBody = JSON.parse(response.payload);
      expect(responseBody.skipped).toBe(true);
    });

    it('labeled event on paused checkpoint: resets and invokes po', async () => {
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      // Mock a checkpoint with pause_context set and next_recipient null (paused state)
      const pausedCheckpoint = {
        messages: [],
        next_recipient: null,
        pause_context: 'refinement_limit',
        rejectionCount: 5,
        rejectionReason: 'max rejections reached',
        signoffs: { po: true, architect: false },
        mesh_origin: 'po',
        mesh_loop_count: 0,
      };

      // Mock graph.getState to return the paused checkpoint
      mockGraph.getState.mockResolvedValue(pausedCheckpoint);

      const payload = {
        action: 'labeled',
        issue: {
          number: 99,
          title: 'Add button component',
          body: 'A new button component is needed.',
          user: { login: 'owner-user' },
          author_association: 'OWNER',
          labels: [{ name: 'component' }],
        },
        label: { name: 'component' },
      };
      const rawBodyBuffer = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: {
          'x-github-event': 'issues',
          'x-github-delivery': 'test-labeled-paused-checkpoint-1',
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
          'content-type': 'application/json',
        },
        payload: rawBodyBuffer,
      });

      expect(response.statusCode).toBe(202);

      // Verify graph.run was called to restart the sequence with reset state
      expect(mockGraph.run).toHaveBeenCalledWith('issue-99', {
        next_recipient: 'po',
        pause_context: null,
        rejectionCount: 0,
        signoffs: {},
        messages: [
          {
            type: 'human',
            content:
              'Issue #99: Add button component\n\nA new button component is needed.',
          },
        ],
      });
    });

    it('labeled event on finished checkpoint: resets and invokes po', async () => {
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      // Mock a checkpoint that is finished (next_recipient and pause_context both null)
      const finishedCheckpoint = {
        messages: [],
        next_recipient: null,
        pause_context: null,
        rejectionCount: 0,
        rejectionReason: '',
        signoffs: {
          po: true,
          architect: true,
          dev: true,
          a11y: true,
          qa: true,
          docs: true,
        },
        mesh_origin: null,
        mesh_loop_count: 0,
      };

      // Mock graph.getState to return the finished checkpoint
      mockGraph.getState.mockResolvedValue(finishedCheckpoint);

      const payload = {
        action: 'labeled',
        issue: {
          number: 100,
          title: 'Fix form validation bug',
          body: 'The login form is not validating correctly.',
          user: { login: 'owner-user' },
          author_association: 'OWNER',
          labels: [{ name: 'component' }],
        },
        label: { name: 'component' },
      };
      const rawBodyBuffer = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: {
          'x-github-event': 'issues',
          'x-github-delivery': 'test-labeled-finished-checkpoint-1',
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
          'content-type': 'application/json',
        },
        payload: rawBodyBuffer,
      });

      expect(response.statusCode).toBe(202);

      // Verify graph.run was called to restart the sequence with reset state
      expect(mockGraph.run).toHaveBeenCalledWith('issue-100', {
        next_recipient: 'po',
        pause_context: null,
        rejectionCount: 0,
        signoffs: {},
        messages: [
          {
            type: 'human',
            content:
              'Issue #100: Fix form validation bug\n\nThe login form is not validating correctly.',
          },
        ],
      });
    });
  });

  describe('Phase 4: Label whitelist externalization via ALLOWED_BOOTSTRAP_LABELS env var', () => {
    it('accepts type: chore label as part of default whitelist', async () => {
      // This test verifies that 'type: chore' is now included in the default
      // ALLOWED_BOOTSTRAP_LABELS='component,bug,type: chore'
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const payload = {
        action: 'labeled',
        issue: {
          number: 99,
          title: 'Chore: update dependencies',
          body: 'Dependencies need updating.',
          user: { login: 'owner-user' },
          author_association: 'OWNER',
          labels: [{ name: 'type: chore' }],
        },
        label: { name: 'type: chore' },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: {
          'x-github-event': 'issues',
          'x-github-delivery': 'test-phase4-chore-1',
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
          'content-type': 'application/json',
        },
        payload: rawBody,
      });

      // Should trigger bootstrap (graph.run will be called)
      expect(response.statusCode).toBe(202);
      expect(mockGraph.run).toHaveBeenCalledWith('issue-99', {
        next_recipient: 'po',
        pause_context: null,
        rejectionCount: 0,
        signoffs: {},
        messages: [
          {
            type: 'human',
            content:
              'Issue #99: Chore: update dependencies\n\nDependencies need updating.',
          },
        ],
      });
    });

    it('normalizes mixed case labels (Type: Chore)', async () => {
      // GitHub returns labels exactly as they appear in UI
      // Test that mixed case 'Type: Chore' is normalized to 'type: chore' and matches
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const payload = {
        action: 'labeled',
        issue: {
          number: 100,
          title: 'Fix form validation bug',
          body: 'The login form is not validating correctly.',
          user: { login: 'owner-user' },
          author_association: 'OWNER',
          labels: [{ name: 'Type: Chore' }],
        },
        label: { name: 'Type: Chore' },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: {
          'x-github-event': 'issues',
          'x-github-delivery': 'test-phase4-case-normalize-1',
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
          'content-type': 'application/json',
        },
        payload: rawBody,
      });

      // Should trigger bootstrap after normalization
      expect(response.statusCode).toBe(202);
      expect(mockGraph.run).toHaveBeenCalledWith('issue-100', {
        next_recipient: 'po',
        pause_context: null,
        rejectionCount: 0,
        signoffs: {},
        messages: [
          {
            type: 'human',
            content:
              'Issue #100: Fix form validation bug\n\nThe login form is not validating correctly.',
          },
        ],
      });
    });

    it('rejects unlisted labels (documentation)', async () => {
      // Verify that labels not in default or env var are rejected
      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      const payload = {
        action: 'labeled',
        issue: {
          number: 101,
          title: 'Update documentation',
          body: null,
          user: { login: 'owner-user' },
          author_association: 'OWNER',
          labels: [{ name: 'documentation' }],
        },
        label: { name: 'documentation' },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: {
          'x-github-event': 'issues',
          'x-github-delivery': 'test-phase4-rejected-1',
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
          'content-type': 'application/json',
        },
        payload: rawBody,
      });

      // Should skip (not bootstrap)
      expect(response.statusCode).toBe(202);
      const responseBody = JSON.parse(response.payload);
      expect(responseBody.skipped).toBe(true);
      expect(mockGraph.run).not.toHaveBeenCalled();
    });

    it('respects custom ALLOWED_BOOTSTRAP_LABELS env var', async () => {
      // This test verifies that when ALLOWED_BOOTSTRAP_LABELS is set to a
      // custom value, only those labels trigger bootstrap
      const previousValue = process.env['ALLOWED_BOOTSTRAP_LABELS'];
      process.env['ALLOWED_BOOTSTRAP_LABELS'] = 'custom,labels';

      // Recreate fastify and register route with new env var value
      const fastifyCustom = Fastify();

      const dbCustom = new Database(':memory:');
      dbCustom.exec(`
        CREATE TABLE IF NOT EXISTS deliveries (
          delivery_id   TEXT    PRIMARY KEY,
          processed_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS webhook_sync (
          key    TEXT PRIMARY KEY,
          value  TEXT NOT NULL
        );
      `);

      await fastifyCustom.register(rawBody, {
        field: 'rawBody',
        global: true,
        encoding: false,
        runFirst: true,
      });

      const { handleApprove } = await import('../commands/approve');
      const { handleFix } = await import('../commands/fix');
      const { handleQuery } = await import('../commands/query');
      vi.mocked(handleApprove).mockResolvedValue(undefined);
      vi.mocked(handleFix).mockResolvedValue(undefined);
      vi.mocked(handleQuery).mockResolvedValue(undefined);

      const mockGraphCustom = {
        getState: vi.fn(),
        invoke: vi.fn(),
        run: vi.fn().mockResolvedValue(undefined),
      };

      await fastifyCustom.register(webhookRoute, {
        db: dbCustom,
        graph: mockGraphCustom as any,
        octokit: { rest: { issues: { createComment: vi.fn() } } } as any,
        owner: 'owner',
        repo: 'repo',
      });

      const { verifyHmac } = await import('../security/hmac');
      vi.mocked(verifyHmac).mockReturnValue(true);

      // Test that 'custom' label triggers bootstrap
      const payload = {
        action: 'labeled',
        issue: {
          number: 102,
          title: 'Custom feature request',
          body: 'A custom feature is required.',
          user: { login: 'owner-user' },
          author_association: 'OWNER',
          labels: [{ name: 'custom' }],
        },
        label: { name: 'custom' },
      };
      const rawBodyBuffer = Buffer.from(JSON.stringify(payload));

      const response = await fastifyCustom.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: {
          'x-github-event': 'issues',
          'x-github-delivery': 'test-phase4-custom-env-1',
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
          'content-type': 'application/json',
        },
        payload: rawBodyBuffer,
      });

      expect(response.statusCode).toBe(202);
      expect(mockGraphCustom.run).toHaveBeenCalledWith('issue-102', {
        next_recipient: 'po',
        pause_context: null,
        rejectionCount: 0,
        signoffs: {},
        messages: [
          {
            type: 'human',
            content:
              'Issue #102: Custom feature request\n\nA custom feature is required.',
          },
        ],
      });

      await fastifyCustom.close();

      // Restore previous env var value
      if (previousValue === undefined) {
        delete process.env['ALLOWED_BOOTSTRAP_LABELS'];
      } else {
        process.env['ALLOWED_BOOTSTRAP_LABELS'] = previousValue;
      }
    });
  });

  describe('Phase 3: Immediate UI Reactions (command feedback)', () => {
    it('adds reaction to issue comment before processing /approve command', async () => {
      const { verifyHmac } = await import('../security/hmac');
      const { handleApprove } = await import('../commands/approve');
      vi.mocked(verifyHmac).mockReturnValue(true);
      vi.mocked(handleApprove).mockResolvedValue(undefined);

      // Mock octokit to verify reaction creation
      const mockCreateReaction = vi.fn().mockResolvedValue({});
      const octokitWithReactions = {
        rest: {
          issues: { createComment: vi.fn() },
          reactions: { createForIssueComment: mockCreateReaction },
        },
      };

      const fastifyWithReactions = Fastify();
      await fastifyWithReactions.register(rawBody, {
        field: 'rawBody',
        global: true,
        encoding: false,
        runFirst: true,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await fastifyWithReactions.register(webhookRoute, {
        db,
        graph: {
          getState: vi.fn().mockReturnValue({}),
          invoke: vi.fn(),
        } as any,
        octokit: octokitWithReactions as any,
        owner: 'owner',
        repo: 'repo',
      });

      const payload = {
        action: 'created',
        issue: { number: 42 },
        comment: {
          id: 123,
          body: '/approve',
          user: { login: 'testuser' },
          author_association: 'OWNER',
        },
      };
      const rawBodyBuffer = Buffer.from(JSON.stringify(payload));

      const response = await fastifyWithReactions.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: makeHeaders({
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
        }),
        payload: rawBodyBuffer,
      });

      expect(response.statusCode).toBe(200);

      // Verify reaction was attempted (exact emoji may vary by command)
      expect(mockCreateReaction).toHaveBeenCalled();

      await fastifyWithReactions.close();
    });

    it('adds different reaction based on command type', async () => {
      const { verifyHmac } = await import('../security/hmac');
      const { handleFix } = await import('../commands/fix');
      vi.mocked(verifyHmac).mockReturnValue(true);
      vi.mocked(handleFix).mockResolvedValue(undefined);

      const mockCreateReaction = vi.fn().mockResolvedValue({});
      const octokitWithReactions = {
        rest: {
          issues: { createComment: vi.fn() },
          reactions: { createForIssueComment: mockCreateReaction },
        },
      };

      const fastifyWithReactions = Fastify();
      await fastifyWithReactions.register(rawBody, {
        field: 'rawBody',
        global: true,
        encoding: false,
        runFirst: true,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await fastifyWithReactions.register(webhookRoute, {
        db,
        graph: {
          getState: vi.fn().mockReturnValue({}),
          invoke: vi.fn(),
        } as any,
        octokit: octokitWithReactions as any,
        owner: 'owner',
        repo: 'repo',
      });

      const payload = {
        action: 'created',
        issue: { number: 42 },
        comment: {
          id: 456,
          body: '/fix provide more feedback',
          user: { login: 'testuser' },
          author_association: 'OWNER',
        },
      };
      const rawBodyBuffer = Buffer.from(JSON.stringify(payload));

      const response = await fastifyWithReactions.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: makeHeaders({
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
        }),
        payload: rawBodyBuffer,
      });

      expect(response.statusCode).toBe(200);
      expect(mockCreateReaction).toHaveBeenCalled();

      await fastifyWithReactions.close();
    });

    it('does not fail webhook if reaction API call fails', async () => {
      const { verifyHmac } = await import('../security/hmac');
      const { handleQuery } = await import('../commands/query');
      vi.mocked(verifyHmac).mockReturnValue(true);
      vi.mocked(handleQuery).mockResolvedValue(undefined);

      const mockCreateReaction = vi
        .fn()
        .mockRejectedValue(new Error('Reaction API failed'));
      const octokitWithReactions = {
        rest: {
          issues: { createComment: vi.fn() },
          reactions: { createForIssueComment: mockCreateReaction },
        },
      };

      const fastifyWithReactions = Fastify();
      await fastifyWithReactions.register(rawBody, {
        field: 'rawBody',
        global: true,
        encoding: false,
        runFirst: true,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await fastifyWithReactions.register(webhookRoute, {
        db,
        graph: {
          getState: vi.fn().mockReturnValue({}),
          invoke: vi.fn(),
        } as any,
        octokit: octokitWithReactions as any,
        owner: 'owner',
        repo: 'repo',
      });

      const payload = {
        action: 'created',
        issue: { number: 42 },
        comment: {
          id: 789,
          body: '/query what is the current status',
          user: { login: 'testuser' },
          author_association: 'OWNER',
        },
      };
      const rawBodyBuffer = Buffer.from(JSON.stringify(payload));

      const response = await fastifyWithReactions.inject({
        method: 'POST',
        url: '/api/webhook',
        headers: makeHeaders({
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
        }),
        payload: rawBodyBuffer,
      });

      // Webhook should still succeed even if reaction fails
      expect(response.statusCode).toBe(200);

      await fastifyWithReactions.close();
    });
  });
});
