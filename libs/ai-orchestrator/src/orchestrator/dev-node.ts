import * as path from 'path';
import * as fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { AgentState, SerializedMessage } from '../schema';
import type { AgentNodeFn } from './langgraph';

const execFileAsync = promisify(execFile);

// ── Public Types ──────────────────────────────────────────────────────────────

export interface DevNodeConfig {
  workspaceRoot: string;
  /** Override the golden sample directory (defaults to libs/react/button/src/lib). */
  goldenSamplePath?: string;
}

export interface GoldenSamplePatterns {
  slots: string[];
  variants: string[];
}

// ── HTML Tag Resolution ───────────────────────────────────────────────────────

const VALID_HTML_TAGS = new Set([
  'a',
  'abbr',
  'address',
  'article',
  'aside',
  'audio',
  'b',
  'blockquote',
  'button',
  'canvas',
  'caption',
  'cite',
  'code',
  'data',
  'datalist',
  'dd',
  'del',
  'details',
  'dfn',
  'dialog',
  'div',
  'dl',
  'dt',
  'em',
  'embed',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'iframe',
  'img',
  'input',
  'ins',
  'kbd',
  'label',
  'legend',
  'li',
  'main',
  'map',
  'mark',
  'menu',
  'meter',
  'nav',
  'ol',
  'optgroup',
  'option',
  'output',
  'p',
  'picture',
  'pre',
  'progress',
  'q',
  'section',
  'select',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'ul',
  'var',
  'video',
]);

interface ArkRefEntry {
  htmlTag?: string;
}

interface ArkRef {
  primitives?: Record<string, ArkRefEntry>;
}

/**
 * Resolve the HTML element tag for `HTMLArkProps<T>` and `ark.<tag>`.
 *
 * Lookup order:
 * 1. docs/ark-ui-reference.json `htmlTag` field for the matching component entry
 * 2. componentName is itself a valid HTML element tag
 * 3. Fall back to 'div'
 */
export async function resolveHtmlTag(
  componentName: string,
  arkRefPath: string,
): Promise<string> {
  try {
    const raw = await fs.readFile(arkRefPath, 'utf-8');
    const ref = JSON.parse(raw) as ArkRef;
    const entry = ref.primitives?.[componentName.toLowerCase()];
    if (entry?.htmlTag) {
      const normalised = entry.htmlTag.toLowerCase();
      if (VALID_HTML_TAGS.has(normalised)) {
        return normalised;
      }
      // Invalid htmlTag value in JSON — fall through to next strategy.
    }
  } catch {
    // File unreadable or JSON parse failure — fall through to next strategy.
  }

  if (VALID_HTML_TAGS.has(componentName.toLowerCase())) {
    return componentName.toLowerCase();
  }

  return 'div';
}

// ── Golden Sample Introspection ───────────────────────────────────────────────

/**
 * Validates that all four required golden sample files exist, then reads them
 * to extract slot names and recipe variant names.
 *
 * Throws with message 'REJECTED: golden sample incomplete' if any file is absent.
 */
export async function introspectGoldenSample(
  workspaceRoot: string,
  goldenSamplePath?: string,
): Promise<GoldenSamplePatterns> {
  const libBase =
    goldenSamplePath ??
    path.join(workspaceRoot, 'libs', 'react', 'button', 'src', 'lib');
  // Derive projectJson relative to libBase (which is at src/lib level).
  // This correctly handles both the default button path and any goldenSamplePath override.
  const projectJson = path.join(libBase, '..', '..', 'project.json');

  const requiredFiles = [
    path.join(libBase, 'button.tsx'),
    path.join(libBase, 'button.recipe.ts'),
    path.join(libBase, 'button.ct.tsx'),
    projectJson,
  ];

  for (const file of requiredFiles) {
    try {
      await fs.access(file);
    } catch {
      throw new Error('REJECTED: golden sample incomplete');
    }
  }

  const recipeContent = await fs.readFile(
    path.join(libBase, 'button.recipe.ts'),
    'utf-8',
  );

  // Extract slot names: slots: ['root', 'label', ...]
  const slotsMatch = recipeContent.match(/slots:\s*\[([^\]]+)\]/);
  const slots = slotsMatch
    ? slotsMatch[1]
        .split(',')
        .map((s) => s.trim().replace(/['"]/g, ''))
        .filter(Boolean)
    : ['root', 'label'];

  // Extract variant names from the variants.variant block (6-space indented keys)
  const variantMatches = [...recipeContent.matchAll(/^ {6}(\w+):\s*\{/gm)];
  const variants =
    variantMatches.length > 0
      ? variantMatches.map((m) => m[1])
      : ['solid', 'outline', 'ghost'];

  return { slots, variants };
}

// ── Nx Generator ─────────────────────────────────────────────────────────────

/**
 * Runs `pnpm nx generate @nx/react:lib` for a new component library.
 * --publishable and --importPath are mandatory to match monorepo conventions.
 */
export async function runNxGenerator(
  workspaceRoot: string,
  componentName: string,
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(
    'pnpm',
    [
      'nx',
      'generate',
      '@nx/react:lib',
      componentName,
      `--directory=libs/react/${componentName}`,
      '--unitTestRunner=vitest',
      '--bundler=vite',
      '--linter=eslint',
      '--publishable',
      `--importPath=@isolate-ui/${componentName}`,
    ],
    { cwd: workspaceRoot },
  );
  return { stdout, stderr };
}

// ── File Writers ──────────────────────────────────────────────────────────────

/**
 * Writes the main component TSX file using HTMLArkProps and ark.<tagName>.
 */
export async function writeComponentFile(
  dir: string,
  componentName: string,
  tagName: string,
  _slots: string[],
): Promise<void> {
  const pascal = toPascal(componentName);
  const camel = toCamel(componentName);
  // 'root' and 'label' are always normalized into slots by createDevBoilerplateNode.

  const content = [
    `import type { HTMLArkProps } from '@ark-ui/react';`,
    `import { ark } from '@ark-ui/react';`,
    `import { cx } from 'styled-system/css';`,
    `import { ${camel}Recipe, type ${pascal}RecipeVariants } from './${componentName}.recipe';`,
    ``,
    `export type ${pascal}Props = HTMLArkProps<'${tagName}'> & {`,
    `  /** Visual style variant. */`,
    `  variant?: ${pascal}RecipeVariants['variant'];`,
    `};`,
    ``,
    `export function ${pascal}({`,
    `  children,`,
    `  className,`,
    `  variant,`,
    `  ...props`,
    `}: ${pascal}Props) {`,
    `  const styles = ${camel}Recipe({ variant });`,
    ``,
    `  return (`,
    `    <ark.${tagName}`,
    `      {...props}`,
    `      className={cx(styles.root, className)}`,
    `    >`,
    `      <span className={styles.label}>{children}</span>`,
    `    </ark.${tagName}>`,
    `  );`,
    `}`,
    ``,
    `export default ${pascal};`,
    ``,
  ].join('\n');

  await fs.writeFile(path.join(dir, `${componentName}.tsx`), content, 'utf-8');
}

/**
 * Writes the Panda CSS slot recipe file using createSlotRecipe from @isolate-ui/utils.
 */
export async function writeRecipeFile(
  dir: string,
  componentName: string,
  slots: string[],
  variants: string[],
): Promise<void> {
  const pascal = toPascal(componentName);
  const camel = toCamel(componentName);
  const slotsArray = slots.map((s) => `'${s}'`).join(', ');
  const defaultVariant = variants[0] ?? 'default';

  const baseEntries = slots
    .map((slot) => {
      if (slot === 'root') {
        return `    root: {\n      display: 'inline-flex',\n      alignItems: 'center',\n    },`;
      }
      if (slot === 'label') {
        return `    label: {\n      lineHeight: 'normal',\n    },`;
      }
      return `    ${slot}: {},`;
    })
    .join('\n');

  const variantEntries = variants
    .map((v) => {
      const slotEntries = slots.map((s) => `        ${s}: {},`).join('\n');
      return `      ${v}: {\n${slotEntries}\n      },`;
    })
    .join('\n');

  const content = [
    `import { createSlotRecipe } from '@isolate-ui/utils';`,
    ``,
    `export const ${camel}Recipe = createSlotRecipe({`,
    `  className: '${componentName}',`,
    `  slots: [${slotsArray}],`,
    `  base: {`,
    baseEntries,
    `  },`,
    `  variants: {`,
    `    variant: {`,
    variantEntries,
    `    },`,
    `  },`,
    `  defaultVariants: {`,
    `    variant: '${defaultVariant}',`,
    `  },`,
    `});`,
    ``,
    `export type ${pascal}RecipeVariants = NonNullable<`,
    `  Parameters<typeof ${camel}Recipe>[0]`,
    `>;`,
    ``,
  ].join('\n');

  await fs.writeFile(
    path.join(dir, `${componentName}.recipe.ts`),
    content,
    'utf-8',
  );
}

/**
 * Writes a CSF 3.0 Storybook stories file with Default and AllVariants stories.
 * AllVariants is a static render templated from the variants array — no dynamic import.
 */
export async function writeStoriesFile(
  dir: string,
  componentName: string,
  variants: string[],
): Promise<void> {
  const pascal = toPascal(componentName);

  const allVariantsJsx = variants
    .map((v) => `      <${pascal} variant="${v}">${pascal} ${v}</${pascal}>`)
    .join('\n');

  const content = [
    `import type { Meta, StoryObj } from '@storybook/react';`,
    `import { ${pascal} } from './${componentName}';`,
    ``,
    `const meta: Meta<typeof ${pascal}> = {`,
    `  title: 'React/${pascal}',`,
    `  component: ${pascal},`,
    `  tags: ['autodocs'],`,
    `  parameters: {`,
    `    layout: 'centered',`,
    `  },`,
    `};`,
    ``,
    `export default meta;`,
    `type Story = StoryObj<typeof meta>;`,
    ``,
    `export const Default: Story = {`,
    `  args: {`,
    `    children: '${pascal}',`,
    `  },`,
    `};`,
    ``,
    `export const AllVariants: Story = {`,
    `  render: () => (`,
    `    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>`,
    allVariantsJsx,
    `    </div>`,
    `  ),`,
    `};`,
    ``,
  ].join('\n');

  await fs.writeFile(
    path.join(dir, `${componentName}.stories.tsx`),
    content,
    'utf-8',
  );
}

/**
 * Writes a Playwright CT test file mirroring the golden sample pattern.
 */
export async function writeComponentTestFile(
  dir: string,
  componentName: string,
): Promise<void> {
  const pascal = toPascal(componentName);

  const content = [
    `import { expect, test } from '@playwright/experimental-ct-react';`,
    `import { expectToHaveNoA11yViolations } from '@isolate-ui/utils/a11y';`,
    `import ${pascal} from './${componentName}';`,
    ``,
    `test('renders and is visible', async ({ mount }) => {`,
    `  const component = await mount(<${pascal}>${pascal}</${pascal}>);`,
    `  await expect(component).toBeVisible();`,
    `});`,
    ``,
    `test('passes a11y in default state', async ({ mount }) => {`,
    `  const component = await mount(<${pascal}>${pascal}</${pascal}>);`,
    `  await expectToHaveNoA11yViolations(component);`,
    `});`,
    ``,
  ].join('\n');

  await fs.writeFile(
    path.join(dir, `${componentName}.ct.tsx`),
    content,
    'utf-8',
  );
}

// ── Build & Test ──────────────────────────────────────────────────────────────

/**
 * Runs `pnpm nx build` then `pnpm nx test` for the generated component.
 */
export async function runBuildAndTest(
  workspaceRoot: string,
  componentName: string,
): Promise<{ success: boolean; errorLog: string }> {
  const projectName = `react-${componentName}`;
  try {
    await execFileAsync('pnpm', ['nx', 'build', projectName], {
      cwd: workspaceRoot,
    });
    await execFileAsync('pnpm', ['nx', 'test', projectName, '--', '--run'], {
      cwd: workspaceRoot,
    });
    return { success: true, errorLog: '' };
  } catch (err) {
    const lines: string[] = [err instanceof Error ? err.message : String(err)];
    const execErr = err as { stderr?: string; stdout?: string };
    if (execErr.stderr) lines.push(`stderr:\n${execErr.stderr}`);
    if (execErr.stdout) lines.push(`stdout:\n${execErr.stdout}`);
    return { success: false, errorLog: lines.join('\n\n') };
  }
}

/**
 * Infrastructure-only auto-fix: re-runs Panda CSS codegen to refresh styled-system/.
 * Does NOT patch generated source files.
 */
export async function attemptAutoFix(
  workspaceRoot: string,
  _componentName: string,
  _errorLog: string,
): Promise<{ success: boolean; errorLog: string }> {
  try {
    await execFileAsync('pnpm', ['exec', 'panda', 'codegen'], {
      cwd: workspaceRoot,
    });
    return { success: true, errorLog: '' };
  } catch (err) {
    const lines: string[] = [err instanceof Error ? err.message : String(err)];
    const execErr = err as { stderr?: string; stdout?: string };
    if (execErr.stderr) lines.push(`stderr:\n${execErr.stderr}`);
    if (execErr.stdout) lines.push(`stdout:\n${execErr.stdout}`);
    return { success: false, errorLog: lines.join('\n\n') };
  }
}

// ── Main Node Factory ─────────────────────────────────────────────────────────

/**
 * Creates the dev persona node function for component boilerplate generation.
 *
 * Flow:
 * 1. Validate component_name in metadata — REJECTED if missing
 * 2. Introspect golden sample — REJECTED if files absent
 * 3. Resolve HTML tag via ark-ui-reference.json
 * 4. Run Nx generator
 * 5. Write component, recipe, stories, and CT test files
 * 6. Run build + test — APPROVED if successful
 * 7. Attempt Panda codegen auto-fix — APPROVED if subsequent build passes
 * 8. Escalate to human_review with pause_context: 'mesh_stalemate' if auto-fix fails
 */
export function createDevBoilerplateNode(config: DevNodeConfig): AgentNodeFn {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const componentName = state.metadata?.['component_name'] as
      | string
      | undefined;

    if (!componentName) {
      return {
        messages: [
          makeMessage(
            'Component generation skipped: no component_name in metadata.\n\nREJECTED: missing component_name',
          ),
        ],
      };
    }

    // Validate componentName to prevent path traversal from untrusted metadata.
    const nameError = validateComponentName(
      componentName,
      config.workspaceRoot,
    );
    if (nameError) {
      return {
        messages: [makeMessage(nameError)],
      };
    }

    // Normalize slots — root and label are always required by the component template.
    const slots = Array.from(new Set(['root', 'label', ...state.parts]));

    // Validate that each slot name is a plain JS identifier (no hyphens or special chars).
    // Slot names are used as unquoted object keys and dot-notation accessors in generated code.
    const SLOT_NAME_RE = /^[a-z][a-z0-9]*$/;
    const invalidSlot = slots.find((s) => !SLOT_NAME_RE.test(s));
    if (invalidSlot) {
      return {
        messages: [
          makeMessage(
            `REJECTED: slot name '${invalidSlot}' is not a valid identifier. ` +
              `Parts must match ^[a-z][a-z0-9]*$`,
          ),
        ],
      };
    }

    // 1. Validate golden sample
    let patterns: GoldenSamplePatterns;
    try {
      patterns = await introspectGoldenSample(
        config.workspaceRoot,
        config.goldenSamplePath,
      );
    } catch (err) {
      const reason =
        err instanceof Error ? err.message : 'golden sample incomplete';
      const message = reason.startsWith('REJECTED:')
        ? reason
        : `REJECTED: ${reason}`;
      return {
        messages: [makeMessage(message)],
      };
    }

    const { variants } = patterns;

    // 2. Resolve HTML tag
    const arkRefPath = path.join(
      config.workspaceRoot,
      'docs',
      'ark-ui-reference.json',
    );
    const tagName = await resolveHtmlTag(componentName, arkRefPath);

    // 3. Run Nx generator
    try {
      await runNxGenerator(config.workspaceRoot, componentName);
    } catch (err) {
      const errorLog = err instanceof Error ? err.message : String(err);
      return {
        messages: [
          makeMessage(`Nx generator failed.\n\nREJECTED: ${errorLog}`),
        ],
      };
    }

    // 4. Write boilerplate files
    const dir = path.join(
      config.workspaceRoot,
      'libs',
      'react',
      componentName,
      'src',
      'lib',
    );
    // Build a reviewable text summary for downstream personas (a11y/qa/docs).
    // code_buffer carries content that agents can inspect, not a filesystem path.
    const codeBuffer = [
      `Generated component: \`${componentName}\``,
      ``,
      `Files created:`,
      `- libs/react/${componentName}/src/lib/${componentName}.tsx`,
      `- libs/react/${componentName}/src/lib/${componentName}.recipe.ts`,
      `- libs/react/${componentName}/src/lib/${componentName}.stories.tsx`,
      `- libs/react/${componentName}/src/lib/${componentName}.ct.tsx`,
      ``,
      `Slots: ${slots.join(', ')}`,
      `Variants: ${variants.join(', ')}`,
      `HTML tag: ${tagName}`,
    ].join('\n');
    try {
      await writeComponentFile(dir, componentName, tagName, slots);
      await writeRecipeFile(dir, componentName, slots, variants);
      await writeStoriesFile(dir, componentName, variants);
      await writeComponentTestFile(dir, componentName);
    } catch (err) {
      const errorLog = err instanceof Error ? err.message : String(err);
      return {
        messages: [makeMessage(`File write failed.\n\nREJECTED: ${errorLog}`)],
      };
    }

    // 5. Build + test
    const buildResult = await runBuildAndTest(
      config.workspaceRoot,
      componentName,
    );
    if (buildResult.success) {
      return {
        code_buffer: codeBuffer,
        messages: [
          makeMessage(
            `Component \`${componentName}\` generated and verified.\n\nAPPROVED`,
          ),
        ],
      };
    }

    // 6. Auto-fix (Panda codegen only)
    const fixResult = await attemptAutoFix(
      config.workspaceRoot,
      componentName,
      buildResult.errorLog,
    );
    if (fixResult.success) {
      const retryResult = await runBuildAndTest(
        config.workspaceRoot,
        componentName,
      );
      if (retryResult.success) {
        return {
          code_buffer: codeBuffer,
          messages: [
            makeMessage(
              `Component \`${componentName}\` generated and verified after auto-fix.\n\nAPPROVED`,
            ),
          ],
        };
      }
      // Auto-fix ran but retry still failed — use retry's error log for escalation
      return escalate(componentName, retryResult.errorLog);
    }

    // 7. Escalate: auto-fix itself failed
    return escalate(componentName, buildResult.errorLog);
  };
}

// ── Private Helpers ───────────────────────────────────────────────────────────

const COMPONENT_NAME_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Validates componentName to prevent path traversal from untrusted metadata.
 * Returns an error string (starting with 'REJECTED:') if invalid, null if valid.
 */
function validateComponentName(
  componentName: string,
  workspaceRoot: string,
): string | null {
  if (!COMPONENT_NAME_RE.test(componentName)) {
    return 'REJECTED: component_name must match ^[a-z][a-z0-9-]*$';
  }
  const resolvedDir = path.resolve(
    workspaceRoot,
    'libs',
    'react',
    componentName,
  );
  const expectedPrefix =
    path.resolve(workspaceRoot, 'libs', 'react') + path.sep;
  if (!resolvedDir.startsWith(expectedPrefix)) {
    return 'REJECTED: component_name would resolve outside libs/react';
  }
  return null;
}

function escalate(
  componentName: string,
  errorLog: string,
): Partial<AgentState> {
  // Do NOT end with REJECTED/APPROVED — the refinement wrapper parses those
  // markers and would override next_recipient. A neutral message lets the
  // wrapper return PENDING and pass through the explicit next_recipient.
  return {
    next_recipient: 'human_review',
    pause_context: 'mesh_stalemate',
    mesh_origin: 'dev',
    messages: [
      makeMessage(
        `Component \`${componentName}\` generation failed after auto-fix attempt.\n\n` +
          `Build errors could not be resolved automatically.\n\n` +
          `Error:\n${errorLog}\n\n` +
          `STALEMATE: escalating to human review`,
      ),
    ],
  };
}

function toPascal(name: string): string {
  return name
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** Returns a camelCase identifier from a kebab/snake-case component name. */
function toCamel(name: string): string {
  const parts = name.split(/[-_]/);
  return (
    (parts[0] ?? '') +
    parts
      .slice(1)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join('')
  );
}

function makeMessage(content: string): SerializedMessage {
  return { type: 'ai', content };
}
