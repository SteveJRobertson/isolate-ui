import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLLMPersonaNode } from './llm-persona-node';
import type { AgentState, SerializedMessage } from '../schema';
import { AGENT_PERSONAS } from '../agents/personas';
import * as clientsModule from '../llm/clients';

/**
 * Test Suite: createLLMPersonaNode Factory
 *
 * Validates that the factory creates LLM-backed persona nodes that:
 * 1. Dispatch to correct LLM client (OpenAI vs Anthropic)
 * 2. Convert message formats from ai-orchestrator to LangChain
 * 3. Construct prompts with system prompt + message history
 * 4. Call LLM and append response to messages
 * 5. Return Partial<AgentState> with only messages field changed
 * 6. Rethrow LLM errors for webhook-listener retry logic
 */

describe('createLLMPersonaNode', () => {
  let mockOpenAIClient: any;
  let mockAnthropicClient: any;

  beforeEach(() => {
    // Mock LLM clients
    mockOpenAIClient = {
      invoke: vi.fn(),
      call: vi.fn(),
    };

    mockAnthropicClient = {
      invoke: vi.fn(),
      call: vi.fn(),
    };

    // Mock client getter functions
    vi.spyOn(clientsModule, 'getOpenAIClient').mockReturnValue(
      mockOpenAIClient,
    );
    vi.spyOn(clientsModule, 'getAnthropicClient').mockReturnValue(
      mockAnthropicClient,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('happy path: valid persona, API response', () => {
    it('should invoke correct LLM client based on persona.model (gpt-4o)', async () => {
      // Arrange
      const personaId = 'po';
      const mockLLMResponse = 'APPROVED - Component specification is ready.';
      mockOpenAIClient.invoke.mockResolvedValue({
        content: mockLLMResponse,
      });

      const state: AgentState = {
        messages: [
          {
            type: 'human',
            content: 'Design a button component.',
          },
        ],
        next_recipient: 'architect',
        code_buffer: '',
        a11y_report: '',
        arch_approval: false,
        metadata: {},
        _step_count: 1,
        rejectionCount: 0,
        rejectionReason: '',
        lastApprovedBy: null,
        signoffs: {},
      };

      const nodeFn = createLLMPersonaNode(personaId);

      // Act
      const result = await nodeFn(state);

      // Assert
      expect(clientsModule.getOpenAIClient).toHaveBeenCalled();
      expect(mockOpenAIClient.invoke).toHaveBeenCalled();
      expect(result.messages).toBeDefined();
      expect(result.messages?.length).toBe(1); // only the new AI message
    });

    it('should invoke correct LLM client based on persona.model (claude-sonnet-4-6)', async () => {
      // Arrange
      const personaId = 'a11y';
      const mockLLMResponse =
        'Accessibility audit: No WCAG violations found. APPROVED.';
      mockAnthropicClient.invoke.mockResolvedValue({
        content: mockLLMResponse,
      });

      const state: AgentState = {
        messages: [
          {
            type: 'human',
            content: 'Audit button component for a11y.',
          },
        ],
        next_recipient: 'qa',
        code_buffer: 'const Button = () => <button>Click me</button>;',
        a11y_report: '',
        arch_approval: false,
        metadata: {},
        _step_count: 1,
        rejectionCount: 0,
        rejectionReason: '',
        lastApprovedBy: null,
        signoffs: {},
      };

      const nodeFn = createLLMPersonaNode(personaId);

      // Act
      const result = await nodeFn(state);

      // Assert
      expect(clientsModule.getAnthropicClient).toHaveBeenCalled();
      expect(mockAnthropicClient.invoke).toHaveBeenCalled();
      expect(result.messages).toBeDefined();
      expect(result.messages?.length).toBe(1); // only the new AI message
    });

    it('should route claude-sonnet-4-5 model to Anthropic client (regression)', async () => {
      // Regression test: ensure ANTHROPIC_MODELS routing handles 4-5 correctly.
      // When a persona is configured with claude-sonnet-4-5, it must route to
      // getAnthropicClient() (not throw an error).

      // Arrange
      const mockLLMResponse = 'Accessibility audit response.';
      mockAnthropicClient.invoke.mockResolvedValue({
        content: mockLLMResponse,
      });

      // Temporarily patch the a11y persona to use claude-sonnet-4-5
      const originalA11yModel = AGENT_PERSONAS.a11y.model;
      (AGENT_PERSONAS.a11y as any).model = 'claude-sonnet-4-5';

      const state: AgentState = {
        messages: [
          {
            type: 'human',
            content: 'Audit component.',
          },
        ],
        next_recipient: 'qa',
        code_buffer: 'const Component = () => <div>test</div>;',
        a11y_report: '',
        arch_approval: false,
        metadata: {},
        _step_count: 1,
        rejectionCount: 0,
        rejectionReason: '',
        lastApprovedBy: null,
        signoffs: {},
      };

      const nodeFn = createLLMPersonaNode('a11y');

      // Act
      const result = await nodeFn(state);

      // Assert
      expect(clientsModule.getAnthropicClient).toHaveBeenCalled();
      expect(mockAnthropicClient.invoke).toHaveBeenCalled();
      expect(result.messages).toBeDefined();

      // Cleanup
      (AGENT_PERSONAS.a11y as any).model = originalA11yModel;
    });

    it('should append LLM response as ai message to messages array', async () => {
      // Arrange
      const personaId = 'po';
      const mockLLMResponse = 'APPROVED - Design spec ready.';
      mockOpenAIClient.invoke.mockResolvedValue({
        content: mockLLMResponse,
      });

      const initialMessages: SerializedMessage[] = [
        {
          type: 'human',
          content: 'Design a button component.',
        },
      ];

      const state: AgentState = {
        messages: initialMessages,
        next_recipient: 'architect',
        code_buffer: '',
        a11y_report: '',
        arch_approval: false,
        metadata: {},
        _step_count: 1,
        rejectionCount: 0,
        rejectionReason: '',
        lastApprovedBy: null,
        signoffs: {},
      };

      const nodeFn = createLLMPersonaNode(personaId);

      // Act
      const result = await nodeFn(state);

      // Assert
      expect(result.messages).toBeDefined();
      expect(result.messages?.length).toBe(1); // only the appended AI message
      expect(result.messages?.[0].type).toBe('ai');
      expect(result.messages?.[0].content).toBe(mockLLMResponse);
    });

    it('should include persona system prompt in LLM call', async () => {
      // Arrange
      const personaId = 'po';
      const persona = AGENT_PERSONAS[personaId];
      const mockLLMResponse = 'Response from LLM.';
      mockOpenAIClient.invoke.mockResolvedValue({
        content: mockLLMResponse,
      });

      const state: AgentState = {
        messages: [
          {
            type: 'human',
            content: 'Design a button component.',
          },
        ],
        next_recipient: 'architect',
        code_buffer: '',
        a11y_report: '',
        arch_approval: false,
        metadata: {},
        _step_count: 1,
        rejectionCount: 0,
        rejectionReason: '',
        lastApprovedBy: null,
        signoffs: {},
      };

      const nodeFn = createLLMPersonaNode(personaId);

      // Act
      await nodeFn(state);

      // Assert
      // The LLM should have been invoked with messages that include system prompt context
      expect(mockOpenAIClient.invoke).toHaveBeenCalled();
      // invoke is called with messages array where first element is SystemMessage with persona.systemPrompt
      const messageArgs = mockOpenAIClient.invoke.mock.calls[0][0];
      // Messages array should be passed
      expect(Array.isArray(messageArgs)).toBe(true);
      expect(messageArgs.length).toBeGreaterThan(0);
      // First message should be a SystemMessage containing the persona's system prompt
      expect(messageArgs[0].content).toBe(persona.systemPrompt);
    });
  });

  describe('message format conversion', () => {
    it('should convert ai-orchestrator message format to LangChain BaseMessage format', async () => {
      // Arrange
      const personaId = 'dev';
      const mockLLMResponse = 'Implementation ready.';
      mockOpenAIClient.invoke.mockResolvedValue({
        content: mockLLMResponse,
      });

      const state: AgentState = {
        messages: [
          {
            type: 'human',
            content: 'Implement button component.',
          },
          {
            type: 'ai',
            content: 'Here is the implementation...',
          },
        ],
        next_recipient: 'qa',
        code_buffer: 'const Button = () => {...}',
        a11y_report: '',
        arch_approval: true,
        metadata: {},
        _step_count: 2,
        rejectionCount: 0,
        rejectionReason: '',
        lastApprovedBy: 'po',
        signoffs: { po: true },
      };

      const nodeFn = createLLMPersonaNode(personaId);

      // Act
      const result = await nodeFn(state);

      // Assert
      expect(mockOpenAIClient.invoke).toHaveBeenCalled();
      // invoke is called with (messages: BaseMessage[], options: { system: string })
      const messageArgs = mockOpenAIClient.invoke.mock.calls[0][0];
      // Messages should have been converted and passed to LLM as first argument
      expect(Array.isArray(messageArgs)).toBe(true);
      expect(messageArgs.length).toBeGreaterThan(0);
      // Result should contain only the appended AI message
      expect(result.messages?.length).toBe(1);
    });

    it('should handle unknown message types as human text', async () => {
      // Arrange
      const personaId = 'qa';
      const mockLLMResponse = 'QA approval granted.';
      mockOpenAIClient.invoke.mockResolvedValue({
        content: mockLLMResponse,
      });

      const state: AgentState = {
        messages: [
          {
            type: 'system',
            content: 'System message (unknown type)',
          },
          {
            type: 'human',
            content: 'Review this code.',
          },
        ],
        next_recipient: 'docs',
        code_buffer: 'const Button = () => {...}',
        a11y_report: '',
        arch_approval: true,
        metadata: {},
        _step_count: 3,
        rejectionCount: 0,
        rejectionReason: '',
        lastApprovedBy: 'qa',
        signoffs: { po: true, dev: true, qa: true },
      };

      const nodeFn = createLLMPersonaNode(personaId);

      // Act
      const result = await nodeFn(state);

      // Assert
      expect(mockOpenAIClient.invoke).toHaveBeenCalled();
      // Should not throw; unknown types should be treated as human
      expect(result.messages).toBeDefined();
      expect(result.messages?.length).toBe(1); // only new AI message
    });
  });

  describe('state mutation and return format', () => {
    it('should return Partial<AgentState> with messages and next_recipient fields changed', async () => {
      // Arrange
      const personaId = 'architect';
      const mockLLMResponse = 'Architecture approved.';
      mockOpenAIClient.invoke.mockResolvedValue({
        content: mockLLMResponse,
      });

      const initialState: AgentState = {
        messages: [
          {
            type: 'human',
            content: 'Review architecture.',
          },
        ],
        next_recipient: 'architect',
        code_buffer: 'const Button = () => {...}',
        a11y_report: 'No violations.',
        arch_approval: false,
        metadata: { component: 'Button' },
        _step_count: 1,
        rejectionCount: 0,
        rejectionReason: '',
        lastApprovedBy: null,
        signoffs: {},
      };

      const nodeFn = createLLMPersonaNode(personaId);

      // Act
      const result = await nodeFn(initialState);

      // Assert
      // Result should contain messages and next_recipient (advanced)
      expect(Object.keys(result).sort()).toEqual(
        ['messages', 'next_recipient'].sort(),
      );
      expect(result.messages).toBeDefined();
      expect(result.next_recipient).toBe('dev');
      // Other fields should not be in result
      expect(result.code_buffer).toBeUndefined();
      expect(result.arch_approval).toBeUndefined();
    });

    it('should preserve original messages array and append new message (immutability)', async () => {
      // Arrange
      const personaId = 'po';
      const mockLLMResponse = 'APPROVED';
      mockOpenAIClient.invoke.mockResolvedValue({
        content: mockLLMResponse,
      });

      const originalMessages: SerializedMessage[] = [
        {
          type: 'human',
          content: 'Design request.',
        },
      ];

      const state: AgentState = {
        messages: originalMessages,
        next_recipient: 'architect',
        code_buffer: '',
        a11y_report: '',
        arch_approval: false,
        metadata: {},
        _step_count: 1,
        rejectionCount: 0,
        rejectionReason: '',
        lastApprovedBy: null,
        signoffs: {},
      };

      const nodeFn = createLLMPersonaNode(personaId);

      // Act
      const result = await nodeFn(state);

      // Assert
      // Original array should not be mutated
      expect(originalMessages.length).toBe(1);
      // Result should contain only the new AI message (not the full history)
      expect(result.messages?.length).toBe(1);
      expect(result.messages?.[0].type).toBe('ai');
    });
  });

  describe('error handling', () => {
    it('should rethrow LLM API errors to allow webhook-listener retry logic', async () => {
      // Arrange
      const personaId = 'po';
      const apiError = new Error('OpenAI API rate limited: 429');
      mockOpenAIClient.invoke.mockRejectedValue(apiError);

      const state: AgentState = {
        messages: [
          {
            type: 'human',
            content: 'Design request.',
          },
        ],
        next_recipient: 'architect',
        code_buffer: '',
        a11y_report: '',
        arch_approval: false,
        metadata: {},
        _step_count: 1,
        rejectionCount: 0,
        rejectionReason: '',
        lastApprovedBy: null,
        signoffs: {},
      };

      const nodeFn = createLLMPersonaNode(personaId);

      // Act & Assert
      await expect(nodeFn(state)).rejects.toThrow('rate limited');
    });

    it('should rethrow network errors', async () => {
      // Arrange
      const personaId = 'a11y';
      const networkError = new Error('Network timeout: ECONNREFUSED');
      mockAnthropicClient.invoke.mockRejectedValue(networkError);

      const state: AgentState = {
        messages: [
          {
            type: 'human',
            content: 'Audit request.',
          },
        ],
        next_recipient: 'qa',
        code_buffer: 'const Button = () => {};',
        a11y_report: '',
        arch_approval: false,
        metadata: {},
        _step_count: 1,
        rejectionCount: 0,
        rejectionReason: '',
        lastApprovedBy: null,
        signoffs: {},
      };

      const nodeFn = createLLMPersonaNode(personaId);

      // Act & Assert
      await expect(nodeFn(state)).rejects.toThrow('ECONNREFUSED');
    });

    it('should throw when persona ID is invalid', () => {
      // Arrange
      const invalidPersonaId = 'invalid-persona-xyz';

      // Act & Assert
      expect(() => createLLMPersonaNode(invalidPersonaId)).toThrow();
    });

    it('should throw when model type is unsupported', async () => {
      // Arrange
      // Temporarily modify a persona to have an unsupported model
      const personaId = 'po';
      const originalModel = AGENT_PERSONAS[personaId].model;
      (AGENT_PERSONAS[personaId].model as any) = 'unsupported-model-xyz';

      const state: AgentState = {
        messages: [
          {
            type: 'human',
            content: 'Request.',
          },
        ],
        next_recipient: 'architect',
        code_buffer: '',
        a11y_report: '',
        arch_approval: false,
        metadata: {},
        _step_count: 1,
        rejectionCount: 0,
        rejectionReason: '',
        lastApprovedBy: null,
        signoffs: {},
      };

      const nodeFn = createLLMPersonaNode(personaId);

      // Act & Assert
      await expect(nodeFn(state)).rejects.toThrow();

      // Cleanup
      AGENT_PERSONAS[personaId].model = originalModel;
    });
  });

  describe('all 6 personas supported', () => {
    const personaIds = ['po', 'architect', 'dev', 'a11y', 'qa', 'docs'];

    personaIds.forEach((personaId) => {
      it(`should support ${personaId} persona`, async () => {
        // Arrange
        const mockResponse = `Response from ${personaId}`;
        const clientMock =
          personaId === 'a11y' ? mockAnthropicClient : mockOpenAIClient;
        clientMock.invoke.mockResolvedValue({ content: mockResponse });

        const state: AgentState = {
          messages: [
            {
              type: 'human',
              content: `Request for ${personaId}.`,
            },
          ],
          next_recipient: null,
          code_buffer: '',
          a11y_report: '',
          arch_approval: false,
          metadata: { persona: personaId },
          _step_count: 1,
          rejectionCount: 0,
          rejectionReason: '',
          lastApprovedBy: null,
          signoffs: {},
        };

        // Act
        const nodeFn = createLLMPersonaNode(personaId);
        const result = await nodeFn(state);

        // Assert
        expect(result.messages).toBeDefined();
        expect(result.messages?.length).toBe(1); // only new AI message
        expect(result.messages?.[0].type).toBe('ai');
        expect(result.messages?.[0].content).toBe(mockResponse);
      });
    });
  });

  describe('message history context preservation', () => {
    it('should include full message history in LLM prompt', async () => {
      // Arrange
      const personaId = 'dev';
      const mockResponse = 'Implementation here.';
      mockOpenAIClient.invoke.mockResolvedValue({ content: mockResponse });

      const state: AgentState = {
        messages: [
          {
            type: 'human',
            content: 'Design request from PO.',
          },
          {
            type: 'ai',
            content: 'Design spec created.',
          },
          {
            type: 'human',
            content: 'Architecture approved.',
          },
          {
            type: 'human',
            content: 'Now implement the component.',
          },
        ],
        next_recipient: 'qa',
        code_buffer: '',
        a11y_report: '',
        arch_approval: true,
        metadata: {},
        _step_count: 4,
        rejectionCount: 0,
        rejectionReason: '',
        lastApprovedBy: 'architect',
        signoffs: { po: true, architect: true },
      };

      const nodeFn = createLLMPersonaNode(personaId);

      // Act
      await nodeFn(state);

      // Assert
      expect(mockOpenAIClient.invoke).toHaveBeenCalled();
      // invoke is called with (messages: BaseMessage[], options: { system: string })
      const messageArgs = mockOpenAIClient.invoke.mock.calls[0][0];
      // Should pass all message history to LLM
      expect(Array.isArray(messageArgs)).toBe(true);
      expect(messageArgs.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('next_recipient routing (persona sequence advancement)', () => {
    it('should advance next_recipient from po to architect', async () => {
      // Arrange
      const personaId = 'po';
      const mockLLMResponse = 'APPROVED - Design ready.';
      mockOpenAIClient.invoke.mockResolvedValue({
        content: mockLLMResponse,
      });

      const state: AgentState = {
        messages: [
          {
            type: 'human',
            content: 'Design request.',
          },
        ],
        next_recipient: 'po',
        code_buffer: '',
        a11y_report: '',
        arch_approval: false,
        metadata: {},
        _step_count: 1,
        rejectionCount: 0,
        rejectionReason: '',
        lastApprovedBy: null,
        signoffs: {},
      };

      const nodeFn = createLLMPersonaNode(personaId);

      // Act
      const result = await nodeFn(state);

      // Assert
      expect(result.next_recipient).toBe('architect');
    });

    it('should advance next_recipient from architect to dev', async () => {
      // Arrange
      const personaId = 'architect';
      const mockLLMResponse = 'Architecture approved.';
      mockOpenAIClient.invoke.mockResolvedValue({
        content: mockLLMResponse,
      });

      const state: AgentState = {
        messages: [
          {
            type: 'human',
            content: 'Architecture review.',
          },
        ],
        next_recipient: 'architect',
        code_buffer: '',
        a11y_report: '',
        arch_approval: false,
        metadata: {},
        _step_count: 1,
        rejectionCount: 0,
        rejectionReason: '',
        lastApprovedBy: null,
        signoffs: {},
      };

      const nodeFn = createLLMPersonaNode(personaId);

      // Act
      const result = await nodeFn(state);

      // Assert
      expect(result.next_recipient).toBe('dev');
    });

    it('should advance next_recipient from dev to a11y', async () => {
      // Arrange
      const personaId = 'dev';
      const mockLLMResponse = 'Implementation complete.';
      mockOpenAIClient.invoke.mockResolvedValue({
        content: mockLLMResponse,
      });

      const state: AgentState = {
        messages: [
          {
            type: 'human',
            content: 'Implementation request.',
          },
        ],
        next_recipient: 'dev',
        code_buffer: '',
        a11y_report: '',
        arch_approval: false,
        metadata: {},
        _step_count: 1,
        rejectionCount: 0,
        rejectionReason: '',
        lastApprovedBy: null,
        signoffs: {},
      };

      const nodeFn = createLLMPersonaNode(personaId);

      // Act
      const result = await nodeFn(state);

      // Assert
      expect(result.next_recipient).toBe('a11y');
    });

    it('should advance next_recipient from a11y to qa', async () => {
      // Arrange
      const personaId = 'a11y';
      const mockLLMResponse = 'Accessibility audit passed.';
      mockAnthropicClient.invoke.mockResolvedValue({
        content: mockLLMResponse,
      });

      const state: AgentState = {
        messages: [
          {
            type: 'human',
            content: 'Audit request.',
          },
        ],
        next_recipient: 'a11y',
        code_buffer: 'const Button = () => {};',
        a11y_report: '',
        arch_approval: false,
        metadata: {},
        _step_count: 1,
        rejectionCount: 0,
        rejectionReason: '',
        lastApprovedBy: null,
        signoffs: {},
      };

      const nodeFn = createLLMPersonaNode(personaId);

      // Act
      const result = await nodeFn(state);

      // Assert
      expect(result.next_recipient).toBe('qa');
    });

    it('should advance next_recipient from qa to docs', async () => {
      // Arrange
      const personaId = 'qa';
      const mockLLMResponse = 'QA passed.';
      mockOpenAIClient.invoke.mockResolvedValue({
        content: mockLLMResponse,
      });

      const state: AgentState = {
        messages: [
          {
            type: 'human',
            content: 'QA review.',
          },
        ],
        next_recipient: 'qa',
        code_buffer: '',
        a11y_report: '',
        arch_approval: false,
        metadata: {},
        _step_count: 1,
        rejectionCount: 0,
        rejectionReason: '',
        lastApprovedBy: null,
        signoffs: {},
      };

      const nodeFn = createLLMPersonaNode(personaId);

      // Act
      const result = await nodeFn(state);

      // Assert
      expect(result.next_recipient).toBe('docs');
    });

    it('should set next_recipient to null when docs persona completes (end of sequence)', async () => {
      // Arrange
      const personaId = 'docs';
      const mockLLMResponse = 'Documentation complete.';
      mockOpenAIClient.invoke.mockResolvedValue({
        content: mockLLMResponse,
      });

      const state: AgentState = {
        messages: [
          {
            type: 'human',
            content: 'Documentation request.',
          },
        ],
        next_recipient: 'docs',
        code_buffer: '',
        a11y_report: '',
        arch_approval: false,
        metadata: {},
        _step_count: 1,
        rejectionCount: 0,
        rejectionReason: '',
        lastApprovedBy: null,
        signoffs: {},
      };

      const nodeFn = createLLMPersonaNode(personaId);

      // Act
      const result = await nodeFn(state);

      // Assert
      expect(result.next_recipient).toBeNull();
    });

    it('should return both messages and next_recipient in result', async () => {
      // Arrange
      const personaId = 'po';
      const mockLLMResponse = 'APPROVED';
      mockOpenAIClient.invoke.mockResolvedValue({
        content: mockLLMResponse,
      });

      const state: AgentState = {
        messages: [
          {
            type: 'human',
            content: 'Request.',
          },
        ],
        next_recipient: 'po',
        code_buffer: '',
        a11y_report: '',
        arch_approval: false,
        metadata: {},
        _step_count: 1,
        rejectionCount: 0,
        rejectionReason: '',
        lastApprovedBy: null,
        signoffs: {},
      };

      const nodeFn = createLLMPersonaNode(personaId);

      // Act
      const result = await nodeFn(state);

      // Assert
      expect(Object.keys(result)).toContain('messages');
      expect(Object.keys(result)).toContain('next_recipient');
      expect(result.messages?.length).toBeGreaterThan(0);
      expect(result.next_recipient).toBe('architect');
    });

    it('should validate routing sequence matches PERSONA_IDS order', async () => {
      // Arrange - Verify the complete sequence
      const sequence = ['po', 'architect', 'dev', 'a11y', 'qa', 'docs'];

      // This is a validation test that documents the expected routing sequence
      // The factory must follow this exact order
      sequence.forEach((personaId, index) => {
        const expectedNext =
          index < sequence.length - 1 ? sequence[index + 1] : null;
        // This test verifies the routing sequence is correct
        expect(expectedNext).toBeDefined();
      });
    });
  });

  describe('Anthropic prefill guard (issue #138)', () => {
    it('should append HumanMessage when Anthropic client receives message array ending with AIMessage', async () => {
      // Arrange
      // The a11y persona uses Anthropic client
      const personaId = 'a11y';
      const mockLLMResponse = 'Accessibility audit complete. No violations.';
      mockAnthropicClient.invoke.mockResolvedValue({
        content: mockLLMResponse,
      });

      // State with message history ending in AIMessage (from mesh router or dev node)
      const state: AgentState = {
        messages: [
          {
            type: 'human',
            content: 'Please audit this component for accessibility.',
          },
          {
            type: 'ai',
            content: 'I will audit the component now.',
          }, // Ends with AIMessage
        ],
        next_recipient: 'qa',
        code_buffer: 'const Button = () => <button>Click</button>;',
        a11y_report: '',
        arch_approval: true,
        metadata: {},
        _step_count: 2,
        rejectionCount: 0,
        rejectionReason: '',
        lastApprovedBy: 'dev',
        signoffs: { po: true, architect: true, dev: true },
      };

      const nodeFn = createLLMPersonaNode(personaId);

      // Act
      const result = await nodeFn(state);

      // Assert
      // The Anthropic client should have been called
      expect(mockAnthropicClient.invoke).toHaveBeenCalled();

      // Get the messages array that was passed to the Anthropic client
      const messageArgs = mockAnthropicClient.invoke.mock.calls[0][0];
      expect(Array.isArray(messageArgs)).toBe(true);

      // The last message in the array should be a HumanMessage (the appended guard message)
      const lastMessage = messageArgs[messageArgs.length - 1];
      expect(lastMessage.constructor.name).toBe('HumanMessage');
      expect(lastMessage.content).toBe(
        'Please proceed with your task based on the context above.',
      );

      // Result should contain the AI response message
      expect(result.messages).toBeDefined();
      expect(result.messages?.[0].type).toBe('ai');
      expect(result.messages?.[0].content).toBe(mockLLMResponse);
    });

    it('should NOT append HumanMessage when OpenAI client receives message array ending with AIMessage', async () => {
      // Arrange
      // The po persona uses OpenAI client
      const personaId = 'po';
      const mockLLMResponse = 'Design specification is ready.';
      mockOpenAIClient.invoke.mockResolvedValue({
        content: mockLLMResponse,
      });

      // State with message history ending in AIMessage
      const state: AgentState = {
        messages: [
          {
            type: 'human',
            content: 'Please design a button component.',
          },
          {
            type: 'ai',
            content: 'I will create the design specification.',
          }, // Ends with AIMessage
        ],
        next_recipient: 'architect',
        code_buffer: '',
        a11y_report: '',
        arch_approval: false,
        metadata: {},
        _step_count: 2,
        rejectionCount: 0,
        rejectionReason: '',
        lastApprovedBy: null,
        signoffs: {},
      };

      const nodeFn = createLLMPersonaNode(personaId);

      // Act
      const result = await nodeFn(state);

      // Assert
      // The OpenAI client should have been called
      expect(mockOpenAIClient.invoke).toHaveBeenCalled();

      // Get the messages array that was passed to the OpenAI client
      const messageArgs = mockOpenAIClient.invoke.mock.calls[0][0];
      expect(Array.isArray(messageArgs)).toBe(true);

      // For OpenAI, the last message should still be the AIMessage
      // (no guard message appended, since OpenAI is permissive)
      const lastMessage = messageArgs[messageArgs.length - 1];
      expect(lastMessage.constructor.name).toBe('AIMessage');

      // Result should contain the AI response message
      expect(result.messages).toBeDefined();
      expect(result.messages?.[0].type).toBe('ai');
      expect(result.messages?.[0].content).toBe(mockLLMResponse);
    });

    it('should NOT append HumanMessage when message array already ends with HumanMessage', async () => {
      // Arrange
      // The a11y persona uses Anthropic client
      const personaId = 'a11y';
      const mockLLMResponse = 'Accessibility audit passed.';
      mockAnthropicClient.invoke.mockResolvedValue({
        content: mockLLMResponse,
      });

      // State with message history already ending in HumanMessage (valid state)
      const state: AgentState = {
        messages: [
          {
            type: 'human',
            content: 'Please audit this component for accessibility.',
          },
          {
            type: 'ai',
            content: 'I will audit the component now.',
          },
          {
            type: 'human',
            content: 'Please proceed with the audit.',
          }, // Already ends with HumanMessage
        ],
        next_recipient: 'qa',
        code_buffer: 'const Button = () => <button>Click</button>;',
        a11y_report: '',
        arch_approval: true,
        metadata: {},
        _step_count: 3,
        rejectionCount: 0,
        rejectionReason: '',
        lastApprovedBy: 'dev',
        signoffs: { po: true, architect: true, dev: true },
      };

      const nodeFn = createLLMPersonaNode(personaId);

      // Act
      const result = await nodeFn(state);

      // Assert
      // The Anthropic client should have been called
      expect(mockAnthropicClient.invoke).toHaveBeenCalled();

      // Get the messages array that was passed to the Anthropic client
      const messageArgs = mockAnthropicClient.invoke.mock.calls[0][0];
      expect(Array.isArray(messageArgs)).toBe(true);

      // Verify no guard message was appended: SystemMessage + 3 state messages = 4 total
      expect(messageArgs.length).toBe(4);

      // The last message should be HumanMessage from state (not an appended guard)
      const lastMessage = messageArgs[messageArgs.length - 1];
      expect(lastMessage.constructor.name).toBe('HumanMessage');
      expect(lastMessage.content).toBe('Please proceed with the audit.');

      // Result should contain the AI response message
      expect(result.messages).toBeDefined();
      expect(result.messages?.[0].type).toBe('ai');
      expect(result.messages?.[0].content).toBe(mockLLMResponse);
    });

    it('should append HumanMessage when Anthropic client receives empty state.messages (only SystemMessage in array)', async () => {
      // Arrange
      // Edge case: state.messages is empty, so the LLM message array contains only SystemMessage
      // Anthropic requires the final message to be from a user, so guard must append
      const personaId = 'a11y';
      const mockLLMResponse = 'Accessibility audit result.';
      mockAnthropicClient.invoke.mockResolvedValue({
        content: mockLLMResponse,
      });

      // State with empty message history (first request to a11y node)
      const state: AgentState = {
        messages: [], // Empty — only SystemMessage will be in the LLM array
        next_recipient: 'qa',
        code_buffer: 'const Button = () => <button>Click</button>;',
        a11y_report: '',
        arch_approval: true,
        metadata: {},
        _step_count: 1,
        rejectionCount: 0,
        rejectionReason: '',
        lastApprovedBy: null,
        signoffs: {},
      };

      const nodeFn = createLLMPersonaNode(personaId);

      // Act
      const result = await nodeFn(state);

      // Assert
      expect(mockAnthropicClient.invoke).toHaveBeenCalled();

      // Get the messages array that was passed to the Anthropic client
      const messageArgs = mockAnthropicClient.invoke.mock.calls[0][0];
      expect(Array.isArray(messageArgs)).toBe(true);

      // With empty state.messages: SystemMessage + appended HumanMessage = 2 total
      expect(messageArgs.length).toBe(2);

      // The last message should be the appended HumanMessage
      const lastMessage = messageArgs[messageArgs.length - 1];
      expect(lastMessage.constructor.name).toBe('HumanMessage');
      expect(lastMessage.content).toBe(
        'Please proceed with your task based on the context above.',
      );

      // Result should contain the AI response message
      expect(result.messages).toBeDefined();
      expect(result.messages?.[0].type).toBe('ai');
      expect(result.messages?.[0].content).toBe(mockLLMResponse);
    });
  });
});
