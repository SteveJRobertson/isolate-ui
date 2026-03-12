import { createSlotRecipe } from '@isolate-ui/utils';

/**
 * Slot recipe for the multi-part Button component.
 *
 * Slots:
 * - `root`    — The main button container (Ark UI primitive)
 * - `label`   — The visible text content
 * - `icon`    — Leading / trailing icon wrapper
 * - `spinner` — Loading state indicator
 *
 * All values reference design tokens to stay in sync with the Style Dictionary
 * source of truth. The `_dark` modifier is a stub for semantic tokens that will
 * be populated in Issue #6 (e.g. `brand.primary.dark`).
 */
export const buttonRecipe = createSlotRecipe({
  className: 'button',
  slots: ['root', 'label', 'icon', 'spinner'],
  base: {
    root: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '2',
      backgroundColor: 'primary.500',
      color: 'neutral.0',
      padding: '4',
      borderRadius: '2',
      fontWeight: 'semibold',
      fontSize: 'base',
      cursor: 'pointer',
      _hover: {
        backgroundColor: 'primary.600',
      },
      _active: {
        backgroundColor: 'primary.700',
      },
      _disabled: {
        opacity: '[0.5]',
        cursor: 'not-allowed',
        pointerEvents: 'none',
      },
      // Stub: dark-mode overrides — will consume `brand.primary.dark` semantic
      // tokens once they are defined in Issue #6.
      _dark: {
        backgroundColor: 'primary.700',
        color: 'neutral.0',
        _hover: {
          backgroundColor: 'primary.800',
        },
        _active: {
          backgroundColor: 'primary.900',
        },
      },
    },
    label: {
      lineHeight: 'normal',
    },
    icon: {
      display: 'inline-flex',
      alignItems: 'center',
      flexShrink: '[0]',
    },
    spinner: {
      display: 'inline-flex',
      alignItems: 'center',
      flexShrink: '[0]',
    },
  },
});

export type ButtonRecipeVariants = NonNullable<
  Parameters<typeof buttonRecipe>[0]
>;
