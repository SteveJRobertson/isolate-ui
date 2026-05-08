import { CommandContext, postErrorReply } from './context';

/**
 * Handle the /fix [feedback] command.
 *
 * Injects human feedback as a message and restarts the refinement loop from
 * 'po' with cleared counters, giving agents a fresh start guided by the
 * human's input.
 *
 * Critically clears rejectionCount, mesh_loop_count, and signoffs so the
 * agents are not immediately re-paused by stale counter state.
 */
export async function handleFix(
  ctx: CommandContext,
  feedback: string,
): Promise<void> {
  const { graph, threadId } = ctx;

  const trimmed = feedback.trim();
  if (!trimmed) {
    await postErrorReply(
      ctx,
      'Usage: `/fix [feedback]` — please provide feedback text after `/fix`.',
    );
    return;
  }

  const checkpoint = graph.getState(threadId);
  if (!checkpoint) {
    await postErrorReply(
      ctx,
      `No active thread found for issue #${ctx.issueNumber}. The graph may not have been started yet.`,
    );
    return;
  }

  try {
    await graph.invoke(threadId, {
      next_recipient: 'po' as any,
      rejectionCount: 0,
      mesh_loop_count: 0,
      signoffs: {},
      pause_context: null,
      messages: [{ type: 'human', content: trimmed }],
    });
  } catch (err) {
    await postErrorReply(
      ctx,
      `Failed to inject feedback: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
