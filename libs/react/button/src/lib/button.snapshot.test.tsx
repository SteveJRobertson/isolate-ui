/**
 * Style Regression Snapshot Tests — Button
 *
 * These tests capture the full rendered DOM of the Button component (including
 * all slot elements and Panda CSS class names) so that unintentional changes to
 * the token system, Panda CSS config, or component recipes are surfaced immediately.
 *
 * Updating snapshots:
 *   When a visual change is intentional, regenerate stored snapshots with:
 *     pnpm vitest -u
 *
 * See the README for guidance on writing snapshot tests for new components.
 */

import { render } from '@testing-library/react';
import Button from './button';

describe('Button — Style Regression Snapshots', () => {
  // ---------------------------------------------------------------------------
  // Variants
  // ---------------------------------------------------------------------------
  describe('Variants', () => {
    it('renders solid variant (default)', () => {
      const { container } = render(<Button variant="solid">Submit</Button>);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('renders outline variant', () => {
      const { container } = render(<Button variant="outline">Submit</Button>);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('renders ghost variant', () => {
      const { container } = render(<Button variant="ghost">Submit</Button>);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('renders default (no variant prop) identically to solid', () => {
      const { container: solidContainer } = render(
        <Button variant="solid">Submit</Button>,
      );
      const { container: defaultContainer } = render(<Button>Submit</Button>);
      expect(defaultContainer.firstChild?.outerHTML).toBe(
        solidContainer.firstChild?.outerHTML,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // States
  // ---------------------------------------------------------------------------
  describe('States', () => {
    it('renders loading state — spinner slot visible, button disabled', () => {
      const { container } = render(<Button loading>Saving…</Button>);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('renders disabled state', () => {
      const { container } = render(<Button disabled>Submit</Button>);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('renders loading + outline variant', () => {
      const { container } = render(
        <Button variant="outline" loading>
          Saving…
        </Button>,
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('renders disabled + ghost variant', () => {
      const { container } = render(
        <Button variant="ghost" disabled>
          Submit
        </Button>,
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  // ---------------------------------------------------------------------------
  // Themes
  // Panda CSS uses `data-theme` on an ancestor element to scope token overrides.
  // These snapshots lock down the full subtree (wrapper + button) so any
  // unexpected attribute or class change is caught.
  // ---------------------------------------------------------------------------
  describe('Themes', () => {
    it('renders inside light theme context', () => {
      const { container } = render(
        <div data-theme="light">
          <Button>Submit</Button>
        </div>,
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('renders inside dark theme context', () => {
      const { container } = render(
        <div data-theme="dark">
          <Button>Submit</Button>
        </div>,
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('renders outline variant inside dark theme context', () => {
      const { container } = render(
        <div data-theme="dark">
          <Button variant="outline">Submit</Button>
        </div>,
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  // ---------------------------------------------------------------------------
  // Full slot structure
  // Ensure all four slots (root, label, icon, spinner) appear in snapshots.
  // ---------------------------------------------------------------------------
  describe('Full slot structure', () => {
    it('renders all slots — leading icon, children, trailing icon', () => {
      const leadingIcon = <svg data-testid="leading" aria-hidden="true" />;
      const trailingIcon = <svg data-testid="trailing" aria-hidden="true" />;
      const { container } = render(
        <Button leadingIcon={leadingIcon} trailingIcon={trailingIcon}>
          Settings
        </Button>,
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it('renders all slots — loading with leading icon', () => {
      const leadingIcon = <svg data-testid="leading" aria-hidden="true" />;
      const { container } = render(
        <Button leadingIcon={leadingIcon} loading>
          Saving…
        </Button>,
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });
});
