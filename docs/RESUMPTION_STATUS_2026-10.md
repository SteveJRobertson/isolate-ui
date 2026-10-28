# Resumption Status — October 2026

Recorded while resuming work on the AI orchestrator after a ~4 month pause (parked early June 2026). Captures what was found, so the next session (and the Spec Kit `/specify` pass for the next feature) doesn't have to re-derive it.

## TL;DR

Nothing was lost — the working tree was clean and the last branch was fully merged into `main`. All 516 tests pass. The reason the orchestrator "wouldn't work with a revision" is bigger than a revision-specific bug: **the live pipeline never had a code-writing or PR-creation step at all**, for new components or revisions. It runs a 6-persona LLM discussion that ends in a GitHub comment, never a commit or a PR.

## Root cause

Every persona registered in `apps/webhook-listener/src/main.ts` runs through `createLLMPersonaNode()` (`libs/ai-orchestrator/src/orchestrator/llm-persona-node.ts`), which only calls an LLM and appends the text reply as a chat message. No node touches the filesystem, runs git, or calls the GitHub PR API. `libs/ai-orchestrator/src/github/poster.ts` only posts issue comments (`postRefinementLoopComment`, `postMeshStalemateComment`) — there is no `pulls.create`, `createRef`, or `git push` anywhere in the repo.

Two pieces that _could_ close this gap already exist, fully built and unit-tested, but are **not wired into the live graph**:

- `libs/ai-orchestrator/src/orchestrator/dev-node.ts` (`createDevBoilerplateNode`) — scaffolds a brand-new Nx library via the Nx generator. Unconditional; the Nx generator errors if the target already exists, so this would fail outright on a _revision_. This is almost certainly the wall the original issue hit, even though it was never actually in the production path.
- `libs/ai-orchestrator/src/orchestrator/git-utils.ts` (`applyCodeBuffer`) — applies an arbitrary unified diff via `git apply`, with snapshot-based rollback on failure. This is the piece that can handle both creation and revision, since it's diff-based rather than scaffold-based. Also unwired.

**What's solid:** the multi-persona triage/consensus layer is in good shape — pause/resume state machine (`refinement_limit` / `mesh_stalemate`), the Goal-Driven Orchestration triage split (po → Path A "component" vs Path B "chore/bug/fast-approve"), the ambiguity mesh router, checkpointing, `/approve` `/fix` `/query` commands, startup sync for missed comments. All well-tested.

**What's missing:** wiring either `applyCodeBuffer` or a successor into the `dev` node, and adding the still-nonexistent "create branch → commit → open PR" step via Octokit after `docs` signs off. Neither exists in any form yet. This is the scope for the next Spec Kit spec.

## Copilot / Gemini

- **Copilot**: never an LLM provider in this codebase. Only appears as a CI-enforced PR-template section (`## Copilot Review Triage`) and a VS Code Copilot Chat prompt file. Decision: keep as-is — it's reviewer-agnostic process tooling, not a provider dependency.
- **Gemini**: was an abandoned rebuild attempt (`gemini-cli-setup` branch + three stashes), fully superseded by the real LangGraph-based implementation. Cleaned up as part of this resumption pass — see git history around this commit for what was removed.

## Housekeeping done alongside this doc

- Fixed three stale doc claims: `/health` endpoint status in `docs/DEPLOYMENT_FUTURE_ENHANCEMENTS.md`, Node version mismatch in `README.md`, and an unbacked Copilot checklist claim in `libs/ai-orchestrator/README.md`.
- Removed dead Gemini branch/stashes.
- Cleared the 5-PR Dependabot backlog (CI gate mismatches with bot commit/PR conventions, not real breakage — see commit history for the `commitlint` scope-enum and PR-template CI fixes).
- Initialized Spec Kit (`specify init`) so the next session can run `/specify` directly against the code-gen + PR-creation feature.

## Provider wiring (for reference)

Three call sites hand-roll provider selection against LangChain's `BaseChatModel`: `libs/ai-orchestrator/src/llm/clients.ts`, `src/orchestrator/llm-persona-node.ts`, `src/orchestrator/mesh-router.ts`. Only OpenAI (`gpt-4o`) and Anthropic (`claude-sonnet-4-6`) are wired. No Copilot/Gemini SDK exists anywhere. Swapping/adding a provider means touching those three files plus the `AgentPersona.model` union type in `src/agents/personas.ts` — not a full rearchitect, but not a single config flag either.
