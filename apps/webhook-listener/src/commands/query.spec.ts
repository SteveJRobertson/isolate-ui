import { describe, it, beforeEach, expect, vi } from 'vitest';
import { handleQuery } from './query';
import { CommandContext } from './context';

vi.mock('./context', () => ({
  postErrorReply: vi.fn(),
}));

describe('handleQuery', () => {
  let ctx;
  let graph;

  beforeEach(() => {
    graph = {
      getState: vi.fn(),
      invoke: vi.fn(),
    };

    ctx = {
      graph,
      threadId: 'issue-1',
      issueNumber: 1,
      username: 'user',
      db: null,
      octokit: null,
      owner: 'owner',
      repo: 'repo',
    } as unknown as CommandContext;
  });

  it('posts error reply when question is empty', async () => {
    const { postErrorReply } = await import('./context');

    await handleQuery(ctx, '');

    expect(postErrorReply).toHaveBeenCalledWith(
      ctx,
      expect.stringContaining('Usage'),
    );
  });

  it('posts error reply when no checkpoint exists', async () => {
    const { postErrorReply } = await import('./context');
    graph.getState.mockReturnValue(null);

    await handleQuery(ctx, 'question');

    expect(postErrorReply).toHaveBeenCalledWith(
      ctx,
      expect.stringContaining('No active thread'),
    );
  });

  it('invokes graph with next_recipient when set', async () => {
    graph.getState.mockReturnValue({ next_recipient: 'dev' });

    await handleQuery(ctx, 'question');

    expect(graph.invoke).toHaveBeenCalledWith(
      'issue-1',
      expect.objectContaining({ next_recipient: 'dev' }),
    );
  });

  it('falls back to po when next_recipient is null (paused)', async () => {
    graph.getState.mockReturnValue({ next_recipient: null });

    await handleQuery(ctx, 'question');

    expect(graph.invoke).toHaveBeenCalledWith(
      'issue-1',
      expect.objectContaining({ next_recipient: 'po' }),
    );
  });
});
