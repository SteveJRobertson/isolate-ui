import { sva } from 'styled-system/css';

/**
 * Creates a standardized Panda CSS slot recipe for Isolate UI multi-part components.
 *
 * This is the recommended way to define slot recipes across the design system,
 * wrapping Panda's `sva` (Slot Visual API) to enforce consistent patterns:
 *
 * - All slots are typed via the `slots` array.
 * - `base` styles should reference semantic tokens (e.g. `color: 'primary.500'`).
 * - Include `_hover`, `_active` modifiers on interactive slots.
 * - Include a `_dark` modifier stub referencing future semantic tokens (Issue #6).
 *
 * @example
 * ```ts
 * import { createSlotRecipe } from '@isolate-ui/utils';
 *
 * export const myRecipe = createSlotRecipe({
 *   className: 'my-component',
 *   slots: ['root', 'label'],
 *   base: {
 *     root: { backgroundColor: 'primary.500', _hover: { backgroundColor: 'primary.600' } },
 *     label: { color: 'neutral.0' },
 *   },
 * });
 * ```
 */
export const createSlotRecipe: typeof sva = (config) => sva(config);
