# Agent Notes — Webhook Listener

## Project Commands

```bash
nx build webhook-listener                   # build
nx lint webhook-listener                    # lint
# No unit test target — use integration tests or run vitest manually in src/
```

## Critical Security Pipeline (enforce on every change)

The route pipeline **must** follow this order — never process the body before verifying the signature:

```
1. Filter: check X-GitHub-Event header
2. HMAC verification  →  401 on failure (verifyHmac in src/security/hmac.ts)
3. Require X-GitHub-Delivery header  →  400 if absent
4. Parse payload; skip non-'created' actions  →  200
5. Deduplication: INSERT delivery ID  →  200 if already seen
6. Authorization: check author_association ∈ AUTHORIZED_ASSOCIATIONS
7. Dispatch to command handler (/approve, /fix, /query)
8. Reply 200
```

`AUTHORIZED_ASSOCIATIONS` = `{ 'OWNER', 'MEMBER', 'COLLABORATOR' }` — always check before business logic.

## Command Handlers

All command handlers live in `src/commands/`:

- `approve.ts` — resumes a paused LangGraph thread from checkpoint
- `fix.ts` — triggers a fix cycle from the current code buffer
- `query.ts` — starts a new orchestrator thread for a GitHub issue
- `context.ts` — `CommandContext` type + `postErrorReply` helper

Every command handler is an `async` function. Top-level call sites must either `await` inside `try/catch` or chain `.catch()`. Never fire-and-forget.

## Environment Variables

Validated at startup in `src/main.ts` with `process.exit(1)` if absent:

- `GITHUB_TOKEN` — PAT with `repo` scope (required)
- `WEBHOOK_SECRET` — HMAC signing secret (required for signature verification)
- `HOST` — defaults to `0.0.0.0`
- `PORT` — defaults to `8080`
- `GITHUB_OWNER`, `GITHUB_REPO` — defaults to `SteveJRobertson/isolate-ui`
- `DATABASE_PATH` — SQLite file path (optional; resolved in `src/db/schema.ts`)

**Never log these values.** Use `postErrorReply` for user-facing error messages.

## Key Files

```
src/
├── main.ts              # Fastify startup; env validation; rawBody registration
├── routes/webhook.ts    # POST /api/webhook — the only route
├── security/hmac.ts     # verifyHmac() — must be called before body parsing
├── commands/            # approve.ts, fix.ts, query.ts, context.ts
├── db/schema.ts         # openDb() + resolveDbPath() + SQLite migrations
└── sync/startup.ts      # runStartupSync() — replays missed commands on boot
```
