import { sva } from 'styled-system/css';

/**
 * Creates a standardized Panda CSS slot recipe for Isolate UI multi-part components.
 *
 * This is the recommended way to define slot recipes across the design system,
 * wrapping Panda's `sva` (Slot Visual API) to provide a consistent entry point.
 *
 * The following are recommended conventions when using this helper:
 * - Prefer typing all slots via the `slots` array.
 * - Prefer having `base` styles reference semantic tokens (e.g. `color: 'primary.500'`).
 * - For interactive slots, prefer including `_hover`, `_active` modifiers.
 * - Optionally include a `_dark` modifier stub referencing future semantic tokens (Issue #6).
 *
 * Note: This helper is a thin alias around `sva` and does not add additional runtime validation.
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
