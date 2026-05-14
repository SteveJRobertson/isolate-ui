import { describe, it, beforeEach, expect, vi } from 'vitest';
import { handleApprove } from './approve';
import { CommandContext } from './context';

vi.mock('./context', () => ({
  postErrorReply: vi.fn(),
}));

describe('handleApprove', () => {
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

  it('posts error reply when no checkpoint exists', async () => {
    const { postErrorReply } = await import('./context');
    graph.getState.mockReturnValue(null);

    await handleApprove(ctx);

    expect(postErrorReply).toHaveBeenCalledWith(
      ctx,
      expect.stringContaining('No active thread'),
    );
  });

  it('posts error reply when pause_context is null', async () => {
    const { postErrorReply } = await import('./context');
    graph.getState.mockReturnValue({ pause_context: null });

    await handleApprove(ctx);

    expect(postErrorReply).toHaveBeenCalledWith(
      ctx,
      expect.stringContaining('not currently paused'),
    );
  });

  it('resumes at mesh_origin when pause_context is mesh_stalemate', async () => {
    graph.getState.mockReturnValue({
      pause_context: 'mesh_stalemate',
      mesh_origin: 'dev',
    });

    await handleApprove(ctx);

    expect(graph.invoke).toHaveBeenCalledWith(
      'issue-1',
      expect.objectContaining({ next_recipient: 'dev' }),
    );
  });

  it('resumes at po when pause_context is refinement_limit', async () => {
    graph.getState.mockReturnValue({ pause_context: 'refinement_limit' });

    await handleApprove(ctx);

    expect(graph.invoke).toHaveBeenCalledWith(
      'issue-1',
      expect.objectContaining({ next_recipient: 'po' }),
    );
  });
});
