import * as path from 'path';
import { StateGraph, START, Annotation, interrupt } from '@langchain/langgraph';
import {
  AgentState,
  createDefaultAgentState,
  AgentStateSchema,
  type PausePayload,
} from '../schema';
import { AGENT_PERSONAS, getPersonaIds } from '../agents';
import { LangGraphSqliteSaver } from '../persistence';
import { validateAgentsConfig, findWorkspaceRoot } from '../config';
import {
  RefinementConfig,
  DEFAULT_REFINEMENT_CONFIG,
  createRefinementNode,
} from './refinement-loop';
import {
  MeshRouterConfig,
  DEFAULT_MESH_CONFIG,
  createMeshRouterNode,
} from './mesh-router';
import {
  postRefinementLoopComment,
  type RefinementCommentPayload,
} from '../github/poster';

/**
 * Node function signature for LangGraph nodes.
 * Each persona node receives the current state and returns a partial state update.
 */
export type AgentNodeFn = (
  state: AgentState,
) => Promise<Partial<AgentState>> | Partial<AgentState>;

/**
 * Result returned from running the orchestrator.
 * Discriminated union: completed | paused.
 */
export type OrchestratorRunResult =
  | {
      status: 'completed';
      threadId: string;
      finalState: AgentState;
      stepCount: number;
    }
  | {
      status: 'paused';
      threadId: string;
      finalState: AgentState;
      stepCount: number;
      pausePayload: PausePayload;
    };

/**
 * OrchestratorGraph
 *
 * Thin wrapper around LangGraph's StateGraph for multi-agent orchestration.
 * Supports:
 * - Conditional edge routing between personas
 * - State persistence via SQLite with LangGraph checkpointing API
 * - Thread-based resumption via thread_id
 *
 * Usage:
 *   const graph = new OrchestratorGraph(dbPath, agentsMdPath);
 *   const result = await graph.invoke('issue-23', { metadata: {...} }, { configurable: { thread_id: 'issue-23' } });
 */
export class OrchestratorGraph {
  private graph: ReturnType<typeof StateGraph.prototype.compile>;
  private checkpointer: LangGraphSqliteSaver;
  private dbPath: string;
  private nodes: Map<string, AgentNodeFn> = new Map();
  private maxStepsLimit = 500;
  private refinementConfig: RefinementConfig = DEFAULT_REFINEMENT_CONFIG;
  private meshConfig: MeshRouterConfig = DEFAULT_MESH_CONFIG;

  /**
   * GitHub repo coordinates used when posting refinement loop comments.
   * Defaults to SteveJRobertson/isolate-ui; override via setGitHubRepo().
   */
  private githubOwner = 'SteveJRobertson';
  private githubRepo = 'isolate-ui';

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

    // Validate AGENTS.md on startup
    validateAgentsConfig(agentsMdPath);

    // Initialize LangGraph-compatible SQLite saver
    this.checkpointer = new LangGraphSqliteSaver(this.dbPath);

    // Create the state graph
    this.graph = this.buildGraph();

    // Register default no-op nodes
    getPersonaIds().forEach((id) => {
      this.registerNode(id, this.createDefaultNode(id));
    });
  }

  /**
   * Build and compile a LangGraph StateGraph with conditional edges.
   * Accepts a per-call recursion limit so concurrent run() calls each get
   * their own isolated compiled graph without mutating shared instance state.
   */
  private buildGraph(
    limit = this.maxStepsLimit,
  ): ReturnType<typeof StateGraph.prototype.compile> {
    const personaIds = getPersonaIds();

    // Define state channels using the Annotation API (replaces deprecated channels object).
    // Each field mirrors its Zod schema type via AgentState[field] to keep types in sync.
    const GraphAnnotation = Annotation.Root({
      messages: Annotation<AgentState['messages']>({
        reducer: (x, y) => [...(x ?? []), ...(y ?? [])],
        default: () => [],
      }),
      next_recipient: Annotation<AgentState['next_recipient']>({
        reducer: (x, y) => (y !== undefined ? y : x),
        default: () => null,
      }),
      code_buffer: Annotation<AgentState['code_buffer']>({
        reducer: (x, y) => (y !== undefined ? y : x),
        default: () => '',
      }),
      a11y_report: Annotation<AgentState['a11y_report']>({
        reducer: (x, y) => (y !== undefined ? y : x),
        default: () => '',
      }),
      arch_approval: Annotation<AgentState['arch_approval']>({
        reducer: (x, y) => (y !== undefined ? y : x),
        default: () => false,
      }),
      metadata: Annotation<AgentState['metadata']>({
        reducer: (x, y) => ({ ...x, ...y }),
        default: () => ({}),
      }),
      _step_count: Annotation<AgentState['_step_count']>({
        reducer: (x, y) => (y !== undefined ? y : x),
        default: () => 0,
      }),
      rejectionCount: Annotation<AgentState['rejectionCount']>({
        reducer: (x, y) => (y !== undefined ? y : x),
        default: () => 0,
      }),
      rejectionReason: Annotation<AgentState['rejectionReason']>({
        reducer: (x, y) => (y !== undefined ? y : x),
        default: () => '',
      }),
      lastApprovedBy: Annotation<AgentState['lastApprovedBy']>({
        reducer: (x, y) => (y !== undefined ? y : x),
        default: () => null,
      }),
      signoffs: Annotation<AgentState['signoffs']>({
        reducer: (x, y) => (y !== undefined ? y : x),
        default: () => ({}),
      }),
      mesh_loop_count: Annotation<AgentState['mesh_loop_count']>({
        reducer: (x, y) => (y !== undefined ? y : x),
        default: () => 0,
      }),
      mesh_origin: Annotation<AgentState['mesh_origin']>({
        reducer: (x, y) => (y !== undefined ? y : x),
        default: () => null,
      }),
      pause_context: Annotation<AgentState['pause_context']>({
        reducer: (x, y) => (y !== undefined ? y : x),
        default: () => null,
      }),
      parts: Annotation<AgentState['parts']>({
        reducer: (x, y) => (y !== undefined ? y : x),
        default: () => [],
      }),
    });

    const stateGraph = new StateGraph(GraphAnnotation);

    // Add nodes for each persona
    personaIds.forEach((personaId) => {
      stateGraph.addNode(personaId, async (state: AgentState) => {
        const nodeFn =
          this.nodes.get(personaId) || this.createDefaultNode(personaId);
        const result = await nodeFn(state);
        // Track step count in state (not instance field) to avoid concurrent invocation races
        return { ...result, _step_count: (state._step_count ?? 0) + 1 };
      });
    });

    // Add the Ambiguity Mesh Router node.
    // Inserted after every persona node via a deterministic edge.
    // Detects cross-persona queries and performs non-linear mesh jumps.
    const meshRouterFn = createMeshRouterNode(this.meshConfig);
    stateGraph.addNode('mesh_router', meshRouterFn);

    // Add the __pause__ node for interrupt-based pause handling.
    // Called when pause_context is set, allowing nodes to request pauses
    // without calling interrupt() themselves (which would fail in unit tests).
    stateGraph.addNode('__pause__', (state: AgentState) => {
      if (state.pause_context) {
        const pausePayload: PausePayload = {
          pause_context: state.pause_context,
          rejectionCount: state.rejectionCount ?? 0,
          rejectionReason: state.rejectionReason ?? '',
          signoffs: state.signoffs,
          mesh_origin: state.mesh_origin,
          mesh_loop_count: state.mesh_loop_count,
        };
        interrupt(pausePayload);
      }
      return {}; // Node requires a return; interrupt() will suspend before this matters
    });

    // Single routing function shared by START and mesh_router output.
    // Routes to a persona node when next_recipient is a known persona ID,
    // routes to __pause__ if pause_context is set, otherwise terminates (__end__).
    const routeByRecipient = (state: AgentState): string => {
      // If pause is requested, route to __pause__ node to call interrupt()
      if (state.pause_context) return '__pause__';
      const next = state.next_recipient;
      if (!next) return '__end__';
      return personaIds.includes(next) ? next : '__end__';
    };

    // START → persona nodes | __pause__ | __end__ (direct dispatch — bypasses mesh_router on initial entry)
    stateGraph.addConditionalEdges(START, routeByRecipient, {
      po: 'po',
      architect: 'architect',
      dev: 'dev',
      a11y: 'a11y',
      qa: 'qa',
      docs: 'docs',
      __pause__: '__pause__',
      __end__: '__end__',
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    // Persona nodes → mesh_router (deterministic)
    // Every persona output is inspected by the mesh router before the next
    // routing decision is made.
    personaIds.forEach((personaId) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stateGraph.addEdge(personaId as any, 'mesh_router' as any);
    });

    // mesh_router → persona nodes | __pause__ | __end__ (conditional)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stateGraph.addConditionalEdges('mesh_router' as any, routeByRecipient, {
      po: 'po',
      architect: 'architect',
      dev: 'dev',
      a11y: 'a11y',
      qa: 'qa',
      docs: 'docs',
      __pause__: '__pause__',
      __end__: '__end__',
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    // __pause__ → __end__ (deterministic)
    // Pauses route to __end__ once interrupt() has suspended execution.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stateGraph.addEdge('__pause__' as any, '__end__' as any);

    return stateGraph.compile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      checkpointer: this.checkpointer as any,
      recursionLimit: limit,
    } as any) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  /**
   * Configure the refinement loop for the PO → Dev → QA sequence.
   * Must be called before invoke() / run() to take effect.
   *
   * @param config - Partial overrides merged with DEFAULT_REFINEMENT_CONFIG
   */
  public configureRefinement(config: Partial<RefinementConfig>): void {
    this.refinementConfig = { ...DEFAULT_REFINEMENT_CONFIG, ...config };
  }

  /**
   * Configure the Ambiguity Mesh Router.
   *
   * Affects `run()`, which rebuilds the graph on every call.
   * For `invoke()` (which uses the graph compiled at construction time),
   * call this method before the very first `invoke()` call.
   *
   * Key options:
   * - maxMeshLoops: max non-linear jumps before MeshStalemateError (default 5)
   * - llmClient: inject a mock client for testing (avoids API calls)
   *
   * @param config - Partial overrides merged with DEFAULT_MESH_CONFIG
   */
  public configureMesh(config: Partial<MeshRouterConfig>): void {
    this.meshConfig = { ...DEFAULT_MESH_CONFIG, ...config };
  }

  /**
   * Set the GitHub repo coordinates used when posting refinement loop comments.
   * Defaults to 'SteveJRobertson/isolate-ui'.
   */
  public setGitHubRepo(owner: string, repo: string): void {
    this.githubOwner = owner;
    this.githubRepo = repo;
  }

  /**
   * Wrap a persona node with refinement loop logic (approval/rejection routing,
   * iteration counting, and iteration-limit interrupts).
   *
   * Use this instead of registerNode() for personas that participate in the
   * Definition of Ready refinement loop (po, dev, qa).
   *
   * @param personaId - Persona to wrap (must be in refinementConfig.baseSequence)
   * @param fn        - The underlying node implementation
   */
  public registerRefinementNode(personaId: string, fn: AgentNodeFn): void {
    if (!this.refinementConfig.baseSequence.includes(personaId)) {
      throw new Error(
        `Cannot register refinement node for "${personaId}": ` +
          `persona is not in the refinement sequence (${this.refinementConfig.baseSequence.join(' → ')}). ` +
          `Use registerNode() for personas outside the refinement loop.`,
      );
    }
    const wrapped = createRefinementNode(personaId, this.refinementConfig, fn);
    this.registerNode(personaId, wrapped);
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
    this.nodes.set(personaId, fn);
  }

  /**
   * Legacy API: invoke with run() method signature.
   * Maps to the new invoke() API internally.
   */
  public async run(
    threadId: string,
    initialInput?: Partial<AgentState>,
    maxSteps = 20,
  ): Promise<OrchestratorRunResult> {
    // Build a local graph with per-run recursionLimit to avoid mutating shared
    // instance state (which would race under concurrent run() calls).
    const localGraph = this.buildGraph(maxSteps);
    const githubToken = process.env['GITHUB_TOKEN'];

    try {
      const result = await this.invokeWithGraph(
        localGraph,
        threadId,
        initialInput,
        { configurable: { thread_id: threadId } },
      );

      // Post GitHub comment only when the full refinement loop completed:
      // next_recipient is null AND every persona in the sequence has signed off.
      const allSignedOff =
        result.finalState.next_recipient === null &&
        this.refinementConfig.baseSequence.every(
          (id) => result.finalState.signoffs?.[id] === true,
        );
      if (allSignedOff) {
        await this.tryPostComment(
          result.finalState,
          threadId,
          githubToken,
          undefined,
        );
      }

      return {
        ...result,
        status: 'completed' as const,
      };
    } catch (error) {
      // Convert LangGraph recursion limit errors to our custom error
      if (error instanceof Error && error.message.includes('Recursion limit')) {
        throw new Error(
          `exceeded max steps: recursion limit hit (limit: ${maxSteps})`,
        );
      }
      throw error;
    }
  }

  /**
   * Build and post a refinement loop comment to GitHub.
   * Silently no-ops when GITHUB_TOKEN is absent or posting fails (non-critical).
   */
  private async tryPostComment(
    state: AgentState,
    threadId: string,
    token: string | undefined,
    rejectionReason: string | undefined,
  ): Promise<void> {
    if (!token) return;

    // Require an explicit github_issue_id in metadata — do not derive from
    // threadId by stripping digits, as that can post to the wrong issue.
    const issueNumber = Number(state.metadata?.['github_issue_id']);
    if (!issueNumber || isNaN(issueNumber)) return;

    const payload: RefinementCommentPayload = {
      issueNumber,
      owner: this.githubOwner,
      repo: this.githubRepo,
      technicalSpec: Array.isArray(state.metadata?.['technicalSpec'])
        ? (state.metadata[
            'technicalSpec'
          ] as RefinementCommentPayload['technicalSpec'])
        : [],
      edgeCases: ['Loading', 'Error', 'Empty', 'Disabled', 'A11y'],
      signoffs: state.signoffs ?? {},
      previewUrl: state.metadata?.['previewUrl'] as string | undefined,
      rejectionReason,
    };

    try {
      const result = await postRefinementLoopComment(payload, token);
      if (result) {
        console.log(
          `[ai-orchestrator] GitHub comment posted: ${result.commentUrl}`,
        );
      }
    } catch (err) {
      // Non-fatal — log and continue
      console.warn(
        `[ai-orchestrator] Failed to post GitHub comment: ${String(err)}`,
      );
    }
  }

  /**
   * Invoke the graph with LangGraph's invoke API.
   * Uses thread_id for checkpoint-based resumption.
   * Per-invocation step counter to avoid thread-safety issues.
   *
   * @param threadId - GitHub Issue ID or other unique thread identifier
   * @param input - Initial input state
   * @param config - LangGraph config object (must include configurable.thread_id)
   */
  public async invoke(
    threadId: string,
    input?: Partial<AgentState>,
    config?: { configurable?: Record<string, unknown> },
  ): Promise<OrchestratorRunResult> {
    return this.invokeWithGraph(this.graph, threadId, input, config);
  }

  /**
   * Internal: invoke a specific compiled graph instance.
   * Separates graph selection from invocation logic so run() can use a
   * per-invocation local graph without touching shared instance state.
   */
  private async invokeWithGraph(
    graph: ReturnType<typeof StateGraph.prototype.compile>,
    threadId: string,
    input?: Partial<AgentState>,
    config?: { configurable?: Record<string, unknown> },
  ): Promise<OrchestratorRunResult> {
    // Check if there's an existing checkpoint for this thread
    const existingCheckpoint = this.checkpointer.getLatest(threadId);

    const fullConfig = {
      configurable: {
        ...(config?.configurable ?? {}),
        thread_id: threadId,
      },
    };

    // Parse input through schema for validation.
    // When input is provided alongside an existing checkpoint, spread the
    // checkpoint state first so that scalar fields (next_recipient, counters,
    // etc.) from the checkpoint are preserved unless explicitly overridden.
    //
    // IMPORTANT — do NOT pre-merge messages here. LangGraph's `messages`
    // channel reducer already appends input messages to the checkpoint history
    // (reducer: (x, y) => [...(x||[]), ...(y||[])]). Pre-merging would pass
    // the full checkpoint history as y, causing every resume to duplicate the
    // existing messages. Pass only the new message deltas via input.messages
    // and let the channel reducer handle the append exactly once.
    const baseState = existingCheckpoint ?? createDefaultAgentState();
    const parsedInput = input
      ? AgentStateSchema.parse({
          ...baseState,
          ...input,
        })
      : existingCheckpoint
        ? AgentStateSchema.parse(existingCheckpoint)
        : createDefaultAgentState();

    // Reset step counter — _step_count is per-invocation and must not carry
    // over from a previous run stored in the checkpoint.
    parsedInput._step_count = 0;

    // Only default to 'po' if starting fresh (no existing checkpoint and no explicit input)
    if (
      !existingCheckpoint &&
      !input?.next_recipient &&
      !parsedInput.next_recipient
    ) {
      parsedInput.next_recipient = 'po';
    }

    // Invoke the graph
    const result = await graph.invoke(parsedInput, fullConfig);

    // Extract the final state
    const finalState = AgentStateSchema.parse(result);

    // Detect pause_context marker set by nodes and handled by __pause__ node.
    // If pause_context is set, return paused result (interrupt() was already called by __pause__ node).
    if (finalState.pause_context) {
      const pausePayload: PausePayload = {
        pause_context: finalState.pause_context,
        rejectionCount: finalState.rejectionCount ?? 0,
        rejectionReason: finalState.rejectionReason ?? '',
        signoffs: finalState.signoffs,
        mesh_origin: finalState.mesh_origin,
        mesh_loop_count: finalState.mesh_loop_count,
      };
      return {
        status: 'paused',
        threadId,
        finalState,
        stepCount: finalState._step_count,
        pausePayload,
      };
    }

    return {
      status: 'completed',
      threadId,
      finalState,
      stepCount: finalState._step_count,
    };
  }

  /**
   * Get the current state of a thread without running it.
   */
  public getState(threadId: string): AgentState | null {
    const state = this.checkpointer.getLatest(threadId);
    return state ? AgentStateSchema.parse(state) : null;
  }

  /**
   * Legacy API: Get execution history for a thread.
   * Note: LangGraph checkpoint storage doesn't maintain step-by-step history.
   * This is a placeholder for backward compatibility with the old API.
   */
  public getHistory(
    threadId: string,
  ): Array<{ agent_id?: string; state: AgentState }> {
    // TODO: Implement history retrieval from LangGraph checkpoint writes
    const state = this.getState(threadId);
    return state ? [{ state }] : [];
  }

  /**
   * Legacy API: List all known thread IDs.
   * TODO: Implement thread listing from checkpoint metadata.
   */
  public listThreads(): string[] {
    // TODO: Implement thread listing from checkpoint storage
    return [];
  }

  /**
   * Close the database connection.
   */
  public close(): void {
    this.checkpointer.close();
  }

  /**
   * Default node implementation — routes to next persona in sequence.
   */
  private createDefaultNode(personaId: string): AgentNodeFn {
    return (state: AgentState): Partial<AgentState> => {
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
        },
      };
    };
  }
}
