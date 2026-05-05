import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatTechnicalSpecTable,
  formatEdgeCaseList,
  formatPersonaSignoffs,
  buildCommentBody,
  postRefinementLoopComment,
  buildStalemateCommentBody,
  postMeshStalemateComment,
  type RefinementCommentPayload,
  type MeshStalematePayload,
} from './poster';

// ── Mock @octokit/rest at module level so it's hoisted before imports ─────────

const mockCreateComment = vi.fn();

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    rest: {
      issues: { createComment: mockCreateComment },
    },
  })),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const minimalPayload: RefinementCommentPayload = {
  issueNumber: 19,
  owner: 'SteveJRobertson',
  repo: 'isolate-ui',
  technicalSpec: [],
  edgeCases: [],
  signoffs: {},
};

const fullPayload: RefinementCommentPayload = {
  issueNumber: 19,
  owner: 'SteveJRobertson',
  repo: 'isolate-ui',
  technicalSpec: [
    {
      slot: 'root',
      primitive: 'Button',
      tokens: 'color.primary.500, spacing.3',
    },
    {
      slot: 'label',
      primitive: 'Button.Root',
      tokens: 'typography.body.fontSize',
    },
  ],
  edgeCases: ['Loading', 'Error', 'Empty', 'Disabled', 'A11y'],
  signoffs: { po: true, dev: true, qa: false },
  previewUrl: 'https://preview.example.com/storybook',
};

// ── formatTechnicalSpecTable ──────────────────────────────────────────────────

describe('formatTechnicalSpecTable', () => {
  it('renders empty message when no rows', () => {
    expect(formatTechnicalSpecTable([])).toBe(
      '_No technical specification provided._',
    );
  });

  it('renders header, divider, and rows', () => {
    const result = formatTechnicalSpecTable([
      { slot: 'root', primitive: 'Button', tokens: 'color.primary.500' },
    ]);
    expect(result).toContain('| Slot | Primitive | Tokens |');
    expect(result).toContain('|------|-----------|--------|');
    expect(result).toContain('| root | Button | color.primary.500 |');
  });

  it('renders multiple rows', () => {
    const result = formatTechnicalSpecTable(fullPayload.technicalSpec);
    expect(result).toContain('| root |');
    expect(result).toContain('| label |');
  });
});

// ── formatEdgeCaseList ────────────────────────────────────────────────────────

describe('formatEdgeCaseList', () => {
  it('renders empty message when no edge cases', () => {
    expect(formatEdgeCaseList([])).toBe('_No edge cases specified._');
  });

  it('renders each case as a list item', () => {
    const result = formatEdgeCaseList(['Loading', 'Error', 'Disabled']);
    expect(result).toBe('- Loading\n- Error\n- Disabled');
  });
});

// ── formatPersonaSignoffs ─────────────────────────────────────────────────────

describe('formatPersonaSignoffs', () => {
  it('renders all three personas unchecked when no signoffs', () => {
    const result = formatPersonaSignoffs({});
    expect(result).toContain('- [ ] @isolate-po');
    expect(result).toContain('- [ ] @isolate-dev');
    expect(result).toContain('- [ ] @isolate-qa');
  });

  it('renders checked box for approved persona (others unchecked)', () => {
    const result = formatPersonaSignoffs({ po: true });
    expect(result).toContain('- [x] @isolate-po');
    expect(result).toContain('- [ ] @isolate-dev');
    expect(result).toContain('- [ ] @isolate-qa');
  });

  it('renders unchecked box for pending persona (others unchecked)', () => {
    const result = formatPersonaSignoffs({ dev: false });
    expect(result).toContain('- [ ] @isolate-po');
    expect(result).toContain('- [ ] @isolate-dev');
    expect(result).toContain('- [ ] @isolate-qa');
  });

  it('renders mixed signoffs correctly', () => {
    const result = formatPersonaSignoffs({ po: true, dev: true, qa: false });
    expect(result).toContain('- [x] @isolate-po');
    expect(result).toContain('- [x] @isolate-dev');
    expect(result).toContain('- [ ] @isolate-qa');
  });
});

// ── buildCommentBody ──────────────────────────────────────────────────────────

describe('buildCommentBody', () => {
  it('includes the report heading', () => {
    const body = buildCommentBody(minimalPayload);
    expect(body).toContain('## 🔍 Definition of Ready');
  });

  it('includes all three sections', () => {
    const body = buildCommentBody(fullPayload);
    expect(body).toContain('### Technical Specification');
    expect(body).toContain('### Edge Cases');
    expect(body).toContain('### Persona Sign-off');
  });

  it('includes the five standard edge cases', () => {
    const body = buildCommentBody(fullPayload);
    ['Loading', 'Error', 'Empty', 'Disabled', 'A11y'].forEach((ec) => {
      expect(body).toContain(ec);
    });
  });

  it('includes signoffs with correct checked state', () => {
    const body = buildCommentBody(fullPayload);
    expect(body).toContain('- [x] @isolate-po');
    expect(body).toContain('- [x] @isolate-dev');
    expect(body).toContain('- [ ] @isolate-qa');
  });

  it('includes preview URL when provided', () => {
    const body = buildCommentBody(fullPayload);
    expect(body).toContain('https://preview.example.com/storybook');
  });

  it('omits preview URL section when not provided', () => {
    const body = buildCommentBody(minimalPayload);
    expect(body).not.toContain('**Preview:**');
  });

  it('includes human-review warning when rejectionReason is set', () => {
    const payload = {
      ...minimalPayload,
      rejectionReason: 'Missing token color.danger.500',
    };
    const body = buildCommentBody(payload);
    expect(body).toContain('⚠️ **Human review required**');
    expect(body).toContain('Missing token color.danger.500');
  });

  it('omits warning block when rejectionReason is absent', () => {
    const body = buildCommentBody(fullPayload);
    expect(body).not.toContain('Human review required');
  });
});

// ── postRefinementLoopComment ─────────────────────────────────────────────────

describe('postRefinementLoopComment', () => {
  beforeEach(() => {
    // Clear call history only — do NOT reset implementations (that removes the mock)
    vi.clearAllMocks();
    mockCreateComment.mockResolvedValue({
      data: { html_url: '', id: 0 },
    });
  });

  it('returns null when token is undefined', async () => {
    const result = await postRefinementLoopComment(fullPayload, undefined);
    expect(result).toBeNull();
  });

  it('returns null when token is empty string', async () => {
    const result = await postRefinementLoopComment(fullPayload, '');
    expect(result).toBeNull();
  });

  it('calls Octokit createComment with correct params', async () => {
    mockCreateComment.mockResolvedValue({
      data: {
        html_url:
          'https://github.com/SteveJRobertson/isolate-ui/issues/19#issuecomment-123',
        id: 123,
      },
    });

    const result = await postRefinementLoopComment(
      fullPayload,
      'ghp_faketoken',
    );

    expect(mockCreateComment).toHaveBeenCalledWith({
      owner: 'SteveJRobertson',
      repo: 'isolate-ui',
      issue_number: 19,
      body: expect.stringContaining('## 🔍 Definition of Ready'),
    });
    expect(result?.commentId).toBe(123);
    expect(result?.commentUrl).toContain('issuecomment-123');
  });
});

// ── buildStalemateCommentBody ─────────────────────────────────────────────────

describe('buildStalemateCommentBody', () => {
  const stalematePayload: MeshStalematePayload = {
    issueNumber: 20,
    owner: 'SteveJRobertson',
    repo: 'isolate-ui',
    meshLoopCount: 6,
    originPersona: 'qa',
    lastMessage: '@isolate-po can you clarify the token?',
    issueAuthor: 'SteveJRobertson',
  };

  it('includes the stalemate heading', () => {
    const body = buildStalemateCommentBody(stalematePayload);
    expect(body).toContain('## 🔴 Ambiguity Mesh — Stalemate');
  });

  it('includes human review warning', () => {
    const body = buildStalemateCommentBody(stalematePayload);
    expect(body).toContain('Human review required');
  });

  it('includes the mesh loop count in the summary table', () => {
    const body = buildStalemateCommentBody(stalematePayload);
    expect(body).toContain('6');
  });

  it('includes the origin persona in the summary table', () => {
    const body = buildStalemateCommentBody(stalematePayload);
    expect(body).toContain('@isolate-qa');
  });

  it('breaks the @mention in issueAuthor with a zero-width space', () => {
    const body = buildStalemateCommentBody(stalematePayload);
    // Must NOT contain a raw @SteveJRobertson (would fire a notification)
    expect(body).not.toContain('@SteveJRobertson');
    // Must contain the broken form
    expect(body).toContain('@\u200bSteveJRobertson');
  });

  it('sanitizes @mentions embedded in lastMessage', () => {
    const body = buildStalemateCommentBody(stalematePayload);
    // The @isolate-po in lastMessage should be broken
    expect(body).not.toMatch(/@isolate-po/);
    expect(body).toContain('@\u200bisolate-po');
  });

  it('collapses newlines in lastMessage to keep blockquote single-line', () => {
    const multilinePayload: MeshStalematePayload = {
      ...stalematePayload,
      lastMessage: 'First line\nSecond line\nThird line',
    };
    const body = buildStalemateCommentBody(multilinePayload);
    // Newlines should be collapsed to spaces inside the blockquote
    expect(body).toContain('First line Second line Third line');
  });

  it('renders null originPersona gracefully', () => {
    const payload: MeshStalematePayload = {
      ...stalematePayload,
      originPersona: null,
    };
    const body = buildStalemateCommentBody(payload);
    expect(body).toContain('_unknown_');
  });

  it('includes resume instructions', () => {
    const body = buildStalemateCommentBody(stalematePayload);
    expect(body).toContain('How to Resume');
  });
});

// ── postMeshStalemateComment ──────────────────────────────────────────────────

describe('postMeshStalemateComment', () => {
  const stalematePayload: MeshStalematePayload = {
    issueNumber: 20,
    owner: 'SteveJRobertson',
    repo: 'isolate-ui',
    meshLoopCount: 6,
    originPersona: 'qa',
    lastMessage: 'some message',
    issueAuthor: 'SteveJRobertson',
  };

  beforeEach(() => {
    mockCreateComment.mockReset();
  });

  it('returns null when token is undefined', async () => {
    const result = await postMeshStalemateComment(stalematePayload, undefined);
    expect(result).toBeNull();
  });

  it('returns null when token is empty string', async () => {
    const result = await postMeshStalemateComment(stalematePayload, '');
    expect(result).toBeNull();
  });

  it('calls Octokit createComment with stalemate body', async () => {
    mockCreateComment.mockResolvedValue({
      data: {
        html_url:
          'https://github.com/SteveJRobertson/isolate-ui/issues/20#issuecomment-456',
        id: 456,
      },
    });

    const result = await postMeshStalemateComment(
      stalematePayload,
      'ghp_faketoken',
    );

    expect(mockCreateComment).toHaveBeenCalledWith({
      owner: 'SteveJRobertson',
      repo: 'isolate-ui',
      issue_number: 20,
      body: expect.stringContaining('## 🔴 Ambiguity Mesh — Stalemate'),
    });
    expect(result?.commentId).toBe(456);
    expect(result?.commentUrl).toContain('issuecomment-456');
  });
});
