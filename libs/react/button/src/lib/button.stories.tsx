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
    onClick: { action: 'clicked' },
    disabled: { control: 'boolean' },
    className: { control: 'text' },
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
