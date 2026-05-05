import { checkTokenExists } from './checkTokenExists';

describe('checkTokenExists', () => {
  // Sample token data for testing
  const mockTokens = {
    color: {
      primary: {
        50: { $value: '#eff6ff', $type: 'color' },
        500: { $value: '#3b82f6', $type: 'color' },
        900: { $value: '#1e3a8a', $type: 'color' },
      },
      neutral: {
        0: { $value: '#ffffff', $type: 'color' },
        500: { $value: '#6b7280', $type: 'color' },
        1000: { $value: '#000000', $type: 'color' },
      },
    },
    spacing: {
      0: { $value: '0px', $type: 'dimension' },
      2: { $value: '0.5rem', $type: 'dimension' },
      3: { $value: '0.75rem', $type: 'dimension' },
      4: { $value: '1rem', $type: 'dimension' },
      6: { $value: '1.5rem', $type: 'dimension' },
    },
    typography: {
      body: {
        fontSize: { $value: '1rem', $type: 'dimension' },
        lineHeight: { $value: '1.5', $type: 'dimension' },
      },
    },
  };

  describe('valid token paths', () => {
    it('should find color.primary.500', () => {
      const result = checkTokenExists('color.primary.500', mockTokens);
      expect(result.exists).toBe(true);
      expect(result.value).toBe('#3b82f6');
      expect(result.type).toBe('color');
    });

    it('should find color.neutral.0', () => {
      const result = checkTokenExists('color.neutral.0', mockTokens);
      expect(result.exists).toBe(true);
      expect(result.value).toBe('#ffffff');
    });

    it('should find spacing.3', () => {
      const result = checkTokenExists('spacing.3', mockTokens);
      expect(result.exists).toBe(true);
      expect(result.value).toBe('0.75rem');
      expect(result.type).toBe('dimension');
    });

    it('should find typography.body.fontSize', () => {
      const result = checkTokenExists('typography.body.fontSize', mockTokens);
      expect(result.exists).toBe(true);
      expect(result.value).toBe('1rem');
    });

    it('should return token group for color.primary', () => {
      const result = checkTokenExists('color.primary', mockTokens);
      expect(result.exists).toBe(true);
      expect(result.type).toBe('token-group');
      expect(result.value).toEqual({
        50: { $value: '#eff6ff', $type: 'color' },
        500: { $value: '#3b82f6', $type: 'color' },
        900: { $value: '#1e3a8a', $type: 'color' },
      });
    });
  });

  describe('invalid token paths', () => {
    it('should return false for non-existent color.danger.500', () => {
      const result = checkTokenExists('color.danger.500', mockTokens);
      expect(result.exists).toBe(false);
      expect(result.value).toBeUndefined();
    });

    it('should return false for non-existent spacing.999', () => {
      const result = checkTokenExists('spacing.999', mockTokens);
      expect(result.exists).toBe(false);
    });

    it('should return false for malformed path', () => {
      const result = checkTokenExists('color.primary.missing', mockTokens);
      expect(result.exists).toBe(false);
    });

    it('should return false for deeply nested non-existent path', () => {
      const result = checkTokenExists(
        'color.primary.500.nested.deep',
        mockTokens,
      );
      expect(result.exists).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should return false for empty path', () => {
      const result = checkTokenExists('', mockTokens);
      expect(result.exists).toBe(false);
    });

    it('should return false for null path', () => {
      const result = checkTokenExists(null as unknown as string, mockTokens);
      expect(result.exists).toBe(false);
    });

    it('should return false for undefined path', () => {
      const result = checkTokenExists(
        undefined as unknown as string,
        mockTokens,
      );
      expect(result.exists).toBe(false);
    });

    it('should handle single-level path for nested token group', () => {
      const result = checkTokenExists('color', mockTokens);
      expect(result.exists).toBe(true);
      expect(result.type).toBe('token-group');
    });

    it('should handle single-level path for direct token group', () => {
      const result = checkTokenExists('spacing', mockTokens);
      expect(result.exists).toBe(true);
      expect(result.type).toBe('token-group');
    });

    it('should preserve path in result', () => {
      const result = checkTokenExists('color.primary.500', mockTokens);
      expect(result.path).toBe('color.primary.500');
    });
  });

  describe('with empty token data', () => {
    it('should return false when token data is empty', () => {
      const result = checkTokenExists('color.primary.500', {});
      expect(result.exists).toBe(false);
    });

    it('should return false when token data is null', () => {
      const result = checkTokenExists('color.primary.500', null);
      expect(result.exists).toBe(false);
    });
  });
});
