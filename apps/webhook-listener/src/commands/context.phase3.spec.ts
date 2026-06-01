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
      commentId: 42, // Phase 3 addition: comment ID
    });
  });

  describe('addReactionToComment', () => {
    it('adds emoji reaction to issue comment via Octokit API', async () => {
      await addReactionToComment(ctx, '🚀');

      expect(octokit.rest.reactions.createForIssueComment).toHaveBeenCalledWith(
        {
          owner: 'owner',
          repo: 'repo',
          comment_id: 42,
          content: '🚀',
        },
      );
    });

    it('supports various emoji reactions', async () => {
      const emojis = ['👍', '❤️', '🎉', '🔄'];

      for (const emoji of emojis) {
        await addReactionToComment(ctx, emoji);
      }

      expect(
        octokit.rest.reactions.createForIssueComment,
      ).toHaveBeenCalledTimes(4);
    });

    it('logs warning and continues on API failure', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation();
      octokit.rest.reactions.createForIssueComment.mockRejectedValue(
        new Error('API error'),
      );

      // Should not throw
      await addReactionToComment(ctx, '🚀');

      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });
  });
});
