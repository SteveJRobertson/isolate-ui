import { join } from 'path';
import type { StorybookConfig } from '@storybook/react-vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { mergeConfig } from 'vite';

const config: StorybookConfig = {
  stories: ['../libs/**/*.stories.@(js|jsx|mjs|ts|tsx|mdx)'],
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-interactions',
    '@storybook/addon-a11y',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  viteFinal: async (config) => {
    return mergeConfig(config, {
      plugins: [nxViteTsPaths()],
      build: {
        chunkSizeWarningLimit: 1000,
      },
      resolve: {
        alias: {
          // Resolve Panda CSS generated styled-system directory for Storybook production builds
          'styled-system': join(__dirname, '../styled-system'),
        },
      },
    });
  },
};

export default config;
