import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scanForA11yViolations, expectToHaveNoA11yViolations } from './a11y';
import type { Page, Locator } from '@playwright/test';
import type { AxeResults } from 'axe-core';

// Mock @axe-core/playwright
vi.mock('@axe-core/playwright', () => {
  const mockAnalyze = vi.fn();
  const mockInclude = vi.fn();
  const mockWithTags = vi.fn();
  const mockOptions = vi.fn();
  const mockDisableRules = vi.fn();

  class MockAxeBuilder {
    constructor(public config: { page: Page }) {}

    include(selector: string) {
      mockInclude(selector);
      return this;
    }

    withTags(tags: string[]) {
      mockWithTags(tags);
      return this;
    }

    options(opts: unknown) {
      mockOptions(opts);
      return this;
    }

    disableRules(rules: string[]) {
      mockDisableRules(rules);
      return this;
    }

    analyze() {
      return mockAnalyze();
    }
  }

  return {
    AxeBuilder: MockAxeBuilder,
    __mockAnalyze: mockAnalyze,
    __mockInclude: mockInclude,
    __mockWithTags: mockWithTags,
    __mockOptions: mockOptions,
    __mockDisableRules: mockDisableRules,
  };
});

// Import mocked functions for assertion
const {
  __mockAnalyze,
  __mockInclude,
  __mockWithTags,
  __mockOptions,
  __mockDisableRules,
} = vi.mocked(await vi.importMock('@axe-core/playwright'));

describe('a11y utilities', () => {
  let mockPage: Page;
  let mockLocator: Locator;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock page
    mockPage = {
      url: vi.fn().mockReturnValue('http://localhost:3000'),
    } as unknown as Page;

    // Create mock locator with page() method
    mockLocator = {
      page: vi.fn().mockReturnValue(mockPage),
    } as unknown as Locator;
  });

  describe('scanForA11yViolations', () => {
    it('should scan page without violations', async () => {
      const mockResults: AxeResults = {
        violations: [],
        passes: [],
        incomplete: [],
        inapplicable: [],
        url: 'http://localhost:3000',
        timestamp: '2026-03-14T00:00:00.000Z',
        toolOptions: {},
        testEngine: { name: 'axe-core', version: '4.11.1' },
        testRunner: { name: 'axe' },
        testEnvironment: {},
      };

      __mockAnalyze.mockResolvedValue(mockResults);

      const violations = await scanForA11yViolations(mockPage);

      expect(violations).toEqual([]);
      expect(__mockWithTags).toHaveBeenCalledWith(['wcag2aa', 'wcag21aa']);
    });

    it('should return formatted violations when present', async () => {
      const mockResults: AxeResults = {
        violations: [
          {
            id: 'color-contrast',
            impact: 'serious',
            help: 'Elements must have sufficient color contrast',
            description:
              'Ensures the contrast between foreground and background colors',
            helpUrl: 'https://deque.com/color-contrast',
            tags: ['wcag2aa', 'wcag21aa'],
            nodes: [
              {
                html: '<button>Click me</button>',
                target: ['button'],
                any: [],
                all: [],
                none: [],
                impact: 'serious',
                failureSummary: 'Fix the color contrast',
              },
            ],
          },
        ],
        passes: [],
        incomplete: [],
        inapplicable: [],
        url: 'http://localhost:3000',
        timestamp: '2026-03-14T00:00:00.000Z',
        toolOptions: {},
        testEngine: { name: 'axe-core', version: '4.11.1' },
        testRunner: { name: 'axe' },
        testEnvironment: {},
      };

      __mockAnalyze.mockResolvedValue(mockResults);

      const violations = await scanForA11yViolations(mockPage);

      expect(violations).toHaveLength(1);
      expect(violations[0]).toEqual({
        id: 'color-contrast',
        impact: 'serious',
        message: 'Elements must have sufficient color contrast',
        nodes: [
          {
            html: '<button>Click me</button>',
            target: ['button'],
          },
        ],
      });
    });

    it('should include CSS selector when provided as string', async () => {
      const mockResults: AxeResults = {
        violations: [],
        passes: [],
        incomplete: [],
        inapplicable: [],
        url: 'http://localhost:3000',
        timestamp: '2026-03-14T00:00:00.000Z',
        toolOptions: {},
        testEngine: { name: 'axe-core', version: '4.11.1' },
        testRunner: { name: 'axe' },
        testEnvironment: {},
      };

      __mockAnalyze.mockResolvedValue(mockResults);

      await scanForA11yViolations(mockPage, '#main-content');

      expect(__mockInclude).toHaveBeenCalledWith('#main-content');
    });

    it('should not include selector when Locator is passed', async () => {
      const mockResults: AxeResults = {
        violations: [],
        passes: [],
        incomplete: [],
        inapplicable: [],
        url: 'http://localhost:3000',
        timestamp: '2026-03-14T00:00:00.000Z',
        toolOptions: {},
        testEngine: { name: 'axe-core', version: '4.11.1' },
        testRunner: { name: 'axe' },
        testEnvironment: {},
      };

      __mockAnalyze.mockResolvedValue(mockResults);

      await scanForA11yViolations(mockPage, mockLocator);

      // Should not call include when Locator is passed
      expect(__mockInclude).not.toHaveBeenCalled();
    });

    it('should pass runOnly options to AxeBuilder', async () => {
      const mockResults: AxeResults = {
        violations: [],
        passes: [],
        incomplete: [],
        inapplicable: [],
        url: 'http://localhost:3000',
        timestamp: '2026-03-14T00:00:00.000Z',
        toolOptions: {},
        testEngine: { name: 'axe-core', version: '4.11.1' },
        testRunner: { name: 'axe' },
        testEnvironment: {},
      };

      __mockAnalyze.mockResolvedValue(mockResults);

      const runOnlyConfig = {
        type: 'tag' as const,
        values: ['wcag2a'],
      };

      await scanForA11yViolations(mockPage, undefined, {
        runOnly: runOnlyConfig,
      });

      expect(__mockOptions).toHaveBeenCalledWith({
        runOnly: runOnlyConfig,
      });
    });

    it('should disable specific rules when configured', async () => {
      const mockResults: AxeResults = {
        violations: [],
        passes: [],
        incomplete: [],
        inapplicable: [],
        url: 'http://localhost:3000',
        timestamp: '2026-03-14T00:00:00.000Z',
        toolOptions: {},
        testEngine: { name: 'axe-core', version: '4.11.1' },
        testRunner: { name: 'axe' },
        testEnvironment: {},
      };

      __mockAnalyze.mockResolvedValue(mockResults);

      await scanForA11yViolations(mockPage, undefined, {
        rules: {
          'color-contrast': { enabled: false },
        },
      });

      expect(__mockDisableRules).toHaveBeenCalledWith(['color-contrast']);
    });

    it('should handle violations with shadow DOM selectors', async () => {
      const mockResults: AxeResults = {
        violations: [
          {
            id: 'button-name',
            impact: 'critical',
            help: 'Buttons must have discernible text',
            description: 'Ensures buttons have discernible text',
            helpUrl: 'https://deque.com/button-name',
            tags: ['wcag2a'],
            nodes: [
              {
                html: '<button></button>',
                target: [['#shadow-root', 'button']],
                any: [],
                all: [],
                none: [],
                impact: 'critical',
                failureSummary: 'Fix button text',
              },
            ],
          },
        ],
        passes: [],
        incomplete: [],
        inapplicable: [],
        url: 'http://localhost:3000',
        timestamp: '2026-03-14T00:00:00.000Z',
        toolOptions: {},
        testEngine: { name: 'axe-core', version: '4.11.1' },
        testRunner: { name: 'axe' },
        testEnvironment: {},
      };

      __mockAnalyze.mockResolvedValue(mockResults);

      const violations = await scanForA11yViolations(mockPage);

      expect(violations[0].nodes[0].target).toEqual([
        ['#shadow-root', 'button'],
      ]);
    });

    it('should handle violations with unknown impact', async () => {
      const mockResults: AxeResults = {
        violations: [
          {
            id: 'test-rule',
            impact: null,
            help: 'Test help text',
            description: 'Test description',
            helpUrl: 'https://example.com',
            tags: [],
            nodes: [
              {
                html: '<div></div>',
                target: ['div'],
                any: [],
                all: [],
                none: [],
                impact: null,
                failureSummary: '',
              },
            ],
          },
        ],
        passes: [],
        incomplete: [],
        inapplicable: [],
        url: 'http://localhost:3000',
        timestamp: '2026-03-14T00:00:00.000Z',
        toolOptions: {},
        testEngine: { name: 'axe-core', version: '4.11.1' },
        testRunner: { name: 'axe' },
        testEnvironment: {},
      };

      __mockAnalyze.mockResolvedValue(mockResults);

      const violations = await scanForA11yViolations(mockPage);

      expect(violations[0].impact).toBe('unknown');
    });
  });

  describe('expectToHaveNoA11yViolations', () => {
    it('should not throw when no violations are found', async () => {
      const mockResults: AxeResults = {
        violations: [],
        passes: [],
        incomplete: [],
        inapplicable: [],
        url: 'http://localhost:3000',
        timestamp: '2026-03-14T00:00:00.000Z',
        toolOptions: {},
        testEngine: { name: 'axe-core', version: '4.11.1' },
        testRunner: { name: 'axe' },
        testEnvironment: {},
      };

      __mockAnalyze.mockResolvedValue(mockResults);

      await expect(
        expectToHaveNoA11yViolations(mockPage),
      ).resolves.not.toThrow();
    });

    it('should throw formatted error when violations are found', async () => {
      const mockResults: AxeResults = {
        violations: [
          {
            id: 'color-contrast',
            impact: 'serious',
            help: 'Elements must have sufficient color contrast',
            description: 'Color contrast description',
            helpUrl: 'https://deque.com/color-contrast',
            tags: ['wcag2aa'],
            nodes: [
              {
                html: '<button>Click</button>',
                target: ['button.submit'],
                any: [],
                all: [],
                none: [],
                impact: 'serious',
                failureSummary: '',
              },
            ],
          },
        ],
        passes: [],
        incomplete: [],
        inapplicable: [],
        url: 'http://localhost:3000',
        timestamp: '2026-03-14T00:00:00.000Z',
        toolOptions: {},
        testEngine: { name: 'axe-core', version: '4.11.1' },
        testRunner: { name: 'axe' },
        testEnvironment: {},
      };

      __mockAnalyze.mockResolvedValue(mockResults);

      await expect(expectToHaveNoA11yViolations(mockPage)).rejects.toThrow(
        /Accessibility violations detected/,
      );
      await expect(expectToHaveNoA11yViolations(mockPage)).rejects.toThrow(
        /color-contrast/,
      );
      await expect(expectToHaveNoA11yViolations(mockPage)).rejects.toThrow(
        /Elements must have sufficient color contrast/,
      );
      await expect(expectToHaveNoA11yViolations(mockPage)).rejects.toThrow(
        /button\.submit/,
      );
    });

    it('should handle Page object correctly', async () => {
      const mockResults: AxeResults = {
        violations: [],
        passes: [],
        incomplete: [],
        inapplicable: [],
        url: 'http://localhost:3000',
        timestamp: '2026-03-14T00:00:00.000Z',
        toolOptions: {},
        testEngine: { name: 'axe-core', version: '4.11.1' },
        testRunner: { name: 'axe' },
        testEnvironment: {},
      };

      __mockAnalyze.mockResolvedValue(mockResults);

      // Should not throw when passed a Page object
      await expect(
        expectToHaveNoA11yViolations(mockPage),
      ).resolves.not.toThrow();

      // Should have called analyze
      expect(__mockAnalyze).toHaveBeenCalled();
    });

    it('should handle Locator object correctly', async () => {
      const mockResults: AxeResults = {
        violations: [],
        passes: [],
        incomplete: [],
        inapplicable: [],
        url: 'http://localhost:3000',
        timestamp: '2026-03-14T00:00:00.000Z',
        toolOptions: {},
        testEngine: { name: 'axe-core', version: '4.11.1' },
        testRunner: { name: 'axe' },
        testEnvironment: {},
      };

      __mockAnalyze.mockResolvedValue(mockResults);

      // Should not throw when passed a Locator object
      await expect(
        expectToHaveNoA11yViolations(mockLocator),
      ).resolves.not.toThrow();

      // Should extract page from locator
      expect(mockLocator.page).toHaveBeenCalled();

      // Should have called analyze
      expect(__mockAnalyze).toHaveBeenCalled();
    });

    it('should pass options through to scanForA11yViolations', async () => {
      const mockResults: AxeResults = {
        violations: [],
        passes: [],
        incomplete: [],
        inapplicable: [],
        url: 'http://localhost:3000',
        timestamp: '2026-03-14T00:00:00.000Z',
        toolOptions: {},
        testEngine: { name: 'axe-core', version: '4.11.1' },
        testRunner: { name: 'axe' },
        testEnvironment: {},
      };

      __mockAnalyze.mockResolvedValue(mockResults);

      await expectToHaveNoA11yViolations(mockPage, {
        runOnly: { type: 'tag', values: ['wcag2a'] },
      });

      expect(__mockOptions).toHaveBeenCalledWith({
        runOnly: { type: 'tag', values: ['wcag2a'] },
      });
    });

    it('should format multiple violations in error message', async () => {
      const mockResults: AxeResults = {
        violations: [
          {
            id: 'color-contrast',
            impact: 'serious',
            help: 'Color contrast issue',
            description: '',
            helpUrl: '',
            tags: [],
            nodes: [
              {
                html: '<button>Button 1</button>',
                target: ['button.btn-1'],
                any: [],
                all: [],
                none: [],
                impact: 'serious',
                failureSummary: '',
              },
            ],
          },
          {
            id: 'button-name',
            impact: 'critical',
            help: 'Button name issue',
            description: '',
            helpUrl: '',
            tags: [],
            nodes: [
              {
                html: '<button></button>',
                target: ['button.btn-2'],
                any: [],
                all: [],
                none: [],
                impact: 'critical',
                failureSummary: '',
              },
            ],
          },
        ],
        passes: [],
        incomplete: [],
        inapplicable: [],
        url: 'http://localhost:3000',
        timestamp: '2026-03-14T00:00:00.000Z',
        toolOptions: {},
        testEngine: { name: 'axe-core', version: '4.11.1' },
        testRunner: { name: 'axe' },
        testEnvironment: {},
      };

      __mockAnalyze.mockResolvedValue(mockResults);

      await expect(expectToHaveNoA11yViolations(mockPage)).rejects.toThrow(
        /SERIOUS.*color-contrast/s,
      );
      await expect(expectToHaveNoA11yViolations(mockPage)).rejects.toThrow(
        /CRITICAL.*button-name/s,
      );
    });

    it('should include help URL in error message', async () => {
      const mockResults: AxeResults = {
        violations: [
          {
            id: 'test-rule',
            impact: 'minor',
            help: 'Test violation',
            description: '',
            helpUrl: '',
            tags: [],
            nodes: [
              {
                html: '<div></div>',
                target: ['div'],
                any: [],
                all: [],
                none: [],
                impact: 'minor',
                failureSummary: '',
              },
            ],
          },
        ],
        passes: [],
        incomplete: [],
        inapplicable: [],
        url: 'http://localhost:3000',
        timestamp: '2026-03-14T00:00:00.000Z',
        toolOptions: {},
        testEngine: { name: 'axe-core', version: '4.11.1' },
        testRunner: { name: 'axe' },
        testEnvironment: {},
      };

      __mockAnalyze.mockResolvedValue(mockResults);

      await expect(expectToHaveNoA11yViolations(mockPage)).rejects.toThrow(
        /https:\/\/www\.deque\.com\/axe\/devtools\//,
      );
    });
  });
});
