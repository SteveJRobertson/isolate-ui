# Agent Notes - Button Component

## Overview

A React button component for the Isolate UI library. This is a presentational component built with React 19 and TypeScript.

## Project Structure

```
libs/react/button/
├── src/
│   ├── index.ts                 # Public API exports
│   └── lib/
│       ├── button.tsx           # Button component
│       ├── button.spec.tsx      # Component tests
│       └── button.module.css    # Component styles
├── vite.config.mts              # Vite + Vitest configuration
├── tsconfig.json                # TypeScript config
├── tsconfig.lib.json            # Build config
├── tsconfig.spec.json           # Test config
└── package.json
```

## Development

### Running Tests

```bash
# Run tests for this component
nx test button

# Run tests in watch mode
nx test button --watch

# Run tests with UI
nx test button --ui

# Run tests with coverage
nx test button --coverage
```

### Building

```bash
# Build the component library
nx build button

# Build outputs to: dist/libs/react/button/
```

### Development Server

To test the component in isolation, create a dev app or use Storybook (if configured):

```bash
# Type check while developing
nx typecheck button --watch
```

### Linting

```bash
# Lint the component
nx lint button

# Lint with auto-fix
nx lint button --fix
```

### Publishing

```bash
# Publish to local Verdaccio for testing
nx release publish --registry=http://localhost:4873

# Publish to npm (CI)
nx release publish
```

## Component API

### ButtonProps

```typescript
interface ButtonProps extends HTMLAttributes<HTMLButtonElement> {
  // Extends all standard HTML button attributes
}
```

### Usage

```tsx
import { Button } from '@isolate-ui/button';

function App() {
  return <Button onClick={() => console.log('clicked')}>Click me</Button>;
}
```

## Configuration

### Vite Configuration

[vite.config.mts](vite.config.mts) is configured with:

- **React plugin**: JSX transformation and Fast Refresh
- **TypeScript**: Type declarations generated via `vite-plugin-dts`
- **Build format**: ESM (ES modules)
- **Externals**: React and React DOM are not bundled

### Vitest Configuration

Test configuration in [vite.config.mts](vite.config.mts):

- **Environment**: `jsdom` (simulates browser environment)
- **Globals**: `true` - no need to import `describe`, `it`, `expect`
- **Test pattern**: `{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}`
- **Coverage**: Reports to `../../../coverage/libs/react/button`

### TypeScript Configuration

- **Strict mode**: Enabled for type safety
- **JSX**: React 19 JSX transform
- **Path mappings**: Import as `@isolate-ui/button`
- **React types**: Includes `@types/react` and `@types/react-dom`

## Adding Features

### Modifying the Component

1. **Update the component**:

   ```tsx
   // src/lib/button.tsx
   export interface ButtonProps extends HTMLAttributes<HTMLButtonElement> {
     variant?: 'primary' | 'secondary';
   }

   export function Button({ variant = 'primary', children, ...props }: ButtonProps) {
     return (
       <button className={variant} {...props}>
         {children}
       </button>
     );
   }
   ```

2. **Update tests**:

   ```tsx
   // src/lib/button.spec.tsx
   describe('Button', () => {
     it('should render with primary variant', () => {
       const { getByRole } = render(<Button variant="primary">Click</Button>);
       expect(getByRole('button')).toHaveClass('primary');
     });
   });
   ```

3. **Run tests**:
   ```bash
   nx test button
   ```

### Adding Styles

The component uses CSS modules for styling:

```css
/* src/lib/button.module.css */
.button {
  padding: 8px 16px;
  border-radius: 4px;
}

.primary {
  background: blue;
  color: white;
}
```

```tsx
// src/lib/button.tsx
import styles from './button.module.css';

export function Button({ children, ...props }: ButtonProps) {
  return (
    <button className={styles.button} {...props}>
      {children}
    </button>
  );
}
```

## Testing Guidelines

### Unit Tests

- ✅ **Render tests**: Verify component renders correctly
- ✅ **Prop tests**: Test different prop combinations
- ✅ **Event tests**: Test click handlers and other events
- ✅ **Accessibility**: Test ARIA attributes and keyboard navigation
- ✅ **Snapshot tests**: Optionally use snapshots for complex markup

### Testing Library

Tests use `@testing-library/react`:

```tsx
import { render, fireEvent } from '@testing-library/react';
import Button from './button';

describe('Button', () => {
  it('should call onClick when clicked', () => {
    const handleClick = vi.fn();
    const { getByRole } = render(<Button onClick={handleClick}>Click</Button>);

    fireEvent.click(getByRole('button'));

    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
```

## Dependencies

### Peer Dependencies

The component requires these in consuming applications:

- `react`: ^19.0.0
- `react-dom`: ^19.0.0

### Internal Dependencies

Can depend on other workspace libraries:

```tsx
import { utils } from '@isolate-ui/utils';
```

## Build Output

The build creates:

- **ESM bundle**: `dist/libs/react/button/index.js`
- **Type declarations**: `dist/libs/react/button/index.d.ts`
- **Source maps**: For debugging

## Usage in Applications

```bash
# In a consuming app
pnpm add @isolate-ui/button
```

```tsx
import { Button } from '@isolate-ui/button';

function App() {
  return <Button>Hello World</Button>;
}
```

## CI/CD

Tests and builds are automatically run:

- On every commit (via Nx affected)
- In pull requests
- Before releases

## Troubleshooting

### Tests failing with "document is not defined"

Make sure `environment: 'jsdom'` is set in the test config

### React hooks errors

Ensure React version matches across all packages (use pnpm's peer dependency resolution)

### Import errors

Check that the component is exported from `src/index.ts`

### Type errors

Run `nx typecheck button` to see all type errors

## Related Documentation

- [Root AGENTS.md](../../../AGENTS.md) - Overall project setup
- [React Documentation](https://react.dev)
- [Vitest Documentation](https://vitest.dev)
- [Testing Library](https://testing-library.com/react)
- [Nx React Plugin](https://nx.dev/docs/technologies/react/introduction)

---

_Last updated: March 4, 2026_
