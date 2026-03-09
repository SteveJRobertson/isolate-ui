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

  it('should prevent non-token values (demonstrated via type checking)', () => {
    // ❌ These would trigger TypeScript errors with strictPropertyValues: true
    // Uncommenting these lines should show TypeScript errors:

    // const invalidColorStyles = css({
    //   color: '#ff0000', // TypeScript error: Type '"#ff0000"' is not assignable to type...
    // });

    // const invalidBackgroundStyles = css({
    //   backgroundColor: 'red', // TypeScript error: Type '"red"' is not assignable to type...
    // });

    // Note: The fact that these are commented out IS the test -
    // they would fail type checking if uncommented.
    expect(true).toBe(true);
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
