# Isolate UI

[![CI](https://github.com/SteveJRobertson/isolate-ui/actions/workflows/ci.yml/badge.svg)](https://github.com/SteveJRobertson/isolate-ui/actions/workflows/ci.yml)

A modern React component library built with TypeScript, tested with Vitest, and managed with Nx.

## Quick Start

```bash
# Install dependencies
pnpm install

# Run tests
pnpm vitest

# Run all tests via Nx
nx run-many -t test -- --run

# Type check
nx run-many -t typecheck

# Lint
nx run-many -t lint
```

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
- **UI Framework**: React 19
- **Build Tool**: [Vite](https://vitejs.dev) 7.x
- **Language**: TypeScript 5.9

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
nx test button

# Run tests in watch mode
nx test button --watch

# Type check
nx typecheck button

# Build
nx build button
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
nx test button
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
nx build button

# Build with dependencies
nx build button --with-deps

# Build only affected
nx affected -t build
```

### Type Checking

```bash
# Type check all projects
nx run-many -t typecheck

# Type check specific project
nx typecheck button

# Watch mode
nx typecheck button --watch
```

### Linting

```bash
# Lint all projects
nx run-many -t lint

# Lint specific project
nx lint button

# Auto-fix
nx lint button --fix
```

## Using Components

### Installation

```bash
# In your project
pnpm add @isolate-ui/button @isolate-ui/utils
```

### Usage

```tsx
import { Button } from '@isolate-ui/button';
import { utils } from '@isolate-ui/utils';

function App() {
  return <Button onClick={() => console.log(utils())}>Click me</Button>;
}
```

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

### Nx Cloud (Optional)

Connect to Nx Cloud for distributed caching and task execution:

```bash
nx connect
```

### CI Commands

```bash
# Test only changed code
nx affected -t test --base=origin/main

# Build only changed code
nx affected -t build --base=origin/main

# Run all checks
nx run-many -t lint typecheck test build
```

## Project Configuration

### Key Files

- **[AGENTS.md](AGENTS.md)** - Detailed project setup and troubleshooting
- **[nx.json](nx.json)** - Nx workspace configuration
- **[tsconfig.base.json](tsconfig.base.json)** - TypeScript base configuration
- **[vitest.workspace.ts](vitest.workspace.ts)** - Vitest workspace configuration
- **[.npmrc](.npmrc)** - pnpm configuration

### Path Mappings

Libraries can be imported using path aliases:

```typescript
import { Button } from '@isolate-ui/button';
import { utils } from '@isolate-ui/utils';
```

Configured in [tsconfig.base.json](tsconfig.base.json).

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
- [Vitest Documentation](https://vitest.dev)
- [React Documentation](https://react.dev)
- [pnpm Documentation](https://pnpm.io)

## License

MIT
