import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks (hoisted before imports) ────────────────────────────────────
// vi.hoisted() ensures these are available when vi.mock factories run.

const { mockChatOpenAI, mockChatAnthropic } = vi.hoisted(() => ({
  mockChatOpenAI: vi.fn(),
  mockChatAnthropic: vi.fn(),
}));

vi.mock('../config', () => ({
  validateOrchestratorEnv: vi.fn().mockReturnValue({
    OPENAI_API_KEY: 'sk-test-openai-key',
    ANTHROPIC_API_KEY: 'sk-ant-test-anthropic-key',
  }),
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: mockChatOpenAI,
}));

vi.mock('@langchain/anthropic', () => ({
  ChatAnthropic: mockChatAnthropic,
}));

// ── Imports under test (after mocks) ─────────────────────────────────────────

import { getOpenAIClient, getAnthropicClient, resetClients } from '../llm';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('LLM clients', () => {
  beforeEach(() => {
    resetClients();
    vi.clearAllMocks();
  });

  describe('getAnthropicClient()', () => {
    it('initializes ChatAnthropic with claude-sonnet-4-6', () => {
      getAnthropicClient();

      expect(mockChatAnthropic).toHaveBeenCalledOnce();
      const [config] = mockChatAnthropic.mock.calls[0];
      expect(config.model).toBe('claude-sonnet-4-6');
    });

    it('passes the ANTHROPIC_API_KEY from env', () => {
      getAnthropicClient();

      const [config] = mockChatAnthropic.mock.calls[0];
      expect(config.apiKey).toBe('sk-ant-test-anthropic-key');
    });

    it('returns the same singleton on repeated calls', () => {
      const first = getAnthropicClient();
      const second = getAnthropicClient();

      expect(first).toBe(second);
      expect(mockChatAnthropic).toHaveBeenCalledOnce();
    });

    it('throws when ANTHROPIC_API_KEY is missing', async () => {
      const { validateOrchestratorEnv } = vi.mocked(await import('../config'));
      validateOrchestratorEnv.mockReturnValueOnce({
        OPENAI_API_KEY: 'sk-test-openai-key',
        ANTHROPIC_API_KEY: undefined,
      } as any);

      expect(() => getAnthropicClient()).toThrow('ANTHROPIC_API_KEY');
    });
  });

  describe('getOpenAIClient()', () => {
    it('initializes ChatOpenAI with gpt-4o (regression guard)', () => {
      getOpenAIClient();

      expect(mockChatOpenAI).toHaveBeenCalledOnce();
      const [config] = mockChatOpenAI.mock.calls[0];
      expect(config.model).toBe('gpt-4o');
    });

    it('passes the OPENAI_API_KEY from env', () => {
      getOpenAIClient();

      const [config] = mockChatOpenAI.mock.calls[0];
      expect(config.apiKey).toBe('sk-test-openai-key');
    });

    it('throws when OPENAI_API_KEY is missing', async () => {
      const { validateOrchestratorEnv } = vi.mocked(await import('../config'));
      validateOrchestratorEnv.mockReturnValueOnce({
        OPENAI_API_KEY: undefined,
        ANTHROPIC_API_KEY: 'sk-ant-test-anthropic-key',
      } as any);

      expect(() => getOpenAIClient()).toThrow('OPENAI_API_KEY');
    });
  });
});
