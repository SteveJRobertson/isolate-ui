# @isolate-ui/button

A multi-slot React button component built with [Ark UI](https://ark-ui.com/) and [Panda CSS](https://panda-css.com/).

## Slots

| Slot      | Description                                     |
| --------- | ----------------------------------------------- |
| `root`    | The main `<button>` container                   |
| `label`   | Wraps the visible text content                  |
| `icon`    | Leading / trailing icon wrapper                 |
| `spinner` | Loading indicator (visible only when `loading`) |

## Variant prop

| Value     | Description                                        |
| --------- | -------------------------------------------------- |
| `solid`   | Filled primary background — **default**            |
| `outline` | Transparent fill, primary-coloured border and text |
| `ghost`   | No background or border; text-only with hover fill |

## Running unit tests

Run `nx test react-button` to execute both the functional and snapshot tests via [Vitest](https://vitest.dev/).

```bash
nx test react-button
```

---

## Style Regression Tests

Style regression tests use Vitest's `toMatchSnapshot()` to capture the rendered DOM
(including all Panda CSS class names and Ark UI attributes) so that any unintentional
change to the token system, Panda CSS config, or component recipes is caught immediately.

### How it works

When a snapshot test runs for the first time, Vitest writes the serialised DOM to a
`__snapshots__` directory next to the test file. On subsequent runs it compares the live
render against the stored snapshot and fails if anything differs.

```
src/lib/
├── button.snapshot.test.tsx           ← test authoring
└── __snapshots__/
    └── button.snapshot.test.tsx.snap  ← committed, auto-managed by Vitest
```

### Writing a Style Regression Test for a new component

1. **Create a `<component>.snapshot.test.tsx` file** alongside your component.
2. **Render every meaningful combination** of variants, states, and theme contexts.
3. **Snapshot `container.firstChild`** (the root element) to capture the full slot tree.

```tsx
import { render } from '@testing-library/react';
import MyComponent from './my-component';

describe('MyComponent — Style Regression Snapshots', () => {
  it('renders default variant', () => {
    const { container } = render(<MyComponent>Label</MyComponent>);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders inside dark theme context', () => {
    const { container } = render(
      <div data-theme="dark">
        <MyComponent>Label</MyComponent>
      </div>,
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});
```

4. **Run the tests once** to generate the initial snapshots:

```bash
nx test react-button
```

5. **Commit the generated `.snap` files** — they are the source of truth for the visual contract.

### Updating snapshots intentionally

When a visual change is **expected** (e.g. after updating a token or recipe), regenerate
the stored snapshots with:

```bash
pnpm vitest -u
# or, for a specific project:
nx test react-button -- --update
```

Review the diff in version control before committing to confirm only the intended
classes/attributes changed.

### CI enforcement

The `verify` job in CI runs `nx affected -t test -- --run` which includes snapshot
comparisons. Any unreviewed snapshot mismatch will cause the job to fail, preventing
accidental visual regressions from merging to `main`.
