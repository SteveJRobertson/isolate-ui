import { CommandContext, postErrorReply } from './context';

/**
 * Handle the /approve command.
 *
 * Resumes the graph from its last checkpoint. Reads pause_context from the
 * checkpoint state to determine the correct resume target:
 * - 'mesh_stalemate' → resume at mesh_origin (return to interrupted sequence)
 * - 'refinement_limit' → resume at 'po' (restart refinement loop)
 *
 * Returns an error reply when pause_context is null — i.e., the thread is not
 * currently paused for human review and there is nothing to approve.
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

  if (!checkpoint.pause_context) {
    await postErrorReply(
      ctx,
      `Thread \`${threadId}\` is not currently paused for human review. Nothing to approve.`,
    );
    return;
  }

  // resumeTarget is computed after the null-guard so it only runs when the
  // thread is confirmed paused. For mesh_stalemate we return to mesh_origin
  // (the persona the stalemate diverted from); for refinement_limit we restart
  // the refinement loop at 'po'.
  // Resetting rejectionCount + signoffs on stalemate resume is intentional:
  // the stale counters would immediately re-trigger a limit if left intact,
  // even though the human has approved continuing.
  const resumeTarget =
    checkpoint.pause_context === 'mesh_stalemate' && checkpoint.mesh_origin
      ? checkpoint.mesh_origin
      : 'po';

  try {
    await graph.invoke(threadId, {
      next_recipient: resumeTarget as any,
      rejectionCount: 0,
      rejectionReason: '',
      lastApprovedBy: null,
      mesh_loop_count: 0,
      signoffs: {},
      pause_context: null,
    });
  } catch (err) {
    // Post a user-facing reply first, then re-throw so the webhook route's
    // catch block can delete the delivery row and allow GitHub to retry.
    await postErrorReply(
      ctx,
      `Failed to resume graph: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}
