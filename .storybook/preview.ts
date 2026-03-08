import type { Preview } from '@storybook/react';
import './global.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    viewport: {
      viewports: {
        mobileS: {
          name: 'Mobile S (320px)',
          styles: { width: '320px', height: '568px' },
          type: 'mobile',
        },
        mobileM: {
          name: 'Mobile M (375px)',
          styles: { width: '375px', height: '667px' },
          type: 'mobile',
        },
        mobileL: {
          name: 'Mobile L (425px)',
          styles: { width: '425px', height: '812px' },
          type: 'mobile',
        },
        tablet: {
          name: 'Tablet (768px)',
          styles: { width: '768px', height: '1024px' },
          type: 'tablet',
        },
        laptop: {
          name: 'Laptop (1024px)',
          styles: { width: '1024px', height: '768px' },
          type: 'desktop',
        },
        desktop: {
          name: 'Desktop (1440px)',
          styles: { width: '1440px', height: '900px' },
          type: 'desktop',
        },
      },
    },
    a11y: {
      // Accessibility checks enabled by default for all stories
      config: {},
    },
  },
};

export default preview;
