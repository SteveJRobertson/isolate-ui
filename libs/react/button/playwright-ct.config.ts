import { defineConfig, devices } from '@playwright/experimental-ct-react';
import { join } from 'path';

/**
 * Playwright Component Testing configuration for the react-button library.
 *
 * Runs tests matching the `.ct.tsx` extension in Chromium and WebKit.
 * Path aliases in ctViteConfig let playwright/index.tsx import design-token
 * CSS variables and Panda CSS styles from outside the library directory,
 * without needing to change Vite's root (which breaks Playwright CT's
 * internal iframe communication).
 *
 * @see https://playwright.dev/docs/test-components
 */
export default defineConfig({
  testDir: './src',
  testMatch: '**/*.ct.tsx',
  timeout: 30_000,
  fullyParallel: true,
  /* Prevent accidental test.only commits reaching CI */
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? 'github' : 'html',

  use: {
    /* Port used by the Playwright CT Vite dev server */
    ctPort: 3100,
    /* Vite configuration for the CT Vite bundle */
    ctViteConfig: {
      resolve: {
        alias: {
          /* Resolve the Panda CSS output directory from the monorepo root.
             Using aliases instead of changing `root` keeps Playwright CT's
             iframe communication intact. */
          'styled-system': join(__dirname, '../../..', 'styled-system'),
          /* Map the CSS imports used in playwright/index.tsx */
          '@isolate-ui/tokens-css': join(
            __dirname,
            '../../..',
            'libs/shared/tokens/gen/css/variables.css',
          ),
          '@isolate-ui/panda-css': join(
            __dirname,
            '../../..',
            'styled-system/styles.css',
          ),
          /* Resolve workspace path aliases */
          '@isolate-ui/utils': join(
            __dirname,
            '../../..',
            'libs/utils/src/index.ts',
          ),
        },
      },
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
