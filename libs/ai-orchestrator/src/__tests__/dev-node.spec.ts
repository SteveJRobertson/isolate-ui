import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  type MockedFunction,
} from 'vitest';
import { execFile } from 'child_process';
import * as fsPromises from 'fs/promises';

// ── Module mocks (hoisted before imports) ────────────────────────────────────

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('util', () => ({
  promisify: vi.fn((fn: unknown) => fn),
}));

vi.mock('fs/promises', () => ({
  access: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

// ── Imports under test (after mocks) ─────────────────────────────────────────

import {
  resolveHtmlTag,
  introspectGoldenSample,
  runNxGenerator,
  writeComponentFile,
  writeRecipeFile,
  writeStoriesFile,
  writeComponentTestFile,
  runBuildAndTest,
  attemptAutoFix,
  createDevBoilerplateNode,
} from '../orchestrator/dev-node';
import { createDefaultAgentState } from '../schema';

// ── Helpers ───────────────────────────────────────────────────────────────────

const WORKSPACE = '/workspace';
const ARK_REF_PATH = `${WORKSPACE}/docs/ark-ui-reference.json`;

const mockExecFile = execFile as unknown as MockedFunction<
  (
    cmd: string,
    args: string[],
    opts: object,
  ) => Promise<{ stdout: string; stderr: string }>
>;
const mockAccess = fsPromises.access as MockedFunction<
  typeof fsPromises.access
>;
const mockReadFile = fsPromises.readFile as MockedFunction<
  typeof fsPromises.readFile
>;
const mockWriteFile = fsPromises.writeFile as MockedFunction<
  typeof fsPromises.writeFile
>;

function makeArkRef(htmlTag?: string): string {
  return JSON.stringify({
    primitives: {
      button: { name: 'Button', htmlTag: htmlTag ?? 'button' },
    },
  });
}

function makeRecipeContent(): string {
  return `
import { createSlotRecipe } from '@isolate-ui/utils';
export const buttonRecipe = createSlotRecipe({
  slots: ['root', 'label', 'icon', 'spinner'],
  variants: {
    variant: {
      solid: { root: {} },
      outline: { root: {} },
      ghost: { root: {} },
    },
  },
});
`.trim();
}

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    ...createDefaultAgentState(),
    metadata: { component_name: 'checkbox', ...overrides },
  };
}

// ── resolveHtmlTag ────────────────────────────────────────────────────────────

describe('resolveHtmlTag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns htmlTag from ark-ui-reference.json when entry exists', async () => {
    mockReadFile.mockResolvedValueOnce(makeArkRef('button') as never);
    const tag = await resolveHtmlTag('button', ARK_REF_PATH);
    expect(tag).toBe('button');
  });

  it('returns componentName when it is a valid HTML tag and no ref entry', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ primitives: {} }) as never,
    );
    const tag = await resolveHtmlTag('nav', ARK_REF_PATH);
    expect(tag).toBe('nav');
  });

  it('falls back to div when componentName is not a valid HTML tag and no ref entry', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ primitives: {} }) as never,
    );
    const tag = await resolveHtmlTag('datepicker', ARK_REF_PATH);
    expect(tag).toBe('div');
  });

  it('falls back to div when ark-ui-reference.json read fails', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT') as never);
    const tag = await resolveHtmlTag('datepicker', ARK_REF_PATH);
    expect(tag).toBe('div');
  });

  it('falls back to div when ark-ui-reference.json contains invalid JSON', async () => {
    mockReadFile.mockResolvedValueOnce('not valid json' as never);
    const tag = await resolveHtmlTag('datepicker', ARK_REF_PATH);
    expect(tag).toBe('div');
  });

  it('falls back to next strategy when htmlTag in JSON is not a valid HTML element', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        primitives: { widget: { htmlTag: 'not-an-html-tag' } },
      }) as never,
    );
    // 'widget' is also not a valid HTML tag, so falls back to 'div'
    const tag = await resolveHtmlTag('widget', ARK_REF_PATH);
    expect(tag).toBe('div');
  });

  it('normalises htmlTag from JSON to lowercase', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        primitives: { button: { htmlTag: 'BUTTON' } },
      }) as never,
    );
    const tag = await resolveHtmlTag('button', ARK_REF_PATH);
    expect(tag).toBe('button');
  });
});

// ── introspectGoldenSample ────────────────────────────────────────────────────

describe('introspectGoldenSample', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns slot and variant names when all files are present', async () => {
    mockAccess.mockResolvedValue(undefined as never);
    mockReadFile.mockResolvedValueOnce(makeRecipeContent() as never);

    const patterns = await introspectGoldenSample(WORKSPACE);

    expect(patterns.slots).toEqual(['root', 'label', 'icon', 'spinner']);
    expect(patterns.variants).toEqual(['solid', 'outline', 'ghost']);
  });

  it('throws REJECTED: golden sample incomplete when a file is missing', async () => {
    mockAccess.mockRejectedValueOnce(new Error('ENOENT') as never);

    await expect(introspectGoldenSample(WORKSPACE)).rejects.toThrow(
      'REJECTED: golden sample incomplete',
    );
  });

  it('uses default slots when recipe has no slots array', async () => {
    mockAccess.mockResolvedValue(undefined as never);
    mockReadFile.mockResolvedValueOnce(
      'export const r = createSlotRecipe({});' as never,
    );

    const patterns = await introspectGoldenSample(WORKSPACE);
    expect(patterns.slots).toEqual(['root', 'label']);
  });

  it('uses default variants when recipe has no variant block', async () => {
    mockAccess.mockResolvedValue(undefined as never);
    mockReadFile.mockResolvedValueOnce(
      "import { createSlotRecipe } from '@isolate-ui/utils';\nexport const r = createSlotRecipe({ slots: ['root'] });" as never,
    );

    const patterns = await introspectGoldenSample(WORKSPACE);
    expect(patterns.variants).toEqual(['solid', 'outline', 'ghost']);
  });

  it('derives projectJson path from goldenSamplePath override', async () => {
    const customPath = '/custom/workspace/libs/react/custom/src/lib';
    mockAccess.mockResolvedValue(undefined as never);
    mockReadFile.mockResolvedValueOnce(makeRecipeContent() as never);

    await introspectGoldenSample(WORKSPACE, customPath);

    // project.json should be resolved two levels up from src/lib: custom/project.json
    expect(mockAccess).toHaveBeenCalledWith(
      expect.stringContaining('custom/project.json'),
    );
  });
});

// ── runNxGenerator ────────────────────────────────────────────────────────────

describe('runNxGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls execFileAsync with the correct mandatory flags', async () => {
    mockExecFile.mockResolvedValueOnce({ stdout: 'ok', stderr: '' } as never);

    await runNxGenerator(WORKSPACE, 'checkbox');

    expect(mockExecFile).toHaveBeenCalledWith(
      'pnpm',
      expect.arrayContaining([
        '--publishable',
        '--importPath=@isolate-ui/checkbox',
        '--directory=libs/react/checkbox',
      ]),
      expect.objectContaining({ cwd: WORKSPACE }),
    );
  });

  it('rejects when execFile rejects', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('generator failed') as never);
    await expect(runNxGenerator(WORKSPACE, 'checkbox')).rejects.toThrow(
      'generator failed',
    );
  });
});

// ── writeComponentFile ────────────────────────────────────────────────────────

describe('writeComponentFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined as never);
  });

  it('writes a file containing HTMLArkProps and ark.<tagName>', async () => {
    await writeComponentFile('/dir', 'checkbox', 'input', ['root', 'label']);

    expect(mockWriteFile).toHaveBeenCalledOnce();
    const [, content] = mockWriteFile.mock.calls[0];
    expect(content).toContain("HTMLArkProps<'input'>");
    expect(content).toContain('ark.input');
  });

  it('uses PascalCase for the component name', async () => {
    await writeComponentFile('/dir', 'my-component', 'div', ['root']);
    const [, content] = mockWriteFile.mock.calls[0];
    expect(content).toContain('MyComponent');
  });

  it('uses camelCase for the recipe identifier (kebab-case input)', async () => {
    await writeComponentFile('/dir', 'my-component', 'div', ['root']);
    const [, content] = mockWriteFile.mock.calls[0];
    expect(content).toContain('myComponentRecipe');
    expect(content).not.toContain('my-componentRecipe');
  });

  it('rejects when writeFile rejects', async () => {
    mockWriteFile.mockRejectedValueOnce(new Error('EACCES') as never);
    await expect(
      writeComponentFile('/dir', 'checkbox', 'input', ['root']),
    ).rejects.toThrow('EACCES');
  });
});

// ── writeRecipeFile ───────────────────────────────────────────────────────────

describe('writeRecipeFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined as never);
  });

  it('writes a file importing createSlotRecipe with the given slots and variants', async () => {
    await writeRecipeFile(
      '/dir',
      'checkbox',
      ['root', 'label'],
      ['solid', 'outline'],
    );

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content).toContain("from '@isolate-ui/utils'");
    expect(content).toContain("'root', 'label'");
    expect(content).toContain('solid');
    expect(content).toContain('outline');
  });

  it('uses camelCase identifier for recipe export (kebab-case name)', async () => {
    await writeRecipeFile('/dir', 'my-component', ['root'], ['solid']);
    const [, content] = mockWriteFile.mock.calls[0];
    expect(content).toContain('export const myComponentRecipe');
    expect(content).not.toContain('my-componentRecipe');
    expect(content).toContain('Parameters<typeof myComponentRecipe>');
  });

  it('rejects when writeFile rejects', async () => {
    mockWriteFile.mockRejectedValueOnce(new Error('disk full') as never);
    await expect(
      writeRecipeFile('/dir', 'checkbox', ['root'], ['solid']),
    ).rejects.toThrow('disk full');
  });
});

// ── writeStoriesFile ──────────────────────────────────────────────────────────

describe('writeStoriesFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined as never);
  });

  it('writes Default and AllVariants CSF 3.0 stories', async () => {
    await writeStoriesFile('/dir', 'checkbox', ['solid', 'outline']);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content).toContain('export const Default');
    expect(content).toContain('export const AllVariants');
    expect(content).toContain('variant="solid"');
    expect(content).toContain('variant="outline"');
  });

  it('rejects when writeFile rejects', async () => {
    mockWriteFile.mockRejectedValueOnce(new Error('EACCES') as never);
    await expect(
      writeStoriesFile('/dir', 'checkbox', ['solid']),
    ).rejects.toThrow('EACCES');
  });
});

// ── writeComponentTestFile ────────────────────────────────────────────────────

describe('writeComponentTestFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined as never);
  });

  it('writes a CT test importing from @isolate-ui/utils/a11y', async () => {
    await writeComponentTestFile('/dir', 'checkbox');

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content).toContain('@isolate-ui/utils/a11y');
    expect(content).toContain('expectToHaveNoA11yViolations');
  });

  it('rejects when writeFile rejects', async () => {
    mockWriteFile.mockRejectedValueOnce(new Error('ENOENT') as never);
    await expect(writeComponentTestFile('/dir', 'checkbox')).rejects.toThrow(
      'ENOENT',
    );
  });
});

// ── runBuildAndTest ───────────────────────────────────────────────────────────

describe('runBuildAndTest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success: true when both build and test pass', async () => {
    mockExecFile
      .mockResolvedValueOnce({ stdout: '', stderr: '' } as never)
      .mockResolvedValueOnce({ stdout: '', stderr: '' } as never);

    const result = await runBuildAndTest(WORKSPACE, 'checkbox');
    expect(result.success).toBe(true);
    expect(result.errorLog).toBe('');
  });

  it('returns success: false with errorLog when build fails', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('build error') as never);

    const result = await runBuildAndTest(WORKSPACE, 'checkbox');
    expect(result.success).toBe(false);
    expect(result.errorLog).toContain('build error');
  });

  it('includes stderr in errorLog when execFile attaches it', async () => {
    const err = Object.assign(new Error('failed'), {
      stderr: 'TS2304: Cannot find name',
    });
    mockExecFile.mockRejectedValueOnce(err as never);

    const result = await runBuildAndTest(WORKSPACE, 'checkbox');
    expect(result.errorLog).toContain('TS2304: Cannot find name');
  });

  it('returns success: false with errorLog when test fails', async () => {
    mockExecFile
      .mockResolvedValueOnce({ stdout: '', stderr: '' } as never)
      .mockRejectedValueOnce(new Error('test failure') as never);

    const result = await runBuildAndTest(WORKSPACE, 'checkbox');
    expect(result.success).toBe(false);
    expect(result.errorLog).toContain('test failure');
  });
});

// ── attemptAutoFix ────────────────────────────────────────────────────────────

describe('attemptAutoFix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success: true when panda codegen succeeds', async () => {
    mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' } as never);

    const result = await attemptAutoFix(WORKSPACE, 'checkbox', 'some error');
    expect(result.success).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'pnpm',
      ['exec', 'panda', 'codegen'],
      expect.objectContaining({ cwd: WORKSPACE }),
    );
  });

  it('returns success: false when panda codegen fails', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('codegen failed') as never);

    const result = await attemptAutoFix(WORKSPACE, 'checkbox', 'build error');
    expect(result.success).toBe(false);
    expect(result.errorLog).toContain('codegen failed');
  });

  it('includes stderr in errorLog when panda codegen attaches it', async () => {
    const err = Object.assign(new Error('panda failed'), {
      stderr: 'Error: missing token',
    });
    mockExecFile.mockRejectedValueOnce(err as never);

    const result = await attemptAutoFix(WORKSPACE, 'checkbox', 'build error');
    expect(result.errorLog).toContain('Error: missing token');
  });
});

// ── createDevBoilerplateNode ──────────────────────────────────────────────────

describe('createDevBoilerplateNode', () => {
  const config = { workspaceRoot: WORKSPACE };

  function setupHappyPath() {
    // introspectGoldenSample: all files accessible + recipe readable
    mockAccess.mockResolvedValue(undefined as never);
    mockReadFile
      .mockResolvedValueOnce(makeRecipeContent() as never) // recipe (introspect)
      .mockResolvedValueOnce(makeArkRef() as never); // ark-ui-reference.json (resolveHtmlTag)
    // runNxGenerator + build + test
    mockExecFile
      .mockResolvedValueOnce({ stdout: '', stderr: '' } as never) // nx generate
      .mockResolvedValueOnce({ stdout: '', stderr: '' } as never) // nx build
      .mockResolvedValueOnce({ stdout: '', stderr: '' } as never); // nx test
    // writeFile calls
    mockWriteFile.mockResolvedValue(undefined as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: returns APPROVED message and sets code_buffer', async () => {
    setupHappyPath();

    const node = createDevBoilerplateNode(config);
    const result = await node(makeState());

    const lastMessage = result.messages?.[result.messages.length - 1];
    expect(lastMessage?.content).toMatch(/APPROVED/);
    expect(result.code_buffer).toContain('Generated component: `checkbox`');
    expect(result.code_buffer).toContain('Slots:');
    expect(result.code_buffer).toContain('Variants:');
  });

  it('build fails, auto-fix succeeds: returns APPROVED after retry', async () => {
    mockAccess.mockResolvedValue(undefined as never);
    mockReadFile
      .mockResolvedValueOnce(makeRecipeContent() as never)
      .mockResolvedValueOnce(makeArkRef() as never);
    mockWriteFile.mockResolvedValue(undefined as never);
    mockExecFile
      .mockResolvedValueOnce({ stdout: '', stderr: '' } as never) // nx generate
      .mockRejectedValueOnce(new Error('build fail') as never) // nx build (first attempt)
      .mockResolvedValueOnce({ stdout: '', stderr: '' } as never) // panda codegen (auto-fix)
      .mockResolvedValueOnce({ stdout: '', stderr: '' } as never) // nx build (retry)
      .mockResolvedValueOnce({ stdout: '', stderr: '' } as never); // nx test (retry)

    const node = createDevBoilerplateNode(config);
    const result = await node(makeState());

    const lastMessage = result.messages?.[result.messages.length - 1];
    expect(lastMessage?.content).toMatch(/APPROVED/);
  });

  it('build fails, auto-fix also fails: escalates to human_review with both error logs', async () => {
    mockAccess.mockResolvedValue(undefined as never);
    mockReadFile
      .mockResolvedValueOnce(makeRecipeContent() as never)
      .mockResolvedValueOnce(makeArkRef() as never);
    mockWriteFile.mockResolvedValue(undefined as never);
    mockExecFile
      .mockResolvedValueOnce({ stdout: '', stderr: '' } as never) // nx generate
      .mockRejectedValueOnce(new Error('build fail') as never) // nx build
      .mockRejectedValueOnce(new Error('panda fail') as never); // panda codegen

    const node = createDevBoilerplateNode(config);
    const result = await node(makeState());

    expect(result.next_recipient).toBe('human_review');
    expect(result.pause_context).toBe('mesh_stalemate');
    expect(result.mesh_origin).toBe('dev');
    // Escalation message must include both the original build error and the codegen error.
    const lastMessage = result.messages?.[result.messages.length - 1];
    expect(lastMessage?.content).toContain('build fail');
    expect(lastMessage?.content).toContain('panda fail');
  });

  it('build fails, auto-fix runs but retry build also fails: escalates to human_review', async () => {
    mockAccess.mockResolvedValue(undefined as never);
    mockReadFile
      .mockResolvedValueOnce(makeRecipeContent() as never)
      .mockResolvedValueOnce(makeArkRef() as never);
    mockWriteFile.mockResolvedValue(undefined as never);
    mockExecFile
      .mockResolvedValueOnce({ stdout: '', stderr: '' } as never) // nx generate
      .mockRejectedValueOnce(new Error('build fail') as never) // nx build (first)
      .mockResolvedValueOnce({ stdout: '', stderr: '' } as never) // panda codegen
      .mockRejectedValueOnce(new Error('retry fail') as never); // nx build (retry)

    const node = createDevBoilerplateNode(config);
    const result = await node(makeState());

    expect(result.next_recipient).toBe('human_review');
    expect(result.pause_context).toBe('mesh_stalemate');
  });

  it('missing component_name: returns REJECTED message', async () => {
    const node = createDevBoilerplateNode(config);
    const state = { ...createDefaultAgentState(), metadata: {} };
    const result = await node(state);

    const lastMessage = result.messages?.[result.messages.length - 1];
    expect(lastMessage?.content).toMatch(/REJECTED: missing component_name/);
    expect(result.next_recipient).toBeUndefined();
  });

  it('invalid component_name format: returns REJECTED', async () => {
    const node = createDevBoilerplateNode(config);
    const result = await node(makeState({ component_name: 'Invalid_Name!' }));

    const lastMessage = result.messages?.[result.messages.length - 1];
    expect(lastMessage?.content).toMatch(/REJECTED: component_name must match/);
    expect(result.next_recipient).toBeUndefined();
  });

  it('path-traversal component_name: returns REJECTED', async () => {
    const node = createDevBoilerplateNode(config);
    const result = await node(makeState({ component_name: '../../../etc' }));

    const lastMessage = result.messages?.[result.messages.length - 1];
    expect(lastMessage?.content).toMatch(/REJECTED:/);
    expect(result.next_recipient).toBeUndefined();
  });

  it('normalizes slots to always include root and label', async () => {
    setupHappyPath();

    const node = createDevBoilerplateNode(config);
    const state = { ...makeState(), parts: ['icon'] };
    const result = await node(state);

    expect(result.code_buffer).toContain('Slots: root, label, icon');
  });

  it('rejects invalid slot name containing hyphen', async () => {
    const node = createDevBoilerplateNode(config);
    const state = { ...makeState(), parts: ['icon-wrapper'] };
    const result = await node(state);

    const lastMessage = result.messages?.[result.messages.length - 1];
    expect(lastMessage?.content).toMatch(/REJECTED: slot name/);
    expect(lastMessage?.content).toContain('icon-wrapper');
  });

  it('escalation message uses STALEMATE not REJECTED to avoid refinement wrapper override', async () => {
    mockAccess.mockResolvedValue(undefined as never);
    mockReadFile
      .mockResolvedValueOnce(makeRecipeContent() as never)
      .mockResolvedValueOnce(makeArkRef() as never);
    mockWriteFile.mockResolvedValue(undefined as never);
    mockExecFile
      .mockResolvedValueOnce({ stdout: '', stderr: '' } as never) // nx generate
      .mockRejectedValueOnce(new Error('build fail') as never) // nx build
      .mockRejectedValueOnce(new Error('panda fail') as never); // panda codegen

    const node = createDevBoilerplateNode(config);
    const result = await node(makeState());

    const lastMessage = result.messages?.[result.messages.length - 1];
    expect(lastMessage?.content).toContain('STALEMATE');
    expect(lastMessage?.content).not.toMatch(/^REJECTED/m);
  });

  it('golden sample missing a file: returns REJECTED message', async () => {
    mockAccess.mockRejectedValueOnce(new Error('ENOENT') as never);
    mockReadFile.mockResolvedValueOnce(makeArkRef() as never);

    const node = createDevBoilerplateNode(config);
    const result = await node(makeState());

    const lastMessage = result.messages?.[result.messages.length - 1];
    expect(lastMessage?.content).toMatch(/REJECTED: golden sample incomplete/);
  });

  it('Nx generator throws: returns REJECTED message', async () => {
    mockAccess.mockResolvedValue(undefined as never);
    mockReadFile
      .mockResolvedValueOnce(makeRecipeContent() as never)
      .mockResolvedValueOnce(makeArkRef() as never);
    mockExecFile.mockRejectedValueOnce(new Error('nx error') as never);

    const node = createDevBoilerplateNode(config);
    const result = await node(makeState());

    const lastMessage = result.messages?.[result.messages.length - 1];
    expect(lastMessage?.content).toMatch(/REJECTED:/);
    expect(lastMessage?.content).toContain('nx error');
  });

  it('does not mutate state directly', async () => {
    setupHappyPath();

    const node = createDevBoilerplateNode(config);
    const state = makeState();
    const originalMessages = state.messages;

    await node(state);

    // state.messages should be unchanged (node returns new array)
    expect(state.messages).toBe(originalMessages);
  });
});
