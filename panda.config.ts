import { defineConfig } from '@pandacss/dev';
import { tokens as styleTokens } from './libs/shared/tokens/gen/ts/tokens';

/**
 * Recursively transforms Style Dictionary tokens into Panda CSS token format.
 * Maps each token value to its corresponding CSS variable.
 *
 * @example
 * // Input: { primary: { 500: "#3b82f6" } }
 * // Output: { primary: { 500: { value: "var(--isolate-color-primary-500)" } } }
 */
function transformTokens(
  obj: Record<string, any>,
  prefix: string = 'isolate',
): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    const tokenPath = `${prefix}-${key}`;

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Recursively transform nested objects
      result[key] = transformTokens(value, tokenPath);
    } else {
      // Leaf node: create token reference to CSS variable
      result[key] = {
        value: `var(--${tokenPath.replace(/\./g, '-')})`,
      };
    }
  }

  return result;
}

export default defineConfig({
  // Enable strict property values to enforce token usage on design-critical properties
  strictPropertyValues: true,

  // Restrict token enforcement to design system properties
  // Allows standard CSS for layout-only properties (flex, grid, position, etc.)
  strictTokens: true,

  // Scan all library components for Panda CSS usage
  include: ['./libs/**/*.{ts,tsx}'],

  // Exclude generated code, dependencies, and build artifacts
  exclude: [
    './styled-system/**',
    './node_modules/**',
    '**/dist/**',
    '**/build/**',
  ],

  // Output directory for generated style engine (shared across all libraries)
  outdir: 'styled-system',

  theme: {
    extend: {
      tokens: {
        colors: transformTokens(styleTokens.color, 'isolate-color'),
        spacing: transformTokens(styleTokens.spacing, 'isolate-spacing'),
        fonts: transformTokens(
          styleTokens.typography.fontFamily,
          'isolate-typography-font-family',
        ),
        fontSizes: transformTokens(
          styleTokens.typography.fontSize,
          'isolate-typography-font-size',
        ),
        fontWeights: transformTokens(
          styleTokens.typography.fontWeight,
          'isolate-typography-font-weight',
        ),
        lineHeights: transformTokens(
          styleTokens.typography.lineHeight,
          'isolate-typography-line-height',
        ),
      },
    },
  },

  // Configure JSX framework (React)
  jsxFramework: 'react',

  // Note: CSS variables from Style Dictionary should be imported in your app's entry point
  // import '@isolate-ui/tokens/gen/css/variables.css';
});
