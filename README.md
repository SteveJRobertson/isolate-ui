# Isolate UI

[![CI](https://github.com/SteveJRobertson/isolate-ui/actions/workflows/ci.yml/badge.svg)](https://github.com/SteveJRobertson/isolate-ui/actions/workflows/ci.yml)
[![Release](https://github.com/SteveJRobertson/isolate-ui/actions/workflows/release.yml/badge.svg)](https://github.com/SteveJRobertson/isolate-ui/actions/workflows/release.yml)

A modern React component library with an AI-orchestrated development pipeline. Six specialised LangGraph.js agents collaborate across product ownership, architecture, implementation, accessibility, QA, and documentation — with a consensus loop, live design token validation, and automated GitHub reporting — ensuring every component meets production standards before a line of implementation code is written.

Built on an Nx monorepo with TypeScript, Vitest, Storybook, and fully automated NPM releases.

---

## 🤖 AI-Orchestrated Development Pipeline

The most distinctive aspect of Isolate UI is its agentic development workflow. The `@isolate-ui/ai-orchestrator` package, built with **LangGraph.js**, coordinates six specialised AI personas through a structured Definition of Ready process before any component implementation begins.

### Agent Personas

| Persona              | Role                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `@isolate-po`        | Selects Ark UI primitives, maps design tokens, and produces the initial component specification                       |
| `@isolate-architect` | Enforces Nx project boundary rules and validates permitted shared utility imports before greenlighting implementation |
| `@isolate-dev`       | Implements TypeScript/React components with Panda CSS, following "The Blueprint" component pattern                    |
| `@isolate-a11y`      | Audits WAI-ARIA compliance and keyboard navigation, validates WCAG 2.1 Level AA conformance                           |
| `@isolate-qa`        | Validates Vitest test coverage (minimum 80%), error state recovery, and edge case handling                            |
| `@isolate-docs`      | Generates Storybook CSF stories and README artifacts documenting all prop interfaces and variants                     |

### The Consensus Loop

The Product Owner, Architect, Developer, and QA personas participate in a **Definition of Ready consensus loop** before implementation begins:

```
GitHub Issue
     │
     ▼
@isolate-po  ──────────────────────────────────────────────►  Spec
     │                                                          │
     ▼                                                          ▼
@isolate-architect  ──────────────────────────────────────►  Approval
     │                                                          │
     ▼                                                          ▼
@isolate-dev  ────────────────────────────────────────────►  Implementation
     │                                                          │
     ▼                                                          ▼
@isolate-a11y + @isolate-qa  ──►  APPROVED / REJECTED: reason  │
     │                                    │                     │
     │              ◄─────────────────────┘                     │
     │         (loop resets to @isolate-po, max 5 iterations)   │
     │                                                          ▼
     └──────────────────────────────────────────────────►  @isolate-docs
                                                               │
                                                               ▼
                                              GitHub comment: Technical Spec Table
                                              + Edge Case List + Persona Sign-offs
```

Each persona ends its response with `APPROVED` or `REJECTED: <reason>`. A rejection resets the loop to `@isolate-po` and increments a counter. After **5 consecutive rejections**, the orchestrator throws a `RefinementIterationLimitError` and pauses for human review — a deliberate guardrail that keeps the pipeline from spinning indefinitely on a genuinely ambiguous requirement.

On success, the orchestrator posts a structured comment back to the triggering GitHub issue containing a **Technical Spec Table**, **Edge Case List**, and **Persona Sign-offs**.

### Live Design Token Validation

Before any agent finalises a specification, design token references are validated in real time via `checkTokenExists()` — a utility exported from `@isolate-ui/utils/ai` that checks dot-notation token paths against the live `@isolate-ui/tokens` registry:

```ts
import { checkTokenExists } from '@isolate-ui/utils/ai';

const result = checkTokenExists('color.primary.500');
// { exists: true, value: '#3b82f6', path: 'color.primary.500' }
```

This prevents invalid token references from ever reaching implementation, catching design system drift at the specification stage rather than in review.

For the full API reference, see [libs/ai-orchestrator/README.md](./libs/ai-orchestrator/README.md).

---

## Quick Start

```bash
# Install dependencies
pnpm install

# Run tests
pnpm vitest

# Run Storybook (component documentation)
nx storybook react-button

# Build Storybook
nx build-storybook react-button

# Run all tests via Nx
nx run-many -t test -- --run

# Type check
nx run-many -t typecheck

# Lint
nx run-many -t lint
```

---

## 📦 Published Packages

Components are published to NPM under the `@isolate-ui` scope:

- [`@isolate-ui/button`](https://www.npmjs.com/package/@isolate-ui/button) — React Button component

Install in your project:

```bash
pnpm add @isolate-ui/button
```

---

## 📚 Documentation

Component documentation is available via Storybook:

- **Local**: Run `nx storybook react-button` to view components locally
- **Preview Deployments**: Every PR includes a Vercel preview deployment with Storybook
- **Agent Notes**: See [AGENTS.md](./AGENTS.md) for the full agentic workflow reference

---

## Project Structure

```
libs/
├── ai-orchestrator/         # LangGraph.js multi-agent pipeline
│   └── README.md            # Full orchestrator API reference
├── react/
│   └── button/              # React Button component
│       ├── src/
│       ├── vite.config.mts
│       ├── AGENTS.md        # Component-specific agent notes
│       └── package.json
└── utils/                   # Shared utility functions
    ├── src/
    │   └── lib/
    │       └── ai/          # checkTokenExists() and agent helpers
    ├── vitest.config.mts
    ├── AGENTS.md            # Library-specific agent notes
    └── package.json
```

---

## Technology Stack

| Category                | Technology                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------- |
| **Monorepo**            | [Nx](https://nx.dev) 22.5.4                                                           |
| **Package Manager**     | [pnpm](https://pnpm.io) 10.30.3                                                       |
| **Agent Orchestration** | [LangGraph.js](https://langchain-ai.github.io/langgraphjs/)                           |
| **UI Framework**        | React 19                                                                              |
| **Language**            | TypeScript 5.9                                                                        |
| **Build Tool**          | [Vite](https://vitejs.dev) 7.x                                                        |
| **Testing**             | [Vitest](https://vitest.dev) 3.2.4                                                    |
| **Browser Testing**     | [Playwright](https://playwright.dev) 1.58.2                                           |
| **Accessibility**       | [@axe-core/playwright](https://github.com/dequelabs/axe-core-npm) 4.11.1              |
| **Documentation**       | [Storybook](https://storybook.js.org) 8.6.18                                          |
| **Styling**             | [Panda CSS](https://panda-css.com)                                                    |
| **Releases**            | [Nx Release](https://nx.dev/features/manage-releases) with version plans              |
| **Commit Linting**      | [Commitlint](https://commitlint.js.org/) + [Husky](https://typicode.github.io/husky/) |
| **Deployment**          | [Vercel](https://vercel.com) (Storybook previews)                                     |
| **Registry**            | [NPM](https://www.npmjs.com) with provenance attestations                             |

---

## Using Components

### Installation

```bash
pnpm add @isolate-ui/button
```

### Usage

```tsx
import { Button } from '@isolate-ui/button';

function App() {
  return <Button onClick={() => console.log('clicked')}>Click me</Button>;
}
```

---

## Contributing

### Commit Convention

This project enforces [Conventional Commits](https://www.conventionalcommits.org/) via [commitlint](https://commitlint.js.org/) and [Husky](https://typicode.github.io/husky/):

```bash
# Valid commit formats:
feat(react-button): add new variant
fix(utils): resolve edge case
docs: update README
chore: update dependencies
chore(release): publish react-button v1.0.0 [skip ci]
chore(deps): update dependencies
```

**Allowed scopes**: Nx project names (`react-button`, `utils`, `tokens`) are auto-discovered, plus `release`, `deps`, and `commitlint` for cross-cutting concerns. Scope is optional for global changes.

Commits are validated locally via Husky and in CI for all PR commits and PR titles.

### Creating a Release

This project uses [Nx Release](https://nx.dev/features/manage-releases) with version plans for independent package versioning:

```bash
# Create a version plan for your changes
pnpm nx release plan [major|minor|patch]

# Example: plan a patch release
pnpm nx release plan patch
```

This creates a YAML file in `.nx/version-plans/`. Commit it with your PR. When merged to `main`, the release workflow automatically bumps versions, generates changelogs, publishes to NPM with provenance, creates Git tags, and pushes the release commit.

---

## Development

### Prerequisites

- Node.js 21.7.3 or compatible
- pnpm 10.30.3+

### Setup

```bash
git clone <repo-url>
cd isolate-ui
pnpm install
```

### Working with Components

```bash
# Run tests
nx test react-button

# Run tests in watch mode
nx test react-button --watch

# Run Storybook
nx storybook react-button

# Build Storybook
nx build-storybook react-button

# Type check
nx typecheck react-button

# Build
nx build react-button
```

See [libs/react/button/AGENTS.md](./libs/react/button/AGENTS.md) for detailed component documentation.

### Creating New Libraries

```bash
# React component library
nx generate @nx/react:lib <name> \
  --directory=libs/react/<name> \
  --unitTestRunner=vitest

# TypeScript utility library
nx generate @nx/js:library <name> \
  --directory=libs/<name> \
  --unitTestRunner=vitest \
  --bundler=tsc \
  --linter=eslint
```

### Running Tests

```bash
# All tests (watch mode)
pnpm vitest

# All tests (single run)
pnpm vitest run

# Specific project via Nx
nx test react-button
nx test utils

# All projects with caching
nx run-many -t test -- --run

# Only affected projects
nx affected -t test
```

---

## Accessibility

Components are tested for WCAG 2.1 Level AA compliance using `@axe-core/playwright`. The `@isolate-a11y` agent persona validates accessibility as part of the Definition of Ready pipeline, and component tests run in real browsers (Chromium + WebKit) via Playwright CT.

```bash
# Run accessibility component tests
pnpm nx run react-button:component-test
```

See [A11Y_TESTING.md](./A11Y_TESTING.md) for the full accessibility testing guide.

---

## CI/CD

### Continuous Integration

Every pull request runs:

- ✅ **Commit validation** — enforces conventional commits format
- ✅ **PR title validation** — PR titles must follow conventional commits
- ✅ **Linting** — ESLint checks on affected projects
- ✅ **Type checking** — TypeScript validation
- ✅ **Testing** — Vitest tests on affected projects
- ✅ **Storybook preview** — Vercel deploys a preview with component docs

### Continuous Deployment

The release workflow runs automatically when PRs are merged to `main`:

1. Detects version plans in `.nx/version-plans/`
2. Builds packages before versioning
3. Bumps versions based on version plans
4. Generates changelogs for each package
5. Publishes to NPM with provenance attestations
6. Creates Git tags (e.g. `button@1.0.0`)
7. Pushes release commit back to `main` with `[skip ci]`

**Authentication**: GitHub App token for bypassing branch protection, NPM granular access token (90-day rotation), and OIDC for provenance attestations.

### Nx Remote Cache

Distributed caching is configured with Vercel Remote Cache. Cacheable operations: `build`, `build-storybook`, `test`, `lint`, `typecheck`.

---

## Project Configuration

### Key Files

| File                                                               | Purpose                                          |
| ------------------------------------------------------------------ | ------------------------------------------------ |
| [AGENTS.md](./AGENTS.md)                                           | Agentic workflow reference and troubleshooting   |
| [libs/ai-orchestrator/README.md](./libs/ai-orchestrator/README.md) | Full orchestrator API reference                  |
| [nx.json](./nx.json)                                               | Nx workspace configuration with release settings |
| [tsconfig.base.json](./tsconfig.base.json)                         | TypeScript base configuration and path mappings  |
| [vitest.workspace.ts](./vitest.workspace.ts)                       | Vitest workspace configuration                   |
| [commitlint.config.ts](./commitlint.config.ts)                     | Commit message linting rules                     |
| [vercel.json](./vercel.json)                                       | Vercel deployment configuration                  |
| [.github/workflows/ci.yml](./.github/workflows/ci.yml)             | CI verification workflow                         |
| [.github/workflows/release.yml](./.github/workflows/release.yml)   | Automated release workflow                       |

### Path Mappings

Libraries can be imported using path aliases configured in `tsconfig.base.json`:

```ts
import { Button } from '@isolate-ui/button';
import { checkTokenExists } from '@isolate-ui/utils/ai'; // Agent helpers (internal)
```

Note: `@isolate-ui/utils` is marked `private` and not published to NPM — internal use only.

---

## Troubleshooting

```bash
# Clear Nx cache
nx reset

# Reinstall dependencies
rm -rf node_modules pnpm-lock.yaml
pnpm install

# View project dependency graph
nx graph

# Check all inferred targets for a project
nx show project <project-name>
```

---

## Resources

- [Nx Documentation](https://nx.dev)
- [Nx Release Documentation](https://nx.dev/features/manage-releases)
- [LangGraph.js Documentation](https://langchain-ai.github.io/langgraphjs/)
- [Vitest Documentation](https://vitest.dev)
- [Storybook Documentation](https://storybook.js.org)
- [Panda CSS Documentation](https://panda-css.com)
- [React Documentation](https://react.dev)
- [pnpm Documentation](https://pnpm.io)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [NPM Provenance](https://docs.npmjs.com/generating-provenance-statements)
- [WCAG 2.1 AA Reference](https://www.w3.org/WAI/WCAG21/quickref/?currentsLevel=aa)

---

## License

MIT
