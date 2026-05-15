/**
 * Regression tests for fresh-graph checkpoint resumption (Issue #88).
 *
 * OrchestratorGraph.run() builds a fresh compiled graph (localGraph) on every
 * call via buildGraph(). When run() is called a second time with the same
 * threadId, the fresh localGraph must resume from the persisted checkpoint
 * without throwing:
 *   TypeError: Cannot read properties of undefined (reading 'configurable')
 *   at Function.initialize (pregel/loop.ts:485)
 *
 * Root cause (resolved in PR #91): the old LangGraphSqliteSaver.getTuple()
 * returned a legacy array [config, checkpoint, metadata] rather than the
 * LangGraph 1.3.0 CheckpointTuple object { config, checkpoint, metadata,
 * pendingWrites }. LangGraph's PregelLoop.initialize() spreads
 * `saved.config.configurable` unconditionally (loop.js:182). When `saved` was
 * an array, `saved.config` was undefined → TypeError.
 *
 * Fix already applied in PR #91: getTuple() now returns a CheckpointTuple
 * object. These tests serve as a regression guard.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { OrchestratorGraph } from '../orchestrator';
import { AgentState } from '../schema';
import { findWorkspaceRoot } from '../config';

const AGENTS_MD_PATH = path.join(findWorkspaceRoot(process.cwd()), 'AGENTS.md');

function detectSqlite(): boolean {
  try {
    require('better-sqlite3');
    return true;
  } catch {
    return false;
  }
}

const sqliteAvailable = detectSqlite();

// ── Helpers ───────────────────────────────────────────────────────────────────

function tempDbPath(): string {
  return path.join(
    os.tmpdir(),
    `resumption-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe.skipIf(!sqliteAvailable)(
  'Checkpoint Resumption — fresh graph instance (Issue #88)',
  () => {
    const graphs: OrchestratorGraph[] = [];
    const tempFiles: string[] = [];

    afterEach(() => {
      graphs.forEach((g) => {
        try {
          g.close();
        } catch {
          // ignore close errors
        }
      });
      graphs.length = 0;
      tempFiles.forEach((f) => {
        try {
          fs.unlinkSync(f);
        } catch {
          // file may not exist
        }
      });
      tempFiles.length = 0;
    });

    function makeGraph(): OrchestratorGraph {
      const dbPath = tempDbPath();
      tempFiles.push(dbPath);
      const graph = new OrchestratorGraph(dbPath, AGENTS_MD_PATH);
      graphs.push(graph);
      return graph;
    }

    // ── Reproduction: second run() on same threadId must not throw TypeError ──

    it('second run() on the same threadId resumes checkpoint without TypeError', async () => {
      const graph = makeGraph();

      // Stub all persona nodes to run quickly, emit one message each, and
      // terminate cleanly. Emitting messages lets us assert that the second
      // run correctly appended to the checkpoint's existing message history.
      graph.registerNode(
        'po',
        (_state: AgentState): Partial<AgentState> => ({
          messages: [{ type: 'ai', content: 'po: stub approval' }],
          next_recipient: 'architect',
          metadata: { ..._state.metadata, po_processed: true },
        }),
      );
      graph.registerNode(
        'architect',
        (_state: AgentState): Partial<AgentState> => ({
          messages: [{ type: 'ai', content: 'architect: stub approval' }],
          arch_approval: true,
          next_recipient: 'dev',
          metadata: { ..._state.metadata, architect_processed: true },
        }),
      );
      graph.registerNode(
        'dev',
        (_state: AgentState): Partial<AgentState> => ({
          messages: [{ type: 'ai', content: 'dev: stub approval' }],
          code_buffer: '// stub',
          next_recipient: 'a11y',
          metadata: { ..._state.metadata, dev_processed: true },
        }),
      );
      graph.registerNode(
        'a11y',
        (_state: AgentState): Partial<AgentState> => ({
          messages: [{ type: 'ai', content: 'a11y: stub approval' }],
          a11y_report: 'No violations',
          next_recipient: 'qa',
          metadata: { ..._state.metadata, a11y_processed: true },
        }),
      );
      graph.registerNode(
        'qa',
        (_state: AgentState): Partial<AgentState> => ({
          messages: [{ type: 'ai', content: 'qa: stub approval' }],
          next_recipient: 'docs',
          metadata: { ..._state.metadata, qa_processed: true },
        }),
      );
      graph.registerNode(
        'docs',
        (_state: AgentState): Partial<AgentState> => ({
          messages: [{ type: 'ai', content: 'docs: stub approval' }],
          next_recipient: null,
          metadata: { ..._state.metadata, docs_processed: true },
        }),
      );

      const threadId = 'thread-fresh-resumption-88';

      // ── First run: completes and persists a checkpoint ──
      const firstResult = await graph.run(threadId, {
        metadata: { component: 'Button' },
      });
      expect(firstResult.status).toBe('completed');
      expect(firstResult.finalState.next_recipient).toBeNull();
      const firstMessageCount = firstResult.finalState.messages.length;

      // ── Second run: same threadId, run() builds a fresh localGraph via
      //    buildGraph() — this is the exact path that previously crashed with:
      //    TypeError: Cannot read properties of undefined (reading 'configurable')
      //    at Function.initialize (pregel/loop.ts:485)
      //    Fixed in PR #91: getTuple() now returns CheckpointTuple object.
      const secondResult = await graph.run(threadId, {
        next_recipient: 'po',
        signoffs: {},
        rejectionCount: 0,
        rejectionReason: '',
        metadata: { component: 'Button' },
      });

      expect(secondResult.status).toBe('completed');
      // The messages reducer appends new messages on top of the checkpoint
      // history, so total must exceed the first run's count.
      expect(secondResult.finalState.messages.length).toBeGreaterThan(
        firstMessageCount,
      );
    });

    // ── Fresh-start path: run() with a brand-new threadId must start fresh ──

    it('run() with a threadId that has no checkpoint starts fresh without errors', async () => {
      const graph = makeGraph();

      graph.registerNode(
        'po',
        (_state: AgentState): Partial<AgentState> => ({
          messages: [{ type: 'ai', content: 'po: stub approval' }],
          next_recipient: null,
          metadata: { ..._state.metadata, po_processed: true },
        }),
      );

      const result = await graph.run('brand-new-thread-88', {
        metadata: { component: 'Input' },
      });

      expect(result.status).toBe('completed');
      expect(result.finalState.next_recipient).toBeNull();
      expect(result.finalState.messages.length).toBeGreaterThan(0);
    });
  },
);
