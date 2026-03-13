import { AxeBuilder } from '@axe-core/playwright';
import type { Page, Locator } from '@playwright/test';

/**
 * Accessibility violation details with formatted output
 */
export interface A11yViolation {
  id: string;
  impact: string;
  message: string;
  nodes: Array<{
    html: string;
    target: string[];
  }>;
}

/**
 * Runs an accessibility audit on a component using axe-core
 * and ensures it meets WCAG 2.1 Level AA standards.
 *
 * @param page - The Playwright page object
 * @param selector - Optional CSS selector string to limit the audit scope
 *                   Note: Locator objects are accepted but the full page context is scanned
 *                   to ensure accurate accessibility validation (relationships, document structure, etc.)
 * @param options - Optional configuration for axe-core
 * @returns The violations array (empty if no violations)
 */
export async function scanForA11yViolations(
  page: Page,
  selector?: string | Locator,
  options?: {
    runOnly?: {
      type: 'tag' | 'rule';
      values: string[];
    };
    rules?: {
      [key: string]: {
        enabled: boolean;
      };
    };
  },
): Promise<A11yViolation[]> {
  const builder = new AxeBuilder({ page });

  // Only include specific selectors if a CSS string is provided
  // Locator objects are accepted for API compatibility but we scan the full page
  // because accessibility rules often require document-wide context
  if (selector && typeof selector === 'string') {
    builder.include(selector);
  }

  // Configure for WCAG 2.1 Level AA
  builder.withTags(['wcag2aa', 'wcag21aa']);

  if (options?.runOnly) {
    builder.withRunOnly(options.runOnly);
  }

  if (options?.rules) {
    // Enable/disable specific rules
    Object.entries(options.rules).forEach(([ruleId, config]) => {
      if (!config.enabled) {
        builder.disableRules([ruleId]);
      }
    });
  }

  const results = await builder.analyze();

  // Format violations for better readability
  const violations = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact || 'unknown',
    message: violation.help,
    nodes: violation.nodes.map((node) => ({
      html: node.html,
      target: node.target,
    })),
  }));

  return violations;
}

/**
 * Asserts that a page or component has no accessibility violations.
 * Throws an error with detailed violation information if violations are found.
 *
 * Usage:
 *   await expectToHaveNoA11yViolations(page);
 *   await expectToHaveNoA11yViolations(component);
 */
export async function expectToHaveNoA11yViolations(
  pageOrLocator: Page | Locator,
  options?: {
    runOnly?: {
      type: 'tag' | 'rule';
      values: string[];
    };
    rules?: {
      [key: string]: {
        enabled: boolean;
      };
    };
  },
): Promise<void> {
  let page: Page;
  let selector: Locator | undefined;

  // Determine if we're dealing with a Page or Locator
  // Locators have a page() method, Pages do not
  if (typeof (pageOrLocator as Locator).page === 'function') {
    page = (pageOrLocator as Locator).page() as Page;
    selector = pageOrLocator as Locator;
  } else {
    page = pageOrLocator as Page;
  }

  const violations = await scanForA11yViolations(page, selector, options);

  if (violations.length > 0) {
    const violationReport = violations
      .map((v) => {
        const nodeDetails = v.nodes
          .map(
            (n) =>
              `\n    - Selector: ${n.target.join(' > ')}\n      HTML: ${n.html}`,
          )
          .join('\n');
        return `\n  [${v.impact?.toUpperCase() || 'UNKNOWN'}] ${v.id}\n    Message: ${v.message}${nodeDetails}`;
      })
      .join('\n');

    throw new Error(
      `Accessibility violations detected:\n${violationReport}\n\nFor more information, visit: https://www.deque.com/axe/devtools/`,
    );
  }
}
