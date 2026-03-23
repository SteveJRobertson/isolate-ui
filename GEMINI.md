# GEMINI.md - Isolate UI Project Context

This file provides foundational context and instructions for AI agents working on the Isolate UI project.

## Project Overview

**Isolate UI** is a modern React component library monorepo built with TypeScript, managed by **Nx**, and styled using **Panda CSS**. It follows a design-system-first approach with automated releases and strict accessibility standards.

### Core Technology Stack

- **Monorepo Management:** [Nx](https://nx.dev)
- **Package Manager:** [pnpm](https://pnpm.io) (v10.30.3+)
- **UI Framework:** [React 19](https://react.dev)
- **Styling:** [Panda CSS](https://panda-css.com) & [Vanilla CSS Modules](https://github.com/css-modules/css-modules)
- **Design Tokens:** [Style Dictionary](https://amzn.github.io/style-dictionary/)
- **Testing:** [Vitest](https://vitest.dev) (Unit/Integration), [Playwright CT](https://playwright.dev/docs/test-components) (Component Testing)
- **Accessibility:** [@axe-core/playwright](https://github.com/dequelabs/axe-core-playwright)
- **Documentation:** [Storybook 8](https://storybook.js.org)
- **Releases:** [Nx Release](https://nx.dev/features/manage-releases) with Version Plans

---

## Directory Structure

- `libs/react/`: React-based UI component libraries.
  - `button/`: The primary Button component library.
- `libs/shared/tokens/`: Centralized design tokens (generates CSS/TS).
- `libs/utils/`: Shared TypeScript utility functions (Node.js environment).
- `.nx/version-plans/`: YAML files describing pending releases.
- `styled-system/`: Generated Panda CSS output (do not edit directly).

---

## Building and Running

### Essential Commands

| Task             | Command                                                 |
| :--------------- | :------------------------------------------------------ |
| **Setup**        | `pnpm install`                                          |
| **All Tests**    | `pnpm vitest` (watch) or `pnpm vitest run` (once)       |
| **Project Test** | `nx test <project-name>` (e.g., `nx test react-button`) |
| **Storybook**    | `nx storybook <project-name>`                           |
| **Build**        | `nx build <project-name>`                               |
| **Lint**         | `nx lint <project-name>`                                |
| **Type Check**   | `nx typecheck <project-name>`                           |
| **Release Plan** | `pnpm nx release plan [major\|minor\|patch]`            |

### Development Setup

Running `pnpm install` triggers a `prepare` script that:

1. Initializes Husky.
2. Builds design tokens (`libs/shared/tokens/build.mjs`).
3. Generates Panda CSS code (`panda codegen`).

---

## Development Conventions

### 1. Commit Messages

Strict adherence to **Conventional Commits** is enforced via `commitlint`.

- **Format:** `<type>(<scope>): <description>`
- **Valid Scopes:** Nx project names (e.g., `react-button`, `utils`, `tokens`) or special scopes (`release`, `deps`, `commitlint`).
- **Valid Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

### 2. Testing Standards

- **Vitest Globals:** `describe`, `it`, `expect`, and `vi` are globally available. Do not import them.
- **Environments:**
  - React components use `jsdom`.
  - Utility libraries use `node`.
- **Accessibility (A11y):** All UI components MUST have accessibility tests using the Playwright Axe helper. A11y failures are considered blocking bugs.
- **Snapshots:** Style changes that affect generated CSS classes will require updating Vitest snapshots (`nx test <project> -- -u`).

### 3. Styling Guidelines

- **Panda CSS:** Preferred for design-token-driven styling.
- **CSS Modules:** Used for component-specific logic where Panda might be overkill or for legacy support.
- **A11y First:** Color choices must meet WCAG 2.1 Level AA contrast requirements.

### 4. Library Generation

When adding new libraries, avoid using the `@nx/vitest` plugin directly during generation due to known ESM compatibility issues.

- **Recommended Workflow:**
  1. Generate with `--unitTestRunner=none`.
  2. Add Vitest manually: `nx g @nx/vitest:configuration --project=<name>`.

### 5. Dependency Management

- Use `pnpm`.
- Library-specific dependencies should be in `libs/<path>/package.json`.
- Build-time scripts (e.g., `build.mjs`) should have their dependencies in `devDependencies` and be ignored by `@nx/dependency-checks` in `eslint.config.mjs`.

---

## Known Issues & Tips

- **Nx Cache:** If builds/tests behave strangely, run `nx reset`.
- **ESLint & Playwright:** Generated `.cache` directories in Playwright should be ignored in `eslint.config.mjs` to avoid noise.
- **Path Mappings:** Always use workspace aliases (e.g., `@isolate-ui/button`) for internal cross-library imports as defined in `tsconfig.base.json`.

---

## Detailed Documentation

Refer to these files for deeper dives:

- `README.md`: High-level project and CI/CD info.
- `AGENTS.md`: Technical deep-dive for AI agents and troubleshooting.
- `A11Y_TESTING.md`: Detailed guide on accessibility testing standards.
- `libs/react/button/AGENTS.md`: Specifics for the Button component.
