import { describe, it, beforeEach, expect, vi } from 'vitest';
import { handleFix } from './fix';
import { makeCommandContext } from '../__tests__/test-helpers';

vi.mock('./context', () => ({
  postErrorReply: vi.fn(),
}));

describe('handleFix', () => {
  let graph;
  let ctx;

  beforeEach(() => {
    vi.clearAllMocks();
    graph = { getState: vi.fn(), invoke: vi.fn() };
    ctx = makeCommandContext({ graph });
  });

  it('posts error reply when feedback is empty', async () => {
    const { postErrorReply } = await import('./context');

    await handleFix(ctx, '');

    expect(postErrorReply).toHaveBeenCalledWith(
      ctx,
      expect.stringContaining('Usage'),
    );
  });

  it('posts error reply when no checkpoint exists', async () => {
    const { postErrorReply } = await import('./context');
    graph.getState.mockReturnValue(null);

    await handleFix(ctx, 'feedback');

    expect(postErrorReply).toHaveBeenCalledWith(
      ctx,
      expect.stringContaining('No active thread'),
    );
  });

  it('posts error reply when pause_context is null', async () => {
    const { postErrorReply } = await import('./context');
    graph.getState.mockReturnValue({ pause_context: null });

    await handleFix(ctx, 'feedback');

    expect(postErrorReply).toHaveBeenCalledWith(
      ctx,
      expect.stringContaining('not currently paused'),
    );
  });

  it('invokes graph with valid feedback and paused thread', async () => {
    graph.getState.mockReturnValue({ pause_context: 'refinement_limit' });

    await handleFix(ctx, 'feedback');

    expect(graph.invoke).toHaveBeenCalledWith(
      'issue-1',
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ content: 'feedback', type: 'human' }),
        ]),
      }),
    );
  });
});
