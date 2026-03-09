# Panda CSS Integration

This document describes the Panda CSS integration for the Isolate UI component library.

## Overview

Panda CSS is integrated as a zero-runtime styling engine that uses the design tokens from Style Dictionary. The integration provides type-safe styling with automatic mapping to CSS variables.

## Architecture

```
libs/shared/tokens/     → Style Dictionary tokens (source of truth)
  ├── src/tokens.json   → Token definitions
  └── gen/
      ├── ts/tokens.ts  → TypeScript tokens
      └── css/variables.css → CSS variables (--isolate-*)

panda.config.ts         → Panda CSS configuration
styled-system/          → Generated Panda CSS styling engine (shared)
```

## Configuration

### Token Mapping

The `panda.config.ts` automatically transforms Style Dictionary tokens into Panda CSS theme tokens:

- **Colors**: `colors.primary.500` → `var(--isolate-color-primary-500)`
- **Spacing**: `spacing.4` → `var(--isolate-spacing-4)`
- **Typography**:
  - `fonts.sans` → `var(--isolate-typography-font-family-sans)`
  - `fontSizes.base` → `var(--isolate-typography-font-size-base)`
  - `fontWeights.semibold` → `var(--isolate-typography-font-weight-semibold)`
  - `lineHeights.normal` → `var(--isolate-typography-line-height-normal)`

### Strict Mode

The configuration enables `strictPropertyValues: true` and `strictTokens: true` to encourage token usage for design-critical properties (colors, spacing, fonts).

**Type Safety**: Panda CSS provides TypeScript autocomplete and type-checking for token values:

```tsx
// ✅ Valid - using tokens
css({ color: 'primary.500', padding: '4' });

// ✅ Valid - using escape hatch for edge cases
css({ color: '[#ff0000]' });

// ❌ TypeScript will suggest valid tokens
// (arbitrary values require bracket notation)
```

## Usage

### 1. Import the CSS Function

```tsx
import { css } from 'styled-system/css';
```

### 2. Use Tokens in Components

```tsx
export function Button({ children }: ButtonProps) {
  return (
    <button
      className={css({
        backgroundColor: 'primary.500',
        color: 'neutral.0',
        padding: '4',
        borderRadius: '2',
        fontWeight: 'semibold',
        fontSize: 'base',
      })}
    >
      {children}
    </button>
  );
}
```

### 3. Import CSS Variables in Your App

The CSS variables need to be imported in your application's entry point:

```tsx
// src/main.tsx or src/index.tsx
import '@isolate-ui/tokens/gen/css/variables.css';
```

## Code Generation

### Manual Generation

```bash
# Generate styled-system for all libraries
pnpm exec panda codegen

# Generate via Nx for a specific library
pnpm nx codegen react-button
```

### Automatic Generation

The `styled-system` is automatically regenerated when:

1. **Post-install**: Running `pnpm install` triggers `prepare` script
2. **Via Nx cache**: The `codegen` target is configured with outputs in `project.json`

## Working with New Components

### 1. Add Codegen Target

Add the `codegen` target to your library's `project.json`:

```json
{
  "targets": {
    "codegen": {
      "executor": "nx:run-commands",
      "options": {
        "command": "pnpm exec panda codegen",
        "cwd": "{workspaceRoot}"
      },
      "outputs": ["{workspaceRoot}/styled-system"]
    }
  }
}
```

### 2. Configure ESLint

Allow `styled-system` imports in your library's `eslint.config.mjs`:

```javascript
export default [
  ...baseConfig,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          allow: ['^styled-system/'],
        },
      ],
    },
  },
];
```

## Generated APIs

The `styled-system` directory provides:

- **`styled-system/css`**: Core styling function
- **`styled-system/tokens`**: Token utilities and types
- **`styled-system/patterns`**: Layout patterns
- **`styled-system/jsx`**: Styled JSX elements (React)

## TypeScript Support

TypeScript types are automatically generated and provide:

- Autocomplete for token values
- Type-safe color, spacing, and typography tokens
- Proper inference for responsive values and conditions

## Best Practices

1. **Use semantic tokens**: Prefer `primary.500` over arbitrary colors
2. **Escape hatch when needed**: Use `[value]` syntax for one-off values
3. **Leverage patterns**: Use Panda's layout patterns for common layouts
4. **Responsive design**: Use Panda's responsive syntax for breakpoints

## Additional Resources

- [Panda CSS Documentation](https://panda-css.com)
- [Style Dictionary Documentation](https://amzn.github.io/style-dictionary)
- [Isolate UI Tokens](./libs/shared/tokens/README.md)
