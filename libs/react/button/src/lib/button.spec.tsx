import { render, screen } from '@testing-library/react';

import Button from './button';

describe('Button', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<Button />);
    expect(baseElement).toBeTruthy();
  });

  it('should render the label slot wrapping children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeTruthy();
  });

  it('should merge custom className with base styles', () => {
    const { container } = render(<Button className="custom-class" />);
    const button = container.querySelector('button');
    expect(button?.className).toContain('custom-class');
    // Base styles from slot recipe should also be present
    expect(button?.className).toBeTruthy();
  });

  it('should apply only base styles when no className provided', () => {
    const { container } = render(<Button />);
    const button = container.querySelector('button');
    expect(button?.className).toBeTruthy();
    expect(button?.className).not.toContain('undefined');
  });

  it('should render leading icon slot when leadingIcon is provided', () => {
    const icon = <svg data-testid="leading-icon" />;
    const { container } = render(<Button leadingIcon={icon} />);
    expect(
      container.querySelector('[data-testid="leading-icon"]'),
    ).toBeTruthy();
  });

  it('should render trailing icon slot when trailingIcon is provided', () => {
    const icon = <svg data-testid="trailing-icon" />;
    const { container } = render(<Button trailingIcon={icon} />);
    expect(
      container.querySelector('[data-testid="trailing-icon"]'),
    ).toBeTruthy();
  });

  it('should render spinner slot and disable button when loading', () => {
    const { container } = render(<Button loading>Save</Button>);
    const button = container.querySelector('button');
    expect(button).toBeTruthy();
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute('aria-busy')).toBe('true');
    expect(button?.getAttribute('data-loading')).toBe('true');
    // Spinner should be present with accessible role and label
    const spinner = container.querySelector('[role="status"]');
    expect(spinner).toBeTruthy();
    expect(spinner?.getAttribute('aria-label')).toBe('Loading');
  });

  it('should disable the button when disabled prop is set', () => {
    const { container } = render(<Button disabled>Submit</Button>);
    const button = container.querySelector('button');
    expect(button?.disabled).toBe(true);
  });
});
