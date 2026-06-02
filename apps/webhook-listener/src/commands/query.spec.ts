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

  it('does NOT clear pause_context when issued while paused', async () => {
    // Simulate a thread paused at refinement_limit
    // handleQuery relies on graph.invoke() to preserve pause_context from checkpoint
    graph.getState.mockReturnValue({
      next_recipient: null,
      pause_context: 'refinement_limit',
    });

    await handleQuery(ctx, 'question');

    // Verify that graph.invoke was called (NOT that pause_context is explicitly passed)
    // The graph's invokeWithGraph() will preserve pause_context from checkpoint
    expect(graph.invoke).toHaveBeenCalled();
    const invokeCall = graph.invoke.mock.calls[0];
    const invokePayload = invokeCall[1];

    // Verify that pause_context is NOT explicitly cleared (not set to null in the call)
    // If handleQuery passed pause_context: null, it would break /approve and /fix guards
    expect(invokePayload.pause_context).not.toBe(null);
    // Should be undefined here (relying on checkpoint preservation)
    expect(invokePayload.pause_context).toBeUndefined();
  });

  it('preserves pause_context for approve/fix resumption guards', async () => {
    // When a thread is paused with mesh_stalemate, pause_context must remain
    // non-null so that /approve and /fix can guard against invalid state transitions.
    // /query should NOT explicitly clear pause_context in its invoke call.
    graph.getState.mockReturnValue({
      next_recipient: null,
      pause_context: 'mesh_stalemate',
      mesh_origin: 'dev',
    });

    await handleQuery(ctx, 'question');

    const invokeCall = graph.invoke.mock.calls[0];
    const invokePayload = invokeCall[1];

    // Critical: pause_context must NOT be explicitly set to null by /query
    // /query should pass the delta message and next_recipient, letting the graph
    // preserve pause_context from checkpoint. This ensures /approve and /fix
    // can still check pause_context and detect the paused state.
    expect(invokePayload.pause_context).not.toBe(null);
    expect(invokePayload.pause_context).toBeUndefined();

    // Verify next_recipient fallback logic still works
    expect(invokePayload.next_recipient).toBe('po');
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
          body: expect.stringContaining('🤖 I could not generate a response'),
        }),
      );
    });

    it('does not post comment if createComment fails', async () => {
      const { postErrorReply } = await import('./context');
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

      await handleQuery(ctx, 'what is foo?');

      // Should still attempt to post the comment
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalled();
    });
  });
});
