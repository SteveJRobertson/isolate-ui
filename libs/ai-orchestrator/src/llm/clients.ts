import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { validateOrchestratorEnv } from '../config';

/**
 * Singleton instances of LLM clients.
 * Initialized on first access with API key validation.
 */
let openaiClient: ChatOpenAI | null = null;
let anthropicClient: ChatAnthropic | null = null;

/**
 * Get or initialize the OpenAI client (GPT-4o).
 * Used by PO, Architect, Dev, QA, and Docs personas.
 * Requires OPENAI_API_KEY to be set.
 */
export function getOpenAIClient(): ChatOpenAI {
  if (!openaiClient) {
    const env = validateOrchestratorEnv();
    if (!env.OPENAI_API_KEY) {
      throw new Error(
        'OPENAI_API_KEY is required for GPT-4o personas. Please set OPENAI_API_KEY in your environment.',
      );
    }
    openaiClient = new ChatOpenAI({
      model: 'gpt-4o',
      apiKey: env.OPENAI_API_KEY,
      temperature: 0.7,
      maxTokens: 4096,
    });
  }
  return openaiClient;
}

/**
 * Get or initialize the Anthropic client (Claude 4.6).
 * Used by A11y specialist persona.
 * Requires ANTHROPIC_API_KEY to be set.
 *
 * Currently hard-coded to claude-sonnet-4-6. The AgentPersona type union allows
 * both claude-sonnet-4-6 and claude-sonnet-4-5 for future flexibility, but this
 * client factory only instantiates 4.6. If a persona is set to 4.5, it will still
 * use 4.6 (see llm-persona-node.ts ANTHROPIC_MODELS for details). This limitation
 * is temporary and will be addressed when the client factory is refactored to accept
 * a model parameter with per-model caching.
 */
export function getAnthropicClient(): ChatAnthropic {
  if (!anthropicClient) {
    const env = validateOrchestratorEnv();
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error(
        'ANTHROPIC_API_KEY is required for Claude personas. Please set ANTHROPIC_API_KEY in your environment.',
      );
    }
    anthropicClient = new ChatAnthropic({
      model: 'claude-sonnet-4-6',
      apiKey: env.ANTHROPIC_API_KEY,
      temperature: 0.7,
      maxTokens: 4096,
    });
  }
  return anthropicClient;
}

/**
 * Reset clients (for testing).
 */
export function resetClients(): void {
  openaiClient = null;
  anthropicClient = null;
}
