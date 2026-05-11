import { describe, it, expect, vi } from 'vitest';
import {
  parseDecision,
  getNextInSequence,
  createRefinementNode,
  DEFAULT_REFINEMENT_CONFIG,
  type RefinementConfig,
} from './refinement-loop';
import { createDefaultAgentState } from '../schema';
import type { AgentState } from '../schema';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return { ...createDefaultAgentState(), ...overrides };
}

function makeMessage(content: string) {
  return { type: 'ai', content };
}

// ── parseDecision ─────────────────────────────────────────────────────────────

describe('parseDecision', () => {
  it('returns APPROVED when last message contains APPROVED', () => {
    const state = makeState({
      messages: [makeMessage('APPROVED — looks good to me')],
    });
    expect(parseDecision(state)).toBe('APPROVED');
  });

  it('is case-insensitive for APPROVED', () => {
    const state = makeState({ messages: [makeMessage('approved')] });
    expect(parseDecision(state)).toBe('APPROVED');
  });

  it('returns REJECTED when last message contains REJECTED', () => {
    const state = makeState({
      messages: [makeMessage('REJECTED: missing token color.danger.500')],
    });
    expect(parseDecision(state)).toBe('REJECTED');
  });

  it('is case-insensitive for REJECTED', () => {
    const state = makeState({ messages: [makeMessage('rejected')] });
    expect(parseDecision(state)).toBe('REJECTED');
  });

  it('returns PENDING when message contains neither token', () => {
    const state = makeState({
      messages: [makeMessage('Here is my analysis...')],
    });
    expect(parseDecision(state)).toBe('PENDING');
  });

  it('returns PENDING when messages array is empty', () => {
    expect(parseDecision(makeState({ messages: [] }))).toBe('PENDING');
  });

  it('reads the LAST message only', () => {
    const state = makeState({
      messages: [
        makeMessage('APPROVED'), // earlier — should be ignored
        makeMessage('REJECTED: see above'),
      ],
    });
    expect(parseDecision(state)).toBe('REJECTED');
  });

  // ── Strict start-of-line matching (^TOKEN\b) ───────────────────────────────

  it('returns PENDING for "not approved" — token not at line start', () => {
    const state = makeState({
      messages: [makeMessage('this is not approved')],
    });
    expect(parseDecision(state)).toBe('PENDING');
  });

  it('returns PENDING for "was rejected" — token not at line start', () => {
    const state = makeState({
      messages: [makeMessage('the spec was rejected before')],
    });
    expect(parseDecision(state)).toBe('PENDING');
  });

  it('returns PENDING for token buried mid-sentence', () => {
    const state = makeState({
      messages: [makeMessage('I think the component is approved by the team')],
    });
    expect(parseDecision(state)).toBe('PENDING');
  });

  it('returns APPROVED when token has leading whitespace (trimmed before matching)', () => {
    // The final line is trimmed via .trim() before the regex runs
    const state = makeState({ messages: [makeMessage('  APPROVED  ')] });
    expect(parseDecision(state)).toBe('APPROVED');
  });

  it('returns APPROVED for lowercase "approved" at line start', () => {
    const state = makeState({
      messages: [makeMessage('approved — looks good')],
    });
    expect(parseDecision(state)).toBe('APPROVED');
  });

  it('returns REJECTED when REJECTED appears on last line after prose', () => {
    const state = makeState({
      messages: [makeMessage('Some analysis here.\n\nREJECTED: missing token')],
    });
    expect(parseDecision(state)).toBe('REJECTED');
  });

  it('returns PENDING when APPROVED appears only on an earlier line', () => {
    const state = makeState({
      messages: [
        makeMessage('APPROVED\n\nActually, on reflection I need more info.'),
      ],
    });
    expect(parseDecision(state)).toBe('PENDING');
  });
});

// ── getNextInSequence ─────────────────────────────────────────────────────────

describe('getNextInSequence', () => {
  const seq = ['po', 'dev', 'qa'] as const;

  it('returns dev after po', () => {
    expect(getNextInSequence('po', seq)).toBe('dev');
  });

  it('returns qa after dev', () => {
    expect(getNextInSequence('dev', seq)).toBe('qa');
  });

  it('returns null after qa (last in sequence)', () => {
    expect(getNextInSequence('qa', seq)).toBeNull();
  });

  it('returns null for an ID not in the sequence', () => {
    expect(getNextInSequence('unknown', seq)).toBeNull();
  });
});

// ── createRefinementNode ──────────────────────────────────────────────────────

describe('createRefinementNode', () => {
  const config: RefinementConfig = {
    baseSequence: ['po', 'dev', 'qa'],
    maxIterations: 5,
  };

  // ── Base sequence routing ──────────────────────────────────────────────────

  it('advances to dev when po approves', async () => {
    const inner = vi.fn().mockResolvedValue({
      messages: [makeMessage('APPROVED')],
    });
    const node = createRefinementNode('po', config, inner);
    const state = makeState();

    const result = await node(state);

    expect(result.next_recipient).toBe('dev');
    expect(result.lastApprovedBy).toBe('po');
    expect(result.signoffs).toEqual({ po: true });
    expect(result.rejectionReason).toBe('');
  });

  it('advances to qa when dev approves', async () => {
    const inner = vi.fn().mockResolvedValue({
      messages: [makeMessage('APPROVED — implementation is solid')],
    });
    const node = createRefinementNode('dev', config, inner);
    const state = makeState({ signoffs: { po: true } });

    const result = await node(state);

    expect(result.next_recipient).toBe('qa');
    expect(result.signoffs).toEqual({ po: true, dev: true });
  });

  it('sets next_recipient to null when qa approves (loop complete)', async () => {
    const inner = vi.fn().mockResolvedValue({
      messages: [makeMessage('APPROVED — coverage meets requirements')],
    });
    const node = createRefinementNode('qa', config, inner);
    const state = makeState({ signoffs: { po: true, dev: true } });

    const result = await node(state);

    expect(result.next_recipient).toBeNull();
    expect(result.signoffs).toEqual({ po: true, dev: true, qa: true });
  });

  // ── Rejection handling ─────────────────────────────────────────────────────

  it('routes back to po and increments rejectionCount on rejection', async () => {
    const inner = vi.fn().mockResolvedValue({
      messages: [makeMessage('REJECTED: token color.danger.500 is missing')],
    });
    const node = createRefinementNode('dev', config, inner);
    const state = makeState({ rejectionCount: 0, signoffs: { po: true } });

    const result = await node(state);

    expect(result.next_recipient).toBe('po');
    expect(result.rejectionCount).toBe(1);
    expect(result.rejectionReason).toContain('REJECTED');
    expect(result.signoffs).toEqual({}); // signoffs cleared on rejection
  });

  it('accumulates rejectionCount across multiple rejections', async () => {
    const inner = vi.fn().mockResolvedValue({
      messages: [makeMessage('REJECTED: still missing tokens')],
    });
    const node = createRefinementNode('dev', config, inner);
    const state = makeState({ rejectionCount: 2 });

    const result = await node(state);

    expect(result.rejectionCount).toBe(3);
  });

  it('routes to human_review at maxIterations', async () => {
    const inner = vi.fn().mockResolvedValue({
      messages: [makeMessage('REJECTED: iteration 5')],
    });
    const node = createRefinementNode('dev', config, inner);
    // Already at 4 rejections; next rejection pushes to 5 (= maxIterations)
    const state = makeState({
      rejectionCount: 4,
      metadata: { github_issue_id: '19' },
    });

    const result = await node(state);
    expect(result.next_recipient).toBeNull();
    expect(result.pause_context).toBe('refinement_limit');
  });

  it('human_review result carries correct rejectionCount on limit', async () => {
    const inner = vi.fn().mockResolvedValue({
      messages: [makeMessage('REJECTED')],
    });
    const node = createRefinementNode('po', config, inner);
    const state = makeState({
      rejectionCount: 4,
      metadata: { github_issue_id: '42' },
    });

    const result = await node(state);
    expect(result.next_recipient).toBeNull();
    expect(result.pause_context).toBe('refinement_limit');
    expect(result.rejectionCount).toBe(5);
    expect(result.signoffs).toEqual({});
  });

  // ── PENDING passthrough ────────────────────────────────────────────────────

  it('passes through inner result unchanged when decision is PENDING', async () => {
    const inner = vi.fn().mockResolvedValue({
      messages: [makeMessage('Analysing the component spec...')],
      next_recipient: 'architect' as AgentState['next_recipient'],
    });
    const node = createRefinementNode('po', config, inner);
    const state = makeState();

    const result = await node(state);

    expect(result.next_recipient).toBe('architect');
    // Refinement fields untouched
    expect(result.rejectionCount).toBeUndefined();
  });

  // ── Custom config ──────────────────────────────────────────────────────────

  it('respects a custom maxIterations', async () => {
    const strictConfig: RefinementConfig = {
      baseSequence: ['po', 'dev', 'qa'],
      maxIterations: 2,
    };
    const inner = vi.fn().mockResolvedValue({
      messages: [makeMessage('REJECTED')],
    });
    const node = createRefinementNode('po', strictConfig, inner);
    const state = makeState({ rejectionCount: 1 }); // 1 + 1 = 2 = maxIterations

    const result = await node(state);
    expect(result.next_recipient).toBeNull();
    expect(result.pause_context).toBe('refinement_limit');
  });

  it('respects a custom baseSequence', async () => {
    const customConfig: RefinementConfig = {
      baseSequence: ['po', 'qa'], // skip dev
      maxIterations: 5,
    };
    const inner = vi
      .fn()
      .mockResolvedValue({ messages: [makeMessage('APPROVED')] });
    const node = createRefinementNode('po', customConfig, inner);
    const state = makeState();

    const result = await node(state);

    expect(result.next_recipient).toBe('qa');
  });
});

// ── DEFAULT_REFINEMENT_CONFIG ─────────────────────────────────────────────────

describe('DEFAULT_REFINEMENT_CONFIG', () => {
  it('has baseSequence po, dev, qa', () => {
    expect(DEFAULT_REFINEMENT_CONFIG.baseSequence).toEqual(['po', 'dev', 'qa']);
  });

  it('has maxIterations 5', () => {
    expect(DEFAULT_REFINEMENT_CONFIG.maxIterations).toBe(5);
  });
});
