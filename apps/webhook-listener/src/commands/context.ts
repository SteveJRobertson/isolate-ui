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
  commentId: number; // Phase 3: ID of the comment that triggered the command
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
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: `@${username} ${message}`,
    });
  } catch (err) {
    console.warn(
      `[webhook-listener] Failed to post error reply: ${String(err)}`,
    );
  }
}

// Valid reaction emoji values supported by GitHub API
type GitHubReaction =
  | '+1'
  | '-1'
  | 'laugh'
  | 'confused'
  | 'heart'
  | 'hooray'
  | 'rocket'
  | 'eyes';

/**
 * Add an emoji reaction to the issue comment that triggered the command.
 * Phase 3: Provides immediate UX feedback to the user.
 */
export async function addReactionToComment(
  ctx: CommandContext,
  emoji: GitHubReaction,
): Promise<void> {
  const { octokit, owner, repo, commentId } = ctx;
  try {
    await octokit.rest.reactions.createForIssueComment({
      owner,
      repo,
      comment_id: commentId,
      content: emoji,
    });
  } catch (err) {
    console.warn(
      `[webhook-listener] Failed to add reaction to comment: ${String(err)}`,
    );
  }
}
