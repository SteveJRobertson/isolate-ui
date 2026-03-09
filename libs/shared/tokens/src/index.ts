/**
 * Isolate UI Design Tokens
 *
 * This library provides the Single Source of Truth for all design tokens
 * in the Isolate UI design system.
 *
 * @packageDocumentation
 */

// Export generated TypeScript tokens
export { tokens, type Tokens } from '../gen/ts/tokens';

// Re-export the source tokens JSON for advanced use cases
export { default as sourceTokens } from './tokens.json';
