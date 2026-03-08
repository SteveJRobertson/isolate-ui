# Isolate UI

[![CI](https://github.com/SteveJRobertson/isolate-ui/actions/workflows/ci.yml/badge.svg)](https://github.com/SteveJRobertson/isolate-ui/actions/workflows/ci.yml)
[![Release](https://github.com/SteveJRobertson/isolate-ui/actions/workflows/release.yml/badge.svg)](https://github.com/SteveJRobertson/isolate-ui/actions/workflows/release.yml)

A modern React component library built with TypeScript, tested with Vitest, documented with Storybook, and managed with Nx. Features automated releases with independent versioning and enforced conventional commits.

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

## 📦 Published Packages

Components are published to NPM under the `@isolate-ui` scope:

- [`@isolate-ui/button`](https://www.npmjs.com/package/@isolate-ui/button) - React Button component

Install in your project:

```bash
pnpm add @isolate-ui/button
```

## 📚 Documentation

Component documentation is available via Storybook:

- **Local**: Run `nx storybook react-button` to view components locally
- **Preview Deployments**: Every PR includes a Vercel preview deployment with Storybook

## Contributing

### Commit Convention

This project enforces [Conventional Commits](https://www.conventionalcommits.org/) via [commitlint](https://commitlint.js.org/) and [Husky](https://typicode.github.io/husky/):

```bash
# Valid commit formats:
feat(react-button): add new variant
fix(utils): resolve edge case
docs: update README
chore: update dependencies

# Scope is optional for global changes:
ci: update workflow
docs: update contributing guide
```

**Allowed scopes**: `react-button`, `utils`, `source`

Commits are validated:

- Locally via Git hook (Husky)
- In CI for all PR commits and PR titles

### Creating a Release

This project uses [Nx Release](https://nx.dev/features/manage-releases) with version plans for independent package versioning:

```bash
# Create a version plan for your changes
pnpm nx release plan [major|minor|patch]

# Example: Plan a patch release
pnpm nx release plan patch
```

This creates a YAML file in `.nx/version-plans/` describing the release. Commit this file with your PR.

**When your PR is merged to `main`:**

1. ✅ The release workflow automatically runs
2. ✅ Versions are bumped based on version plans
3. ✅ Changelogs are generated
4. ✅ Packages are built and published to NPM
5. ✅ Git tags are created (e.g., `button@1.0.0`)
6. ✅ Release commit is pushed back to `main`

## Project Structure

```
libs/
├── react/
│   └── button/          # React Button component
│       ├── src/
│       ├── vite.config.mts
│       ├── AGENTS.md    # Component-specific docs
│       └── package.json
└── utils/               # Shared utility functions
    ├── src/
    ├── vitest.config.mts
    ├── AGENTS.md        # Library-specific docs
    └── package.json
```

## Technology Stack

- **Monorepo**: [Nx](https://nx.dev) 22.5.4
- **Package Manager**: [pnpm](https://pnpm.io) 10.30.3
- **Testing**: [Vitest](https://vitest.dev) 3.2.4
- **Documentation**: [Storybook](https://storybook.js.org) 8.6.18
- **UI Framework**: React 19
- **Build Tool**: [Vite](https://vitejs.dev) 7.x
- **Language**: TypeScript 5.9
- **Releases**: [Nx Release](https://nx.dev/features/manage-releases) with version plans
- **Commit Linting**: [Commitlint](https://commitlint.js.org/) + [Husky](https://typicode.github.io/husky/)
- **Deployment**: [Vercel](https://vercel.com) (Storybook previews)
- **Registry**: [NPM](https://www.npmjs.com) with provenance

## Development

### Prerequisites

- Node.js 21.7.3 or compatible
- pnpm 10.30.3+

### Setup

```bash
# Clone the repository
git clone <repo-url>
cd isolate-ui

# Install dependencies
pnpm install
```

### Working with Components

#### Button Component

```bash
# Run tests
nx test react-button

# Run tests in watch mode
nx test react-button --watch

# Run Storybook (interactive component documentation)
nx storybook react-button

# Build Storybook (static site)
nx build-storybook react-button

# Type check
nx typecheck react-button

# Build
nx build react-button
```

See [libs/react/button/AGENTS.md](libs/react/button/AGENTS.md) for detailed documentation.

#### Utils Library

```bash
# Run tests
nx test utils

# Type check
nx typecheck utils

# Build
nx build utils
```

See [libs/utils/AGENTS.md](libs/utils/AGENTS.md) for detailed documentation.

### Creating New Libraries

#### React Component Library

```bash
nx generate @nx/react:lib <name> \
  --directory=libs/react/<name> \
  --unitTestRunner=vitest
```

#### TypeScript Utility Library

```bash
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

### Building

```bash
# Build all libraries
nx run-many -t build

# Build specific library
nx build react-button

# Build with dependencies
nx build react-button --with-deps

# Build only affected
nx affected -t build
```

### Type Checking

```bash
# Type check all projects
nx run-many -t typecheck

# Type check specific project
nx typecheck react-button

# Watch mode
nx typecheck react-button --watch
```

### Linting

```bash
# Lint all projects
nx run-many -t lint

# Lint specific project
nx lint react-button

# Auto-fix
nx lint react-button --fix
```

### Storybook

Storybook provides interactive component documentation:

```bash
# Run Storybook dev server
nx storybook react-button

# Build static Storybook site
nx build-storybook react-button

# Build Storybook for all components
nx run-many -t build-storybook
```

**Features:**

- Interactive component playground
- Accessibility testing (a11y addon)
- Interaction testing
- Multiple device viewports
- Dark mode support

**Vercel Previews:**
Every PR automatically deploys Storybook to Vercel for team review.

## Using Components

### Installation

```bash
# In your project
pnpm add @isolate-ui/button
```

### Usage

```tsx
import { Button } from '@isolate-ui/button';

function App() {
  return <Button onClick={() => console.log('clicked')}>Click me</Button>;
}
```

### Component Documentation

All components are documented with Storybook:

- **During development**: Run `nx storybook react-button` for interactive docs
- **In pull requests**: Every PR gets a Vercel preview deployment with Storybook
- **Production**: Coming soon - deployed Storybook site

## Testing

The project uses Vitest with different environments:

- **React components**: `jsdom` environment for DOM APIs
- **Utility libraries**: `node` environment

Tests use globals (`describe`, `it`, `expect`) - no imports needed.

```typescript
describe('MyComponent', () => {
  it('should work', () => {
    expect(true).toBe(true);
  });
});
```

## CI/CD

### Continuous Integration

Every pull request runs automated checks:

- ✅ **Commit validation** - Enforces conventional commits format
- ✅ **PR title validation** - PR titles must follow conventional commits
- ✅ **Linting** - ESLint checks on affected projects
- ✅ **Type checking** - TypeScript validation
- ✅ **Testing** - Vitest tests on affected projects
- ✅ **Storybook preview** - Vercel deploys a preview with component docs

### Continuous Deployment

The release workflow runs automatically when PRs are merged to `main`:

1. **Detects version plans** in `.nx/version-plans/`
2. **Builds packages** before versioning
3. **Bumps versions** based on version plans
4. **Generates changelogs** for each package
5. **Publishes to NPM** with provenance attestations
6. **Creates Git tags** (e.g., `button@1.0.0`)
7. **Pushes release commit** back to `main` with `[skip ci]`

**Authentication:**

- GitHub App token for bypassing branch protection
- NPM granular access token (90-day rotation required)
- OIDC for npm provenance attestations

### Nx Cloud

Distributed caching is configured with Vercel Remote Cache:

- Build outputs are cached across CI runs
- Cacheable operations: `build`, `build-storybook`, `test`, `lint`, `typecheck`

### CI Commands

```bash
# Test only changed code
nx affected -t test --base=origin/main

# Build only changed code
nx affected -t build --base=origin/main

# Run all checks
nx run-many -t lint typecheck test build

# Build Storybook for all components
nx run-many -t build-storybook
```

## Project Configuration

### Key Files

- **[AGENTS.md](AGENTS.md)** - Detailed project setup and troubleshooting
- **[nx.json](nx.json)** - Nx workspace configuration with release settings
- **[tsconfig.base.json](tsconfig.base.json)** - TypeScript base configuration
- **[vitest.workspace.ts](vitest.workspace.ts)** - Vitest workspace configuration
- **[commitlint.config.ts](commitlint.config.ts)** - Commit message linting rules
- **[vercel.json](vercel.json)** - Vercel deployment configuration
- **[.npmrc](.npmrc)** - pnpm configuration
- **[.github/workflows/ci.yml](.github/workflows/ci.yml)** - CI verification workflow
- **[.github/workflows/release.yml](.github/workflows/release.yml)** - Automated release workflow
- **[.storybook/](.storybook/)** - Storybook configuration

### Path Mappings

Libraries can be imported using path aliases:

```typescript
import { Button } from '@isolate-ui/button';
import { utils } from '@isolate-ui/utils'; // Internal use only (not published)
```

Configured in [tsconfig.base.json](tsconfig.base.json).

**Note:** The `@isolate-ui/utils` package is marked as `private` and is not published to NPM. It's only used internally within the monorepo.

## Troubleshooting

### Clear Nx Cache

```bash
nx reset
```

### Reinstall Dependencies

```bash
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### View Project Graph

```bash
nx graph
```

## Documentation

- **[AGENTS.md](AGENTS.md)** - Comprehensive project documentation
- **[libs/react/button/AGENTS.md](libs/react/button/AGENTS.md)** - Button component docs
- **[libs/utils/AGENTS.md](libs/utils/AGENTS.md)** - Utils library docs

## Resources

- [Nx Documentation](https://nx.dev)
- [Nx Release Documentation](https://nx.dev/features/manage-releases)
- [Vitest Documentation](https://vitest.dev)
- [Storybook Documentation](https://storybook.js.org)
- [React Documentation](https://react.dev)
- [pnpm Documentation](https://pnpm.io)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Commitlint Documentation](https://commitlint.js.org/)
- [NPM Provenance](https://docs.npmjs.com/generating-provenance-statements)

## License

MIT
