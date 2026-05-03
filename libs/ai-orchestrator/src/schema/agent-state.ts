import { z } from 'zod';

/**
 * Type for LangChain BaseMessage - imported when LangGraph graph is implemented
 * For now, we use a generic message type to avoid circular dependencies
 */
type BaseMessage = Record<string, unknown>;

/**
 * Zod schema for the orchestrator's centralized state.
 *
 * This state flows through all 6 agent nodes and is persisted after each step.
 * Each agent reads relevant fields and updates others before passing to the next.
 */
export const AgentStateSchema = z.object({
  /**
   * Full conversation history with all messages sent/received.
   * Each agent appends its response here for context.
   */
  messages: z.array(z.any()).default([] as BaseMessage[]),

  /**
   * Current recipient - the persona that should process next.
   * Values: 'po' | 'architect' | 'dev' | 'a11y' | 'qa' | 'docs' | null
   *
   * When null, the orchestrator router determines the next recipient.
   */
  next_recipient: z.string().nullable().default(null),

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
  metadata: z.record(z.string(), z.any()).default({}),
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
};
