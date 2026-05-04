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
    // Serialized conversation history
    type: string; //   LangChain message type (human/ai/tool)
    content: string; //   Message text
    id?: string; //   Optional message ID
    additional_kwargs?: Record<string, unknown>;
  }>;
  next_recipient: 'po' | 'architect' | 'dev' | 'a11y' | 'qa' | 'docs' | null;
  code_buffer: string; // Git diff or code under review
  a11y_report: string; // Accessibility audit feedback
  arch_approval: boolean; // Monorepo consistency gate
  metadata: Record<string, any>; // Iteration tracking
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

Currently installed:

- `zod` - Runtime schema validation
- `better-sqlite3` - Persistent state storage

Planned (not yet installed — LangGraph.js integration is part of the target architecture
but the packages are not required by the current implementation):

- `@langchain/langgraph` - Multi-agent orchestration
- `@langchain/openai` - GPT-4o integration
- `@langchain/anthropic` - Claude 3.5 Sonnet integration

## Testing

Tests verify:

- [x] Multi-node orchestration workflow execution
- [x] All 6 personas detected correctly in AGENTS.md
- [x] State persists to SQLite and resumes via thread_id
- [x] GitHub Copilot can summarize persona constraints

## Related Issues

- #23 - Establish Agent Personas and Governance (this project)
- #18 - Setup Agent Environment (Node.js + LangGraph.js)
- #20 - Build the "Ambiguity Mesh" Router
- #21 - GitHub Webhook Listener for Remote Review

## Resources

- [LangGraph.js Documentation](https://langchain-js.vercel.app/docs/langgraph)
- [LangChain Documentation](https://js.langchain.com)
- [Zod Documentation](https://zod.dev)
