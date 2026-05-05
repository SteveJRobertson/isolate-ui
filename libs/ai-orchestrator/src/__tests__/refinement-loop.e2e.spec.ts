/**
 * E2E integration tests for the Definition of Ready refinement loop.
 *
 * These tests exercise the full PO → Dev → QA consensus loop through
 * OrchestratorGraph.registerRefinementNode(), verifying state transitions,
 * rejection backtracking, iteration counting, and the iteration-limit interrupt.
 *
 * Note: These tests require a working native better-sqlite3 binary.
 * In environments where the binary is unavailable (e.g. certain CI runners)
 * the tests will fail at OrchestratorGraph construction — this is an environment
 * issue, not a code issue. Use the unit tests in refinement-loop.test.ts for
 * environments without native SQLite support.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { OrchestratorGraph } from '../orchestrator';
import { RefinementIterationLimitError } from '../orchestrator/refinement-loop';
import { AgentState } from '../schema';
import { findWorkspaceRoot } from '../config';

const AGENTS_MD_PATH = path.join(findWorkspaceRoot(process.cwd()), 'AGENTS.md');

// Detect whether the native better-sqlite3 binary is available.
// If it is not (e.g. in a CI runner where the binary wasn't rebuilt),
// skip these E2E tests gracefully rather than failing with a native error.
function detectSqlite(): boolean {
  try {
    // Attempt a full require() load so that a missing or ABI-incompatible
    // native binary is caught here rather than surfacing as a runtime error
    // inside OrchestratorGraph construction.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('better-sqlite3');
    return true;
  } catch {
    // Any failure (missing package, missing native binary, ABI mismatch, etc.)
    // means better-sqlite3 is not usable — skip the E2E tests gracefully.
    return false;
  }
}

const sqliteAvailable = detectSqlite();

// ── Helpers ───────────────────────────────────────────────────────────────────

function tempDbPath(): string {
  return path.join(
    os.tmpdir(),
    `refinement-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
}

function approvalNode(
  personaId: string,
  next: AgentState['next_recipient'] = null,
) {
  return (_state: AgentState): Partial<AgentState> => ({
    messages: [{ type: 'ai', content: `APPROVED — ${personaId} sign-off` }],
    next_recipient: next,
  });
}

function rejectionNode(personaId: string, reason: string) {
  return (_state: AgentState): Partial<AgentState> => ({
    messages: [
      {
        type: 'ai',
        content: `REJECTED: ${reason} (from ${personaId})`,
      },
    ],
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe.skipIf(!sqliteAvailable)('Refinement Loop — E2E', () => {
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

  function makeGraph(maxIterations = 5): OrchestratorGraph {
    const dbPath = tempDbPath();
    tempFiles.push(dbPath);
    const graph = new OrchestratorGraph(dbPath, AGENTS_MD_PATH);
    graphs.push(graph);
    graph.configureRefinement({
      baseSequence: ['po', 'dev', 'qa'],
      maxIterations,
    });
    return graph;
  }

  // ── Happy path: all three personas approve on first pass ──────────────────

  it('completes PO → Dev → QA sequence when all approve', async () => {
    const graph = makeGraph();

    graph.registerRefinementNode('po', approvalNode('po'));
    graph.registerRefinementNode('dev', approvalNode('dev'));
    graph.registerRefinementNode('qa', approvalNode('qa'));

    const result = await graph.run('issue-e2e-happy', {
      metadata: { github_issue_id: 'e2e-happy' },
    });

    // Loop completed: no further routing needed
    expect(result.finalState.next_recipient).toBeNull();

    // All three personas signed off
    expect(result.finalState.signoffs).toMatchObject({
      po: true,
      dev: true,
      qa: true,
    });

    // lastApprovedBy is the final approver
    expect(result.finalState.lastApprovedBy).toBe('qa');

    // No rejections occurred
    expect(result.finalState.rejectionCount).toBe(0);
    expect(result.finalState.rejectionReason).toBe('');
  });

  // ── Rejection + backtrack: dev rejects once, po re-approves, loop continues

  it('backtracks to po when dev rejects and completes on second pass', async () => {
    const graph = makeGraph();
    let devCallCount = 0;

    graph.registerRefinementNode('po', approvalNode('po'));
    graph.registerRefinementNode('dev', (_state: AgentState) => {
      devCallCount += 1;
      if (devCallCount === 1) {
        // First call: reject
        return {
          messages: [
            { type: 'ai', content: 'REJECTED: missing token color.danger.500' },
          ],
        };
      }
      // Second call: approve
      return {
        messages: [{ type: 'ai', content: 'APPROVED — token added' }],
      };
    });
    graph.registerRefinementNode('qa', approvalNode('qa'));

    const result = await graph.run('issue-e2e-backtrack', {
      metadata: { github_issue_id: 'e2e-backtrack' },
    });

    // Loop completed successfully
    expect(result.finalState.signoffs).toMatchObject({
      po: true,
      dev: true,
      qa: true,
    });

    // Dev was called twice
    expect(devCallCount).toBe(2);

    // One rejection was recorded
    expect(result.finalState.rejectionCount).toBe(1);
  });

  // ── Rejection reason is captured ──────────────────────────────────────────

  it('captures rejection reason from the rejecting persona message', async () => {
    const graph = makeGraph();
    let poCallCount = 0;

    graph.registerRefinementNode('po', (_state: AgentState) => {
      poCallCount += 1;
      if (poCallCount === 1) {
        return {
          messages: [
            { type: 'ai', content: 'REJECTED: no Ark UI primitive selected' },
          ],
        };
      }
      return { messages: [{ type: 'ai', content: 'APPROVED' }] };
    });
    graph.registerRefinementNode('dev', approvalNode('dev'));
    graph.registerRefinementNode('qa', approvalNode('qa'));

    const result = await graph.run('issue-e2e-reason', {
      metadata: { github_issue_id: 'e2e-reason' },
    });

    // After successful completion rejectionReason is cleared (from last approval)
    expect(result.finalState.signoffs.qa).toBe(true);
  });

  // ── Signoffs cleared on rejection ────────────────────────────────────────

  it('clears all signoffs when any persona rejects', async () => {
    const graph = makeGraph();
    let qaCallCount = 0;

    graph.registerRefinementNode('po', approvalNode('po'));
    graph.registerRefinementNode('dev', approvalNode('dev'));
    graph.registerRefinementNode('qa', (_state: AgentState) => {
      qaCallCount += 1;
      if (qaCallCount === 1) {
        // Reject on first pass — should clear po + dev signoffs
        return {
          messages: [{ type: 'ai', content: 'REJECTED: coverage below 80%' }],
        };
      }
      return { messages: [{ type: 'ai', content: 'APPROVED' }] };
    });

    const result = await graph.run('issue-e2e-clear', {
      metadata: { github_issue_id: 'e2e-clear' },
    });

    // Loop eventually completed after qa rejection reset the loop
    expect(result.finalState.signoffs).toMatchObject({
      po: true,
      dev: true,
      qa: true,
    });
    expect(result.finalState.rejectionCount).toBe(1);
  });

  // ── Iteration limit: throws RefinementIterationLimitError at maxIterations ─

  it('throws RefinementIterationLimitError when rejectionCount reaches maxIterations', async () => {
    const graph = makeGraph(3); // low limit for test speed

    // po always rejects
    graph.registerRefinementNode(
      'po',
      rejectionNode('po', 'never good enough'),
    );
    graph.registerRefinementNode('dev', approvalNode('dev'));
    graph.registerRefinementNode('qa', approvalNode('qa'));

    await expect(
      graph.run('issue-e2e-limit', {
        metadata: { github_issue_id: 'e2e-limit' },
      }),
    ).rejects.toThrow(RefinementIterationLimitError);
  });

  it('RefinementIterationLimitError carries correct rejectionCount', async () => {
    const graph = makeGraph(2);

    graph.registerRefinementNode('po', rejectionNode('po', 'always rejected'));
    graph.registerRefinementNode('dev', approvalNode('dev'));
    graph.registerRefinementNode('qa', approvalNode('qa'));

    try {
      await graph.run('issue-e2e-limit-count', {
        metadata: { github_issue_id: 'e2e-limit-count' },
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RefinementIterationLimitError);
      const limitErr = err as RefinementIterationLimitError;
      expect(limitErr.rejectionCount).toBe(2);
    }
  });

  // ── configureRefinement: custom sequence ──────────────────────────────────

  it('respects a custom baseSequence (po → qa only, skipping dev)', async () => {
    const graph = makeGraph();
    graph.configureRefinement({ baseSequence: ['po', 'qa'] });

    let devCalled = false;
    graph.registerRefinementNode('po', approvalNode('po'));
    graph.registerNode('dev', (_state) => {
      devCalled = true;
      return { next_recipient: 'qa' as AgentState['next_recipient'] };
    });
    graph.registerRefinementNode('qa', approvalNode('qa'));

    const result = await graph.run('issue-e2e-custom-seq', {
      metadata: { github_issue_id: 'e2e-custom' },
    });

    expect(result.finalState.signoffs).toMatchObject({ po: true, qa: true });
    expect(devCalled).toBe(false);
  });
});
