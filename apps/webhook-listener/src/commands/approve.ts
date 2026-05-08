import { CommandContext, postErrorReply } from './context';

/**
 * Handle the /approve command.
 *
 * Resumes the graph from its last checkpoint. Reads pause_context from the
 * checkpoint state to determine the correct resume target:
 * - 'mesh_stalemate' → resume at mesh_origin (return to interrupted sequence)
 * - 'refinement_limit' or null → resume at 'po' (restart refinement loop)
 *
 * Also resets rejectionCount, mesh_loop_count, signoffs, and pause_context
 * so the agents get a clean run.
 */
export async function handleApprove(ctx: CommandContext): Promise<void> {
  const { graph, threadId } = ctx;

  const checkpoint = graph.getState(threadId);
  if (!checkpoint) {
    await postErrorReply(
      ctx,
      `No active thread found for issue #${ctx.issueNumber}. The graph may not have been started yet.`,
    );
    return;
  }

  const resumeTarget =
    checkpoint.pause_context === 'mesh_stalemate' && checkpoint.mesh_origin
      ? checkpoint.mesh_origin
      : 'po';

  if (!checkpoint.pause_context) {
    await postErrorReply(
      ctx,
      `Thread \`${threadId}\` is not currently paused for human review. Nothing to approve.`,
    );
    return;
  }

  try {
    await graph.invoke(threadId, {
      next_recipient: resumeTarget as any,
      rejectionCount: 0,
      mesh_loop_count: 0,
      signoffs: {},
      pause_context: null,
    });
  } catch (err) {
    await postErrorReply(
      ctx,
      `Failed to resume graph: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
