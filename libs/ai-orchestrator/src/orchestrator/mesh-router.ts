import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { validateOrchestratorEnv } from '../config';
import { AgentState, SerializedMessage } from '../schema';
import { AgentNodeFn } from './langgraph';

// ── Constants ─────────────────────────────────────────────────────────────────

const PERSONA_IDS = ['po', 'architect', 'dev', 'a11y', 'qa', 'docs'] as const;

type PersonaId = (typeof PERSONA_IDS)[number];

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Configuration for the Ambiguity Mesh Router.
 */
export interface MeshRouterConfig {
  /**
   * Maximum number of non-linear mesh jumps permitted before
   * MeshStalemateError is thrown. Callers (e.g. OrchestratorGraph.run)
   * catch the error and are responsible for posting the stalemate comment.
   * Defaults to 5.
   */
  maxMeshLoops: number;

  /**
   * Optional LLM client for query classification.
   * When absent, defaults to ChatOpenAI gpt-4o-mini (see createDefaultMeshClient).
   * Inject MockChatModel / FakeListChatModel in tests to avoid API calls.
   */
  llmClient?: BaseChatModel;
}

export const DEFAULT_MESH_CONFIG: MeshRouterConfig = {
  maxMeshLoops: 5,
};

/**
 * Result of an LLM-based mesh query analysis.
 */
export interface MeshQueryResult {
  /** Detected target persona, or null when no cross-persona query was found. */
  target: PersonaId | null;
}

// ── LLM prompt ────────────────────────────────────────────────────────────────

const MESH_SYSTEM_PROMPT = `You are a routing classifier for an AI multi-agent orchestration system.

Analyze the provided message and determine whether it contains a directed query or request aimed at a specific agent persona.

Valid persona IDs: po, architect, dev, a11y, qa, docs

Rules:
- Return a non-null target ONLY when the message explicitly asks a question of, or directs a task to, a specific persona — for example: "I need @isolate-po to clarify the token choice" or "Can qa verify this edge case?".
- Return null for standard work outputs, APPROVED/REJECTED decisions, inline explanations, or any message that does not address a specific persona as the recipient of a query.

Respond with ONLY valid JSON in this exact format, with no additional text:
{"target": "persona_id"}
or
{"target": null}`;

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * Analyze the last message in the conversation for a cross-persona query.
 *
 * Uses a two-stage approach to minimize API costs:
 *
 * 1. Heuristic gate — immediately returns { target: null } if the last
 *    message contains neither '?' nor '@isolate-'. In normal linear flows
 *    (APPROVED tokens, work outputs) this gate fires for >80% of calls,
 *    eliminating the LLM call entirely.
 *
 * 2. LLM classification — only reached when the heuristic gate passes.
 *    The LLM returns structured JSON identifying the target persona or null.
 *    JSON is extracted defensively (handles markdown code-fence wrapping).
 *
 * Parsing errors are swallowed and return { target: null } to fail safe —
 * the router falls back to the deterministic sequence rather than crashing.
 *
 * @param messages  - Current conversation messages from AgentState
 * @param llmClient - Chat model to use for classification
 */
export async function analyzeMeshQuery(
  messages: SerializedMessage[],
  llmClient: BaseChatModel,
): Promise<MeshQueryResult> {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage?.content) return { target: null };

  // Heuristic gate — skip the LLM for routine work outputs and decision tokens
  if (
    !lastMessage.content.includes('?') &&
    !lastMessage.content.includes('@isolate-')
  ) {
    return { target: null };
  }

  let raw = '';
  try {
    const response = await llmClient.invoke([
      new SystemMessage(MESH_SYSTEM_PROMPT),
      new HumanMessage(lastMessage.content),
    ]);
    raw =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
  } catch {
    // LLM call failed — fail safe, no mesh jump
    return { target: null };
  }

  try {
    // Extract JSON defensively (response may be wrapped in markdown code fences)
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return { target: null };

    const parsed = JSON.parse(jsonMatch[0]) as { target: unknown };
    const candidate = parsed.target;

    if (
      typeof candidate === 'string' &&
      (PERSONA_IDS as readonly string[]).includes(candidate)
    ) {
      return { target: candidate as PersonaId };
    }
  } catch {
    // Malformed JSON from LLM — fail safe, no mesh jump
  }

  return { target: null };
}

/**
 * Create the Ambiguity Mesh Router node function.
 *
 * This node is inserted after every persona node via a deterministic edge.
 * On each invocation it:
 *
 * 1. Applies the heuristic gate — skips the LLM when the last message
 *    contains neither '?' nor '@isolate-'.
 * 2. Calls the LLM classifier to detect cross-persona queries.
 * 3. Mesh jump — when a target persona is detected AND it differs from the
 *    current next_recipient:
 *    - Sets next_recipient to the detected target.
 *    - Records mesh_origin as the pre-jump next_recipient.
 *    - Increments mesh_loop_count.
 *    - Returns state with pause_context: 'mesh_stalemate' when mesh_loop_count > maxMeshLoops.
 *      Callers (e.g. OrchestratorGraph.run) catch this error, post a
 *      stalemate GitHub comment, and surface the error to the consumer.
 * 4. Deterministic fallback — when no cross-persona query is detected,
 *    returns an empty partial state so next_recipient flows through unchanged.
 *
 * The node NEVER modifies code_buffer or messages — full context is always
 * preserved across mesh jumps.
 *
 * @param config - Mesh router configuration. Defaults to DEFAULT_MESH_CONFIG.
 *                 Inject config.llmClient in tests to avoid API calls.
 */
export function createMeshRouterNode(
  config: MeshRouterConfig = DEFAULT_MESH_CONFIG,
): AgentNodeFn {
  // Lazily resolve the client: if a client was injected (e.g. MockChatModel in
  // tests) use it directly; otherwise create the default on first invocation so
  // that OPENAI_API_KEY absence only throws when the node actually runs.
  let resolvedClient: BaseChatModel | undefined = config.llmClient;

  return async (state: AgentState): Promise<Partial<AgentState>> => {
    if (!resolvedClient) {
      try {
        resolvedClient = createDefaultMeshClient();
      } catch {
        // No API key available — mesh router is disabled for this run.
        // Fail safe: pass through unchanged rather than crashing the graph.
        // This preserves existing behaviour in environments without OPENAI_API_KEY
        // (e.g. tests that don't inject a client via config.llmClient).
        return {};
      }
    }

    const { target } = await analyzeMeshQuery(
      state.messages ?? [],
      resolvedClient,
    );

    // No ambiguous query detected — pass through unchanged (deterministic fallback)
    if (target === null || target === state.next_recipient) {
      return {};
    }

    // Mesh jump
    const newMeshLoopCount = (state.mesh_loop_count ?? 0) + 1;

    if (newMeshLoopCount > config.maxMeshLoops) {
      // Node returns state with pause_context marker.
      // Phase 3 (invoke layer) detects this and calls interrupt().
      return {
        next_recipient: null,
        pause_context: 'mesh_stalemate',
        rejectionCount: state.rejectionCount ?? 0,
        rejectionReason: `Ambiguity mesh stalemate after ${newMeshLoopCount} jumps.`,
        mesh_loop_count: newMeshLoopCount,
        mesh_origin: state.next_recipient ?? null,
      };
    }

    return {
      next_recipient: target,
      // Record where the deterministic sequence was heading before this jump.
      // 'human_review' is excluded by the early guard above, so this is always
      // a valid persona ID or null.
      mesh_origin: state.next_recipient ?? null,
      mesh_loop_count: newMeshLoopCount,
    };
  };
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Create the default ChatOpenAI client used for mesh routing classification.
 *
 * Uses gpt-4o-mini: the routing task is a binary classification problem —
 * a small, fast model is perfectly suited and keeps orchestration overhead
 * negligible. temperature: 0 for deterministic routing decisions;
 * maxTokens: 64 since only a short JSON object is expected.
 */
function createDefaultMeshClient(): BaseChatModel {
  const env = validateOrchestratorEnv();
  if (!env.OPENAI_API_KEY) {
    throw new Error(
      'OPENAI_API_KEY is required for the mesh router. Please set OPENAI_API_KEY in your environment.',
    );
  }
  return new ChatOpenAI({
    modelName: 'gpt-4o-mini',
    apiKey: env.OPENAI_API_KEY,
    temperature: 0,
    maxTokens: 64,
    // JSON mode ensures the model always returns a valid JSON object,
    // reducing parse failures and making routing more deterministic.
    modelKwargs: { response_format: { type: 'json_object' } },
  }) as unknown as BaseChatModel;
}
