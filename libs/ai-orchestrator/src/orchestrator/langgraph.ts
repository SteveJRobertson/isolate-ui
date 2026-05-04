import * as path from 'path';
import { StateGraph, START } from '@langchain/langgraph';
import {
  AgentState,
  createDefaultAgentState,
  AgentStateSchema,
} from '../schema';
import { AGENT_PERSONAS, getPersonaIds } from '../agents';
import { LangGraphSqliteSaver } from '../persistence';
import { validateAgentsConfig, findWorkspaceRoot } from '../config';

/**
 * Node function signature for LangGraph nodes.
 * Each persona node receives the current state and returns a partial state update.
 */
export type AgentNodeFn = (
  state: AgentState,
) => Promise<Partial<AgentState>> | Partial<AgentState>;

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
  private stepCount = 0;
  private maxStepsLimit = 500;

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
   * Build the LangGraph StateGraph with conditional edges.
   * Uses the maxStepsLimit to control recursion depth.
   */
  private buildGraph() {
    const personaIds = getPersonaIds();

    // Create the graph with AgentState as the state type
    const stateGraph = new StateGraph<AgentState>({
      channels: {
        messages: {
          value: (x: any, y: any) => [...(x || []), ...(y || [])],
          default: () => [],
        },
        next_recipient: {
          value: (x: any, y: any) => (y !== undefined ? y : x), // Properly handle null values
          default: () => null,
        },
        code_buffer: {
          value: (x: any, y: any) => (y !== undefined ? y : x),
          default: () => '',
        },
        a11y_report: {
          value: (x: any, y: any) => (y !== undefined ? y : x),
          default: () => '',
        },
        arch_approval: {
          value: (x: any, y: any) => (y !== undefined ? y : x),
          default: () => false,
        },
        metadata: {
          value: (x: any, y: any) => ({ ...x, ...y }),
          default: () => ({}),
        },
      },
    });

    // Add nodes for each persona
    personaIds.forEach((personaId) => {
      stateGraph.addNode(personaId, async (state: AgentState) => {
        const nodeFn =
          this.nodes.get(personaId) || this.createDefaultNode(personaId);
        const result = await nodeFn(state);
        this.stepCount++;
        return result;
      });
    });

    // Conditional router function
    const routeByRecipient = (state: AgentState): string => {
      const next = state.next_recipient;
      return !next ? '__end__' : personaIds.includes(next) ? next : '__end__';
    };

    // Add conditional edges from START
    stateGraph.addConditionalEdges(START, routeByRecipient, {
      po: 'po',
      architect: 'architect',
      dev: 'dev',
      a11y: 'a11y',
      qa: 'qa',
      docs: 'docs',
      __end__: '__end__',
    } as any);

    // Add conditional edges from each persona node
    personaIds.forEach((personaId) => {
      stateGraph.addConditionalEdges(personaId as any, routeByRecipient, {
        po: 'po',
        architect: 'architect',
        dev: 'dev',
        a11y: 'a11y',
        qa: 'qa',
        docs: 'docs',
        __end__: '__end__',
      } as any);
    });

    // Compile with recursion limit based on maxStepsLimit
    return stateGraph.compile({
      checkpointer: this.checkpointer as any,
      recursionLimit: this.maxStepsLimit,
    } as any);
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
    this.stepCount = 0;
    // Set recursion limit for this execution
    this.maxStepsLimit = maxSteps;
    this.graph = this.buildGraph();

    try {
      const result = await this.invoke(threadId, initialInput, {
        configurable: { thread_id: threadId },
      });

      return result;
    } catch (error) {
      // Convert LangGraph recursion limit errors to our custom error
      if (error instanceof Error && error.message.includes('Recursion limit')) {
        throw new Error(
          `exceeded max steps: recursion limit hit (limit: ${maxSteps})`,
        );
      }
      throw error;
    } finally {
      // Reset to default limit
      this.maxStepsLimit = 500;
      this.graph = this.buildGraph();
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
    config?: { configurable?: Record<string, any> },
  ): Promise<OrchestratorRunResult> {
    // Reset step counter for this invocation (thread-safe per-invocation tracking)
    this.stepCount = 0;

    // Check if there's an existing checkpoint for this thread
    const existingCheckpoint = this.checkpointer.getLatest(threadId);

    const fullConfig = {
      configurable: {
        ...(config?.configurable ?? {}),
        thread_id: threadId,
      },
    };

    // Parse input through schema for validation
    const parsedInput = input
      ? AgentStateSchema.parse({
          ...createDefaultAgentState(),
          ...input,
        })
      : existingCheckpoint
        ? AgentStateSchema.parse(existingCheckpoint)
        : createDefaultAgentState();

    // Only default to 'po' if starting fresh (no existing checkpoint and no explicit input)
    if (
      !existingCheckpoint &&
      !input?.next_recipient &&
      !parsedInput.next_recipient
    ) {
      parsedInput.next_recipient = 'po';
    }

    // Invoke the graph
    const result = await this.graph.invoke(parsedInput, fullConfig);

    // Extract the final state
    const finalState = AgentStateSchema.parse(result);

    return {
      threadId,
      finalState,
      stepCount: this.stepCount,
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
