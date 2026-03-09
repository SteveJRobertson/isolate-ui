/**
 * Test file to validate that Panda CSS strict mode correctly enforces token usage.
 *
 * This file demonstrates that:
 * 1. Using semantic tokens (e.g., "primary.500") works correctly
 * 2. Using non-token values (e.g., "#ff0000") triggers TypeScript errors
 */

import { css } from 'styled-system/css';

describe('Panda CSS Token Validation', () => {
  it('should allow token values', () => {
    // ✅ This should work - using semantic tokens
    const validStyles = css({
      color: 'primary.500',
      backgroundColor: 'neutral.0',
      padding: '4',
      fontSize: 'base',
      fontWeight: 'semibold',
    });

    expect(validStyles).toBeDefined();
  });

  it('should enforce strict token usage at compile time', () => {
    // ✅ This test validates that TypeScript enforces token usage
    // The @ts-expect-error directives ensure that non-token values are rejected

    // These variables are intentionally unused - they're here to validate type errors
    /* eslint-disable @typescript-eslint/no-unused-vars */

    // @ts-expect-error - Invalid: raw hex color not allowed without escape hatch
    const _invalidColorStyles = css({ color: '#ff0000' });

    // @ts-expect-error - Invalid: named color not allowed without escape hatch
    const _invalidBackgroundStyles = css({ backgroundColor: 'red' });

    // @ts-expect-error - Invalid: arbitrary value not allowed without escape hatch
    const _invalidFontSize = css({ fontSize: '18px' });

    /* eslint-enable @typescript-eslint/no-unused-vars */

    // ✅ Valid: using escape hatch for arbitrary values
    const validArbitraryStyles = css({
      color: '[#ff0000]',
      backgroundColor: '[red]',
    });

    expect(validArbitraryStyles).toBeDefined();
  });

  it('should allow standard CSS for layout properties', () => {
    // ✅ Layout properties should still accept standard CSS values
    const layoutStyles = css({
      display: 'flex',
      flexDirection: 'column',
      position: 'absolute',
      top: '0',
      left: '0',
    });

    expect(layoutStyles).toBeDefined();
  });
});
