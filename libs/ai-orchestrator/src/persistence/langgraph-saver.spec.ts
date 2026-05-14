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
  });
});
