import { AgentState } from '../schema';
import { AgentNodeFn } from './langgraph';

/**
 * Configuration for the refinement loop.
 */
export interface RefinementConfig {
  /**
   * Ordered sequence of persona IDs that must each approve before the loop
   * is considered complete. Defaults to ['po', 'dev', 'qa'].
   */
  baseSequence: readonly string[];

  /**
   * Maximum number of rejections before the loop auto-pauses and requires
   * human intervention via pause_context marker and interrupt().
   * Defaults to 5.
   */
  maxIterations: number;
}

export const DEFAULT_REFINEMENT_CONFIG: RefinementConfig = {
  baseSequence: ['po', 'dev', 'qa'],
  maxIterations: 5,
};

// ── Decision parsing ──────────────────────────────────────────────────────────

export type RefinementDecision = 'APPROVED' | 'REJECTED' | 'PENDING';

/**
 * Extract a structured approval/rejection decision from the latest message in
 * state. Looks for the literal tokens APPROVED or REJECTED (case-insensitive)
 * anywhere in the last message's content.
 *
 * Returns 'PENDING' when the last message is absent or contains neither token,
 * which causes the refinement wrapper to defer to whatever `next_recipient` the
 * inner node function set directly.
 *
 * Matching rules:
 * - Only the final non-empty line of the message content is examined,
 *   trimmed of leading/trailing whitespace before matching.
 * - REJECTED is tested before APPROVED.
 * - Both tokens must appear at the START of the last line (^TOKEN\b) so that
 *   a phrase like "this is not approved" is never misclassified. Reason text
 *   or punctuation may follow (e.g. "APPROVED ✓" or "REJECTED: missing token"
 *   both match; "not approved" does not).
 */
export function parseDecision(state: Partial<AgentState>): RefinementDecision {
  const messages = state.messages ?? [];
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage?.content) return 'PENDING';

  const lastLine = (
    lastMessage.content
      .split('\n')
      .filter((l) => l.trim())
      .slice(-1)[0] ?? ''
  ).trim();

  if (/^REJECTED\b/i.test(lastLine)) return 'REJECTED';
  if (/^APPROVED\b/i.test(lastLine)) return 'APPROVED';
  return 'PENDING';
}

// ── Iteration limit error ─────────────────────────────────────────────────────

// ── Node wrapper ──────────────────────────────────────────────────────────────

/**
 * Wraps a persona node function with refinement loop logic.
 *
 * The wrapper:
 * 1. Calls the inner persona node to get its state update.
 * 2. Parses an APPROVED / REJECTED decision from the latest message.
 * 3. On APPROVED: advances `next_recipient` to the next persona in sequence,
 *    records the signoff, and clears `rejectionReason`.
 * 4. On REJECTED: increments `rejectionCount`; if the count reaches
 *    `maxIterations`, throws `RefinementIterationLimitError`; otherwise
 *    resets `next_recipient` to the first persona in the sequence and clears
 *    all accumulated signoffs.
 * 5. On PENDING: defers entirely to whatever the inner node returned.
 *
 * @param personaId - ID of the persona this wrapper belongs to
 * @param config    - Refinement configuration (sequence + max iterations)
 * @param innerFn   - The underlying node implementation for this persona
 */
export function createRefinementNode(
  personaId: string,
  config: RefinementConfig,
  innerFn: AgentNodeFn,
): AgentNodeFn {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const innerResult = await innerFn(state);

    // Merge inner result with current state so parseDecision sees the latest
    // message even when the inner node appended to state.messages via channels.
    const mergedMessages = [
      ...(state.messages ?? []),
      ...((innerResult.messages as AgentState['messages']) ?? []),
    ];
    const decision = parseDecision({ messages: mergedMessages });

    if (decision === 'APPROVED') {
      const nextPersona = getNextInSequence(personaId, config.baseSequence);
      return {
        ...innerResult,
        next_recipient: nextPersona as AgentState['next_recipient'],
        lastApprovedBy: personaId,
        rejectionReason: '',
        signoffs: { ...(state.signoffs ?? {}), [personaId]: true },
      };
    }

    if (decision === 'REJECTED') {
      const newRejectionCount = (state.rejectionCount ?? 0) + 1;

      // Capture reason first so it is available on the error and in state
      const reason =
        mergedMessages[mergedMessages.length - 1]?.content ??
        'No reason provided';

      if (newRejectionCount >= config.maxIterations) {
        // Node returns state with pause_context marker.
        // Phase 3 (invoke layer) detects this and calls interrupt().
        return {
          ...innerResult,
          next_recipient: null,
          pause_context: 'refinement_limit',
          rejectionCount: newRejectionCount,
          rejectionReason: reason,
          signoffs: {},
        };
      }

      return {
        ...innerResult,
        // Restart from the first persona in the sequence
        next_recipient: config.baseSequence[0] as AgentState['next_recipient'],
        rejectionCount: newRejectionCount,
        rejectionReason: reason,
        // Clear all approval progress metadata — the loop starts over
        lastApprovedBy: null,
        signoffs: {},
      };
    }

    // PENDING — trust the inner node's own routing decision
    return innerResult;
  };
}

// ── Sequence helpers ──────────────────────────────────────────────────────────

/**
 * Return the next persona ID in the refinement sequence, or null when the
 * current persona is last (loop complete).
 */
export function getNextInSequence(
  currentPersonaId: string,
  sequence: readonly string[],
): string | null {
  const index = sequence.indexOf(currentPersonaId);
  if (index === -1 || index === sequence.length - 1) return null;
  return sequence[index + 1];
}
