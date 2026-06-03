import {
  HumanMessage,
  AIMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { getOpenAIClient, getAnthropicClient } from '../llm/clients';
import { AGENT_PERSONAS, PERSONA_IDS } from '../agents/personas';
import type { AgentState, SerializedMessage } from '../schema';

/**
 * Supported Anthropic models for routing.
 * These models are routed to getAnthropicClient().
 * Currently only claude-sonnet-4-6 is instantiated; support for claude-sonnet-4-5
 * will be added when the client factory is updated to accept a model parameter.
 */
const ANTHROPIC_MODELS = ['claude-sonnet-4-6', 'claude-sonnet-4-5'] as const;

/**
 * Node function signature for LangGraph-compatible node implementations.
 * Takes current state, performs async work, returns partial state updates.
 */
export type AgentNodeFn = (
  state: AgentState,
) => Promise<Partial<AgentState>> | Partial<AgentState>;

/**
 * Create an LLM-backed persona node that dispatches to the correct LLM client
 * and advances the workflow to the next persona in the sequence.
 *
 * @param personaId - The ID of the persona (must exist in AGENT_PERSONAS)
 * @returns A node function compatible with LangGraph
 * @throws If personaId is invalid or model type is unsupported
 */
export function createLLMPersonaNode(personaId: string): AgentNodeFn {
  // Validate persona exists
  const persona = AGENT_PERSONAS[personaId.toLowerCase()];
  if (!persona) {
    throw new Error(
      `Invalid persona ID: ${personaId}. Available personas: ${Object.keys(AGENT_PERSONAS).join(', ')}`,
    );
  }

  // Return the node function
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    // Select the appropriate LLM client based on persona model
    const isAnthropicModel = ANTHROPIC_MODELS.includes(
      persona.model as (typeof ANTHROPIC_MODELS)[number],
    );
    const client =
      persona.model === 'gpt-4o'
        ? getOpenAIClient()
        : isAnthropicModel
          ? getAnthropicClient()
          : (() => {
              throw new Error(
                `Unsupported model type for persona ${personaId}: ${persona.model}`,
              );
            })();

    // Convert message history from ai-orchestrator format to LangChain BaseMessage format
    // and prepend the system prompt
    const messages: any[] = [
      new SystemMessage(persona.systemPrompt),
      ...state.messages.map((msg: SerializedMessage) => {
        // Normalize message type and create appropriate LangChain message
        const messageType = (msg.type || 'human').toLowerCase();

        if (messageType === 'ai') {
          return new AIMessage(msg.content);
        } else if (messageType === 'human') {
          return new HumanMessage(msg.content);
        } else {
          // Unknown types treated as human messages
          return new HumanMessage(msg.content);
        }
      }),
    ];

    // PREFILL GUARD: Anthropic API requires the final message to be from a user.
    // If the message array ends with an AIMessage (e.g., from mesh router or prior node),
    // append a generic HumanMessage to satisfy Anthropic's constraint.
    // This is Anthropic-specific; OpenAI and other providers are permissive.
    if (isAnthropicModel && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage instanceof AIMessage) {
        messages.push(
          new HumanMessage(
            'Please proceed with your task based on the context above.',
          ),
        );
      }
    }

    // Invoke the LLM with the full message history (including system prompt)
    const response = await client.invoke(messages as any);

    // Extract response content
    const responseContent =
      typeof response.content === 'string'
        ? response.content
        : Array.isArray(response.content)
          ? response.content
              .map((c: any) => (typeof c === 'string' ? c : c.text || ''))
              .join('')
          : String(response.content);

    // Create only the NEW message to be appended.
    // The graph's messages reducer will handle merging: state.messages + updates.messages
    // Returning the full history here would cause duplication.
    const newMessage: SerializedMessage = {
      type: 'ai',
      content: responseContent,
    };

    // Calculate the next recipient in the persona sequence
    const currentIndex = PERSONA_IDS.indexOf(personaId.toLowerCase() as any);
    const nextIndex = currentIndex + 1;
    const nextRecipient =
      nextIndex < PERSONA_IDS.length ? PERSONA_IDS[nextIndex] : null;

    // Return the partial state with only the new message and advanced routing
    return {
      messages: [newMessage],
      next_recipient: nextRecipient,
    };
  };
}
