import { Annotation, StateGraph, interrupt } from '@langchain/langgraph';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';
/**
 * Simple type for component spec
 */
type ComponentSpec = {
  component: string;
  primitive: string;
  props: Record<string, any>;
  slots: string[];
  tokens: string[];
  variants?: Record<string, any>;
};

// --- State Definition ---
const AgentState = Annotation.Root({
  issue_id: Annotation<string>,
  current_spec: Annotation<ComponentSpec | null>,
  iteration_count: Annotation<number>({
    reducer: (x, y) => y,
    default: () => 0,
  }),
  architect_feedback: Annotation<string[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  lessons_learned: Annotation<string>({
    reducer: (x, y) => y,
    default: () => '',
  }),
  is_human_approved: Annotation<boolean>({
    reducer: (x, y) => y,
    default: () => false,
  }),
  status: Annotation<'active' | 'success' | 'failed' | 'waiting'>({
    reducer: (x, y) => y,
    default: () => 'active',
  }),
});

// --- Node Implementations ---

/**
 * Node A: PO Node
 * Generates the component spec based on existing requirements.
 */
async function poNode(state: typeof AgentState.State) {
  console.log(`[PO Node] Generating spec. Iteration: ${state.iteration_count}`);

  // In a real scenario, this would be an LLM call.
  // For the spike, we'll simulate a slightly flawed spec that improves.
  const spec: ComponentSpec = {
    component: 'Button',
    primitive: '@ark-ui/react/button',
    props: {
      loading: { type: 'boolean', default: false },
      variant: { type: 'enum', options: ['solid', 'outline', 'ghost'] },
    },
    slots:
      state.iteration_count < 4
        ? ['root', 'label']
        : ['root', 'label', 'icon', 'spinner'],
    tokens:
      state.iteration_count === 0
        ? ['invalid.token']
        : ['color.primary.500', 'color.neutral.0'],
  };

  return { current_spec: spec };
}

/**
 * Node B: Architect Node
 * Validates the spec against Zod and real tokens.json.
 */
async function architectNode(state: typeof AgentState.State) {
  console.log(`[Architect Node] Validating spec.`);
  const spec = state.current_spec;
  if (!spec) return { status: 'failed' as const };

  const feedback: string[] = [];

  // 1. Basic Validation
  if (!spec.component) feedback.push('Missing component name.');
  if (!spec.primitive.startsWith('@ark-ui/react/'))
    feedback.push('Primitive must be an Ark UI component.');
  if (!spec.slots.includes('root'))
    feedback.push('Every component must have a "root" slot.');

  // 2. Token Validation (Real-time check against tokens.json)
  try {
    const tokensPath = path.resolve(
      process.cwd(),
      'libs/shared/tokens/src/tokens.json',
    );
    const tokensData = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));

    for (const token of spec.tokens) {
      const parts = token.split('.');
      let current = tokensData;
      let found = true;
      for (const part of parts) {
        if (current && typeof current === 'object' && part in current) {
          current = current[part];
        } else {
          found = false;
          break;
        }
      }
      if (!found) {
        feedback.push(`Token "${token}" is not defined in tokens.json.`);
      }
    }
  } catch (e) {
    feedback.push(`Failed to read tokens.json: ${e}`);
  }

  // 3. Logic/Standards Check
  if (!spec.slots.includes('icon'))
    feedback.push('Button should have an "icon" slot.');
  if (!spec.slots.includes('spinner'))
    feedback.push('Button should have a "spinner" slot.');

  if (feedback.length > 0) {
    console.log(`[Architect Node] Feedback: ${feedback.join(' | ')}`);
    return {
      architect_feedback: feedback,
      iteration_count: state.iteration_count + 1,
    };
  }

  console.log(`[Architect Node] Validation successful.`);
  return { architect_feedback: [], status: 'success' as const };
}

/**
 * Context Compression Node
 * Uses LLM to condense feedback into lessons_learned.
 */
async function summarizerNode(state: typeof AgentState.State) {
  if (state.architect_feedback.length === 0) return {};

  console.log(`[Summarizer Node] Compressing feedback.`);

  // Mocking LLM for the spike if API key is missing
  if (!process.env.OPENAI_API_KEY) {
    return {
      lessons_learned: `Mock Summary: Fix slots and tokens. Iteration ${state.iteration_count}`,
    };
  }

  const model = new ChatOpenAI({ modelName: 'gpt-4o' });
  const response = await model.invoke([
    {
      role: 'system',
      content:
        'You are an AI summarizer. Condense the following technical feedback into a concise "Lessons Learned" string for the next iteration.',
    },
    { role: 'user', content: state.architect_feedback.join('\n') },
  ]);

  return { lessons_learned: response.content as string };
}

/**
 * Gate Node: Human-in-the-loop pause
 */
function humanGate(state: typeof AgentState.State) {
  if (state.iteration_count === 3 && !state.is_human_approved) {
    console.log(`[Gate] Iteration 3 reached. Pausing for human approval.`);
    return interrupt('Human approval required at iteration 3.');
  }
}

// --- Graph Construction ---

const workflow = new StateGraph(AgentState)
  .addNode('po', poNode)
  .addNode('architect', architectNode)
  .addNode('summarizer', summarizerNode)
  .addNode('gate', humanGate)
  .addEdge('__start__', 'po')
  .addEdge('po', 'architect')
  .addEdge('architect', 'summarizer')
  .addEdge('summarizer', 'gate')
  .addConditionalEdges('gate', (state) => {
    if (state.status === 'success') return '__end__';
    if (state.iteration_count >= 5) {
      console.log(`[Graph] Max iterations reached. Failing.`);
      return '__end__';
    }
    return 'po';
  });

// Persistence setup
const dbPath = path.resolve(
  process.cwd(),
  'libs/ai-orchestrator/spikes/state.db',
);
const checkpointer = SqliteSaver.fromConnString(dbPath);

export const langgraphApp = workflow.compile({
  checkpointer,
});
