import { CommandContext, postErrorReply } from './context';

/**
 * Handle the /query [question] command.
 *
 * Injects the question as a HumanMessage prefixed with '@isolate-' so the
 * mesh router's heuristic gate triggers (checks for '@isolate-' in content).
 * The mesh router LLM then classifies which persona should receive the query
 * and routes accordingly — no webhook-side routing logic required.
 *
 * The '@isolate- ' prefix (without a specific persona ID) causes the LLM
 * classifier to choose the most appropriate target based on question content.
 */
export async function handleQuery(
  ctx: CommandContext,
  question: string,
): Promise<void> {
  const { graph, threadId } = ctx;

  const trimmed = question.trim();
  if (!trimmed) {
    await postErrorReply(
      ctx,
      'Usage: `/query [question]` — please provide a question after `/query`.',
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

  // If the graph is paused at human_review, its next_recipient is null,
  // so graph.invoke() would immediately route START → __end__ and the mesh
  // router would never run. Fall back to 'po' so the question is processed
  // by at least one persona before the mesh router classifies the target.
  const nextRecipient =
    checkpoint.next_recipient && checkpoint.next_recipient !== 'human_review'
      ? checkpoint.next_recipient
      : 'po';

  try {
    // The '@isolate- ' prefix triggers the mesh router heuristic gate.
    // The LLM classifier determines the target persona from the question content.
    // Explicitly set next_recipient so the graph re-enters at a real persona
    // rather than routing immediately to __end__ when the thread is paused.
    // Clear pause_context so that /approve and /fix behave correctly after a
    // /query: leaving it set would make the thread appear still-paused and
    // those commands would return an error reply.
    await graph.invoke(threadId, {
      next_recipient: nextRecipient as any,
      pause_context: null,
      messages: [{ type: 'human', content: `@isolate- ${trimmed}` }],
    });
  } catch (err) {
    // Post a user-facing reply first, then re-throw so the webhook route's
    // catch block can delete the delivery row and allow GitHub to retry.
    await postErrorReply(
      ctx,
      `Failed to route query: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}
