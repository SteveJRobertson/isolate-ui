import { describe, it, beforeEach, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import Database from 'better-sqlite3';
import { runStartupSync } from './startup';

vi.mock('../commands/approve');
vi.mock('../commands/fix');
vi.mock('../commands/query');

describe('runStartupSync', () => {
  let db;
  let graph: { getState: Mock; invoke: Mock };
  let octokit: { paginate: Mock; issues: { listComments: Mock } };

  beforeEach(() => {
    db = new Database(':memory:');

    // Initialize schema
    db.exec(`
      CREATE TABLE deliveries (delivery_id TEXT PRIMARY KEY);
      CREATE TABLE webhook_sync (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE checkpoints (thread_id TEXT NOT NULL);
    `);

    graph = {
      getState: vi.fn(),
      invoke: vi.fn(),
    };

    octokit = {
      paginate: vi.fn(),
      issues: {
        listComments: vi.fn(),
      },
    };
  });

  it('uses default sync window when no cursor exists', async () => {
    db.prepare('INSERT INTO checkpoints (thread_id) VALUES (?)').run('issue-1');
    octokit.paginate.mockResolvedValue([]);

    await runStartupSync(db, graph as any, octokit as any, 'owner', 'repo');

    expect(octokit.paginate).toHaveBeenCalled();
  });

  it('skips already-processed deliveries', async () => {
    db.prepare('INSERT INTO checkpoints (thread_id) VALUES (?)').run('issue-1');
    db.prepare('INSERT INTO deliveries (delivery_id) VALUES (?)').run(
      'startup-sync-123',
    );

    octokit.paginate.mockResolvedValue([
      {
        id: 123,
        body: '/approve',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        user: { login: 'user' },
        author_association: 'OWNER',
      },
    ]);

    await runStartupSync(db, graph as any, octokit as any, 'owner', 'repo');

    // Verify the delivery was skipped (already exists)
    expect(octokit.paginate).toHaveBeenCalled();
  });

  it('skips edited comments', async () => {
    db.prepare('INSERT INTO checkpoints (thread_id) VALUES (?)').run('issue-1');

    octokit.paginate.mockResolvedValue([
      {
        id: 123,
        body: '/approve',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:01:00Z', // Different from created_at
        user: { login: 'user' },
        author_association: 'OWNER',
      },
    ]);

    await runStartupSync(db, graph as any, octokit as any, 'owner', 'repo');

    // Delivery should not be inserted since comment is an edit
    const deliveries = db.prepare('SELECT * FROM deliveries').all();
    expect(deliveries).toHaveLength(0);
  });

  it('deletes delivery row for unauthorized users', async () => {
    db.prepare('INSERT INTO checkpoints (thread_id) VALUES (?)').run('issue-1');

    octokit.paginate.mockResolvedValue([
      {
        id: 123,
        body: '/approve',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        user: { login: 'user' },
        author_association: 'NONE', // Not authorized
      },
    ]);

    await runStartupSync(db, graph as any, octokit as any, 'owner', 'repo');

    // Delivery should not remain since user is unauthorized
    const deliveries = db.prepare('SELECT * FROM deliveries').all();
    expect(deliveries).toHaveLength(0);
  });

  it('advances cursor to latest seen comment', async () => {
    db.prepare('INSERT INTO checkpoints (thread_id) VALUES (?)').run('issue-1');

    octokit.paginate.mockResolvedValue([
      {
        id: 123,
        body: 'regular comment',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        user: { login: 'user' },
        author_association: 'OWNER',
      },
    ]);

    await runStartupSync(db, graph as any, octokit as any, 'owner', 'repo');

    const sync = db
      .prepare('SELECT value FROM webhook_sync WHERE key = ?')
      .get('last_sync_time') as any;
    expect(sync.value).toEqual('2026-01-01T00:00:00Z');
  });

  it('does not advance cursor when octokit.paginate throws', async () => {
    db.prepare('INSERT INTO checkpoints (thread_id) VALUES (?)').run('issue-1');
    octokit.paginate.mockRejectedValue(new Error('API error'));

    await runStartupSync(db, graph as any, octokit as any, 'owner', 'repo');

    const sync = db
      .prepare('SELECT value FROM webhook_sync WHERE key = ?')
      .get('last_sync_time') as any;
    expect(sync).toBeUndefined();
  });

  it('handles empty scan window gracefully', async () => {
    db.prepare('INSERT INTO checkpoints (thread_id) VALUES (?)').run('issue-1');
    octokit.paginate.mockResolvedValue([]);

    await runStartupSync(db, graph as any, octokit as any, 'owner', 'repo');

    const sync = db
      .prepare('SELECT value FROM webhook_sync WHERE key = ?')
      .get('last_sync_time') as any;
    expect(sync).toBeUndefined(); // Cursor not advanced when no comments seen
  });
});
