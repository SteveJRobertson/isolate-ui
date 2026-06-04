import { CommandContext, postErrorReply } from './context';

/**
 * Extract the latest AI message from the state's messages array.
 * Returns the message content, or null if no AI message found.
 */
function extractLatestAIMessage(
  messages: Array<{ type?: string; content?: string }> | undefined,
): string | null {
  if (!messages || messages.length === 0) {
    return null;
  }
  // Find the last message with type 'ai'
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === 'ai' && messages[i].content) {
      return messages[i].content;
    }
  }
  return null;
}

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
  const { graph, threadId, octokit, owner, repo, issueNumber } = ctx;

  const trimmed = question.trim();
  if (!trimmed) {
    await postErrorReply(
      ctx,
      'Usage: `/query [question]` — please provide a question after `/query`.',
    );
    return;
  }

  let checkpoint = graph.getState(threadId);
  if (!checkpoint) {
    // Bootstrap: initialize a new thread if none exists
    try {
      await graph.run(threadId, {});
      // After bootstrap, fetch the checkpoint again
      checkpoint = graph.getState(threadId);
      if (!checkpoint) {
        await postErrorReply(
          ctx,
          `Failed to bootstrap thread for issue #${ctx.issueNumber}.`,
        );
        return;
      }
    } catch (err) {
      await postErrorReply(
        ctx,
        `Failed to bootstrap thread: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
  }

  // If the graph is paused at human_review, its next_recipient is null,
  // so graph.invoke() would immediately route START → __end__ and the mesh
  // router would never run. Fall back to 'po' so the question is processed
  // by at least one persona before the mesh router classifies the target.
  const nextRecipient = checkpoint.next_recipient
    ? checkpoint.next_recipient
    : 'po';

  try {
    // The '@isolate- ' prefix triggers the mesh router heuristic gate to ensure
    // the LLM classifier is consulted (vs being skipped for routine work outputs).
    // However, the current mesh router classifier only returns a non-null target
    // for queries explicitly directed at specific personas (e.g. '@isolate-po').
    // For generic queries like '@isolate- which design token?', the classifier
    // returns {target: null}, and routing defaults to next_recipient (usually 'po').
    // Future improvement: update mesh_router's MESH_SYSTEM_PROMPT to classify
    // generic queries to the most appropriate persona (e.g. 'po' for token questions).
    //
    // Issue #140: set pause_context: null to clear mesh_stalemate (and any other
    // pause) so the graph routes through mesh_router instead of __pause__ node.
    // With the new START → mesh_router topology, mesh_router always runs first,
    // so every /query reaches mesh_router before any persona executes.
    await graph.invoke(threadId, {
      next_recipient: nextRecipient as any,
      pause_context: null,
      messages: [{ type: 'human', content: `@isolate- ${trimmed}` }],
    });

    // Phase 5: Extract latest AI message and post to GitHub
    const finalState = graph.getState(threadId);
    const aiResponse =
      extractLatestAIMessage(finalState?.messages) ||
      'I could not generate a response.';

    try {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body: `🤖 ${aiResponse}`,
      });
    } catch (commentErr) {
      // Log and re-throw so the webhook route can delete the delivery row and allow GitHub to retry
      console.warn(
        `[webhook-listener] Failed to post query response comment: ${String(commentErr)}`,
      );
      throw commentErr;
    }
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
