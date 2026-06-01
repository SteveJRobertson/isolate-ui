import { describe, it, expect, vi } from 'vitest';
import type { Octokit } from '@octokit/rest';
import {
  postRefinementLoopComment,
  postMeshStalemateComment,
  type RefinementCommentPayload,
  type MeshStalematePayload,
} from './poster';

// ── Test Suite: Octokit Refactoring ───────────────────────────────────────────
//
// This test suite verifies that postRefinementLoopComment and postMeshStalemateComment
// accept an Octokit instance as a parameter instead of a token string.
// Tests will fail until the refactoring is implemented.

const minimalRefinementPayload: RefinementCommentPayload = {
  issueNumber: 19,
  owner: 'SteveJRobertson',
  repo: 'isolate-ui',
  technicalSpec: [],
  edgeCases: [],
  signoffs: {},
};

const minimalMeshPayload: MeshStalematePayload = {
  issueNumber: 19,
  owner: 'SteveJRobertson',
  repo: 'isolate-ui',
  meshLoopCount: 3,
  originPersona: 'dev',
  lastMessage: 'Test message',
  issueAuthor: 'testuser',
  maxMeshLoops: 5,
};

// ── postRefinementLoopComment with Octokit instance ────────────────────────────

describe('postRefinementLoopComment (Octokit refactor)', () => {
  it('FAILING: accepts an Octokit instance parameter', async () => {
    const mockCreateComment = vi.fn().mockResolvedValue({
      data: {
        id: 12345,
        html_url:
          'https://github.com/SteveJRobertson/isolate-ui/issues/19#issuecomment-12345',
      },
    });

    const mockOctokit = {
      rest: {
        issues: { createComment: mockCreateComment },
      },
    } as unknown as Octokit;

    // TODO: Update function signature to accept octokit: Octokit | undefined
    // Currently expects (payload, token) — should be (payload, octokit)
    const result = await postRefinementLoopComment(
      minimalRefinementPayload,
      mockOctokit,
    );

    expect(result).toEqual({
      commentUrl:
        'https://github.com/SteveJRobertson/isolate-ui/issues/19#issuecomment-12345',
      commentId: 12345,
    });
  });

  it('FAILING: returns null when Octokit instance is not provided', async () => {
    // TODO: Update function to check for undefined Octokit and return null
    const result = await postRefinementLoopComment(
      minimalRefinementPayload,
      undefined,
    );
    expect(result).toBeNull();
  });

  it('FAILING: calls issues.createComment with correct parameters', async () => {
    const mockCreateComment = vi.fn().mockResolvedValue({
      data: {
        id: 12345,
        html_url:
          'https://github.com/SteveJRobertson/isolate-ui/issues/19#issuecomment-12345',
      },
    });

    const mockOctokit = {
      rest: {
        issues: { createComment: mockCreateComment },
      },
    } as unknown as Octokit;

    const payload: RefinementCommentPayload = {
      ...minimalRefinementPayload,
      issueNumber: 42,
      owner: 'TestOwner',
      repo: 'test-repo',
    };

    await postRefinementLoopComment(payload, mockOctokit);

    expect(mockCreateComment).toHaveBeenCalledWith({
      owner: 'TestOwner',
      repo: 'test-repo',
      issue_number: 42,
      body: expect.any(String),
    });
  });

  it('FAILING: throws when Octokit call fails', async () => {
    const mockCreateComment = vi.fn().mockRejectedValue(new Error('API Error'));

    const mockOctokit = {
      rest: {
        issues: { createComment: mockCreateComment },
      },
    } as unknown as Octokit;

    await expect(
      postRefinementLoopComment(minimalRefinementPayload, mockOctokit),
    ).rejects.toThrow('API Error');
  });
});

// ── postMeshStalemateComment with Octokit instance ────────────────────────────

describe('postMeshStalemateComment (Octokit refactor)', () => {
  it('FAILING: accepts an Octokit instance parameter', async () => {
    const mockCreateComment = vi.fn().mockResolvedValue({
      data: {
        id: 54321,
        html_url:
          'https://github.com/SteveJRobertson/isolate-ui/issues/19#issuecomment-54321',
      },
    });

    const mockOctokit = {
      rest: {
        issues: { createComment: mockCreateComment },
      },
    } as unknown as Octokit;

    // TODO: Update function signature to accept octokit: Octokit | undefined
    // Currently expects (payload, token) — should be (payload, octokit)
    const result = await postMeshStalemateComment(
      minimalMeshPayload,
      mockOctokit,
    );

    expect(result).toEqual({
      commentUrl:
        'https://github.com/SteveJRobertson/isolate-ui/issues/19#issuecomment-54321',
      commentId: 54321,
    });
  });

  it('FAILING: returns null when Octokit instance is not provided', async () => {
    // TODO: Update function to check for undefined Octokit and return null
    const result = await postMeshStalemateComment(
      minimalMeshPayload,
      undefined,
    );
    expect(result).toBeNull();
  });

  it('FAILING: calls issues.createComment with correct mesh stalemate body', async () => {
    const mockCreateComment = vi.fn().mockResolvedValue({
      data: {
        id: 54321,
        html_url:
          'https://github.com/SteveJRobertson/isolate-ui/issues/19#issuecomment-54321',
      },
    });

    const mockOctokit = {
      rest: {
        issues: { createComment: mockCreateComment },
      },
    } as unknown as Octokit;

    const payload: MeshStalematePayload = {
      ...minimalMeshPayload,
      issueNumber: 88,
      owner: 'OrgName',
      repo: 'mesh-test',
    };

    await postMeshStalemateComment(payload, mockOctokit);

    expect(mockCreateComment).toHaveBeenCalledWith({
      owner: 'OrgName',
      repo: 'mesh-test',
      issue_number: 88,
      body: expect.stringContaining('Ambiguity Mesh'),
    });
  });

  it('FAILING: throws when Octokit call fails', async () => {
    const mockCreateComment = vi
      .fn()
      .mockRejectedValue(new Error('Network Error'));

    const mockOctokit = {
      rest: {
        issues: { createComment: mockCreateComment },
      },
    } as unknown as Octokit;

    await expect(
      postMeshStalemateComment(minimalMeshPayload, mockOctokit),
    ).rejects.toThrow('Network Error');
  });
});
