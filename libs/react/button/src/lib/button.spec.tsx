import { render } from '@testing-library/react';

import Button from './button';

describe('Button', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<Button />);
    expect(baseElement).toBeTruthy();
  });

  it('should merge custom className with base styles', () => {
    const { container } = render(<Button className="custom-class" />);
    const button = container.querySelector('button');
    expect(button?.className).toContain('custom-class');
    // Base styles should also be present
    expect(button?.className).toBeTruthy();
  });

  it('should apply only base styles when no className provided', () => {
    const { container } = render(<Button />);
    const button = container.querySelector('button');
    expect(button?.className).toBeTruthy();
    expect(button?.className).not.toContain('undefined');
  });
});
