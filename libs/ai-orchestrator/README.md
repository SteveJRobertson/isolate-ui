# AI Orchestrator

Multi-agent orchestrator for the Isolate UI development lifecycle. Coordinates 6 specialized agent personas for component implementation via a stateful execution graph (LangGraph.js integration planned).

## Overview

The AI Orchestrator acts as the "Brain" of Isolate UI development, managing a stateful workflow that routes requests through specialized agents:

- **@isolate-po** - Product Owner (design tokens, Ark UI primitives)
- **@isolate-architect** - Architect (Nx boundaries, monorepo governance)
- **@isolate-dev** - Developer (TypeScript/Panda CSS implementation)
- **@isolate-a11y** - A11y Specialist (WAI-ARIA, keyboard navigation)
- **@isolate-qa** - QA Engineer (test coverage, error scenarios)
- **@isolate-docs** - Documentation (Storybook, README generation)

## Architecture

### Core Components

- **Agent State** - Zod-validated schema tracking conversation, code buffers, and approval gates
- **Persona Nodes** - LLM-powered agents with specialized constraints and capabilities
- **Checkpointing** - SQLite persistence for thread-based resumption via GitHub Issue IDs
- **Router** - Intelligent routing between agents based on task requirements

### State Shape

```typescript
{
  messages: Array<{
    type: string; // LangChain message type (human/ai/tool)
    content: string; // Message text
    id?: string;
    additional_kwargs?: Record<string, unknown>;
  }>;
  next_recipient: 'po' | 'architect' | 'dev' | 'a11y' | 'qa' | 'docs' | null;
  code_buffer: string; // Git diff or code under review
  a11y_report: string; // Accessibility audit feedback
  arch_approval: boolean; // Monorepo consistency gate
  metadata: Record<string, any>; // Iteration tracking

  // Refinement loop channels
  rejectionCount: number; // Increments on each persona rejection
  rejectionReason: string; // Last rejection message content
  lastApprovedBy: string | null; // Persona ID of last approver
  signoffs: Record<string, boolean>; // Per-persona approval booleans
}
```

## Setup

### Environment Variables

Create a `.env` file in the project root:

```bash
OPENAI_API_KEY=sk_...
ANTHROPIC_API_KEY=sk_...
GITHUB_TOKEN=ghp_...
```

### Installation

```bash
# Install dependencies
pnpm install

# Verify setup
pnpm nx test ai-orchestrator
pnpm nx typecheck ai-orchestrator
pnpm nx lint ai-orchestrator
```

## Development

### Running Tests

```bash
# Run once
pnpm nx test ai-orchestrator

# Watch mode
pnpm nx test ai-orchestrator --watch
```

### Type Checking

```bash
pnpm nx typecheck ai-orchestrator
```

### Linting

```bash
pnpm nx lint ai-orchestrator
```

## Personas

The orchestrator uses in-code persona definitions and validates them against the persona markers in `AGENTS.md` at the project root:

### 1. Product Owner (@isolate-po)

- Selects Ark UI primitives
- Maps design tokens (Panda CSS)
- Ensures design consistency

### 2. Architect (@isolate-architect)

- Enforces Nx project boundaries
- Validates shared utility usage
- Reviews monorepo structure

### 3. Developer (@isolate-dev)

- Implements TypeScript components
- Applies Panda CSS styling
- Follows "The Blueprint" specification

### 4. A11y Specialist (@isolate-a11y)

- Audits WAI-ARIA compliance
- Validates keyboard navigation
- Ensures WCAG 2.1 AA conformance

### 5. QA Engineer (@isolate-qa)

- Validates Vitest coverage
- Tests error state recovery
- Verifies component behavior

### 6. Documentation (@isolate-docs)

- Generates Storybook stories
- Creates README artifacts
- Documents API surfaces

## Refinement Loop

The orchestrator implements a **Definition of Ready** refinement loop that routes a component
request through a 3-agent (PO → Dev → QA) consensus sequence before implementation begins.

### How It Works

1. Each persona ends its LLM response with `APPROVED` or `REJECTED: <reason>`.
2. On **APPROVED** the loop advances to the next persona and records the signoff.
3. On **REJECTED** the loop resets to the first persona (`po`), increments `rejectionCount`,
   clears all signoffs, and stores the rejection reason.
4. At **iteration 5** the loop throws `RefinementIterationLimitError` and pauses for human
   review.

### Key API

```typescript
import { createRefinementNode, parseDecision, getNextInSequence, RefinementIterationLimitError, DEFAULT_REFINEMENT_CONFIG } from '@isolate-ui/ai-orchestrator';

// Wrap a persona node function with refinement routing
const wrappedNode = createRefinementNode('po', DEFAULT_REFINEMENT_CONFIG, myPoFn);

// Or configure the orchestrator graph directly
const graph = new OrchestratorGraph();
graph.configureRefinement({ maxIterations: 3 });
graph.registerRefinementNode('po', myPoFn);
graph.registerRefinementNode('dev', myDevFn);
graph.registerRefinementNode('qa', myQaFn);

try {
  const result = await graph.run(initialState, threadId, token);
} catch (err) {
  if (err instanceof RefinementIterationLimitError) {
    // Loop paused — err.rejectionCount, err.threadId available
  }
}
```

### Sequence Configuration

```typescript
// Default: po → dev → qa
const DEFAULT_REFINEMENT_CONFIG = {
  baseSequence: ['po', 'dev', 'qa'],
  maxIterations: 5,
};

// Custom sequence (e.g. skip dev for documentation tasks)
graph.configureRefinement({
  baseSequence: ['po', 'qa'],
  maxIterations: 3,
});
```

### GitHub Comment

When the loop completes successfully (or is interrupted at the iteration limit), the orchestrator
posts a structured comment to the triggering GitHub Issue containing:

- **Technical Spec Table** — component name, Ark UI primitive, tokens, variants
- **Edge Case List** — accessibility, keyboard, dark mode, loading/error states
- **Persona Sign-offs** — `- [x] @isolate-po`, `- [x] @isolate-dev`, `- [x] @isolate-qa`

A `GITHUB_TOKEN` environment variable is required to post comments. If absent the comment is
skipped silently and a warning is logged.

```typescript
// GitHub repo coordinates (default: SteveJRobertson/isolate-ui)
graph.setGitHubRepo('my-org', 'my-repo');
```

### Token Validation Helper

The Dev persona has access to `checkTokenExists()` from `@isolate-ui/utils/ai` to validate
that design token references exist in the live token registry:

```typescript
import { checkTokenExists } from '@isolate-ui/utils/ai';

const result = checkTokenExists('color.primary.500');
// { exists: true, value: '#3b82f6', path: 'color.primary.500' }

const missing = checkTokenExists('color.brand.unknown');
// { exists: false, path: 'color.brand.unknown', closestMatch: 'color.brand.500' }
```

## Persistence

State is persisted to SQLite:

```
libs/ai-orchestrator/data/state.db
```

Resume workflows by thread ID (GitHub Issue number):

```typescript
const checkpointer = new SqliteSaver(dbPath);
const state = checkpointer.get(threadId);
```

## Configuration

Personas are validated against the root `AGENTS.md` file on startup via `validateAgentsConfig()`.
The validation checks that each required persona marker (`@isolate-po`, `@isolate-architect`, etc.)
is present anywhere in the file.

> **Note**: Persona definitions (system prompts, model selection, I/O fields) live in the
> in-code `AGENT_PERSONAS` map in `src/agents/personas.ts`. `AGENTS.md` serves as the
> canonical human-readable reference; `validateAgentsConfig()` ensures the two are kept in sync
> by failing fast if any persona is missing from the file.

If validation fails, the orchestrator throws a hard error during initialization.

## Dependencies

- `zod` - Runtime schema validation
- `better-sqlite3` - Persistent state storage
- `@langchain/langgraph` - Multi-agent orchestration graph
- `@langchain/openai` - GPT-4o integration
- `@langchain/anthropic` - Claude 3.5 Sonnet integration
- `@octokit/rest` - GitHub API client for posting refinement loop comments

## Testing

Tests verify:

- [x] Multi-node orchestration workflow execution
- [x] All 6 personas detected correctly in AGENTS.md
- [x] State persists to SQLite and resumes via thread_id
- [x] GitHub Copilot can summarize persona constraints
- [x] `parseDecision` extracts APPROVED / REJECTED / PENDING from LLM responses
- [x] `createRefinementNode` advances, backtracks, and enforces the iteration limit
- [x] `RefinementIterationLimitError` carries `rejectionCount` and `threadId`
- [x] GitHub comment formatter renders Technical Spec Table, Edge Case List, and Sign-offs
- [x] Full PO → Dev → QA E2E consensus loop via `OrchestratorGraph`

## Related Issues

- #19 - Implement Definition of Ready Refinement Loop
- #23 - Establish Agent Personas and Governance (this project)
- #18 - Setup Agent Environment (Node.js + LangGraph.js)
- #20 - Build the "Ambiguity Mesh" Router
- #21 - GitHub Webhook Listener for Remote Review

## Resources

- [LangGraph.js Documentation](https://langchain-js.vercel.app/docs/langgraph)
- [LangChain Documentation](https://js.langchain.com)
- [Zod Documentation](https://zod.dev)
