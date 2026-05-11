import { describe, it, expect } from 'vitest';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import {
  analyzeMeshQuery,
  createMeshRouterNode,
  MeshStalemateError,
  DEFAULT_MESH_CONFIG,
  type MeshRouterConfig,
} from '../orchestrator/mesh-router';
import { createDefaultAgentState } from '../schema';
import type { AgentState } from '../schema';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return { ...createDefaultAgentState(), ...overrides };
}

function makeMessage(content: string) {
  return { type: 'ai', content };
}

/**
 * Build a FakeListChatModel that returns a single JSON routing response.
 * FakeListChatModel cycles through `responses` in order, returning each as
 * the content of an AIMessage.
 */
function fakeClient(responseJson: string): FakeListChatModel {
  return new FakeListChatModel({ responses: [responseJson] });
}

// ── analyzeMeshQuery ──────────────────────────────────────────────────────────

describe('analyzeMeshQuery', () => {
  it('returns { target: null } when messages array is empty', async () => {
    const client = fakeClient('{"target": null}');
    const result = await analyzeMeshQuery([], client);
    expect(result).toEqual({ target: null });
  });

  it('returns { target: null } when last message has no content', async () => {
    const client = fakeClient('{"target": null}');
    const result = await analyzeMeshQuery(
      [{ type: 'ai', content: '' }],
      client,
    );
    expect(result).toEqual({ target: null });
  });

  describe('heuristic gate', () => {
    it('returns { target: null } without calling LLM when message has no ? or @isolate-', async () => {
      // This client would return a non-null target, but the heuristic gate
      // should bypass it entirely for plain work-output messages.
      const client = fakeClient('{"target": "po"}');
      const messages = [
        makeMessage('APPROVED — token references look correct'),
      ];
      const result = await analyzeMeshQuery(messages, client);
      expect(result).toEqual({ target: null });
    });

    it('passes to LLM when message contains ?', async () => {
      const client = fakeClient('{"target": "po"}');
      const messages = [makeMessage('Can the PO clarify which token to use?')];
      const result = await analyzeMeshQuery(messages, client);
      expect(result).toEqual({ target: 'po' });
    });

    it('passes to LLM when message contains @isolate-', async () => {
      const client = fakeClient('{"target": "qa"}');
      const messages = [
        makeMessage('@isolate-qa please verify this edge case'),
      ];
      const result = await analyzeMeshQuery(messages, client);
      expect(result).toEqual({ target: 'qa' });
    });
  });

  describe('LLM response parsing', () => {
    it('detects target persona from structured LLM response', async () => {
      const client = fakeClient('{"target": "architect"}');
      const messages = [
        makeMessage('Does @isolate-architect approve this boundary?'),
      ];
      const result = await analyzeMeshQuery(messages, client);
      expect(result).toEqual({ target: 'architect' });
    });

    it('returns { target: null } when LLM returns null target', async () => {
      const client = fakeClient('{"target": null}');
      const messages = [
        makeMessage('Is this pattern consistent with the design system?'),
      ];
      const result = await analyzeMeshQuery(messages, client);
      expect(result).toEqual({ target: null });
    });

    it('handles JSON wrapped in markdown code fences defensively', async () => {
      const client = fakeClient('```json\n{"target": "dev"}\n```');
      const messages = [
        makeMessage('Should @isolate-dev implement this pattern?'),
      ];
      const result = await analyzeMeshQuery(messages, client);
      expect(result).toEqual({ target: 'dev' });
    });

    it('returns { target: null } when LLM returns an invalid persona ID', async () => {
      const client = fakeClient('{"target": "unknown-persona"}');
      const messages = [makeMessage('Should @isolate-unknown handle this?')];
      const result = await analyzeMeshQuery(messages, client);
      expect(result).toEqual({ target: null });
    });

    it('returns { target: null } when LLM returns malformed JSON', async () => {
      const client = fakeClient('not valid json at all');
      const messages = [makeMessage('Is this correct? @isolate-po')];
      const result = await analyzeMeshQuery(messages, client);
      expect(result).toEqual({ target: null });
    });
  });
});

// ── createMeshRouterNode ──────────────────────────────────────────────────────

describe('createMeshRouterNode', () => {
  it('returns empty partial state (pass-through) when no query detected', async () => {
    const config: MeshRouterConfig = {
      ...DEFAULT_MESH_CONFIG,
      llmClient: fakeClient('{"target": null}'),
    };
    const node = createMeshRouterNode(config);
    const state = makeState({
      next_recipient: 'dev',
      messages: [makeMessage('APPROVED — ready to proceed')],
    });

    const result = await node(state);
    expect(result).toEqual({});
  });

  it('performs mesh jump when a cross-persona query is detected', async () => {
    const config: MeshRouterConfig = {
      ...DEFAULT_MESH_CONFIG,
      llmClient: fakeClient('{"target": "po"}'),
    };
    const node = createMeshRouterNode(config);
    const state = makeState({
      next_recipient: 'dev',
      mesh_loop_count: 0,
      messages: [
        makeMessage('I need @isolate-po to clarify the token choice?'),
      ],
    });

    const result = await node(state);
    expect(result.next_recipient).toBe('po');
    expect(result.mesh_origin).toBe('dev');
    expect(result.mesh_loop_count).toBe(1);
  });

  it('records mesh_origin as the pre-jump next_recipient', async () => {
    const config: MeshRouterConfig = {
      ...DEFAULT_MESH_CONFIG,
      llmClient: fakeClient('{"target": "a11y"}'),
    };
    const node = createMeshRouterNode(config);
    const state = makeState({
      next_recipient: 'qa',
      mesh_loop_count: 1,
      messages: [makeMessage('@isolate-a11y can you check the ARIA roles?')],
    });

    const result = await node(state);
    expect(result.mesh_origin).toBe('qa');
  });

  it('increments mesh_loop_count on each mesh jump', async () => {
    const config: MeshRouterConfig = {
      ...DEFAULT_MESH_CONFIG,
      llmClient: new FakeListChatModel({
        responses: ['{"target": "po"}', '{"target": "qa"}'],
      }),
    };
    const node = createMeshRouterNode(config);

    const state1 = makeState({
      next_recipient: 'dev',
      mesh_loop_count: 2,
      messages: [makeMessage('@isolate-po clarify this?')],
    });
    const result1 = await node(state1);
    expect(result1.mesh_loop_count).toBe(3);

    const state2 = makeState({
      next_recipient: 'architect',
      mesh_loop_count: 3,
      messages: [makeMessage('@isolate-qa verify this?')],
    });
    const result2 = await node(state2);
    expect(result2.mesh_loop_count).toBe(4);
  });

  it('does not mesh-jump when target equals current next_recipient (self-loop guard)', async () => {
    const config: MeshRouterConfig = {
      ...DEFAULT_MESH_CONFIG,
      llmClient: fakeClient('{"target": "dev"}'),
    };
    const node = createMeshRouterNode(config);
    const state = makeState({
      next_recipient: 'dev',
      mesh_loop_count: 0,
      messages: [makeMessage('@isolate-dev can I clarify this myself?')],
    });

    const result = await node(state);
    // No jump — target is the same as current recipient
    expect(result).toEqual({});
  });

  it('routes to human_review when mesh_loop_count exceeds maxMeshLoops', async () => {
    const config: MeshRouterConfig = {
      maxMeshLoops: 3,
      llmClient: fakeClient('{"target": "po"}'),
    };
    const node = createMeshRouterNode(config);
    const state = makeState({
      next_recipient: 'dev',
      mesh_loop_count: 3, // already AT the limit — next jump (count=4) exceeds it
      messages: [makeMessage('@isolate-po clarify this?')],
      metadata: { github_issue_id: '20' },
    });

    const result = await node(state);
    expect(result.next_recipient).toBeNull();
    expect(result.pause_context).toBe('mesh_stalemate');
  });

  it('human_review result carries correct mesh_loop_count on stalemate', async () => {
    const config: MeshRouterConfig = {
      maxMeshLoops: 2,
      llmClient: fakeClient('{"target": "qa"}'),
    };
    const node = createMeshRouterNode(config);
    const state = makeState({
      next_recipient: 'architect',
      mesh_loop_count: 2,
      messages: [makeMessage('@isolate-qa verify this edge case?')],
      metadata: { github_issue_id: '20' },
    });

    const result = await node(state);
    expect(result.next_recipient).toBeNull();
    expect(result.pause_context).toBe('mesh_stalemate');
    expect(result.mesh_loop_count).toBe(3);
  });

  it('never mutates code_buffer during a mesh jump', async () => {
    const config: MeshRouterConfig = {
      ...DEFAULT_MESH_CONFIG,
      llmClient: fakeClient('{"target": "po"}'),
    };
    const node = createMeshRouterNode(config);
    const originalBuffer =
      'diff --git a/Button.tsx b/Button.tsx\n+const x = 1;';
    const state = makeState({
      next_recipient: 'qa',
      code_buffer: originalBuffer,
      messages: [makeMessage('@isolate-po please review the token?')],
    });

    const result = await node(state);
    // code_buffer must not be touched — only routing fields change
    expect(result).not.toHaveProperty('code_buffer');
    // Original state is untouched
    expect(state.code_buffer).toBe(originalBuffer);
  });

  it('never mutates messages during a mesh jump', async () => {
    const config: MeshRouterConfig = {
      ...DEFAULT_MESH_CONFIG,
      llmClient: fakeClient('{"target": "dev"}'),
    };
    const node = createMeshRouterNode(config);
    const originalMessages = [
      makeMessage('@isolate-dev should we use flex here?'),
    ];
    const state = makeState({
      next_recipient: 'po',
      messages: originalMessages,
    });

    const result = await node(state);
    expect(result).not.toHaveProperty('messages');
    expect(state.messages).toBe(originalMessages);
  });

  it('returns pass-through when no llmClient and no API key (fail-safe)', async () => {
    // No llmClient injected and no OPENAI_API_KEY — should return {} not throw
    const config: MeshRouterConfig = { maxMeshLoops: 5 };
    const node = createMeshRouterNode(config);
    const state = makeState({
      next_recipient: 'dev',
      messages: [makeMessage('@isolate-po can you clarify?')],
    });

    // Should silently fail safe without throwing
    const result = await node(state);
    expect(result).toEqual({});
  });
});

// ── MeshStalemateError ────────────────────────────────────────────────────────

describe('MeshStalemateError', () => {
  it('is an instance of Error', () => {
    const err = new MeshStalemateError(6, 'issue-20', 'dev', 5);
    expect(err).toBeInstanceOf(Error);
  });

  it('carries correct fields', () => {
    const err = new MeshStalemateError(6, 'issue-20', 'dev', 5);
    expect(err.meshLoopCount).toBe(6);
    expect(err.issueId).toBe('issue-20');
    expect(err.originPersona).toBe('dev');
    expect(err.name).toBe('MeshStalemateError');
  });

  it('message includes loop count and limit', () => {
    const err = new MeshStalemateError(6, 'issue-20', 'dev', 5);
    expect(err.message).toContain('6');
    expect(err.message).toContain('5');
  });

  it('instanceof check survives re-throw', () => {
    const original = new MeshStalemateError(3, 'issue-20', 'po', 3);
    let caught: unknown;
    try {
      throw original;
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(MeshStalemateError);
  });
});
