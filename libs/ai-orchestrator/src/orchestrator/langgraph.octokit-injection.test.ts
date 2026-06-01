import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Octokit } from '@octokit/rest';
import { OrchestratorGraph } from './langgraph';

vi.mock('../github/poster', () => ({
  postRefinementLoopComment: vi.fn(),
  postMeshStalemateComment: vi.fn(),
}));

vi.mock('../persistence', () => ({
  LangGraphSqliteSaver: vi.fn().mockImplementation(() => ({
    getLatest: vi.fn().mockReturnValue(null),
    save: vi.fn(),
  })),
}));

// Mock the underlying LangGraph StateGraph so invoke() doesn't need a real DB/LLM
vi.mock('@langchain/langgraph', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@langchain/langgraph')>();
  return {
    ...actual,
    StateGraph: vi.fn().mockImplementation(() => ({
      addNode: vi.fn().mockReturnThis(),
      addEdge: vi.fn().mockReturnThis(),
      addConditionalEdges: vi.fn().mockReturnThis(),
      compile: vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue({
          messages: [],
          next_recipient: null,
          signoffs: { po: true, dev: true, qa: true },
          _step_count: 3,
          pause_context: null,
          rejectionCount: 0,
          rejectionReason: undefined,
          metadata: { github_issue_id: '42' },
          mesh_origin: null,
          mesh_loop_count: 0,
        }),
      }),
    })),
  };
});

import { postRefinementLoopComment } from '../github/poster';

function makeMockOctokit(): Octokit {
  return {
    rest: {
      issues: {
        createComment: vi.fn().mockResolvedValue({
          data: {
            id: 1,
            html_url:
              'https://github.com/SteveJRobertson/isolate-ui/issues/42#issuecomment-1',
          },
        }),
      },
    },
  } as unknown as Octokit;
}

describe('OrchestratorGraph — octokit constructor injection (hotfix/#117)', () => {
  let originalDbPath: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalDbPath = process.env['DATABASE_PATH'];
    process.env['DATABASE_PATH'] = ':memory:';
  });

  afterEach(() => {
    if (originalDbPath === undefined) {
      delete process.env['DATABASE_PATH'];
    } else {
      process.env['DATABASE_PATH'] = originalDbPath;
    }
  });

  // ── Constructor ─────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('accepts an optional octokit parameter without throwing', () => {
      const octokit = makeMockOctokit();
      expect(
        () => new OrchestratorGraph(':memory:', undefined, octokit),
      ).not.toThrow();
    });

    it('constructs successfully without an octokit parameter', () => {
      expect(() => new OrchestratorGraph(':memory:')).not.toThrow();
    });

    it('constructs successfully when octokit is explicitly undefined', () => {
      expect(
        () => new OrchestratorGraph(':memory:', undefined, undefined),
      ).not.toThrow();
    });
  });

  // ── tryPostComment via run() ─────────────────────────────────────────────────

  describe('run() — comment posting via injected octokit', () => {
    it('calls postRefinementLoopComment when octokit is injected and all personas sign off', async () => {
      const mockPostComment = vi.mocked(postRefinementLoopComment);
      mockPostComment.mockResolvedValue({
        commentUrl:
          'https://github.com/SteveJRobertson/isolate-ui/issues/42#issuecomment-1',
        commentId: 1,
      });

      const octokit = makeMockOctokit();
      const graph = new OrchestratorGraph(':memory:', undefined, octokit);

      await graph.run('42', { metadata: { github_issue_id: '42' } });

      expect(mockPostComment).toHaveBeenCalledOnce();
      expect(mockPostComment).toHaveBeenCalledWith(
        expect.objectContaining({ issueNumber: 42 }),
        octokit,
      );
    });

    it('does NOT call postRefinementLoopComment when no octokit is injected', async () => {
      const mockPostComment = vi.mocked(postRefinementLoopComment);

      const graph = new OrchestratorGraph(':memory:');

      await graph.run('42', { metadata: { github_issue_id: '42' } });

      expect(mockPostComment).not.toHaveBeenCalled();
    });

    it('continues without throwing when postRefinementLoopComment rejects', async () => {
      const mockPostComment = vi.mocked(postRefinementLoopComment);
      mockPostComment.mockRejectedValue(new Error('GitHub API unavailable'));

      const octokit = makeMockOctokit();
      const graph = new OrchestratorGraph(':memory:', undefined, octokit);

      // Should not throw — comment posting is non-fatal
      await expect(
        graph.run('42', { metadata: { github_issue_id: '42' } }),
      ).resolves.not.toThrow();
    });
  });

  // ── tryPostComment via invoke() ──────────────────────────────────────────────

  describe('invoke() — comment posting via injected octokit', () => {
    it('calls postRefinementLoopComment when octokit is injected', async () => {
      const mockPostComment = vi.mocked(postRefinementLoopComment);
      mockPostComment.mockResolvedValue({
        commentUrl:
          'https://github.com/SteveJRobertson/isolate-ui/issues/42#issuecomment-1',
        commentId: 1,
      });

      const octokit = makeMockOctokit();
      const graph = new OrchestratorGraph(':memory:', undefined, octokit);

      await graph.invoke('42', { metadata: { github_issue_id: '42' } });

      expect(mockPostComment).toHaveBeenCalledOnce();
      expect(mockPostComment).toHaveBeenCalledWith(
        expect.objectContaining({ issueNumber: 42 }),
        octokit,
      );
    });

    it('does NOT call postRefinementLoopComment when no octokit is injected', async () => {
      const mockPostComment = vi.mocked(postRefinementLoopComment);

      const graph = new OrchestratorGraph(':memory:');

      await graph.invoke('42', { metadata: { github_issue_id: '42' } });

      expect(mockPostComment).not.toHaveBeenCalled();
    });
  });
});
