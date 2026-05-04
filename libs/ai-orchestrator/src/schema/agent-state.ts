import { z } from 'zod';

/**
 * Stable serialized shape for a LangChain message persisted in SQLite.
 * Mirrors the minimal fields used by LangChain's BaseMessage serialization.
 */
export const SerializedMessageSchema = z.object({
  type: z.string(),
  content: z.string(),
  id: z.string().optional(),
  additional_kwargs: z.record(z.string(), z.unknown()).optional(),
});

export type SerializedMessage = z.infer<typeof SerializedMessageSchema>;

export const AgentStateSchema = z.object({
  /**
   * Full conversation history stored as serialized message objects.
   * Conforms to LangChain BaseMessage serialization for SQLite persistence.
   */
  messages: z.array(SerializedMessageSchema).default(() => []),

  /**
   * Current recipient - the persona that should process next.
   * Validated as a known persona ID or null; invalid values are rejected at schema parse time.
   *
   * When null, the workflow has completed or the next recipient has not yet been set.
   */
  next_recipient: z
    .enum(['po', 'architect', 'dev', 'a11y', 'qa', 'docs'])
    .nullable()
    .default(null),

  /**
   * Git diff string or code snippet under review.
   * Populated by the developer agent, consumed by a11y/qa agents.
   */
  code_buffer: z.string().default(''),

  /**
   * Accessibility audit feedback from the a11y agent.
   * Includes violations, WCAG compliance notes, and recommendations.
   */
  a11y_report: z.string().default(''),

  /**
   * Architectural approval gate (read by architect agent).
   * Set to true when the architecture is consistent with monorepo rules.
   * Blocks deployment if false.
   */
  arch_approval: z.boolean().default(false),

  /**
   * Flexible metadata for tracking iteration state.
   * Examples:
   * - iteration_count: number
   * - github_issue_id: string
   * - component_name: string
   * - variant_selected: string
   * - design_tokens_applied: string[]
   */
  metadata: z.record(z.string(), z.any()).default(() => ({})),

  /**
   * Internal: step counter for this invocation only.
   * Tracked via state to avoid shared mutable instance fields.
   * Reset on each invoke(); not persisted across resumptions.
   */
  _step_count: z.number().default(0),
});

export type AgentState = z.infer<typeof AgentStateSchema>;

/**
 * Default initial state for new workflows.
 */
export const DEFAULT_AGENT_STATE: AgentState = {
  messages: [],
  next_recipient: null,
  code_buffer: '',
  a11y_report: '',
  arch_approval: false,
  metadata: {},
  _step_count: 0,
};

/**
 * Factory that returns a fresh default state object on each call.
 * Prefer this over spreading DEFAULT_AGENT_STATE when starting new workflows,
 * to avoid accidental sharing of nested mutable references (messages, metadata).
 */
export function createDefaultAgentState(): AgentState {
  return {
    messages: [],
    next_recipient: null,
    code_buffer: '',
    a11y_report: '',
    arch_approval: false,
    metadata: {},
    _step_count: 0,
  };
}
