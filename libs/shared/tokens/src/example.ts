/**
 * Example usage of design tokens
 * This file demonstrates TypeScript autocomplete and type safety
 */

import { tokens } from './index';

// Example 1: Accessing color tokens
const exampleColors = {
  primary: tokens.color.primary[500],
  neutral: tokens.color.neutral[500],
  lightBg: tokens.color.neutral[50],
  darkText: tokens.color.neutral[900],
};

// Example 2: Accessing spacing tokens
const exampleSpacing = {
  small: tokens.spacing[2], // 8px
  medium: tokens.spacing[4], // 16px
  large: tokens.spacing[8], // 32px
};

// Example 3: Accessing typography tokens
const exampleTypography = {
  fontFamily: tokens.typography.fontFamily.sans,
  fontSize: tokens.typography.fontSize.base,
  fontWeight: tokens.typography.fontWeight.medium,
  lineHeight: tokens.typography.lineHeight.normal,
};

// Example 4: Building a component style object
const buttonStyles = {
  backgroundColor: tokens.color.primary[500],
  color: tokens.color.neutral[0],
  padding: `${tokens.spacing[3]} ${tokens.spacing[6]}`,
  fontSize: tokens.typography.fontSize.base,
  fontWeight: tokens.typography.fontWeight.semibold,
  borderRadius: tokens.spacing[1],
};

// Export for demonstration purposes
export { exampleColors, exampleSpacing, exampleTypography, buttonStyles };
