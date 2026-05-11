---
mode: agent
description: >-
  Create a new React component in the Isolate UI library. Use when: scaffolding
  a new component, adding a new UI primitive, creating a new react library.
---

Create a new React component library in the Isolate UI monorepo.

## Component name

$component_name

## Steps

### 1. Generate the Nx library

```bash
nx generate @nx/react:lib $component_name \
  --directory=libs/react/$component_name \
  --unitTestRunner=vitest \
  --bundler=vite \
  --linter=eslint \
  --importPath=@isolate-ui/$component_name
```

If the generator fails with a vitest ESM error, run with `--unitTestRunner=none` first, then add vitest separately:

```bash
nx g @nx/vitest:configuration --project=react-$component_name --uiFramework=react
```

### 2. Component implementation

Follow the Button component pattern in `libs/react/button/src/lib/`:

- Use `ark` from `@ark-ui/react` for the root element to get polymorphism and ARIA support
- Define a slot recipe in `$component_name.recipe.ts` using `sva()` from `styled-system/css`
- Use design tokens from `@isolate-ui/tokens` — validate any token reference with `checkTokenExists()` from `@isolate-ui/utils/ai` before using it
- Export `$ComponentNameProps` type that extends the appropriate HTML element attributes interface
- Spread `...restProps` onto the underlying element
- Default `type="button"` where applicable

**Imports:**

```typescript
import { ark } from '@ark-ui/react';
import { cx } from 'styled-system/css';
import { sva } from 'styled-system/css';
// Never use relative paths across project boundaries
// ✅ import { checkTokenExists } from '@isolate-ui/utils/ai';
// ❌ import { checkTokenExists } from '../../utils/src/lib/ai';
```

### 3. Tests (Vitest unit)

Create `$component_name.spec.tsx` alongside the component file with:

- Happy path: renders successfully, renders children, applies className
- Error/edge paths: at least one test for each exported async function's rejection case
- Do **not** make real network calls; mock external dependencies

Run: `nx test react-$component_name`

### 4. Accessibility tests (Playwright CT)

Follow [A11Y_TESTING.md](../../A11Y_TESTING.md):

- Create `$component_name.ct.tsx` using `@playwright/experimental-ct-react`
- Test all variants and states (default, disabled, loading, etc.)
- Use `expectToHaveNoA11yViolations` from `@isolate-ui/utils/a11y`
- Fix any color contrast violations before committing — do not disable axe rules

Run: `pnpm nx run react-$component_name:component-test`

### 5. Update snapshots if needed

After fixing a11y issues that change CSS classes:

```bash
pnpm nx test react-$component_name -- -u
```

### 6. Quality gate

```bash
nx run-many -t test lint typecheck --projects=react-$component_name
```

Fix all errors. When green, run `#pre-pr-review` before reporting completion.
