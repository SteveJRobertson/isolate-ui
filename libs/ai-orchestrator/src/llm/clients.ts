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
 */
export function getOpenAIClient(): ChatOpenAI {
  if (!openaiClient) {
    validateOrchestratorEnv(); // Fail fast if keys are missing
    openaiClient = new ChatOpenAI({
      modelName: 'gpt-4o',
      apiKey: process.env.OPENAI_API_KEY,
      temperature: 0.7,
      maxTokens: 4096,
    });
  }
  return openaiClient;
}

/**
 * Get or initialize the Anthropic client (Claude 3.5 Sonnet).
 * Used by A11y specialist persona.
 */
export function getAnthropicClient(): ChatAnthropic {
  if (!anthropicClient) {
    validateOrchestratorEnv(); // Fail fast if keys are missing
    anthropicClient = new ChatAnthropic({
      modelName: 'claude-3-5-sonnet-20241022',
      apiKey: process.env.ANTHROPIC_API_KEY,
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
