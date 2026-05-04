import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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

    await expect(graph.run('issue-loop', {}, 5)).rejects.toThrow(
      'exceeded max steps',
    );
  });

  it('getHistory returns all steps in order', async () => {
    const graph = new OrchestratorGraph(tempDbPath(), AGENTS_MD_PATH);
    graphs.push(graph);

    await graph.run('issue-history', {});

    const history = graph.getHistory('issue-history');
    expect(history.length).toBe(6);
    expect(history[0].agent_id).toBe('po');
    expect(history[5].agent_id).toBe('docs');
  });

  it('listThreads returns all known thread IDs', async () => {
    const graph = new OrchestratorGraph(tempDbPath(), AGENTS_MD_PATH);
    graphs.push(graph);

    await graph.run('thread-alpha', {});
    await graph.run('thread-beta', {});

    const threads = graph.listThreads();
    expect(threads).toContain('thread-alpha');
    expect(threads).toContain('thread-beta');
  });
});
