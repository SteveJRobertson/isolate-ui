import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LangGraphSqliteSaver } from './langgraph-saver';
import type { RunnableConfig } from '@langchain/core/runnables';

function makeTempDb(): string {
  return path.join(
    os.tmpdir(),
    `saver-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
}

function makeConfig(threadId: string): RunnableConfig {
  return { configurable: { thread_id: threadId } };
}

function makeCheckpoint(id: string) {
  return {
    v: 4,
    id,
    ts: new Date().toISOString(),
    channel_values: { messages: [] },
    channel_versions: {},
    versions_seen: {},
    pending_sends: [],
  };
}

function makeMetadata() {
  return { source: 'input' as const, step: 0, writes: {}, parents: {} };
}

describe('LangGraphSqliteSaver', () => {
  let saver: LangGraphSqliteSaver;
  let dbPath: string;
  const tempFiles: string[] = [];

  beforeEach(() => {
    dbPath = makeTempDb();
    tempFiles.push(dbPath);
    saver = new LangGraphSqliteSaver(dbPath);
  });

  afterEach(() => {
    saver.close();
    tempFiles.forEach((f) => {
      try {
        fs.unlinkSync(f);
      } catch {
        // ignore
      }
    });
    tempFiles.length = 0;
  });

  describe('getTuple', () => {
    it('returns undefined when no checkpoint exists for the thread', async () => {
      const result = await saver.getTuple(makeConfig('nonexistent-thread'));
      expect(result).toBeUndefined();
    });

    it('returns a CheckpointTuple object (not an array)', async () => {
      const config = makeConfig('thread-1');
      const checkpoint = makeCheckpoint('ckpt-1');
      const metadata = makeMetadata();

      await saver.put(config, checkpoint, metadata, {});

      const result = await saver.getTuple(config);

      // Must be an object, not an array
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(false);
      expect(typeof result).toBe('object');
    });

    it('returns CheckpointTuple with required config field', async () => {
      const config = makeConfig('thread-2');
      const checkpoint = makeCheckpoint('ckpt-2');
      const metadata = makeMetadata();

      await saver.put(config, checkpoint, metadata, {});

      const tuple = await saver.getTuple(config);

      // LangGraph 1.3.0 reads tuple.config.configurable to find thread_id
      expect(tuple).toHaveProperty('config');
      expect(tuple?.config).toHaveProperty('configurable');
      expect((tuple?.config?.configurable as any)?.['thread_id']).toBe(
        'thread-2',
      );
    });

    it('returns CheckpointTuple with checkpoint field', async () => {
      const config = makeConfig('thread-3');
      const checkpoint = makeCheckpoint('ckpt-3');
      const metadata = makeMetadata();

      await saver.put(config, checkpoint, metadata, {});

      const tuple = await saver.getTuple(config);

      expect(tuple).toHaveProperty('checkpoint');
      expect(tuple?.checkpoint?.id).toBe('ckpt-3');
    });

    it('returns CheckpointTuple with metadata field', async () => {
      const config = makeConfig('thread-4');
      const checkpoint = makeCheckpoint('ckpt-4');
      const metadata = makeMetadata();

      await saver.put(config, checkpoint, metadata, {});

      const tuple = await saver.getTuple(config);

      expect(tuple).toHaveProperty('metadata');
      expect(tuple?.metadata?.source).toBe('input');
    });

    it('returns pendingWrites as CheckpointPendingWrite[] tuples', async () => {
      const config = makeConfig('thread-5');
      const checkpoint = makeCheckpoint('ckpt-5');
      const metadata = makeMetadata();

      await saver.put(config, checkpoint, metadata, {});

      // putWrites now takes (config, writes, taskId)
      const writeConfig = {
        configurable: { thread_id: 'thread-5', checkpoint_id: 'ckpt-5' },
      };
      await saver.putWrites(writeConfig, [['messages', ['hello']]], 'task-1');

      const tuple = await saver.getTuple(config);

      // pendingWrites must be [taskId, channel, value][] — not [channel, value][]
      expect(tuple?.pendingWrites).toBeDefined();
      expect(Array.isArray(tuple?.pendingWrites)).toBe(true);
      if (tuple?.pendingWrites?.length) {
        const [taskId, channel] = tuple.pendingWrites[0];
        expect(typeof taskId).toBe('string');
        expect(typeof channel).toBe('string');
      }
    });

    it('returns specific checkpoint when config.configurable.checkpoint_id is provided', async () => {
      const config = makeConfig('thread-specific');
      const checkpointA = makeCheckpoint('ckpt-a');
      const checkpointB = makeCheckpoint('ckpt-b');
      const metadata = makeMetadata();

      // Put two checkpoints for the same thread — ckpt-b is the latest
      await saver.put(config, checkpointA, metadata, {});
      await saver.put(config, checkpointB, metadata, {});

      // Request the older checkpoint by explicit checkpoint_id
      const specificConfig: RunnableConfig = {
        configurable: { thread_id: 'thread-specific', checkpoint_id: 'ckpt-a' },
      };
      const tuple = await saver.getTuple(specificConfig);

      // Must return ckpt-a, not the latest ckpt-b
      expect(tuple).toBeDefined();
      expect(tuple?.checkpoint?.id).toBe('ckpt-a');
      // The returned config must echo back the requested checkpoint_id
      expect((tuple?.config?.configurable as any)?.['checkpoint_id']).toBe(
        'ckpt-a',
      );
    });

    it('returns undefined when a specific checkpoint_id is provided but not found', async () => {
      const config = makeConfig('thread-specific-miss');
      const checkpoint = makeCheckpoint('ckpt-exists');
      const metadata = makeMetadata();

      await saver.put(config, checkpoint, metadata, {});

      // Request a checkpoint_id that was never stored
      const missConfig: RunnableConfig = {
        configurable: {
          thread_id: 'thread-specific-miss',
          checkpoint_id: 'ckpt-does-not-exist',
        },
      };
      const result = await saver.getTuple(missConfig);

      expect(result).toBeUndefined();
    });

    it('rejects when the latest checkpoint statement throws', async () => {
      const originalStmt = (saver as any).stmtGetLatest;
      const expectedError = new Error('DB Locked');
      (saver as any).stmtGetLatest = {
        get: () => {
          throw expectedError;
        },
      };

      try {
        await expect(
          saver.getTuple(makeConfig('thread-db-error')),
        ).rejects.toBe(expectedError);
      } finally {
        (saver as any).stmtGetLatest = originalStmt;
      }
    });
  });

  describe('put', () => {
    it('returns a RunnableConfig (not void)', async () => {
      const config = makeConfig('thread-put-1');
      const checkpoint = makeCheckpoint('ckpt-put-1');
      const metadata = makeMetadata();

      const result = await saver.put(config, checkpoint, metadata, {});

      // LangGraph 1.3.0 put must return RunnableConfig
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      expect(result).toHaveProperty('configurable');
    });

    it('returned RunnableConfig contains thread_id and checkpoint_id', async () => {
      const config = makeConfig('thread-put-2');
      const checkpoint = makeCheckpoint('ckpt-put-2');
      const metadata = makeMetadata();

      const result = await saver.put(config, checkpoint, metadata, {});

      expect((result.configurable as any)?.['thread_id']).toBe('thread-put-2');
      expect((result.configurable as any)?.['checkpoint_id']).toBe(
        'ckpt-put-2',
      );
    });
  });

  describe('putWrites', () => {
    it('accepts taskId as third argument (not checkpointId)', async () => {
      const config = makeConfig('thread-writes-1');
      const checkpoint = makeCheckpoint('ckpt-writes-1');
      const metadata = makeMetadata();

      await saver.put(config, checkpoint, metadata, {});

      // New signature: putWrites(config, writes: PendingWrite[], taskId: string)
      // PendingWrite = [channel, value]
      const writeConfig = {
        configurable: {
          thread_id: 'thread-writes-1',
          checkpoint_id: 'ckpt-writes-1',
        },
      };
      await expect(
        saver.putWrites(writeConfig, [['messages', ['msg']]], 'task-abc'),
      ).resolves.not.toThrow();
    });

    it('throws when checkpoint_id is missing from config', async () => {
      // Per error-path testing: ensure putWrites rejects if checkpoint_id is absent
      // (caller forgot to call put() first or pass the wrong config)
      const configMissingCheckpointId = {
        configurable: {
          thread_id: 'thread-writes-2',
          // checkpoint_id intentionally missing
        },
      };

      await expect(
        saver.putWrites(
          configMissingCheckpointId,
          [['messages', ['msg']]],
          'task-xyz',
        ),
      ).rejects.toThrow('checkpoint_id is required');
    });
  });

  describe('list', () => {
    it('is an async generator that yields CheckpointTuples', async () => {
      const config = makeConfig('thread-list-1');
      const checkpoint = makeCheckpoint('ckpt-list-1');
      const metadata = makeMetadata();

      await saver.put(config, checkpoint, metadata, {});

      const results: unknown[] = [];
      for await (const tuple of saver.list(config)) {
        results.push(tuple);
      }

      expect(results.length).toBeGreaterThan(0);
      // Each result must be a CheckpointTuple object
      const first = results[0] as any;
      expect(Array.isArray(first)).toBe(false);
      expect(first).toHaveProperty('config');
      expect(first).toHaveProperty('checkpoint');
    });

    it('yields no results for an unknown thread', async () => {
      const results: unknown[] = [];
      for await (const tuple of saver.list(makeConfig('unknown-thread'))) {
        results.push(tuple);
      }
      expect(results).toHaveLength(0);
    });

    it('rejects (async generator error path) when statement.all() throws', async () => {
      // Per repo testing guidelines, error-path tests required for exported async APIs.
      // Mock the underlying stmtGetAllByThread to throw an error and verify
      // the async generator properly propagates the rejection.
      const config = makeConfig('thread-error');
      const checkpoint = makeCheckpoint('ckpt-error');
      const metadata = makeMetadata();

      await saver.put(config, checkpoint, metadata, {});

      // Monkey-patch the private stmtGetAllByThread to throw
      const originalStmt = (saver as any).stmtGetAllByThread;
      (saver as any).stmtGetAllByThread = {
        all: () => {
          throw new Error('Database error: simulated failure');
        },
      };

      try {
        // Attempt to iterate the generator — should raise the error
        const generator = saver.list(config);
        await generator.next(); // First call triggers the .all() error
        // If we get here, the test should fail
        throw new Error('Expected list() to raise on generator iteration');
      } catch (err) {
        expect((err as Error).message).toContain('Database error');
      } finally {
        // Restore original statement
        (saver as any).stmtGetAllByThread = originalStmt;
      }
    });
  });
});
