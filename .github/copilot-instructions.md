# Isolate UI — Copilot Coding Instructions

These rules apply to all code generated or edited by Copilot in this repository.
Follow them precisely; do not silently deviate.

---

## Project Orientation

Nx monorepo for the Isolate UI component library. Package manager: **pnpm**. Testing: **Vitest** (unit) + **Playwright CT** (component a11y).

**Key paths:**

- `libs/react/*/` — React component libraries
- `libs/shared/tokens/` — Design token pipeline (Style Dictionary v4)
- `libs/utils/` — Shared utilities; `@isolate-ui/utils/ai` exports `checkTokenExists()`
- `libs/ai-orchestrator/` — LangGraph multi-agent orchestrator
- `apps/webhook-listener/` — Fastify server that receives GitHub webhooks

**Essential commands:**

```bash
pnpm vitest run            # run all unit tests once
nx run-many -t test lint typecheck  # full quality gate
nx affected -t test --base=origin/main  # only changed projects
nx test react-button       # single project
```

**Full development guide:** [AGENTS.md](../AGENTS.md)
**Accessibility testing guide:** [A11Y_TESTING.md](../A11Y_TESTING.md)

---

## Async / Error Handling

- **No fire-and-forget.** Every top-level async call site must either `await` the call inside a `try/catch`, or chain `.catch()` with a handler that logs and exits (or re-throws). This applies to: command handlers (`approve.ts`, `fix.ts`, `query.ts`), startup functions, and any background work initiated from a route handler.
- Mid-level `async` functions that are themselves `await`-ed do not need their own `.catch()` — rejection propagates to the caller.
- Fastify route handlers must either `throw` on error or call `reply.status(N).send(err)`. Never swallow an error silently.

```typescript
// ✅ correct — top-level entry point
start().catch((err) => {
  console.error('[service] fatal startup error:', err);
  process.exit(1);
});

// ❌ wrong — unhandled rejection if start() throws
start();
```

---

## Security

- **Webhook HMAC verification must happen before any payload parsing or business logic.** Never read `request.body` fields before the signature is confirmed valid.
- **Authorization checks must precede business logic.** Verify the actor's role/permission before touching state, the database, or external services.
- **No secrets or tokens in log output.** Use a redaction helper or log only the first/last N characters. Never log `GITHUB_TOKEN`, `WEBHOOK_SECRET`, or equivalent.
- Environment variables required for the service to function must be validated at startup with an explicit `process.exit(1)` and a clear error message if absent.

```typescript
// ✅ correct order
verifyHmac(request); // 1. verify signature
checkAuthorization(actor); // 2. check permission
await processCommand(payload); // 3. business logic

// ❌ wrong order — processes payload before verifying identity
await processCommand(payload);
verifyHmac(request);
```

---

## TypeScript

- **No `any` at public API boundaries** (exported function parameters, return types, Zod schemas, HTTP route types). Use `unknown` with explicit type narrowing instead.
- **New I/O boundaries must use Zod.** Any new HTTP route handler, database read, or environment variable block introduced after May 2026 must parse its input with a Zod schema. Existing `IssueCommentPayload`-style interfaces do not need to be retrofitted.
- Use `as const` for literal enum-like values shared across modules.
- Prefer explicit return types on exported functions.

```typescript
// ✅ new route — Zod schema
const BodySchema = z.object({ command: z.string(), issueId: z.number() });
const body = BodySchema.parse(request.body);

// ❌ no validation — unknown shape at runtime
const body = request.body as MyInterface;
```

---

## Testing

- Every new **exported function** must have at least one test covering the failure / error path, not only the happy path.
- Every new **async function** must have at least one test that verifies what happens when the async operation rejects or throws.
- Mock external dependencies (`Octokit`, SQLite DB, LLM clients) — never make real network calls in unit tests.
- Test files live alongside source files or in `__tests__/` directories within the same project. Do not place tests outside the project boundary.

```typescript
// ✅ error path tested
it('throws when GITHUB_TOKEN is missing', () => {
  delete process.env.GITHUB_TOKEN;
  expect(() => validateEnv()).toThrow('GITHUB_TOKEN');
});
```

---

## LangGraph / AI Orchestrator

- **State mutations must be via the return object only.** Never mutate `state` directly inside a node function. Return a `Partial<AgentState>` with only the fields that changed.
- Channel reducers handle merging — returning the full state causes duplicate data.

```typescript
// ✅ correct — return only what changed
return { next_recipient: 'dev', signoffs: { po: true } };

// ❌ wrong — direct mutation
state.next_recipient = 'dev';
return state;
```

---

## SQLite

- **Parameterized queries only.** Never interpolate user-supplied or externally-sourced values into a SQL string.
- Use `INSERT OR IGNORE` for idempotent inserts (e.g., deduplication tables).

```typescript
// ✅ correct
db.prepare('SELECT * FROM deliveries WHERE id = ?').get(deliveryId);

// ❌ wrong — SQL injection risk
db.exec(`SELECT * FROM deliveries WHERE id = '${deliveryId}'`);
```

---

## Project Structure

- All imports between Nx projects must use the workspace aliases defined in `tsconfig.base.json` (e.g. `@isolate-ui/utils`, `@isolate-ui/tokens`). Never use relative paths that cross project boundaries.
- Generated or build-output directories (`styled-system/`, `dist/`, `playwright/.cache/`) must never be committed or imported from source.

---

## PR Workflow

- **Run the pre-PR reviewer automatically at the end of every phase of work.** Do not wait for a human to ask. In VS Code Copilot Chat, run `#pre-pr-review` and work through all findings before reporting phase completion or starting the next phase. Do not open the PR until Blocker and Major findings are resolved.
- **Wait for explicit human sign-off before committing.** After presenting the pre-PR review findings, do not commit or proceed to the next phase until the human has reviewed and approved. Never auto-commit immediately after the review.
- **Phase changes must be committed before the next phase begins.** Once the human has signed off, commit the phase changes (one commit per phase) before starting any implementation work for the subsequent phase.
- **Always use the PR template.** Every PR must include the four required sections: `## Summary`, `## Changes`, `## Copilot Review Triage`, and `## Deferred follow-ups`. CI will fail if any section is missing.
- **Never pre-check triage boxes.** Only mark a triage checkbox as `[x]` after the pre-PR review confirms that category is clean. CI requires all four triage checkboxes to be checked (`[x]`) and will fail if fewer than four are present — this is intentional: it means the review was not completed.
