import {
  HumanMessage,
  AIMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { getOpenAIClient, getAnthropicClient } from '../llm/clients';
import { AGENT_PERSONAS, PERSONA_IDS } from '../agents/personas';
import type { AgentState, SerializedMessage } from '../schema';

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
    const client =
      persona.model === 'gpt-4o'
        ? getOpenAIClient()
        : persona.model === 'claude-sonnet-4-6' ||
            persona.model === 'claude-sonnet-4-5'
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
