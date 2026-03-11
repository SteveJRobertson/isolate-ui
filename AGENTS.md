# Agent Notes - Isolate UI Project

## Project Overview

This is an Nx monorepo for the Isolate UI component library, using pnpm as the package manager and vitest for testing.

## Package Manager: pnpm

This project uses **pnpm** instead of npm for faster, more efficient dependency management.

### Migration from npm to pnpm

The project was migrated from npm to pnpm with the following configuration:

**Key Files:**

- [.npmrc](.npmrc) - Contains `shamefully-hoist=true` for Nx compatibility
- [package.json](package.json) - Includes `"packageManager": "pnpm@10.30.3"`

### Common pnpm Commands

```bash
# Install dependencies
pnpm install

# Add a package
pnpm add <package>
pnpm add -D <package>  # dev dependency

# Run scripts
pnpm <script-name>
pnpm vitest
pnpm nx <command>
```

## Testing with Vitest

### Configuration

The project uses **Vitest v3.2.4** (downgraded from v4 for Nx compatibility) with a workspace pattern:

**Key Files:**

- [vitest.workspace.ts](vitest.workspace.ts) - Discovers all vitest/vite configs via glob patterns
- Individual project configs:
  - [libs/react/button/vite.config.mts](libs/react/button/vite.config.mts)
  - [libs/utils/vitest.config.mts](libs/utils/vitest.config.mts)

### Running Tests

```bash
# Run all tests once
pnpm vitest run

# Run tests in watch mode
pnpm vitest

# Run tests for a specific project via Nx
nx test react-button
nx test utils

# Run all tests via Nx (with caching)
nx run-many -t test -- --run

# Run only affected tests
nx affected -t test
```

### Test Configuration Notes

- **React components** (like button): Use `environment: 'jsdom'` for DOM APIs
- **Node libraries** (like utils): Use `environment: 'node'` (default)
- **Globals enabled**: `describe`, `it`, `expect` are globally available (no imports needed)

## Nx Monorepo Structure

```
libs/
├── react/
│   └── button/          # React button component
│       ├── src/
│       ├── vite.config.mts
│       └── package.json
└── utils/               # Utility library
    ├── src/
    ├── vitest.config.mts
    └── package.json
```

### Nx Configuration

**[nx.json](nx.json)** includes:

- `@nx/eslint/plugin` - For linting
- `@nx/vite/plugin` - For Vite builds
- `@nx/vitest` - For test task inference (note: **not** `@nx/vitest/plugin`)

### Generating New Libraries

```bash
# With unit tests (vitest)
nx generate @nx/js:library <name> --directory=libs/<name> --unitTestRunner=vitest --bundler=tsc --linter=eslint

# React library with tests
nx generate @nx/react:lib <name> --directory=libs/react/<name> --unitTestRunner=vitest

# Without tests (add manually later)
nx generate @nx/js:library <name> --directory=libs/<name> --unitTestRunner=none --bundler=tsc --linter=eslint
```

### Adding Vitest to an Existing Project

```bash
# For React components
nx g @nx/vitest:configuration --project=<project-name> --uiFramework=react

# For Node/TypeScript libraries
nx g @nx/vitest:configuration --project=<project-name> --uiFramework=none
```

This will:

- Create `vitest.config.mts` in the project
- Create `tsconfig.spec.json`
- Update project tsconfig files
- Automatically be discovered by [vitest.workspace.ts](vitest.workspace.ts)

## Known Issues & Solutions

### Issue: `@nx/vitest` plugin errors during generation

**Error:**

```
require() of ES Module .../vitest/dist/node.js ... not supported
```

**Cause:** `@nx/vitest@22.5.4` has ESM compatibility issues with both vitest v3 and v4 when using pnpm's strict dependency resolution.

**Solutions:**

1. ✅ **Current approach**: Generate libraries without vitest initially, then add it manually:

   ```bash
   nx g @nx/js:library mylib --unitTestRunner=none
   nx g @nx/vitest:configuration --project=mylib
   ```

2. ⚠️ **Alternative**: Upgrade Nx (may require vitest v4):
   ```bash
   pnpm add -D nx@latest @nx/vite@latest @nx/vitest@latest @nx/js@latest @nx/react@latest
   ```

### Issue: Tests run twice or globals not available

**Cause:** Having both a root `vitest.config.mts` and project-specific configs can cause conflicts in workspace mode.

**Solution:**

- ✅ Use [vitest.workspace.ts](vitest.workspace.ts) with project-specific configs only
- ❌ Avoid having a root `vitest.config.mts` when using workspace pattern

## CI/CD Considerations

### Nx Caching

Nx automatically caches test results. In CI:

```bash
# Only test affected projects
nx affected -t test --base=origin/main

# Run all tests
nx run-many -t test -- --run
```

### Environment Variables

For Nx Cloud (optional):

```bash
# Connect to Nx Cloud for distributed caching
nx connect
```

## TypeScript Configuration

**[tsconfig.base.json](tsconfig.base.json)** contains path mappings:

```json
{
  "paths": {
    "@isolate-ui/button": ["libs/react/button/src/index.ts"],
    "@isolate-ui/utils": ["libs/utils/src/index.ts"]
  }
}
```

Projects can import from each other using these aliases:

```typescript
import { Button } from '@isolate-ui/button';
import { utils } from '@isolate-ui/utils';
```

## Development Workflow

### Initial Setup

```bash
# Install dependencies
pnpm install

# Verify everything works
nx run-many -t test -- --run
nx run-many -t typecheck
nx run-many -t lint
```

### Daily Development

```bash
# Run tests in watch mode
pnpm vitest

# Run tests for specific project
nx test react-button --watch

# Type check
nx typecheck react-button

# Build
nx build react-button

# Run all tasks for affected projects
nx affected -t test lint typecheck build
```

## Commit Message Guidelines

This project enforces [Conventional Commits](https://www.conventionalcommits.org/) via commitlint. Commit messages are validated locally (Husky pre-commit hook) and in GitHub Actions (PR commit validation + PR title validation).

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Valid Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation changes |
| `style` | Code style changes (formatting, etc.) |
| `refactor` | Code refactoring |
| `perf` | Performance improvements |
| `test` | Adding or updating tests |
| `build` | Build system changes |
| `ci` | CI/CD changes |
| `chore` | Other changes (dependencies, configs, etc.) |
| `revert` | Revert a previous commit |

### Valid Scopes

Scopes are **automatically discovered** from the Nx workspace and will grow as new projects are added.

**Current project scopes:**
- `react-button` - React button component
- `utils` - Utility library
- `tokens` - Design tokens library
- `source` - Root workspace project

**Special scopes (always valid):**
- `release` - For release commits
- `deps` - For dependency updates
- `commitlint` - For commitlint config changes
- `ci` - For CI configuration changes (e.g. `fix(ci): ...`)

**Finding valid scopes:**

```bash
# List all Nx projects (these are valid scopes)
nx show projects
```

**Scope is optional** for cross-cutting changes:

```bash
ci: update workflow
docs: update README
chore: update dependencies
```

### Examples

```bash
# ✅ Valid — project-specific changes with scope
feat(react-button): add disabled state
fix(utils): handle null values in helper
test(tokens): add validation tests
docs(react-button): update usage examples

# ✅ Valid — repository-wide changes without scope
ci: add commit validation
docs: update contributing guide
chore: update dependencies
chore(deps): bump vitest to 3.2.4
chore(release): publish react-button v1.0.0 [skip ci]
```

### Common Mistakes to Avoid

```bash
# ❌ Missing type prefix
Add new feature
Update button component

# ❌ Capitalized type
Feat: add new feature
Fix: resolve bug

# ❌ Invalid scope (must be an Nx project name or special scope)
feat(button): add variant       # should be feat(react-button)
feat(react): add button         # should be feat(react-button)

# ❌ Too generic (auto-ignored by commitlint but not useful)
Update file.ts
Initial plan
```

## Troubleshooting

### Clear Nx Cache

If you encounter unexpected behavior:

```bash
nx reset
```

### Reinstall Dependencies

If pnpm packages are corrupted:

```bash
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### Check Nx Plugin Status

```bash
nx show project <project-name>
```

This shows all inferred and configured targets for a project.

### Dependency Check Lint Errors

If you see ESLint errors about missing dependencies (from `@nx/dependency-checks`):

```
error  The "project-name" project uses the following packages, but they are missing from "dependencies":
  - some-package
```

**Solution options:**

1. **For source code imports**: Add the package to `dependencies` in the library's `package.json`

2. **For build scripts** (e.g., `build.mjs`, `config.mjs`):
   - Add the package to `devDependencies` in the library's `package.json`
   - Add the build script to `ignoredFiles` in the library's `eslint.config.mjs`:
     ```javascript
     {
       '@nx/dependency-checks': [
         'error',
         {
           ignoredFiles: [
             '{projectRoot}/build.mjs',
             '{projectRoot}/config.mjs',
           ],
         },
       ],
     }
     ```

**Why**: Build scripts are executed during the build process but their dependencies aren't needed by library consumers. Ignoring them prevents false positives.

**Example**: See `libs/shared/tokens/eslint.config.mjs` for a working example.

## Additional Resources

- [Nx Documentation](https://nx.dev)
- [Vitest Documentation](https://vitest.dev)
- [pnpm Documentation](https://pnpm.io)
- [Nx Vitest Plugin](https://nx.dev/docs/technologies/test-tools/vitest/introduction)

## Version Information

- **Nx**: 22.5.4
- **pnpm**: 10.30.3
- **Vitest**: 3.2.4
- **Node.js**: 22.x

---

_Last updated: March 8, 2026_
