import Database from 'better-sqlite3';
import { OrchestratorGraph } from '@isolate-ui/ai-orchestrator';
import { Octokit } from '@octokit/rest';

export interface CommandContext {
  db: Database.Database;
  graph: OrchestratorGraph;
  octokit: Octokit;
  owner: string;
  repo: string;
  issueNumber: number;
  threadId: string;
  username: string;
}

/**
 * Post an error reply to the GitHub issue mentioning the triggering user.
 */
export async function postErrorReply(
  ctx: CommandContext,
  message: string,
): Promise<void> {
  const { octokit, owner, repo, issueNumber, username } = ctx;
  try {
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: `@${username} ${message}`,
    });
  } catch (err) {
    console.warn(`[webhook-listener] Failed to post error reply: ${String(err)}`);
  }
}
