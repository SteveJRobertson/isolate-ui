import { describe, it, expect, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { SqliteSaver } from '../persistence';
import { DEFAULT_AGENT_STATE } from '../schema';

// Use a unique temp directory for each test database so parallel runs don't collide
function tempDbPath(): string {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ai-orchestrator-test-'),
  );
  return path.join(tempDir, 'checkpoint.db');
}

describe('SqliteSaver', () => {
  const dbs: SqliteSaver[] = [];

  afterEach(() => {
    dbs.forEach((db) => db.close());
    dbs.length = 0;
  });

  it('creates the database and schema on init', () => {
    const dbPath = tempDbPath();
    const saver = new SqliteSaver(dbPath);
    dbs.push(saver);

    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it('saves and retrieves state by thread ID', () => {
    const saver = new SqliteSaver(tempDbPath());
    dbs.push(saver);

    const state = {
      ...DEFAULT_AGENT_STATE,
      next_recipient: 'architect',
      code_buffer: 'const x = 1;',
    };

    saver.save('issue-23', state, 'po');

    const retrieved = saver.get('issue-23');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.next_recipient).toBe('architect');
    expect(retrieved?.code_buffer).toBe('const x = 1;');
  });

  it('returns null for unknown thread IDs', () => {
    const saver = new SqliteSaver(tempDbPath());
    dbs.push(saver);

    expect(saver.get('does-not-exist')).toBeNull();
  });

  it('updates existing state on repeated saves', () => {
    const saver = new SqliteSaver(tempDbPath());
    dbs.push(saver);

    saver.save('thread-1', { ...DEFAULT_AGENT_STATE, next_recipient: 'po' });
    saver.save('thread-1', {
      ...DEFAULT_AGENT_STATE,
      next_recipient: 'architect',
    });

    const retrieved = saver.get('thread-1');
    expect(retrieved?.next_recipient).toBe('architect');
  });

  it('tracks step count across saves', () => {
    const saver = new SqliteSaver(tempDbPath());
    dbs.push(saver);

    saver.save('thread-2', { ...DEFAULT_AGENT_STATE, next_recipient: 'po' });
    saver.save('thread-2', {
      ...DEFAULT_AGENT_STATE,
      next_recipient: 'architect',
    });
    saver.save('thread-2', { ...DEFAULT_AGENT_STATE, next_recipient: 'dev' });

    const retrieved = saver.get('thread-2');
    expect(retrieved?.step_count).toBe(3);
  });

  it('records history with agent IDs', () => {
    const saver = new SqliteSaver(tempDbPath());
    dbs.push(saver);

    saver.save(
      'issue-99',
      { ...DEFAULT_AGENT_STATE, next_recipient: 'po' },
      'po',
    );
    saver.save(
      'issue-99',
      { ...DEFAULT_AGENT_STATE, next_recipient: 'architect' },
      'architect',
    );

    const history = saver.getHistory('issue-99');
    expect(history.length).toBe(2);
    expect(history[0].agent_id).toBe('po');
    expect(history[1].agent_id).toBe('architect');
  });

  it('retrieves state at a specific step', () => {
    const saver = new SqliteSaver(tempDbPath());
    dbs.push(saver);

    saver.save('issue-5', {
      ...DEFAULT_AGENT_STATE,
      next_recipient: 'po',
      code_buffer: 'step-0',
    });
    saver.save('issue-5', {
      ...DEFAULT_AGENT_STATE,
      next_recipient: 'dev',
      code_buffer: 'step-1',
    });

    const stepOne = saver.getAtStep('issue-5', 1);
    expect(stepOne?.code_buffer).toBe('step-0');

    const stepTwo = saver.getAtStep('issue-5', 2);
    expect(stepTwo?.code_buffer).toBe('step-1');
  });

  it('lists all thread IDs', () => {
    const saver = new SqliteSaver(tempDbPath());
    dbs.push(saver);

    saver.save('thread-a', DEFAULT_AGENT_STATE);
    saver.save('thread-b', DEFAULT_AGENT_STATE);

    const threads = saver.listThreads();
    expect(threads).toContain('thread-a');
    expect(threads).toContain('thread-b');
  });

  it('deletes a thread and its history', () => {
    const saver = new SqliteSaver(tempDbPath());
    dbs.push(saver);

    saver.save('to-delete', DEFAULT_AGENT_STATE, 'po');
    expect(saver.get('to-delete')).not.toBeNull();

    saver.deleteThread('to-delete');
    expect(saver.get('to-delete')).toBeNull();
    expect(saver.getHistory('to-delete')).toHaveLength(0);
  });
});
