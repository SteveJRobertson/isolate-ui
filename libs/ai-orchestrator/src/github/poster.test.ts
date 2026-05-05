import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatTechnicalSpecTable,
  formatEdgeCaseList,
  formatPersonaSignoffs,
  buildCommentBody,
  postRefinementLoopComment,
  type RefinementCommentPayload,
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
  it('renders empty message when no signoffs', () => {
    expect(formatPersonaSignoffs({})).toBe('_No sign-offs recorded._');
  });

  it('renders checked box for approved persona', () => {
    const result = formatPersonaSignoffs({ po: true });
    expect(result).toBe('- [x] @isolate-po');
  });

  it('renders unchecked box for pending persona', () => {
    const result = formatPersonaSignoffs({ dev: false });
    expect(result).toBe('- [ ] @isolate-dev');
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
    vi.resetAllMocks();
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
