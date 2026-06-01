import { describe, it, beforeEach, expect, vi } from 'vitest';
import { addReactionToComment } from './context';
import { makeCommandContext } from '../__tests__/test-helpers';

vi.mock('@octokit/rest');

describe('Phase 3: Immediate UI Reactions', () => {
  let octokit;
  let ctx;

  beforeEach(() => {
    vi.clearAllMocks();
    octokit = {
      rest: {
        reactions: {
          createForIssueComment: vi.fn().mockResolvedValue({}),
        },
      },
    };
    ctx = makeCommandContext({
      octokit,
      commentId: 42,
    });
  });

  describe('addReactionToComment', () => {
    it('adds emoji reaction to issue comment via Octokit API', async () => {
      await addReactionToComment(ctx, 'rocket');

      expect(octokit.rest.reactions.createForIssueComment).toHaveBeenCalledWith(
        {
          owner: 'owner',
          repo: 'repo',
          comment_id: 42,
          content: 'rocket',
        },
      );
    });

    it('supports various GitHub reactions', async () => {
      const reactions: (
        | '+1'
        | '-1'
        | 'laugh'
        | 'confused'
        | 'heart'
        | 'hooray'
        | 'rocket'
        | 'eyes'
      )[] = ['+1', 'heart', 'rocket', 'eyes'];

      for (const reaction of reactions) {
        await addReactionToComment(ctx, reaction);
      }

      expect(
        octokit.rest.reactions.createForIssueComment,
      ).toHaveBeenCalledTimes(4);
    });

    it('logs warning and continues on API failure', async () => {
      const consoleWarnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      octokit.rest.reactions.createForIssueComment.mockRejectedValue(
        new Error('API error'),
      );

      await addReactionToComment(ctx, 'rocket');

      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });
  });
});
