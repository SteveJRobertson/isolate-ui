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
      modelName: 'gpt-4o',
      apiKey: env.OPENAI_API_KEY,
      temperature: 0.7,
      maxTokens: 4096,
    });
  }
  return openaiClient;
}

/**
 * Get or initialize the Anthropic client (Claude 3.5 Sonnet).
 * Used by A11y specialist persona.
 * Requires ANTHROPIC_API_KEY to be set.
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
      modelName: 'claude-3-5-sonnet-20241022',
      apiKey: env.ANTHROPIC_API_KEY,
      temperature: 0.7,
      maxTokens: 4096,
    } as any);
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
