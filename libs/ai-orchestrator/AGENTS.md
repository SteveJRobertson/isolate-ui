# Agent Notes — AI Orchestrator

See the full architecture overview in [README.md](README.md).

## Project Commands

```bash
nx test ai-orchestrator        # run unit tests
nx typecheck ai-orchestrator   # type check
nx lint ai-orchestrator        # lint
nx build ai-orchestrator       # build
```

## Key Constraints (enforce on every change)

### LangGraph node functions

- **Return `Partial<AgentState>` with only changed fields.** Never mutate the `state` argument.
- Channel reducers handle merging — returning the full state causes duplicate data.

```typescript
// ✅ correct
return { next_recipient: 'dev', signoffs: { po: true } };

// ❌ wrong — direct mutation
state.next_recipient = 'dev';
return state;
```

### Persona workflow

- Persona ordering is governed by `PERSONA_IDS` in `src/agents/personas.ts`. Do not rely on `Object.keys()` insertion order.
- Each persona ends its response with `APPROVED` or `REJECTED: <reason>`. A rejection resets to `@isolate-po` and increments `rejectionCount`. After 5 rejections the orchestrator throws `RefinementIterationLimitError`.
- `next_recipient: 'human_review'` is a special terminal node — it posts a GitHub pause comment and routes the graph to `__end__`.

### SQLite checkpointing

- The SQLite saver in `src/persistence/` uses parameterized queries only. Never interpolate runtime values into SQL strings.
- Thread key is the GitHub Issue ID — `OrchestratorGraph` is initialized with a `dbPath`.

## File Structure

```
src/
├── agents/
│   ├── index.ts        # AgentNode factory
│   └── personas.ts     # PERSONA_IDS + persona definitions
├── config/             # Model/LLM configuration
├── github/             # GitHub comment posting helpers
├── llm/                # LLM client wrappers (OpenAI / Anthropic)
├── orchestrator/       # OrchestratorGraph class (LangGraph graph definition)
├── persistence/
│   ├── checkpoint.ts   # CheckpointSaver interface
│   ├── langgraph-saver.ts  # SQLite-backed saver
│   └── index.ts
├── schema/
│   ├── agent-state.ts  # AgentStateSchema (Zod) + type exports
│   └── index.ts
└── index.ts            # Public API — exports OrchestratorGraph
```

## Environment Variables

Required at runtime (validated at startup in `apps/webhook-listener`):

- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` — at least one LLM key
- `GITHUB_TOKEN` — PAT with `repo` scope for posting comments
