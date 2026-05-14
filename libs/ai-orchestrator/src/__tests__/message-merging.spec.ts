import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { OrchestratorGraph } from '../orchestrator';
import { AgentState } from '../schema';
import { findWorkspaceRoot } from '../config';

// Locate workspace root via nx.json
const AGENTS_MD_PATH = path.join(findWorkspaceRoot(process.cwd()), 'AGENTS.md');

describe('Message merging with checkpoint resumption', () => {
  const graphs: OrchestratorGraph[] = [];
  const tempFiles: string[] = [];

  function tempDbPath(): string {
    const p = path.join(
      os.tmpdir(),
      `message-merge-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
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
        // file may not exist
      }
    });
    tempFiles.length = 0;
  });

  it('appends delta messages without duplication (single graph instance, multiple runs)', async () => {
    // REQUIREMENT (from issue #67): When a thread is resumed multiple times with delta
    // messages, the reducer must append messages exactly once each time.
    // This test uses a SINGLE long-lived graph instance (like production webhook-listener)
    // and verifies message append correctness across multiple run() calls.

    const dbPath = tempDbPath();
    const graph = new OrchestratorGraph(dbPath, AGENTS_MD_PATH);
    graphs.push(graph);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    graph.registerNode('po', (_state: AgentState) => {
      return { next_recipient: null };
    });

    // Run 1: Store initial message
    await graph.run('merge-single-graph', {
      messages: [{ type: 'human', content: 'message_1' }],
    });

    let state = graph.getState('merge-single-graph');
    expect(state?.messages).toHaveLength(1);
    expect(state?.messages[0].content).toBe('message_1');

    // Run 2: Append delta message
    await graph.run('merge-single-graph', {
      messages: [{ type: 'human', content: 'message_2' }],
    });

    state = graph.getState('merge-single-graph');
    expect(state?.messages).toHaveLength(2);
    expect(state?.messages[0].content).toBe('message_1');
    expect(state?.messages[1].content).toBe('message_2');

    // Run 3: Append another delta message
    await graph.run('merge-single-graph', {
      messages: [{ type: 'human', content: 'message_3' }],
    });

    state = graph.getState('merge-single-graph');
    expect(state?.messages).toHaveLength(3);
    expect(state?.messages[0].content).toBe('message_1');
    expect(state?.messages[1].content).toBe('message_2');
    expect(state?.messages[2].content).toBe('message_3');
  });

  it('appends delta messages to checkpoint history without duplication on resume (ORIGINAL)', async () => {
    // REQUIREMENT (from issue #67): When a thread is checkpointed and resumed
    // with delta messages, the channel reducer should append messages exactly once.
    // Scenario: run() stores msg_1 → close graph → new graph loads checkpoint →
    // run with delta message (msg_2) → verify total is exactly 2, not duplicated

    const dbPath = tempDbPath();

    // --- Phase 1: Initial run stores first message ---
    const graph1 = new OrchestratorGraph(dbPath, AGENTS_MD_PATH);
    graphs.push(graph1);

    graph1.registerNode('po', (_state: AgentState) => {
      return { next_recipient: null };
    });

    await graph1.run('merge-test-1', {
      messages: [{ type: 'human', content: 'message_1' }],
    });

    const state1 = graph1.getState('merge-test-1');
    expect(state1?.messages).toHaveLength(1);
    expect(state1?.messages[0].content).toBe('message_1');

    graph1.close();
    graphs.pop();

    // --- Phase 2: Resume with new graph, append delta message ---
    const graph2 = new OrchestratorGraph(dbPath, AGENTS_MD_PATH);
    graphs.push(graph2);

    // Register node that just stops (to load checkpoint and resume)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    graph2.registerNode('po', (_state: AgentState) => {
      return { next_recipient: null };
    });

    // Resume using run() (which rebuilds the graph with registered nodes)
    // passing delta message in the initial messages array
    await graph2.run('merge-test-1', {
      messages: [{ type: 'human', content: 'message_2' }],
    });

    // --- Verify: exactly 2 messages, no duplication ---
    const state2 = graph2.getState('merge-test-1');
    expect(state2?.messages).toHaveLength(2);
    expect(state2?.messages[0].content).toBe('message_1');
    expect(state2?.messages[1].content).toBe('message_2');

    graph2.close();
    graphs.pop();

    // --- Phase 3: Resume again, append another message ---
    const graph3 = new OrchestratorGraph(dbPath, AGENTS_MD_PATH);
    graphs.push(graph3);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    graph3.registerNode('po', (_state: AgentState) => {
      return { next_recipient: null };
    });

    // Append msg_3 to the checkpoint that already has [msg_1, msg_2]
    await graph3.run('merge-test-1', {
      messages: [{ type: 'human', content: 'message_3' }],
    });

    // --- Verify: exactly 3 messages, no duplication ---
    const state3 = graph3.getState('merge-test-1');
    expect(state3?.messages).toHaveLength(3);
    expect(state3?.messages[0].content).toBe('message_1');
    expect(state3?.messages[1].content).toBe('message_2');
    expect(state3?.messages[2].content).toBe('message_3');
  });

  it('preserves pause_context across checkpoint resumption', async () => {
    // REQUIREMENT (from issue #67): When /query is issued while paused,
    // it does NOT pass pause_context to invoke(). The invokeWithGraph() method
    // merges checkpoint state with input, so pause_context is preserved from
    // the checkpoint. This is critical for /approve and /fix guards.

    const dbPath = tempDbPath();

    // --- Phase 1: Set pause_context and store checkpoint ---
    const graph1 = new OrchestratorGraph(dbPath, AGENTS_MD_PATH);
    graphs.push(graph1);

    let poRun1 = false;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    graph1.registerNode('po', (_state: AgentState) => {
      poRun1 = true;
      return {
        next_recipient: null,
        pause_context: 'refinement_limit',
      };
    });

    await graph1.run('pause-preserve-1', {
      messages: [{ type: 'human', content: 'msg_1' }],
    });

    const state1 = graph1.getState('pause-preserve-1');
    expect(state1?.pause_context).toBe('refinement_limit');
    expect(poRun1).toBe(true);

    graph1.close();
    graphs.pop();

    // --- Phase 2: Resume WITHOUT setting pause_context (simulating /query) ---
    // Critical: invoke() does NOT pass pause_context, so it should be preserved from checkpoint
    const graph2 = new OrchestratorGraph(dbPath, AGENTS_MD_PATH);
    graphs.push(graph2);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    graph2.registerNode('po', (_state: AgentState) => {
      return { next_recipient: null };
    });

    // Invoke with delta message but NO pause_context (simulates /query)
    await graph2.invoke('pause-preserve-1', {
      next_recipient: 'po',
      messages: [{ type: 'human', content: '@isolate- clarification?' }],
      // NOT setting pause_context — should be preserved from checkpoint
    });

    // --- Verify: pause_context is preserved ---
    const state2 = graph2.getState('pause-preserve-1');
    expect(state2?.pause_context).toBe('refinement_limit');
    expect(state2?.messages).toHaveLength(2);
    expect(state2?.messages[1].content).toBe('@isolate- clarification?');

    graph2.close();
    graphs.pop();

    // --- Phase 3: Clear pause_context (simulating /approve) ---
    const graph3 = new OrchestratorGraph(dbPath, AGENTS_MD_PATH);
    graphs.push(graph3);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    graph3.registerNode('po', (_state: AgentState) => {
      return { next_recipient: null };
    });

    // Invoke with explicit pause_context: null (simulates /approve)
    await graph3.invoke('pause-preserve-1', {
      next_recipient: 'po',
      messages: [{ type: 'human', content: 'approved' }],
      pause_context: null, // /approve explicitly clears this
    });

    // --- Verify: pause_context is now null ---
    const state3 = graph3.getState('pause-preserve-1');
    expect(state3?.pause_context).toBeNull();
    expect(state3?.messages).toHaveLength(3);
  });

  it('handles multiple delta appends without message duplication', async () => {
    // REQUIREMENT: Simulate a sequence of /query → /query → /fix
    // Each resume appends delta messages. Final message count should be
    // exactly 1 (initial) + 3 (deltas) = 4, not 5, 6, or more.

    const dbPath = tempDbPath();

    // --- Phase 1: Initial message ---
    const graph1 = new OrchestratorGraph(dbPath, AGENTS_MD_PATH);
    graphs.push(graph1);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    graph1.registerNode('po', (_state: AgentState) => {
      return { next_recipient: null };
    });

    await graph1.run('multi-delta-test', {
      messages: [{ type: 'human', content: 'initial' }],
    });

    graph1.close();
    graphs.pop();

    // --- Phase 2: First /query (delta append) ---
    const graph2 = new OrchestratorGraph(dbPath, AGENTS_MD_PATH);
    graphs.push(graph2);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    graph2.registerNode('po', (_state: AgentState) => {
      return { next_recipient: null };
    });

    await graph2.invoke('multi-delta-test', {
      next_recipient: 'po',
      messages: [{ type: 'human', content: '@isolate- query_1' }],
    });

    graph2.close();
    graphs.pop();

    // --- Phase 3: Second /query (delta append) ---
    const graph3 = new OrchestratorGraph(dbPath, AGENTS_MD_PATH);
    graphs.push(graph3);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    graph3.registerNode('po', (_state: AgentState) => {
      return { next_recipient: null };
    });

    await graph3.invoke('multi-delta-test', {
      next_recipient: 'po',
      messages: [{ type: 'human', content: '@isolate- query_2' }],
    });

    graph3.close();
    graphs.pop();

    // --- Phase 4: /fix (delta append with pause_context clear) ---
    const graph4 = new OrchestratorGraph(dbPath, AGENTS_MD_PATH);
    graphs.push(graph4);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    graph4.registerNode('po', (_state: AgentState) => {
      return { next_recipient: null };
    });

    await graph4.invoke('multi-delta-test', {
      next_recipient: 'po',
      messages: [{ type: 'human', content: 'fixed' }],
      pause_context: null,
    });

    // --- Verify: exactly 4 messages (initial + 3 deltas) ---
    const finalState = graph4.getState('multi-delta-test');
    expect(finalState?.messages).toHaveLength(4);

    const contents = finalState?.messages.map((m) => m.content) || [];
    expect(contents).toEqual([
      'initial',
      '@isolate- query_1',
      '@isolate- query_2',
      'fixed',
    ]);
  });
});
