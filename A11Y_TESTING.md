# Accessibility Testing Guide

This document describes how the Isolate UI project integrates automated accessibility testing to ensure components meet **WCAG 2.1 Level AA** standards.

## Overview

The project uses **@axe-core/playwright** to run automated accessibility audits on React components during component testing (CT). This ensures:

- Components are compliant with WCAG 2.1 Level AA by default
- Accessibility regressions are caught before they reach production
- Developers have clear, actionable feedback on accessibility issues

## Usage

### Basic Accessibility Check

The simplest way to check a component's accessibility is using the `expectToHaveNoA11yViolations` helper from `@isolate-ui/utils`:

```typescript
import { expectToHaveNoA11yViolations } from '@isolate-ui/utils';
import { test } from '@playwright/experimental-ct-react';

test('my component is accessible', async ({ mount }) => {
  const component = await mount(<MyComponent />);
  await expectToHaveNoA11yViolations(component);
});
```

### Scanning for Violations

To get detailed violation information without failing the test, use `scanForA11yViolations`:

```typescript
import { scanForA11yViolations } from '@isolate-ui/utils';

test('my component violations', async ({ mount, page }) => {
  const component = await mount(<MyComponent />);
  const violations = await scanForA11yViolations(page, component);

  console.log('Found violations:', violations);
  // violations contains impact level, rule ID, message, and affected elements
});
```

## API Reference

### `expectToHaveNoA11yViolations(pageOrLocator, options?)`

Asserts that a page or component has no accessibility violations.

**Parameters:**

- `pageOrLocator` - Either a Playwright `Page` or `Locator` object
- `options` (optional) - Configuration object with:
  - `runOnly` - Restrict audit to specific rules or tags
  - `rules` - Enable/disable specific axe rules

**Throws:** Error with detailed violation report if violations are found

**Example:**

```typescript
// Check entire page
await expectToHaveNoA11yViolations(page);

// Check specific component
await expectToHaveNoA11yViolations(button);

// Run only WCAG AA rules
await expectToHaveNoA11yViolations(component, {
  runOnly: {
    type: 'tag',
    values: ['wcag2aa', 'wcag21aa'],
  },
});
```

### `scanForA11yViolations(page, selector?, options?)`

Runs an accessibility audit and returns violations without assertions.

**Parameters:**

- `page` - Playwright Page object
- `selector` (optional) - CSS selector string to limit audit scope. Locator objects are accepted for API compatibility, but the full page context is scanned (see note below)
- `options` (optional) - Configuration object (see above)

**Returns:** Array of `A11yViolation` objects

> **Note on Locator objects:** While this function accepts Playwright Locator objects for convenience, the accessibility scan always analyzes the full page context. This is because many WCAG rules require understanding document-level relationships (e.g., form labels, heading hierarchy, landmark structure). To limit the scope, pass a CSS selector string instead.

**Example:**

```typescript
// Scan specific section by CSS selector
const violations = await scanForA11yViolations(page, '#main-content');

// Scan full page (Locator provided but full context scanned)
const button = page.locator('button');
const violations = await scanForA11yViolations(page, button);

violations.forEach((violation) => {
  console.log(`[${violation.impact}] ${violation.id}: ${violation.message}`);
  violation.nodes.forEach((node) => {
    console.log(`  Affected: ${node.target.join(' > ')}`);
  });
});
```

## Handling Edge Cases

### Disabling Specific Rules

Some automated checks may produce false positives. You can disable specific axe rules:

```typescript
test('custom component with unavoidable violation', async ({ mount }) => {
  const component = await mount(<CustomComponent />);

  await expectToHaveNoA11yViolations(component, {
    rules: {
      'color-contrast': { enabled: false },
      'image-alt': { enabled: false },
    },
  });
});
```

**Document your reasoning:** When disabling rules, add a comment explaining why:

```typescript
// Disabling 'color-contrast' because this component intentionally uses
// a specific brand color palette that has lower contrast by design.
// Colors are validated independently against WCAG AA via design system.
rules: {
  'color-contrast': { enabled: false },
}
```

### Testing Modal Dialogs and Overlays

For components that render outside the component root (modals, popovers), scan the full page:

```typescript
test('modal dialog is accessible', async ({ mount, page }) => {
  const component = await mount(<Modal open>Content</Modal>);

  // Scan entire page, not just the mount point
  await expectToHaveNoA11yViolations(page);
});
```

### Context-Dependent Checks

For components that require specific parent contexts, mount the full context:

```typescript
test('form field is accessible', async ({ mount }) => {
  const component = await mount(
    <form>
      <label>Email</label>
      <FormField required />
    </form>
  );

  // Scans the label relationship as well
  await expectToHaveNoA11yViolations(component.locator('form'));
});
```

## Violation Impact Levels

axe-core categorizes violations by impact:

- **Critical** - Issues that significantly impact accessibility; must be fixed
- **Serious** - Major issues that limit access; should be fixed
- **Moderate** - May cause some issues; should be fixed
- **Minor** - Least severe; nice to fix

All violations are reported regardless of impact level. Focus on fixing Critical and Serious violations first.

## CI/CD Integration

The `component-test` job in `.github/workflows/ci.yml` automatically runs all component tests, including accessibility audits. Any violation will cause the test suite to fail, preventing merge until resolved.

### Local Testing

Run accessibility checks locally before pushing:

```bash
# Run all component tests (including accessibility audits)
pnpm nx run react-<component>:component-test

# Run in watch mode for iterative development
pnpm nx run react-<component>:component-test -- --watch
```

## Best Practices

1. **Test All States:** Include accessibility checks for default, disabled, loading, and error states
2. **Use Semantic HTML:** Let axe-core help validate your semantic structure
3. **Document Exclusions:** When disabling rules, comment why
4. **Test User Flows:** Include a11y checks in interaction tests, not just static renders
5. **Regular Audits:** Keep @axe-core/playwright updated to catch new issues

## Common Violations & Fixes

### color-contrast

**Issue:** Text doesn't have sufficient contrast ratio (should be at least 4.5:1 for normal text)
**Fix:** Adjust text or background color, or adjust component sizing

### image-alt

**Issue:** Images missing alternate text
**Fix:** Add `alt` attribute to images

### aria-required-attr

**Issue:** ARIA role missing required attributes
**Fix:** Add required ARIA attributes for the role being used

### button-name

**Issue:** Button has no accessible name
**Fix:** Add text content or `aria-label`

## References

- [axe DevTools Documentation](https://www.deque.com/axe/devtools/)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [Playwright Testing Documentation](https://playwright.dev/docs/intro)
- [Web Accessibility Initiative (WAI)](https://www.w3.org/WAI/)

## Support

For accessibility questions or issues:

1. Check the [axe DevTools guide](https://www.deque.com/axe/devtools/) for rule details
2. Review [WCAG 2.1 Level AA requirements](https://www.w3.org/WAI/WCAG21/quickref/?currentsLevel=aa)
3. Open an issue on the repository with violation details
