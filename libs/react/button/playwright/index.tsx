/**
 * Playwright CT entry file.
 *
 * Imported by every component test run before mounting.  The two CSS
 * imports use path aliases defined in playwright-ct.config.ts so that
 * files outside the library directory can be resolved without changing
 * Vite's root (which breaks Playwright CT's iframe communication).
 *
 * Import order matters:
 *   1. Style Dictionary CSS variables (–isolate-*) must be defined first.
 *   2. Panda CSS styles (which reference those variables) are loaded second.
 *
 * – `@isolate-ui/tokens-css` → `libs/shared/tokens/gen/css/variables.css`
 * – `@isolate-ui/panda-css`  → `styled-system/styles.css`
 */
// 1. Design-token CSS custom properties (Style Dictionary output)
//    Resolved via the `@isolate-ui/tokens-css` alias in playwright-ct.config.ts
import '@isolate-ui/tokens-css';
// 2. Panda CSS utility classes, component recipes, and the layer order
//    Resolved via the `@isolate-ui/panda-css` alias in playwright-ct.config.ts
import '@isolate-ui/panda-css';
