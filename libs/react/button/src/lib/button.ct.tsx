/**
 * Playwright Component Tests — Button
 *
 * These tests validate real-world component behaviour in actual browser engines
 * (Chromium and WebKit), covering interactions that JSDOM cannot exercise:
 * hover/focus-visible pseudo-classes, pointer events, and Ark UI accessibility
 * primitives.
 *
 * Run locally:
 *   pnpm nx run react-button:component-test
 *
 * Update snapshots (if used in future):
 *   pnpm nx run react-button:component-test -- --update-snapshots
 */

import { expect, test } from '@playwright/experimental-ct-react';
import Button from './button';

// ---------------------------------------------------------------------------
// Basic rendering
// ---------------------------------------------------------------------------
test.describe('Button — rendering', () => {
  test('renders with default slot structure', async ({ mount }) => {
    const component = await mount(<Button>Click me</Button>);
    await expect(component).toBeVisible();
    await expect(component).toHaveRole('button');
    await expect(component.locator('.button__label')).toHaveText('Click me');
  });

  test('renders solid variant by default', async ({ mount }) => {
    const component = await mount(<Button>Solid</Button>);
    // solid variant applies a primary background utility class
    await expect(component).toHaveClass(/bg-c_primary\.500/);
  });

  test('renders outline variant with border class', async ({ mount }) => {
    const component = await mount(<Button variant="outline">Outline</Button>);
    await expect(component).toHaveClass(/bd-c_primary\.500/);
  });

  test('renders ghost variant with transparent background', async ({
    mount,
  }) => {
    const component = await mount(<Button variant="ghost">Ghost</Button>);
    await expect(component).toHaveClass(/bg-c_transparent/);
  });
});

// ---------------------------------------------------------------------------
// Interactions — click
// ---------------------------------------------------------------------------
test.describe('Button — click', () => {
  test('fires onClick when clicked', async ({ mount }) => {
    let clicked = false;
    const component = await mount(
      <Button onClick={() => (clicked = true)}>Click me</Button>,
    );
    await component.click();
    // React event handlers are delivered to the Node test process via an async
    // IPC round-trip in Playwright CT, so poll until the flag is set.
    await expect.poll(() => clicked).toBe(true);
  });

  test('does not fire onClick when disabled', async ({ mount }) => {
    let clicked = false;
    const component = await mount(
      <Button disabled onClick={() => (clicked = true)}>
        Disabled
      </Button>,
    );
    // Disabled button should not respond to click
    await component.click({ force: true });
    // Poll to give any unexpected async delivery a chance to arrive before
    // asserting the flag remains false.
    await expect.poll(() => clicked).toBe(false);
  });

  test('does not fire onClick when loading', async ({ mount }) => {
    let clicked = false;
    const component = await mount(
      <Button loading onClick={() => (clicked = true)}>
        Loading
      </Button>,
    );
    await component.click({ force: true });
    await expect.poll(() => clicked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Interactions — focus & keyboard
// ---------------------------------------------------------------------------
test.describe('Button — focus & keyboard', () => {
  test('is focusable by default', async ({ mount, page }) => {
    const component = await mount(<Button>Focus me</Button>);
    // Focus programmatically — avoids WebKit's macOS-default behaviour of
    // not Tab-focusing buttons (which Playwright's WebKit engine replicates).
    await component.focus();
    await expect(component).toBeFocused();
  });

  test('is not focusable when disabled', async ({ mount }) => {
    const component = await mount(<Button disabled>Disabled</Button>);
    // Attempt to focus — browsers prevent focus on disabled form elements.
    await component.focus();
    await expect(component).not.toBeFocused();
  });

  test('submits form when type=submit and enter is pressed', async ({
    mount,
    page,
  }) => {
    let submitted = false;
    await mount(
      // No event.preventDefault() here: Playwright CT serialises the React
      // SyntheticEvent to the Node test context as a plain object, so calling
      // .preventDefault() on it would throw a TypeError before `submitted` is
      // set.  In the CT iframe there is no real navigation target, so omitting
      // it is safe and the test remains deterministic.
      <form onSubmit={() => (submitted = true)}>
        <Button type="submit">Submit</Button>
      </form>,
    );
    // Focus the button directly then trigger Enter — WebKit doesn't Tab-focus
    // buttons by default (it's a macOS/Safari setting that Playwright replicates).
    await page.locator('button').focus();
    await page.keyboard.press('Enter');
    // Use polling: keyboard.press() resolves before the CT IPC round-trip that
    // delivers the React callback to the test context completes.
    await expect.poll(() => submitted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// States — loading
// ---------------------------------------------------------------------------
test.describe('Button — loading state', () => {
  test('renders spinner slot when loading', async ({ mount }) => {
    const component = await mount(<Button loading>Saving…</Button>);
    const spinner = component.locator('[role="status"]');
    await expect(spinner).toBeVisible();
    await expect(spinner).toHaveAttribute('aria-label', 'Loading');
  });

  test('sets aria-busy when loading', async ({ mount }) => {
    const component = await mount(<Button loading>Saving…</Button>);
    await expect(component).toHaveAttribute('aria-busy', 'true');
  });

  test('sets data-loading attribute when loading', async ({ mount }) => {
    const component = await mount(<Button loading>Saving…</Button>);
    await expect(component).toHaveAttribute('data-loading', 'true');
  });

  test('disables the button when loading', async ({ mount }) => {
    const component = await mount(<Button loading>Saving…</Button>);
    await expect(component).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------
test.describe('Button — accessibility', () => {
  test('has button role', async ({ mount }) => {
    const component = await mount(<Button>Accessible</Button>);
    await expect(component).toHaveRole('button');
  });

  test('type defaults to "button" to prevent accidental form submission', async ({
    mount,
  }) => {
    const component = await mount(<Button>No Form Submit</Button>);
    await expect(component).toHaveAttribute('type', 'button');
  });

  test('icons are hidden from assistive technology', async ({ mount }) => {
    const icon = <svg data-testid="icon" />;
    const component = await mount(<Button leadingIcon={icon}>With Icon</Button>);
    const iconWrapper = component.locator('[aria-hidden="true"]').first();
    await expect(iconWrapper).toBeAttached();
  });

  test('label slot wraps text content', async ({ mount }) => {
    const component = await mount(<Button>Label text</Button>);
    const label = component.locator('.button__label');
    await expect(label).toHaveText('Label text');
  });
});

// ---------------------------------------------------------------------------
// Style integration — Panda CSS classes applied in a real browser
// ---------------------------------------------------------------------------
test.describe('Button — style integration', () => {
  test('applies Panda CSS base layout classes to root slot', async ({
    mount,
  }) => {
    const component = await mount(<Button>Styled</Button>);
    // These atomic utility classes come from the slot recipe base styles
    await expect(component).toHaveClass(/d_inline-flex/);
    await expect(component).toHaveClass(/ai_center/);
    await expect(component).toHaveClass(/jc_center/);
  });

  test('applies label slot class', async ({ mount }) => {
    const component = await mount(<Button>Label</Button>);
    await expect(component.locator('.button__label')).toBeVisible();
  });

  test('applies spinner slot class when loading', async ({ mount }) => {
    const component = await mount(<Button loading>Loading button</Button>);
    await expect(component.locator('.button__spinner')).toBeVisible();
  });
});
