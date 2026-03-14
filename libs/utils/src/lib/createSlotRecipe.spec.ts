import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSlotRecipe } from './createSlotRecipe';

// Mock styled-system/css
vi.mock('styled-system/css', () => ({
  sva: vi.fn((config) => ({
    __type: 'SlotRecipe',
    config,
    // Mock return structure similar to actual sva
    slots: config.slots || [],
    className: config.className || '',
  })),
}));

import { sva } from 'styled-system/css';

describe('createSlotRecipe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should forward config to sva', () => {
    const config = {
      className: 'button',
      slots: ['root', 'label'],
      base: {
        root: { backgroundColor: 'blue.500' },
        label: { color: 'white' },
      },
    };

    createSlotRecipe(config);

    expect(sva).toHaveBeenCalledWith(config);
    expect(sva).toHaveBeenCalledTimes(1);
  });

  it('should return the result from sva', () => {
    const config = {
      className: 'card',
      slots: ['root', 'header', 'body', 'footer'],
      base: {
        root: { padding: '4' },
        header: { fontWeight: 'bold' },
        body: { fontSize: 'md' },
        footer: { color: 'gray.500' },
      },
    };

    const result = createSlotRecipe(config);

    expect(result).toEqual({
      __type: 'SlotRecipe',
      config,
      slots: ['root', 'header', 'body', 'footer'],
      className: 'card',
    });
  });

  it('should handle config with variants', () => {
    const config = {
      className: 'button',
      slots: ['root', 'icon'],
      base: {
        root: { display: 'flex' },
        icon: { marginRight: '2' },
      },
      variants: {
        size: {
          sm: {
            root: { padding: '2' },
            icon: { fontSize: 'sm' },
          },
          lg: {
            root: { padding: '4' },
            icon: { fontSize: 'lg' },
          },
        },
        variant: {
          solid: {
            root: { backgroundColor: 'blue.500' },
          },
          outline: {
            root: { borderWidth: '1px', borderColor: 'blue.500' },
          },
        },
      },
    };

    createSlotRecipe(config);

    expect(sva).toHaveBeenCalledWith(config);
  });

  it('should handle config with default variants', () => {
    const config = {
      className: 'input',
      slots: ['root', 'label', 'helperText'],
      base: {
        root: { display: 'flex', flexDirection: 'column' },
        label: { fontWeight: 'medium' },
        helperText: { fontSize: 'sm' },
      },
      variants: {
        size: {
          sm: { root: { gap: '1' } },
          md: { root: { gap: '2' } },
        },
      },
      defaultVariants: {
        size: 'md',
      },
    };

    createSlotRecipe(config);

    expect(sva).toHaveBeenCalledWith(config);
  });

  it('should handle config with compound variants', () => {
    const config = {
      className: 'button',
      slots: ['root'],
      base: {
        root: { display: 'inline-flex' },
      },
      variants: {
        variant: {
          solid: { root: { backgroundColor: 'blue.500' } },
          outline: { root: { borderWidth: '1px' } },
        },
        size: {
          sm: { root: { padding: '2' } },
          lg: { root: { padding: '4' } },
        },
      },
      compoundVariants: [
        {
          variant: 'solid',
          size: 'lg',
          css: {
            root: { fontWeight: 'bold' },
          },
        },
      ],
    };

    createSlotRecipe(config);

    expect(sva).toHaveBeenCalledWith(config);
  });

  it('should handle minimal config', () => {
    const config = {
      className: 'simple',
      slots: ['root'],
    };

    createSlotRecipe(config);

    expect(sva).toHaveBeenCalledWith(config);
  });

  it('should be callable as a function', () => {
    expect(typeof createSlotRecipe).toBe('function');
  });

  it('should maintain sva function signature', () => {
    // Test that createSlotRecipe accepts the same parameters as sva
    const config = {
      className: 'test',
      slots: ['root'],
      base: { root: { color: 'red' } },
    };

    const directSvaResult = sva(config);
    const createSlotRecipeResult = createSlotRecipe(config);

    // Both should have been called with the same config
    expect(sva).toHaveBeenCalledWith(config);

    // Results should be the same structure
    expect(createSlotRecipeResult).toEqual(directSvaResult);
  });

  it('should handle empty slots array', () => {
    const config = {
      className: 'empty-slots',
      slots: [],
      base: {},
    };

    const result = createSlotRecipe(config);

    expect(sva).toHaveBeenCalledWith(config);
    expect(result.slots).toEqual([]);
  });

  it('should pass through all config properties unchanged', () => {
    const config = {
      className: 'comprehensive',
      slots: ['root', 'child1', 'child2'],
      base: {
        root: { position: 'relative' },
        child1: { position: 'absolute', top: '0' },
        child2: { position: 'absolute', bottom: '0' },
      },
      variants: {
        orientation: {
          horizontal: { root: { flexDirection: 'row' } },
          vertical: { root: { flexDirection: 'column' } },
        },
      },
      defaultVariants: {
        orientation: 'horizontal',
      },
    };

    createSlotRecipe(config);

    // Verify exact config was passed
    expect(sva).toHaveBeenCalledWith(
      expect.objectContaining({
        className: 'comprehensive',
        slots: expect.arrayContaining(['root', 'child1', 'child2']),
        base: expect.any(Object),
        variants: expect.any(Object),
        defaultVariants: expect.any(Object),
      }),
    );
  });
});
