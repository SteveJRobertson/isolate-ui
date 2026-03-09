# @isolate-ui/tokens

Design tokens library for the Isolate UI design system. This library serves as the **Single Source of Truth** for all design tokens, providing platform-agnostic values that can be consumed across all UI libraries.

## Features

- 🎨 **DTCG Format**: Tokens defined using the W3C Design Token Community Group format
- 🔄 **Style Dictionary v4**: Automated transformation pipeline with async ESM support
- 🎯 **Type-Safe TypeScript**: Full autocomplete and type safety with `as const` exports
- 📦 **CSS Variables**: Auto-generated with `--isolate-` prefix
- ⚡ **Nx Caching**: Build outputs are cached for fast subsequent builds

## Token Categories

### Colors

- **Primary**: 9 shades (50-900) for primary brand colors
- **Neutral**: 11 shades (0-1000) for grays, blacks, and whites

### Spacing

4px-based spacing scale from 0 to 32 (0px to 128px)

### Typography

- **Font Families**: Sans, Serif, Mono
- **Font Sizes**: xs through 6xl
- **Font Weights**: Thin (100) through Black (900)
- **Line Heights**: None through Loose

## Usage

### TypeScript

```typescript
import { tokens } from '@isolate-ui/tokens';

// Full autocomplete and type safety
const primaryColor = tokens.color.primary[500]; // "#3b82f6"
const baseSpacing = tokens.spacing[4]; // "1rem"
const baseFontSize = tokens.typography.fontSize.base; // "1rem"
```

### CSS Variables

Import the generated CSS file in your application:

```css
@import '@isolate-ui/tokens/gen/css/variables.css';

.my-component {
  color: var(--isolate-color-primary-500);
  padding: var(--isolate-spacing-4);
  font-size: var(--isolate-typography-font-size-base);
}
```

## Development

### Generate Tokens

```bash
# Generate CSS and TypeScript files from token definitions
pnpm nx build-tokens tokens

# Build the entire library (includes token generation)
pnpm nx build tokens
```

### Modify Tokens

1. Edit `src/tokens.json` using the DTCG format
2. Run `pnpm nx build-tokens tokens` to regenerate outputs
3. The generated files in `gen/` are cached by Nx for performance

### Output Structure

```
libs/shared/tokens/
├── src/
│   ├── tokens.json          # Source of truth (DTCG format)
│   └── index.ts             # Main exports
├── gen/                     # Generated files (gitignored)
│   ├── css/
│   │   └── variables.css    # CSS custom properties
│   └── ts/
│       └── tokens.ts        # TypeScript definitions
├── config.mjs               # Style Dictionary config
└── build.mjs                # Build script
```

## Integration

This library is designed to be consumed by:

- **Panda CSS Configuration**: Use tokens for theme generation
- **UI Component Libraries**: Import tokens directly in components
- **Documentation**: Reference tokens in Storybook stories

## Technical Details

- **Style Dictionary Version**: 4.x (Async ESM)
- **Prefix**: All CSS variables use `--isolate-`
- **Format**: DTCG (W3C Design Token Community Group)
- **Build Tool**: Nx with caching enabled
