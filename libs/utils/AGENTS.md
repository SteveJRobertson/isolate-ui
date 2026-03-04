# Agent Notes - Utils Library

## Overview

A utility library for shared functions across the Isolate UI component library. This is a Node.js/TypeScript library with no browser dependencies.

## Project Structure

```
libs/utils/
├── src/
│   ├── index.ts           # Public API exports
│   └── lib/
│       ├── utils.ts       # Utility functions
│       └── utils.spec.ts  # Unit tests
├── vitest.config.mts      # Vitest configuration
├── tsconfig.json          # TypeScript config
├── tsconfig.lib.json      # Build config
├── tsconfig.spec.json     # Test config
└── package.json
```

## Development

### Running Tests

```bash
# Run tests for this library
nx test utils

# Run tests in watch mode
nx test utils --watch

# Run tests with coverage
nx test utils --coverage

# Or use vitest directly
cd libs/utils
pnpm vitest
```

### Building

```bash
# Build the library
nx build utils

# Build with dependencies
nx build utils --with-deps
```

### Type Checking

```bash
# Type check this library
nx typecheck utils
```

### Linting

```bash
# Lint the library
nx lint utils

# Lint with auto-fix
nx lint utils --fix
```

## Configuration

### Vitest Configuration

[vitest.config.mts](vitest.config.mts) is configured with:
- **Environment**: `node` (not browser/jsdom)
- **Globals**: `true` - no need to import `describe`, `it`, `expect`
- **Test pattern**: `{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}`
- **Coverage**: Reports to `../../coverage/libs/utils`

### TypeScript Configuration

The library uses TypeScript with:
- **Strict mode**: Enabled for type safety
- **Path mappings**: Import as `@isolate-ui/utils`
- **Target**: ES2015
- **Module**: ESNext

## Adding New Utilities

1. **Create the utility function** in `src/lib/`:
   ```typescript
   // src/lib/my-util.ts
   export function myUtil(input: string): string {
     return input.toUpperCase();
   }
   ```

2. **Write tests**:
   ```typescript
   // src/lib/my-util.spec.ts
   import { myUtil } from './my-util';

   describe('myUtil', () => {
     it('should convert to uppercase', () => {
       expect(myUtil('hello')).toBe('HELLO');
     });
   });
   ```

3. **Export from index.ts**:
   ```typescript
   // src/index.ts
   export * from './lib/my-util';
   ```

4. **Run tests**:
   ```bash
   nx test utils
   ```

## Usage in Other Libraries

Import from other libraries using the path alias:

```typescript
import { utils } from '@isolate-ui/utils';
```

## Testing Guidelines

- ✅ **Unit tests**: Test individual functions in isolation
- ✅ **Pure functions**: Prefer pure functions for easier testing
- ✅ **Edge cases**: Test boundary conditions and error cases
- ✅ **Type safety**: Tests should catch type errors
- ❌ **No browser APIs**: This is a Node.js library - no DOM, window, etc.

## CI/CD

Tests are automatically run:
- On every commit (via Nx affected)
- In pull requests
- Before releases

Cached results are shared across the team via Nx Cloud (if configured).

## Troubleshooting

### Tests not found
Make sure test files match the pattern: `*.spec.ts` or `*.test.ts`

### Import errors
Check that the function is exported from `src/index.ts`

### Type errors
Run `nx typecheck utils` to see all type errors

## Related Documentation

- [Root AGENTS.md](../../AGENTS.md) - Overall project setup
- [Vitest Documentation](https://vitest.dev)
- [Nx Documentation](https://nx.dev)

---

_Last updated: March 4, 2026_
