import { describe, it, beforeEach, expect, vi } from 'vitest';
import { handleQuery } from './query';
import { makeCommandContext } from '../__tests__/test-helpers';

vi.mock('./context', () => ({
  postErrorReply: vi.fn(),
}));

describe('handleQuery', () => {
  let graph;
  let ctx;
  let mockOctokit;

  beforeEach(() => {
    vi.clearAllMocks();
    graph = { getState: vi.fn(), invoke: vi.fn() };
    mockOctokit = {
      rest: {
        issues: {
          createComment: vi.fn().mockResolvedValue({ data: { id: 123 } }),
        },
      },
    };
    ctx = makeCommandContext({
      graph,
      octokit: mockOctokit,
    });
  });

  it('posts error reply when question is empty', async () => {
    const { postErrorReply } = await import('./context');

    await handleQuery(ctx, '');

    expect(postErrorReply).toHaveBeenCalledWith(
      ctx,
      expect.stringContaining('Usage'),
    );
  });

  describe('Phase 2: Command Bootstrapping', () => {
    it('bootstraps new thread when no checkpoint exists', async () => {
      graph.run = vi.fn().mockResolvedValue(undefined);
      // First call returns null (no checkpoint), second returns initialized state
      graph.getState.mockReturnValueOnce(null).mockReturnValueOnce({
        next_recipient: 'po',
      });

      await handleQuery(ctx, 'question');

      // Should call graph.run() to bootstrap
      expect(graph.run).toHaveBeenCalledWith('issue-1', {});

      // Then invoke with question
      expect(graph.invoke).toHaveBeenCalled();
    });

    it('posts error reply when bootstrap fails', async () => {
      const { postErrorReply } = await import('./context');
      graph.getState.mockReturnValue(null);
      graph.run = vi.fn().mockRejectedValue(new Error('Bootstrap failed'));

      await handleQuery(ctx, 'question');

      expect(postErrorReply).toHaveBeenCalledWith(
        ctx,
        expect.stringContaining('Failed to bootstrap'),
      );
    });

    it('proceeds with query after successful bootstrap', async () => {
      graph.run = vi.fn().mockResolvedValue(undefined);
      // After bootstrap, next call to getState returns active thread
      graph.getState.mockReturnValueOnce(null).mockReturnValueOnce({
        next_recipient: 'po',
      });

      await handleQuery(ctx, 'test question');

      expect(graph.run).toHaveBeenCalled();
      expect(graph.invoke).toHaveBeenCalled();
    });
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

  it('always passes pause_context: null to clear stalemate and allow re-routing', async () => {
    // Issue #140: /query must clear pause_context so the graph can re-route via
    // mesh_router rather than hitting the __pause__ node immediately.
    // Applies to both mesh_stalemate and refinement_limit — user expects a response.
    graph.getState.mockReturnValue({
      next_recipient: null,
      pause_context: 'refinement_limit',
    });

    await handleQuery(ctx, 'question');

    expect(graph.invoke).toHaveBeenCalled();
    const invokeCall = graph.invoke.mock.calls[0];
    const invokePayload = invokeCall[1];

    // /query must explicitly pass pause_context: null so the graph can process
    // the question without routing to __pause__ node first.
    expect(invokePayload.pause_context).toBe(null);
  });

  it('clears mesh_stalemate pause by passing pause_context: null on /query', async () => {
    // Issue #140: when the thread is stuck in mesh_stalemate, /query must clear
    // pause_context so the graph routes through mesh_router instead of __pause__.
    // The topology change (START → mesh_router) ensures mesh_router reclassifies
    // the question to the right persona before any agent logic executes.
    graph.getState.mockReturnValue({
      next_recipient: 'dev',
      pause_context: 'mesh_stalemate',
      mesh_origin: 'dev',
    });

    await handleQuery(ctx, 'question');

    const invokeCall = graph.invoke.mock.calls[0];
    const invokePayload = invokeCall[1];

    // pause_context must be explicitly null so the graph doesn't route to __pause__
    expect(invokePayload.pause_context).toBe(null);

    // next_recipient is preserved from checkpoint (not reset to 'po')
    expect(invokePayload.next_recipient).toBe('dev');
  });

  describe('Phase 5: Extract & Post AI Response', () => {
    it('extracts and posts latest AI message after query succeeds', async () => {
      const { postErrorReply } = await import('./context');
      graph.getState
        .mockReturnValueOnce({ next_recipient: 'po' })
        .mockReturnValueOnce({
          // After invoke
          next_recipient: 'architect',
          messages: [
            { type: 'human', content: '@isolate- what is foo?' },
            {
              type: 'ai',
              content:
                'Foo is a placeholder variable commonly used in examples.',
            },
            { type: 'human', content: 'thanks' },
            {
              type: 'ai',
              content: 'You are welcome!',
            },
          ],
        });

      await handleQuery(ctx, 'what is foo?');

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: ctx.owner,
          repo: ctx.repo,
          issue_number: ctx.issueNumber,
          body: expect.stringContaining('🤖 You are welcome!'),
        }),
      );
    });

    it('posts fallback message when no AI message found', async () => {
      graph.getState
        .mockReturnValueOnce({ next_recipient: 'po' })
        .mockReturnValueOnce({
          // After invoke — no AI messages
          next_recipient: 'architect',
          messages: [{ type: 'human', content: '@isolate- what is foo?' }],
        });

      await handleQuery(ctx, 'what is foo?');

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('🤖 I could not generate a response.'),
        }),
      );
    });

    it('rethrows error when createComment fails', async () => {
      graph.getState
        .mockReturnValueOnce({ next_recipient: 'po' })
        .mockReturnValueOnce({
          next_recipient: 'architect',
          messages: [
            { type: 'human', content: '@isolate- what is foo?' },
            {
              type: 'ai',
              content: 'Foo is a placeholder variable.',
            },
          ],
        });
      mockOctokit.rest.issues.createComment.mockRejectedValue(
        new Error('Comment API failed'),
      );

      // createComment failure should propagate so the webhook route can retry
      await expect(handleQuery(ctx, 'what is foo?')).rejects.toThrow(
        'Comment API failed',
      );
      // Verify createComment was still attempted
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalled();
    });
  });
});
