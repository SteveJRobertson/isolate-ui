import { describe, it, expect } from 'vitest';
import { AgentStateSchema, DEFAULT_AGENT_STATE } from '../schema';

describe('AgentState Schema', () => {
  it('validates a complete state object', () => {
    const state = AgentStateSchema.parse({
      messages: [],
      next_recipient: 'po',
      code_buffer: 'diff --git a/button.tsx ...',
      a11y_report: '',
      arch_approval: false,
      metadata: { issue_id: '23' },
    });

    expect(state.next_recipient).toBe('po');
    expect(state.code_buffer).toBe('diff --git a/button.tsx ...');
    expect(state.metadata.issue_id).toBe('23');
  });

  it('applies defaults when fields are missing', () => {
    const state = AgentStateSchema.parse({});

    expect(state.messages).toEqual([]);
    expect(state.next_recipient).toBeNull();
    expect(state.code_buffer).toBe('');
    expect(state.a11y_report).toBe('');
    expect(state.arch_approval).toBe(false);
    expect(state.metadata).toEqual({});
  });

  it('exports a valid DEFAULT_AGENT_STATE', () => {
    const result = AgentStateSchema.safeParse(DEFAULT_AGENT_STATE);
    expect(result.success).toBe(true);
  });

  it('rejects invalid arch_approval type', () => {
    const result = AgentStateSchema.safeParse({
      arch_approval: 'yes',
    });
    expect(result.success).toBe(false);
  });

  // ── shared_decisions: Goal-Driven Orchestration shared memory ─────────────

  it('shared_decisions defaults to empty array', () => {
    const state = AgentStateSchema.parse({});
    expect(state.shared_decisions).toEqual([]);
  });

  it('shared_decisions accepts an array of strings', () => {
    const state = AgentStateSchema.parse({
      shared_decisions: [
        'Use Button primitive',
        'Apply color.primary.700 for contrast',
      ],
    });
    expect(state.shared_decisions).toEqual([
      'Use Button primitive',
      'Apply color.primary.700 for contrast',
    ]);
  });

  it('DEFAULT_AGENT_STATE includes shared_decisions as empty array', () => {
    expect(DEFAULT_AGENT_STATE.shared_decisions).toEqual([]);
  });

  it('rejects shared_decisions with non-string items', () => {
    const result = AgentStateSchema.safeParse({
      shared_decisions: [42, true],
    });
    expect(result.success).toBe(false);
  });
});
