import * as path from 'path';
import { AgentState, AgentStateSchema, DEFAULT_AGENT_STATE } from '../schema';
import { AGENT_PERSONAS, getPersonaIds } from '../agents';
import { SqliteSaver } from '../persistence';
import { validateAgentsConfig, findWorkspaceRoot } from '../config';

/**
 * Node function signature — each persona node receives the current state
 * and returns a partial state update to be merged.
 */
export type AgentNodeFn = (
  state: AgentState,
) => Promise<Partial<AgentState>> | Partial<AgentState>;

/**
 * A registered node in the graph.
 */
interface GraphNode {
  id: string;
  fn: AgentNodeFn;
}

/**
 * Result returned from running the orchestrator.
 */
export interface OrchestratorRunResult {
  threadId: string;
  finalState: AgentState;
  stepCount: number;
}

/**
 * OrchestratorGraph
 *
 * The core multi-agent execution engine for Isolate UI.
 * Wires together agent nodes into a stateful LangGraph-style workflow:
 *
 *   entry → router → [po | architect | dev | a11y | qa | docs] → router → ...
 *
 * Each node is a function that reads from AgentState and returns partial updates.
 * The router decides which node to invoke next based on `state.next_recipient`.
 *
 * State is persisted via SqliteSaver after every step for resumability.
 */
export class OrchestratorGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private checkpointer: SqliteSaver;
  private dbPath: string;

  constructor(dbPath?: string, agentsMdPath?: string) {
    this.dbPath =
      dbPath ??
      path.resolve(
        findWorkspaceRoot(process.cwd()),
        'libs',
        'ai-orchestrator',
        'data',
        'state.db',
      );
    // Validate AGENTS.md on startup — fail-fast if misconfigured
    // (must happen before SqliteSaver so we don't create DB files on bad config)
    validateAgentsConfig(agentsMdPath);

    this.checkpointer = new SqliteSaver(this.dbPath);

    // Register default no-op nodes for each persona
    // Real LLM implementations will be swapped in via registerNode()
    getPersonaIds().forEach((id) => {
      this.registerNode(id, this.createDefaultNode(id));
    });
  }

  /**
   * Register (or replace) a node implementation for a persona.
   *
   * @param personaId - e.g. 'po', 'architect', 'dev'
   * @param fn - Node function that processes state and returns updates
   */
  public registerNode(personaId: string, fn: AgentNodeFn): void {
    if (!AGENT_PERSONAS[personaId]) {
      throw new Error(
        `Cannot register node for unknown persona: "${personaId}". ` +
          `Valid personas: ${getPersonaIds().join(', ')}`,
      );
    }
    this.nodes.set(personaId, { id: personaId, fn });
  }

  /**
   * Run the orchestrator for a given thread.
   *
   * If the thread already has saved state, execution resumes from where it left off.
   * Terminates when next_recipient is null (all agents have completed their pass).
   *
   * @param threadId - GitHub Issue ID or other unique thread identifier
   * @param initialInput - Initial state to merge (for new threads only)
   * @param maxSteps - Safety cap to prevent infinite loops (default: 20)
   */
  public async run(
    threadId: string,
    initialInput?: Partial<AgentState>,
    maxSteps = 20,
  ): Promise<OrchestratorRunResult> {
    // Resume from checkpoint or start fresh.
    // Strip step_count from the saved state — it's a persistence internal and
    // must not leak into AgentState or OrchestratorRunResult.finalState.
    const savedState = this.checkpointer.get(threadId);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { step_count: _sc, ...savedAgentState } = savedState ?? {
      step_count: undefined,
      ...DEFAULT_AGENT_STATE,
    };
    // Parse through the schema so any undefined values in initialInput fall back
    // to schema defaults, preventing invalid state from entering the execution loop.
    let state: AgentState = savedState
      ? savedAgentState
      : AgentStateSchema.parse({ ...DEFAULT_AGENT_STATE, ...initialInput });

    // If starting fresh and no initial recipient set, begin with po (product owner)
    if (!savedState && !state.next_recipient) {
      state.next_recipient = 'po';
    }

    let steps = 0;

    while (state.next_recipient !== null && steps < maxSteps) {
      const recipientId = state.next_recipient;
      const node = this.nodes.get(recipientId);

      if (!node) {
        throw new Error(
          `No node registered for persona: "${recipientId}". ` +
            `Registered nodes: ${Array.from(this.nodes.keys()).join(', ')}`,
        );
      }

      // Execute the agent node
      const updates = await node.fn(state);

      // Merge updates into state
      state = { ...state, ...updates };

      // Persist after every step
      this.checkpointer.save(threadId, state, recipientId);

      steps++;
    }

    if (steps >= maxSteps && state.next_recipient !== null) {
      throw new Error(
        `Orchestrator exceeded max steps (${maxSteps}) for thread "${threadId}". ` +
          `Last recipient: ${state.next_recipient}. ` +
          `This may indicate an infinite routing loop.`,
      );
    }

    return {
      threadId,
      finalState: state,
      stepCount: steps,
    };
  }

  /**
   * Resume a previously saved thread.
   * Throws if the thread does not exist.
   */
  public async resume(
    threadId: string,
    maxSteps = 20,
  ): Promise<OrchestratorRunResult> {
    const saved = this.checkpointer.get(threadId);
    if (!saved) {
      throw new Error(
        `Cannot resume: no saved state found for thread "${threadId}".`,
      );
    }
    return this.run(threadId, undefined, maxSteps);
  }

  /**
   * Get the current state of a thread without running it.
   */
  public getState(threadId: string): AgentState | null {
    const state = this.checkpointer.get(threadId);
    if (!state) return null;
    // Strip the step_count augmentation added by SqliteSaver — callers should
    // only observe AgentState fields, not persistence internals.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { step_count, ...agentState } = state;
    return agentState;
  }

  /**
   * Get full step-by-step execution history for a thread.
   */
  public getHistory(threadId: string) {
    return this.checkpointer.getHistory(threadId);
  }

  /**
   * List all known thread IDs.
   */
  public listThreads(): string[] {
    return this.checkpointer.listThreads();
  }

  /**
   * Close the database connection. Call when the orchestrator is no longer needed.
   */
  public close(): void {
    this.checkpointer.close();
  }

  /**
   * Default node implementation — passes through without mutation.
   * Used as a placeholder until real LLM nodes are registered.
   *
   * In production, call registerNode() to replace these with LLM-backed functions.
   */
  private createDefaultNode(personaId: string): AgentNodeFn {
    return (state: AgentState): Partial<AgentState> => {
      const persona = AGENT_PERSONAS[personaId];
      const index = getPersonaIds().indexOf(personaId);
      const nextPersonas = getPersonaIds();
      const next = (
        index < nextPersonas.length - 1 ? nextPersonas[index + 1] : null
      ) as AgentState['next_recipient'];

      return {
        next_recipient: next,
        metadata: {
          ...state.metadata,
          [`${personaId}_processed`]: true,
          [`${personaId}_processed_at`]: new Date().toISOString(),
          [`${personaId}_title`]: persona.title,
        },
      };
    };
  }
}
