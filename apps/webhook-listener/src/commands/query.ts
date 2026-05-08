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

  try {
    // The '@isolate- ' prefix triggers the mesh router heuristic gate.
    // The LLM classifier determines the target persona from the question content.
    await graph.invoke(threadId, {
      messages: [{ type: 'human', content: `@isolate- ${trimmed}` }],
    });
  } catch (err) {
    await postErrorReply(
      ctx,
      `Failed to route query: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
