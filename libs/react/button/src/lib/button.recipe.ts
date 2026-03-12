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
 * Variants:
 * - `solid`   — Filled background (default). Full primary colour, inverted text.
 * - `outline` — Transparent fill with a visible primary-colour border and text.
 * - `ghost`   — No visible background or border; uses a transparent border (from
 *               base styles) to preserve sizing across variants. Text-only
 *               appearance with hover/active fills.
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
      padding: '4',
      borderRadius: '2',
      fontWeight: 'semibold',
      fontSize: 'base',
      cursor: 'pointer',
      borderWidth: '[1px]',
      borderStyle: 'solid',
      borderColor: 'transparent',
      _disabled: {
        opacity: '[0.5]',
        cursor: 'not-allowed',
        pointerEvents: 'none',
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
  variants: {
    variant: {
      solid: {
        root: {
          backgroundColor: 'primary.500',
          color: 'neutral.0',
          _hover: {
            backgroundColor: 'primary.600',
          },
          _active: {
            backgroundColor: 'primary.700',
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
      },
      outline: {
        root: {
          backgroundColor: 'transparent',
          color: 'primary.500',
          borderColor: 'primary.500',
          _hover: {
            backgroundColor: 'primary.50',
          },
          _active: {
            backgroundColor: 'primary.100',
          },
          _dark: {
            color: 'primary.300',
            borderColor: 'primary.300',
            _hover: {
              backgroundColor: 'primary.900',
            },
            _active: {
              backgroundColor: 'primary.800',
            },
          },
        },
      },
      ghost: {
        root: {
          backgroundColor: 'transparent',
          color: 'primary.500',
          _hover: {
            backgroundColor: 'primary.50',
          },
          _active: {
            backgroundColor: 'primary.100',
          },
          _dark: {
            color: 'primary.300',
            _hover: {
              backgroundColor: 'primary.900',
            },
            _active: {
              backgroundColor: 'primary.800',
            },
          },
        },
      },
    },
  },
  defaultVariants: {
    variant: 'solid',
  },
});

export type ButtonRecipeVariants = NonNullable<
  Parameters<typeof buttonRecipe>[0]
>;
