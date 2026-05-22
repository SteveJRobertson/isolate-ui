import { describe, it, beforeEach, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { runStartupSync } from './startup';

vi.mock('../commands/approve');
vi.mock('../commands/fix');
vi.mock('../commands/query');

describe('runStartupSync', () => {
  let db;
  let graph: { getState: Mock; invoke: Mock };
  let octokit: { paginate: Mock; issues: { listComments: Mock } };

  // Helper for inserting checkpoints (module scope)
  function insertCheckpoint(
    db: DatabaseType,
    threadId: string,
    checkpointBody: string,
    sequenceNum = 1,
  ) {
    db.prepare(
      `
    INSERT INTO checkpoints (thread_id, checkpoint_id, checkpoint_body, metadata_body, sequence)
    VALUES (?, ?, ?, ?, ?)
  `,
    ).run(
      threadId,
      `checkpoint-${threadId}-${sequenceNum}`,
      checkpointBody,
      '{}',
      sequenceNum,
    );
  }

  beforeEach(() => {
    db = new Database(':memory:');
    // Initialize schema (full checkpoints schema)
    db.exec(`
      CREATE TABLE deliveries (delivery_id TEXT PRIMARY KEY);
      CREATE TABLE webhook_sync (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE startup_lock (
        lock_id      TEXT     PRIMARY KEY,
        acquired_at  INTEGER  NOT NULL,
        expires_at   INTEGER  NOT NULL
      );
      CREATE TABLE checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_id TEXT NOT NULL,
        checkpoint_body BLOB NOT NULL,
        metadata_body BLOB NOT NULL,
        sequence INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (thread_id, checkpoint_id)
      );
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

  it('processes only paused threads (pause_context)', async () => {
    // thread-1: paused, thread-2: not paused
    insertCheckpoint(
      db,
      'issue-1',
      JSON.stringify({ channel_values: { pause_context: 'refinement_limit' } }),
      1,
    );
    insertCheckpoint(
      db,
      'issue-2',
      JSON.stringify({ channel_values: { pause_context: null } }),
      1,
    );
    octokit.paginate.mockResolvedValue([]);
    await runStartupSync(db, graph as any, octokit as any, 'owner', 'repo');
    // Only issue-1 should be processed
    expect(octokit.paginate).toHaveBeenCalledTimes(1);
    expect(octokit.paginate.mock.calls[0][1].issue_number).toBe(1);
  });

  it('processes both legacy and channel_values formats', async () => {
    // thread-1: legacy flat format, thread-2: channel_values format
    insertCheckpoint(
      db,
      'issue-1',
      JSON.stringify({ pause_context: 'mesh_stalemate' }),
      1,
    );
    insertCheckpoint(
      db,
      'issue-2',
      JSON.stringify({ channel_values: { pause_context: 'refinement_limit' } }),
      1,
    );
    octokit.paginate.mockResolvedValue([]);
    await runStartupSync(db, graph as any, octokit as any, 'owner', 'repo');
    // Both should be processed
    expect(octokit.paginate).toHaveBeenCalledTimes(2);
    const calledIssues = octokit.paginate.mock.calls
      .map((call) => call[1].issue_number)
      .sort();
    expect(calledIssues).toEqual([1, 2]);
  });

  it('processes only paused threads with multiple pause contexts', async () => {
    // thread-1, thread-2: paused with different pause_context values
    // thread-3, thread-4: not paused (pause_context = null)
    insertCheckpoint(
      db,
      'issue-1',
      JSON.stringify({ channel_values: { pause_context: 'refinement_limit' } }),
      1,
    );
    insertCheckpoint(
      db,
      'issue-2',
      JSON.stringify({ channel_values: { pause_context: 'mesh_stalemate' } }),
      1,
    );
    insertCheckpoint(
      db,
      'issue-3',
      JSON.stringify({ channel_values: { pause_context: null } }),
      1,
    );
    insertCheckpoint(
      db,
      'issue-4',
      JSON.stringify({ channel_values: { pause_context: null } }),
      1,
    );
    octokit.paginate.mockResolvedValue([]);
    await runStartupSync(db, graph as any, octokit as any, 'owner', 'repo');
    // Only issue-1 and issue-2 should be processed
    expect(octokit.paginate).toHaveBeenCalledTimes(2);
    const calledIssues = octokit.paginate.mock.calls
      .map((call) => call[1].issue_number)
      .sort();
    expect(calledIssues).toEqual([1, 2]);
  });

  it('skips malformed checkpoint_body but processes valid ones', async () => {
    // thread-1: malformed, thread-2: valid
    insertCheckpoint(db, 'issue-1', '{not valid json}', 1);
    insertCheckpoint(
      db,
      'issue-2',
      JSON.stringify({ channel_values: { pause_context: 'refinement_limit' } }),
      1,
    );
    octokit.paginate.mockResolvedValue([]);
    await runStartupSync(db, graph as any, octokit as any, 'owner', 'repo');
    // Only valid one should be processed
    expect(octokit.paginate).toHaveBeenCalledTimes(1);
    expect(octokit.paginate.mock.calls[0][1].issue_number).toBe(2);
  });

  it('handles zero checkpoints without error', async () => {
    // No checkpoints inserted
    octokit.paginate.mockResolvedValue([]);
    await runStartupSync(db, graph as any, octokit as any, 'owner', 'repo');

    expect(octokit.paginate).not.toHaveBeenCalled();
  });

  it('uses default sync window when no cursor exists', async () => {
    insertCheckpoint(
      db,
      'issue-1',
      JSON.stringify({ channel_values: { pause_context: 'refinement_limit' } }),
      1,
    );
    octokit.paginate.mockResolvedValue([]);
    await runStartupSync(db, graph as any, octokit as any, 'owner', 'repo');
    expect(octokit.paginate).toHaveBeenCalled();
  });

  it('skips already-processed deliveries', async () => {
    insertCheckpoint(
      db,
      'issue-1',
      JSON.stringify({ channel_values: { pause_context: 'refinement_limit' } }),
      1,
    );
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
    expect(octokit.paginate).toHaveBeenCalled();
  });

  it('skips edited comments', async () => {
    insertCheckpoint(
      db,
      'issue-1',
      JSON.stringify({ channel_values: { pause_context: 'refinement_limit' } }),
      1,
    );
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
    const deliveries = db.prepare('SELECT * FROM deliveries').all();
    expect(deliveries).toHaveLength(0);
  });

  it('deletes delivery row for unauthorized users', async () => {
    insertCheckpoint(
      db,
      'issue-1',
      JSON.stringify({ channel_values: { pause_context: 'refinement_limit' } }),
      1,
    );
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
    const deliveries = db.prepare('SELECT * FROM deliveries').all();
    expect(deliveries).toHaveLength(0);
  });

  it('advances cursor to latest seen comment', async () => {
    insertCheckpoint(
      db,
      'issue-1',
      JSON.stringify({ channel_values: { pause_context: 'refinement_limit' } }),
      1,
    );
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
    insertCheckpoint(
      db,
      'issue-1',
      JSON.stringify({ channel_values: { pause_context: 'refinement_limit' } }),
      1,
    );
    octokit.paginate.mockRejectedValue(new Error('API error'));
    await runStartupSync(db, graph as any, octokit as any, 'owner', 'repo');
    const sync = db
      .prepare('SELECT value FROM webhook_sync WHERE key = ?')
      .get('last_sync_time') as any;
    expect(sync).toBeUndefined();
  });

  it('handles empty scan window gracefully', async () => {
    insertCheckpoint(
      db,
      'issue-1',
      JSON.stringify({ channel_values: { pause_context: 'refinement_limit' } }),
      1,
    );
    octokit.paginate.mockResolvedValue([]);
    await runStartupSync(db, graph as any, octokit as any, 'owner', 'repo');
    const sync = db
      .prepare('SELECT value FROM webhook_sync WHERE key = ?')
      .get('last_sync_time') as any;
    expect(sync).toBeUndefined(); // Cursor not advanced when no comments seen
  });

  describe('advisory lock', () => {
    it('acquires the lock before running sync and releases it after', async () => {
      insertCheckpoint(
        db,
        'issue-1',
        JSON.stringify({
          channel_values: { pause_context: 'refinement_limit' },
        }),
        1,
      );
      octokit.paginate.mockResolvedValue([]);

      await runStartupSync(db, graph as any, octokit as any, 'owner', 'repo');

      // Lock should be released after sync completes
      const lock = db
        .prepare('SELECT lock_id FROM startup_lock WHERE lock_id = ?')
        .get('startup_sync');
      expect(lock).toBeUndefined();
    });

    it('skips sync with a warning when another instance holds the lock', async () => {
      // Simulate another instance holding the lock
      const expiresAt = Date.now() + 300_000;
      db.prepare(
        'INSERT INTO startup_lock (lock_id, acquired_at, expires_at) VALUES (?, ?, ?)',
      ).run('startup_sync', Date.now(), expiresAt);

      insertCheckpoint(
        db,
        'issue-1',
        JSON.stringify({
          channel_values: { pause_context: 'refinement_limit' },
        }),
        1,
      );

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await runStartupSync(db, graph as any, octokit as any, 'owner', 'repo');

      // Sync should have been skipped — no paginate calls
      expect(octokit.paginate).not.toHaveBeenCalled();
      // Warning should have been logged
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('startup sync skipped'),
      );

      warnSpy.mockRestore();
    });

    it('releases the lock even when sync throws an error', async () => {
      insertCheckpoint(
        db,
        'issue-1',
        JSON.stringify({
          channel_values: { pause_context: 'refinement_limit' },
        }),
        1,
      );
      octokit.paginate.mockRejectedValue(new Error('network failure'));

      await runStartupSync(db, graph as any, octokit as any, 'owner', 'repo');

      // Lock should be released even though sync threw
      const lock = db
        .prepare('SELECT lock_id FROM startup_lock WHERE lock_id = ?')
        .get('startup_sync');
      expect(lock).toBeUndefined();
    });

    it('allows the second instance to acquire lock after first releases it', async () => {
      octokit.paginate.mockResolvedValue([]);

      await runStartupSync(db, graph as any, octokit as any, 'owner', 'repo');
      // First call: no checkpoints — lock released
      const lockAfterFirst = db
        .prepare('SELECT lock_id FROM startup_lock WHERE lock_id = ?')
        .get('startup_sync');
      expect(lockAfterFirst).toBeUndefined();

      // Second call should succeed (lock available)
      await runStartupSync(db, graph as any, octokit as any, 'owner', 'repo');
      // Still released
      const lockAfterSecond = db
        .prepare('SELECT lock_id FROM startup_lock WHERE lock_id = ?')
        .get('startup_sync');
      expect(lockAfterSecond).toBeUndefined();
    });
  });
});
