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

| Type       | Description                                 |
| ---------- | ------------------------------------------- |
| `feat`     | New feature                                 |
| `fix`      | Bug fix                                     |
| `docs`     | Documentation changes                       |
| `style`    | Code style changes (formatting, etc.)       |
| `refactor` | Code refactoring                            |
| `perf`     | Performance improvements                    |
| `test`     | Adding or updating tests                    |
| `build`    | Build system changes                        |
| `ci`       | CI/CD changes                               |
| `chore`    | Other changes (dependencies, configs, etc.) |
| `revert`   | Revert a previous commit                    |

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

## Accessibility Testing with Playwright

### Overview

The project includes automated accessibility testing using **@axe-core/playwright** to ensure WCAG 2.1 Level AA compliance.

**Key Files:**

- [A11Y_TESTING.md](A11Y_TESTING.md) - Complete accessibility testing guide
- [libs/utils/src/lib/a11y.ts](libs/utils/src/lib/a11y.ts) - Helper utilities
- Component tests: e.g., [libs/react/button/src/lib/button.ct.tsx](libs/react/button/src/lib/button.ct.tsx)

### Running Component Tests

Component tests use Playwright CT and run in real browsers (Chromium + WebKit):

```bash
# Run component tests for a specific project
pnpm nx run react-button:component-test

# Playwright commands also work directly
pnpm exec playwright test -c libs/react/button/playwright-ct.config.ts
```

### Critical Learnings for Agents

#### 1. A11y Test Failures are Real Issues (Not Test Bugs)

**What Will Happen**: When you add accessibility tests to components, they may fail immediately with color contrast violations or other issues.

**DO NOT assume the tests are broken.** The tests are working correctly - they've found real accessibility problems.

**Example from this project:**

- Button outline/ghost variants failed with `color-contrast` violations
- Original: `primary.500` (#3b82f6) on white = 3.4:1 contrast ❌
- Fixed: `primary.700` (#1d4ed8) on white = ~7:1 contrast ✅

**When tests fail:**

1. Read the violation message carefully - it explains what's wrong
2. Check the impact level (Critical, Serious, Moderate, Minor)
3. Fix the component, don't disable the test
4. Document why if you must disable a specific rule

#### 2. Snapshot Tests Break After Style Changes

**What Will Happen**: After fixing accessibility issues that change CSS (like color values), Vitest snapshot tests will fail.

**This is expected.** Snapshots capture exact CSS classes, and changing colors changes the generated utility classes.

**How to fix:**

```bash
# Update snapshots after making validated style changes
pnpm nx test <project-name> -- -u

# Example
pnpm nx test react-button -- -u
```

**Always commit snapshot updates together with the style changes** in the same commit, explaining what changed and why.

#### 3. Test All Component States

**Why**: A component may be accessible in one state but fail in others.

**Always test:**

- All variants (solid, outline, ghost, etc.)
- Disabled state
- Loading state
- Interactive states if applicable
- Both light and dark themes

**Example pattern:**

```typescript
test('default state passes a11y', async ({ mount }) => {
  const component = await mount(<Button>Default</Button>);
  await expectToHaveNoA11yViolations(component);
});

test('outline variant passes a11y', async ({ mount }) => {
  const component = await mount(<Button variant="outline">Outline</Button>);
  await expectToHaveNoA11yViolations(component);
});

test('disabled state passes a11y', async ({ mount }) => {
  const component = await mount(<Button disabled>Disabled</Button>);
  await expectToHaveNoA11yViolations(component);
});
```

#### 4. Playwright Cache Files and ESLint

**What Will Happen**: ESLint will try to lint Playwright's generated cache files and fail with hundreds of errors.

**Solution**: Always add generated directories to ESLint ignore patterns:

```javascript
// In eslint.config.mjs
{
  ignores: ['**/playwright/.cache/**'],
}
```

**Pattern**: Generated/build output should always be ignored by linting tools.

#### 5. Peer Dependencies for Testing Utilities

**When creating utilities that wrap test libraries** (like the a11y helpers in `@isolate-ui/utils/a11y`), declare the testing libraries as peer dependencies:

```json
{
  "peerDependencies": {
    "@axe-core/playwright": "^4.0.0",
    "@playwright/test": "^1.0.0"
  }
}
```

**Why**: Prevents version conflicts and makes requirements explicit.

**Important**: Use a separate entry point (e.g., `@isolate-ui/utils/a11y`) to avoid pulling test dependencies into production builds. Configure package exports:

```json
{
  "exports": {
    ".": "./src/index.js",
    "./a11y": "./src/lib/a11y.js"
  }
}
```

#### 6. AxeBuilder API Limitations

**Important**: `AxeBuilder.include()` only accepts CSS selector strings, NOT Playwright Locator objects.

```typescript
// ✅ Correct - CSS selector string
builder.include('#main-content');

// ❌ Wrong - Locator object (will fail at runtime)
const locator = page.locator('button');
builder.include(locator); // Type error / runtime failure
```

**Our implementation** accepts Locator objects for API convenience but scans the full page context. This is correct because accessibility validation requires document-level context (form labels, heading hierarchy, landmarks, etc.).

#### 7. CI Workflow Considerations

**Version Plan Checks**: The `check-version-plan` job should only run for release PRs, not feature PRs.

```yaml
# Conditional check - only runs when PR is labeled 'release'
if: contains(github.event.pull_request.labels.*.name, 'release')
```

**Why**: Feature development shouldn't be blocked by version plan requirements. Version plans are only needed when actually releasing.

### Quick Reference: Common Tasks

```bash
# Run accessibility tests
pnpm nx run react-button:component-test

# Update snapshots after style changes
pnpm nx test react-button -- -u

# Check types (catches import issues)
pnpm nx typecheck utils
pnpm nx typecheck react-button

# Lint (includes dependency checks)
pnpm nx lint react-button

# Run all quality checks
pnpm nx affected -t lint test typecheck --base=origin/main
```

### When Implementing New Components

1. **Add component tests first** - behavior and rendering
2. **Add accessibility tests** - for all states and variants
3. **Expect failures** - a11y tests will likely find issues
4. **Fix the issues** - don't disable tests
5. **Update snapshots** - after validated changes
6. **Commit together** - code + snapshots + explanation

### Resources for Agents

- Full guide: [A11Y_TESTING.md](A11Y_TESTING.md)
- WCAG 2.1 AA requirements: https://www.w3.org/WAI/WCAG21/quickref/?currentsLevel=aa
- axe-core rule explanations: https://www.deque.com/axe/devtools/

## Additional Resources

- [Nx Documentation](https://nx.dev)
- [Vitest Documentation](https://vitest.dev)
- [pnpm Documentation](https://pnpm.io)
- [Nx Vitest Plugin](https://nx.dev/docs/technologies/test-tools/vitest/introduction)

## Version Information

- **Nx**: 22.5.4
- **pnpm**: 10.30.3
- **Vitest**: 3.2.4
- **Playwright**: 1.58.2
- **@axe-core/playwright**: 4.11.1
- **Node.js**: 22.x

---

_Last updated: March 13, 2026_

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->
