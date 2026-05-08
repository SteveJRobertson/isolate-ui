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
   * 'human_review' is a special terminal node that posts a GitHub pause comment
   * and routes the graph to __end__, preserving the checkpoint for webhook resumption.
   */
  next_recipient: z
    .enum(['po', 'architect', 'dev', 'a11y', 'qa', 'docs', 'human_review'])
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
   * Internal: cumulative step counter for this thread, tracked via state to
   * avoid shared mutable instance fields. Reset to 0 at the start of each
   * invoke() call, so it reflects steps taken in the current invocation only
   * (not across checkpoint resumptions).
   */
  _step_count: z.number().default(0),

  // ── Refinement loop fields ────────────────────────────────────────────────

  /**
   * Number of times any persona in the refinement sequence has rejected the
   * current proposal. Resets to 0 when the loop completes successfully.
   * When this reaches RefinementConfig.maxIterations the graph throws
   * RefinementIterationLimitError to signal a human-in-the-loop pause.
   */
  rejectionCount: z.number().default(0),

  /**
   * The rejection reason captured from the last rejecting persona's message.
   * Surfaced in the GitHub comment and human-pause notification.
   */
  rejectionReason: z.string().default(''),

  /**
   * ID of the last persona that issued an APPROVED decision.
   * Used to track progress through the refinement sequence.
   */
  lastApprovedBy: z.string().nullable().default(null),

  /**
   * Per-persona approval flags. Keys are persona IDs ('po', 'dev', 'qa').
   * Reset to {} when a rejection causes the loop to restart from the beginning.
   */
  signoffs: z.record(z.string(), z.boolean()).default(() => ({})),

  // ── Ambiguity Mesh fields ─────────────────────────────────────────────────

  /**
   * Number of non-linear (mesh) jumps performed during the current workflow.
   * Independent of rejectionCount. When this exceeds MeshRouterConfig.maxMeshLoops
   * the mesh router throws MeshStalemateError; the caller (OrchestratorGraph.run)
   * is responsible for posting a stalemate comment and surfacing the error.
   */
  mesh_loop_count: z.number().default(0),

  /**
   * The persona ID that was active (i.e. had just produced a message) when an
   * ambiguity-driven mesh jump was triggered. Recorded so that callers can
   * communicate the diversion point in a stalemate comment.
   * Null when no mesh jump is in-flight.
   */
  mesh_origin: z
    .enum(['po', 'architect', 'dev', 'a11y', 'qa', 'docs'])
    .nullable()
    .default(null),

  /**
   * The reason the graph was routed to the human_review node.
   * Used by the webhook listener to determine the correct resume target:
   * - 'refinement_limit': resume at 'po' (restart the refinement loop)
   * - 'mesh_stalemate': resume at mesh_origin (return to interrupted sequence)
   * Null when the graph is not in a human-review pause.
   */
  pause_context: z
    .enum(['refinement_limit', 'mesh_stalemate'])
    .nullable()
    .default(null),

  /**
   * Component slot names to generate for the new component.
   * Populated by the dev node from the incoming request or defaulted to
   * ['root', 'label'] when absent. Used to drive recipe and boilerplate generation.
   */
  parts: z.array(z.string()).default(() => []),
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
  rejectionCount: 0,
  rejectionReason: '',
  lastApprovedBy: null,
  signoffs: {},
  mesh_loop_count: 0,
  mesh_origin: null,
  pause_context: null,
  parts: [],
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
    rejectionCount: 0,
    rejectionReason: '',
    lastApprovedBy: null,
    signoffs: {},
    mesh_loop_count: 0,
    mesh_origin: null,
    pause_context: null,
    parts: [],
  };
}
