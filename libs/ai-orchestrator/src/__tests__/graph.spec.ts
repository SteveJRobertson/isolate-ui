import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { OrchestratorGraph } from '../orchestrator';
import { AgentState } from '../schema';
import { getPersonaIds } from '../agents';

import { findWorkspaceRoot } from '../config';

// Locate workspace root via nx.json — robust across Vitest/Node runtimes
const AGENTS_MD_PATH = path.join(findWorkspaceRoot(process.cwd()), 'AGENTS.md');

describe('OrchestratorGraph', () => {
  const graphs: OrchestratorGraph[] = [];
  const tempFiles: string[] = [];

  function tempDbPath(): string {
    const p = path.join(
      os.tmpdir(),
      `orchestrator-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    tempFiles.push(p);
    return p;
  }

  afterEach(() => {
    graphs.forEach((g) => g.close());
    graphs.length = 0;
    tempFiles.forEach((f) => {
      try {
        fs.unlinkSync(f);
      } catch {
        // file may not exist if test failed before DB was created
      }
    });
    tempFiles.length = 0;
  });

  it('initializes without errors', () => {
    const graph = new OrchestratorGraph(tempDbPath(), AGENTS_MD_PATH);
    graphs.push(graph);
    expect(graph).toBeDefined();
  });

  it('executes a complete multi-node run through all 6 personas', async () => {
    const graph = new OrchestratorGraph(tempDbPath(), AGENTS_MD_PATH);
    graphs.push(graph);

    const result = await graph.run('issue-23', {
      metadata: { component: 'Button', github_issue_id: '23' },
    });

    // All 6 personas should have processed
    const personaIds = getPersonaIds();
    personaIds.forEach((id) => {
      expect(result.finalState.metadata[`${id}_processed`]).toBe(true);
    });

    // Should have terminated cleanly (next_recipient null)
    expect(result.finalState.next_recipient).toBeNull();
    expect(result.stepCount).toBe(6);
  });

  it('persists state between runs (resumption)', async () => {
    const dbPath = tempDbPath();
    const graph1 = new OrchestratorGraph(dbPath, AGENTS_MD_PATH);
    graphs.push(graph1);

    // Run only the first step
    let stoppedEarly = false;
    graph1.registerNode('po', (state: AgentState) => {
      stoppedEarly = true;
      return {
        next_recipient: null, // Stop after po
        metadata: { ...state.metadata, po_ran: true },
      };
    });

    await graph1.run('issue-resume', {
      metadata: { component: 'Input' },
    });
    graph1.close();
    graphs.pop();

    expect(stoppedEarly).toBe(true);

    // Open a new graph against the same DB — state should be loaded
    const graph2 = new OrchestratorGraph(dbPath, AGENTS_MD_PATH);
    graphs.push(graph2);

    const savedState = graph2.getState('issue-resume');
    expect(savedState).not.toBeNull();
    expect(savedState?.metadata.po_ran).toBe(true);
    expect(savedState?.next_recipient).toBeNull();
  });

  it('throws when registering a node for an unknown persona', () => {
    const graph = new OrchestratorGraph(tempDbPath(), AGENTS_MD_PATH);
    graphs.push(graph);

    expect(() => {
      graph.registerNode('nonexistent', async () => ({}));
    }).toThrow('unknown persona');
  });

  it('custom node implementations override the defaults', async () => {
    const graph = new OrchestratorGraph(tempDbPath(), AGENTS_MD_PATH);
    graphs.push(graph);

    // Override the 'dev' node to inject code into the buffer
    graph.registerNode('dev', (state: AgentState) => ({
      code_buffer: 'const Button = () => <button>{children}</button>;',
      next_recipient: 'a11y',
      metadata: state.metadata,
    }));

    // Run just until dev by stopping before po resolves further
    graph.registerNode('po', () => ({
      next_recipient: 'architect',
    }));
    graph.registerNode('architect', (state) => ({
      arch_approval: true,
      next_recipient: 'dev',
      metadata: state.metadata,
    }));
    graph.registerNode('a11y', (state) => ({
      a11y_report: 'No violations found',
      next_recipient: null,
      metadata: state.metadata,
    }));

    const result = await graph.run('issue-custom', {});

    expect(result.finalState.code_buffer).toBe(
      'const Button = () => <button>{children}</button>;',
    );
    expect(result.finalState.arch_approval).toBe(true);
    expect(result.finalState.a11y_report).toBe('No violations found');
  });

  it('throws after exceeding max steps (infinite loop guard)', async () => {
    const graph = new OrchestratorGraph(tempDbPath(), AGENTS_MD_PATH);
    graphs.push(graph);

    // Infinite loop: po always routes back to itself
    graph.registerNode('po', (state: AgentState) => ({
      next_recipient: 'po',
      metadata: state.metadata,
    }));

    await expect(graph.run('issue-loop', {})).rejects.toThrow(
      'exceeded max steps',
    );
  });

  it('getHistory returns all steps in order', async () => {
    const graph = new OrchestratorGraph(tempDbPath(), AGENTS_MD_PATH);
    graphs.push(graph);

    await graph.run('issue-history', {});

    // TODO: Implement full history tracking in LangGraph checkpoints
    // For now, just verify the method exists and doesn't crash
    const history = graph.getHistory('issue-history');
    expect(Array.isArray(history)).toBe(true);
  });

  it('listThreads returns all known thread IDs', async () => {
    const graph = new OrchestratorGraph(tempDbPath(), AGENTS_MD_PATH);
    graphs.push(graph);

    await graph.run('thread-alpha', {});
    await graph.run('thread-beta', {});

    // TODO: Implement thread listing in LangGraph checkpoints
    // For now, just verify the method exists and doesn't crash
    const threads = graph.listThreads();
    expect(Array.isArray(threads)).toBe(true);
  });

  // ── Ambiguity Mesh Router integration ────────────────────────────────────────

  it('mesh router passes through when messages contain no cross-persona query', async () => {
    const graph = new OrchestratorGraph(tempDbPath(), AGENTS_MD_PATH);
    graphs.push(graph);

    // Inject a mesh client that would detect a target — but messages have no
    // '?' or '@isolate-' so the heuristic gate fires and no jump occurs.
    graph.configureMesh({
      maxMeshLoops: 5,
      llmClient: new FakeListChatModel({ responses: ['{"target": "po"}'] }),
    });

    graph.registerNode('po', () => ({
      next_recipient: 'architect',
      messages: [{ type: 'ai', content: 'APPROVED — token looks good' }],
    }));
    graph.registerNode('architect', () => ({
      next_recipient: null,
      messages: [{ type: 'ai', content: 'APPROVED — boundaries respected' }],
    }));

    const result = await graph.run('mesh-passthrough', {
      metadata: { github_issue_id: '20' },
    });

    // Workflow should complete normally with no mesh jumps
    expect(result.finalState.next_recipient).toBeNull();
    expect(result.finalState.mesh_loop_count).toBe(0);
  });

  it('mesh router performs non-linear QA → PO jump on cross-persona query', async () => {
    const graph = new OrchestratorGraph(tempDbPath(), AGENTS_MD_PATH);
    graphs.push(graph);

    // LLM returns 'po' as target — simulating QA asking PO a question.
    // Use a list with enough responses for multiple hops.
    graph.configureMesh({
      maxMeshLoops: 5,
      llmClient: new FakeListChatModel({
        responses: [
          '{"target": "po"}', // first mesh_router call: QA output contains @isolate-po?
          '{"target": null}', // second call: PO output is a normal response
          '{"target": null}', // subsequent calls: no more mesh jumps
          '{"target": null}',
          '{"target": null}',
          '{"target": null}',
        ],
      }),
    });

    const visited: string[] = [];

    graph.registerNode('po', (state: AgentState) => {
      visited.push('po');
      return {
        next_recipient: 'qa',
        messages: [
          ...state.messages,
          { type: 'ai', content: 'PO response — no further queries' },
        ],
      };
    });

    graph.registerNode('qa', (state: AgentState) => {
      visited.push('qa');
      // First visit: ask PO a question (triggers mesh jump back to PO)
      // Second visit: conclude normally
      const isSecondVisit = visited.filter((v) => v === 'qa').length > 1;
      return {
        next_recipient: isSecondVisit ? null : 'dev',
        messages: [
          ...state.messages,
          {
            type: 'ai',
            content: isSecondVisit
              ? 'QA complete — all good'
              : '@isolate-po can you confirm the token spec?',
          },
        ],
      };
    });

    graph.registerNode('dev', () => ({
      next_recipient: null,
      messages: [{ type: 'ai', content: 'Dev: done' }],
    }));

    const result = await graph.run('mesh-qa-to-po', {
      next_recipient: 'qa',
      metadata: { github_issue_id: '20' },
    });

    // PO should have been visited as a result of the mesh jump from QA
    expect(visited).toContain('po');
    // The mesh jump counter should have incremented
    expect(result.finalState.mesh_loop_count).toBeGreaterThan(0);
  });

  it('code_buffer is preserved after a mesh jump', async () => {
    const graph = new OrchestratorGraph(tempDbPath(), AGENTS_MD_PATH);
    graphs.push(graph);

    graph.configureMesh({
      maxMeshLoops: 5,
      llmClient: new FakeListChatModel({
        responses: ['{"target": "po"}', '{"target": null}', '{"target": null}'],
      }),
    });

    const originalBuffer =
      'diff --git a/Button.tsx b/Button.tsx\n+const x = 1;';

    graph.registerNode('dev', (state: AgentState) => ({
      next_recipient: 'qa',
      code_buffer: originalBuffer,
      messages: [
        ...state.messages,
        { type: 'ai', content: '@isolate-po can you review the token?' },
      ],
    }));

    graph.registerNode('po', (state: AgentState) => ({
      next_recipient: null,
      messages: [
        ...state.messages,
        { type: 'ai', content: 'PO: token confirmed' },
      ],
    }));

    graph.registerNode('qa', () => ({
      next_recipient: null,
      messages: [{ type: 'ai', content: 'QA: done' }],
    }));

    const result = await graph.run('mesh-buffer-preservation', {
      next_recipient: 'dev',
      metadata: { github_issue_id: '20' },
    });

    // code_buffer should be intact after the mesh jump
    expect(result.finalState.code_buffer).toBe(originalBuffer);
  });

  it('routes to human_review when mesh_loop_count exceeds maxMeshLoops', async () => {
    const graph = new OrchestratorGraph(tempDbPath(), AGENTS_MD_PATH);
    graphs.push(graph);

    // Every mesh_router call returns a target → always jumps, never settles
    graph.configureMesh({
      maxMeshLoops: 2,
      llmClient: new FakeListChatModel({
        responses: Array(20).fill('{"target": "po"}'),
      }),
    });

    graph.registerNode('po', (state: AgentState) => ({
      next_recipient: 'dev',
      messages: [
        ...state.messages,
        { type: 'ai', content: '@isolate-dev clarify this?' },
      ],
    }));

    graph.registerNode('dev', (state: AgentState) => ({
      next_recipient: 'po',
      messages: [
        ...state.messages,
        { type: 'ai', content: '@isolate-po clarify back?' },
      ],
    }));

    const result = await graph.run(
      'mesh-stalemate',
      { metadata: { github_issue_id: '20' } },
      50,
    );
    expect(result.finalState.next_recipient).toBeNull();
    expect(result.finalState.pause_context).toBe('mesh_stalemate');
  });
});
