# Agent Notes - Shared Tokens Library

## Overview

This library implements the Style Dictionary v4 token pipeline for the Isolate UI design system. It serves as the Single Source of Truth for all design tokens.

## Architecture

### File Structure

```
libs/shared/tokens/
├── src/
│   ├── tokens.json          # DTCG format token definitions
│   ├── index.ts             # Main exports
│   └── example.ts           # Usage examples
├── gen/                     # Generated files (gitignored)
│   ├── css/
│   │   └── variables.css    # CSS custom properties
│   └── ts/
│       └── tokens.ts        # TypeScript definitions
├── config.mjs               # Style Dictionary configuration
├── build.mjs                # Build script
├── project.json             # Nx project configuration
└── .gitignore               # Excludes gen/ directory
```

### Build Process

1. **Source**: Design tokens defined in `src/tokens.json` using DTCG format
2. **Transform**: Style Dictionary v4 processes tokens through custom transformers
3. **Output**:
   - CSS variables with `--isolate-` prefix
   - TypeScript definitions with `as const` for type safety
4. **Caching**: Nx automatically caches the `gen/` directory outputs

### Nx Targets

- **build-tokens**: Generates CSS and TypeScript files from tokens
  - Executor: `nx:run-commands`
  - Command: `node libs/shared/tokens/build.mjs`
  - Outputs: `{projectRoot}/gen`
  - Cached: Yes
- **build**: Compiles the library for distribution
  - Depends on: `build-tokens`
  - Includes generated files in the output

## Token Categories

### Colors

- **Primary**: 9 shades (50-900) for brand colors
- **Neutral**: 11 shades (0-1000) for grays

### Spacing

- 4px-based scale from 0 to 32
- Values in rem units

### Typography

- **Font Families**: Sans, Serif, Mono
- **Font Sizes**: xs through 6xl
- **Font Weights**: 100-900
- **Line Heights**: Unitless multipliers

## Development Workflow

### Adding New Tokens

1. Edit `src/tokens.json` following DTCG format:

   ```json
   {
     "token-name": {
       "$value": "value",
       "$type": "type",
       "$description": "optional description"
     }
   }
   ```

2. Run token generation:

   ```bash
   pnpm nx build-tokens tokens
   ```

3. Verify outputs in `gen/css/` and `gen/ts/`

### Testing Token Changes

The `src/example.ts` file demonstrates TypeScript autocomplete and type safety. Add new examples when introducing new token categories.

### Style Dictionary Configuration

The `config.mjs` file defines:

- **Platforms**: CSS and TypeScript outputs
- **Transform Groups**: Built-in DTCG transformers
- **Custom Formatters**: TypeScript formatter with `as const`
- **Prefix**: `isolate` for CSS variables

### TypeScript Configuration

Key settings in tsconfig files:

- `resolveJsonModule: true` - Allows importing tokens.json
- `esModuleInterop: true` - For Style Dictionary imports
- Include patterns cover both `src/` and `gen/` directories

## Dependencies

- **style-dictionary**: ^4.4.0 (ESM async API)
- No additional transformers needed - uses built-in DTCG support

## Integration Points

This library is designed to integrate with:

1. **Panda CSS**: Import tokens for theme generation
2. **Component Libraries**: Import TypeScript tokens directly
3. **CSS Frameworks**: Import CSS variables file
4. **Documentation**: Reference tokens in Storybook

## Known Considerations

- The `gen/` directory is gitignored but must be generated before building
- Nx automatically handles the build order via `dependsOn`
- CSS variables use kebab-case naming (e.g., `--isolate-color-primary-500`)
- TypeScript tokens use string keys for numeric names (e.g., `tokens.color.primary['500']`)

## Linting Configuration

### Dependency Checks

The `@nx/dependency-checks` ESLint rule validates that imported packages are properly declared in `package.json`. For this library:

- **Build scripts** (`build.mjs`, `config.mjs`) import `style-dictionary`
- These are **build-time only** dependencies, not needed by library consumers
- The dependency is in `devDependencies` of the library's `package.json`

**Configuration**: The `eslint.config.mjs` explicitly ignores build scripts from dependency checks:

```javascript
{
  ignoredFiles: [
    '{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}',
    '{projectRoot}/build.mjs',
    '{projectRoot}/config.mjs',
  ],
}
```

**Why**: These build scripts are executed by Nx targets but their dependencies aren't needed by consumers who only import the generated tokens. Ignoring them prevents false positives in the linter while maintaining proper dependency declarations.

**Troubleshooting**: If you see lint errors about missing dependencies:

1. Check if the import is in source code (should be in `dependencies`) or build scripts (should be ignored)
2. Add build/config files to `ignoredFiles` in `eslint.config.mjs`
3. Ensure the dependency is in `devDependencies` of the library's `package.json`

## Future Enhancements

Potential additions:

- Additional token types (shadows, borders, radii)
- Platform-specific outputs (iOS, Android)
- Semantic token layers (theme-specific overrides)
- Token validation and linting

---

_Last updated: March 9, 2026_
