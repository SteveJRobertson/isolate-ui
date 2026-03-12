import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import { Button } from './button';

const meta: Meta<typeof Button> = {
  title: 'React/Button',
  component: Button,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    disabled: { control: 'boolean' },
    loading: { control: 'boolean' },
    className: { control: 'text' },
    leadingIcon: { control: false },
    trailingIcon: { control: false },
  },
  args: {
    onClick: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Button',
  },
};

export const WithLongLabel: Story = {
  args: {
    children: 'This is a longer button label',
  },
};

export const Disabled: Story = {
  args: {
    children: 'Disabled Button',
    disabled: true,
  },
};

export const Loading: Story = {
  args: {
    children: 'Saving…',
    loading: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          'The `loading` prop disables the button, sets `aria-busy`, and renders the spinner slot.',
      },
    },
  },
};

export const WithLeadingIcon: Story = {
  args: {
    children: 'Upload',
    leadingIcon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    ),
  },
};

export const WithTrailingIcon: Story = {
  args: {
    children: 'Next',
    trailingIcon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
      </svg>
    ),
  },
};

export const WithBothIcons: Story = {
  args: {
    children: 'Settings',
    leadingIcon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
      </svg>
    ),
    trailingIcon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    ),
  },
};

export const WithoutChildren: Story = {
  args: {},
  parameters: {
    docs: {
      description: {
        story:
          'When no children are provided, the button falls back to the `helloWorld()` utility.',
      },
    },
  },
};
