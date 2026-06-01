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

  describe('Phase 2: Command Bootstrapping', () => {
    it('bootstraps new thread when no checkpoint exists', async () => {
      graph.run = vi.fn().mockResolvedValue(undefined);
      // First call: null (no checkpoint, needs bootstrap).
      // Second call: checkpoint with no pause_context (bootstrap succeeded, but not paused).
      graph.getState
        .mockReturnValueOnce(null)
        .mockReturnValueOnce({ pause_context: null });

      await handleFix(ctx, 'feedback');

      // Should call graph.run() to bootstrap
      expect(graph.run).toHaveBeenCalledWith('issue-1', {});

      // /fix requires a paused thread; after bootstrap it is not paused
      const { postErrorReply } = await import('./context');
      expect(postErrorReply).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('not currently paused'),
      );
    });

    it('posts error reply when bootstrap fails', async () => {
      const { postErrorReply } = await import('./context');
      graph.getState.mockReturnValue(null);
      graph.run = vi.fn().mockRejectedValue(new Error('Bootstrap failed'));

      await handleFix(ctx, 'feedback');

      expect(postErrorReply).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('Failed to bootstrap'),
      );
    });

    it('proceeds with fix after bootstrap when thread is paused', async () => {
      graph.getState.mockReturnValue(null);
      graph.run = vi.fn().mockResolvedValue(undefined);
      // After bootstrap, next call to getState returns paused thread
      graph.getState.mockReturnValueOnce(null).mockReturnValueOnce({
        pause_context: 'refinement_limit',
      });

      await handleFix(ctx, 'feedback');

      expect(graph.run).toHaveBeenCalled();
      // After bootstrap, should invoke with feedback
      expect(graph.invoke).toHaveBeenCalled();
    });
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
