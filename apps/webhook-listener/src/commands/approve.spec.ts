import { describe, it, beforeEach, expect, vi } from 'vitest';
import { handleApprove } from './approve';
import { makeCommandContext } from '../__tests__/test-helpers';

vi.mock('./context', () => ({
  postErrorReply: vi.fn(),
}));

describe('handleApprove', () => {
  let graph;
  let ctx;

  beforeEach(() => {
    vi.clearAllMocks();
    graph = { getState: vi.fn(), invoke: vi.fn() };
    ctx = makeCommandContext({ graph });
  });

  describe('Phase 2: Command Bootstrapping', () => {
    it('bootstraps new thread when no checkpoint exists', async () => {
      graph.getState.mockReturnValue(null);
      graph.run = vi.fn().mockResolvedValue(undefined);

      await handleApprove(ctx);

      // Should call graph.run() to bootstrap
      expect(graph.run).toHaveBeenCalledWith(
        'issue-1',
        {},
        { configurable: { thread_id: 'issue-1' } },
      );

      // But /approve still requires pause_context to proceed
      // So after bootstrap, should get error about not being paused
      const { postErrorReply } = await import('./context');
      expect(postErrorReply).toHaveBeenCalled();
    });

    it('posts error reply when bootstrap fails', async () => {
      const { postErrorReply } = await import('./context');
      graph.getState.mockReturnValue(null);
      graph.run = vi.fn().mockRejectedValue(new Error('Bootstrap failed'));

      await handleApprove(ctx);

      expect(postErrorReply).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('Failed to bootstrap'),
      );
    });

    it('proceeds with approve after bootstrap when thread is paused', async () => {
      graph.getState.mockReturnValue(null);
      graph.run = vi.fn().mockResolvedValue(undefined);
      // After bootstrap, next call to getState returns paused thread
      graph.getState.mockReturnValueOnce(null).mockReturnValueOnce({
        pause_context: 'refinement_limit',
      });

      await handleApprove(ctx);

      expect(graph.run).toHaveBeenCalled();
      // After bootstrap, should invoke with approval
      expect(graph.invoke).toHaveBeenCalled();
    });
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

  it('falls back to po when pause_context is mesh_stalemate but mesh_origin is missing', async () => {
    graph.getState.mockReturnValue({
      pause_context: 'mesh_stalemate',
      mesh_origin: undefined,
    });

    await handleApprove(ctx);

    expect(graph.invoke).toHaveBeenCalledWith(
      'issue-1',
      expect.objectContaining({ next_recipient: 'po' }),
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
