import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { validateAgentsConfig, findWorkspaceRoot } from '../config';

// The workspace root — confirmed to contain nx.json
const WORKSPACE_ROOT = findWorkspaceRoot(process.cwd());
const REAL_AGENTS_MD = path.join(WORKSPACE_ROOT, 'AGENTS.md');

describe('findWorkspaceRoot', () => {
  it('finds the workspace root from the project cwd', () => {
    const root = findWorkspaceRoot(process.cwd());
    expect(fs.existsSync(path.join(root, 'nx.json'))).toBe(true);
  });

  it('returns the same root regardless of the start directory', () => {
    const fromSrc = findWorkspaceRoot(
      path.join(WORKSPACE_ROOT, 'libs', 'ai-orchestrator', 'src'),
    );
    expect(fromSrc).toBe(WORKSPACE_ROOT);
  });

  it('throws if no nx.json can be found', () => {
    // Create a fresh isolated temp dir with no nx.json anywhere above it
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-nx-'));
    try {
      expect(() => findWorkspaceRoot(tmpDir)).toThrow(
        'Could not locate workspace root',
      );
    } finally {
      fs.rmdirSync(tmpDir);
    }
  });
});

describe('validateAgentsConfig', () => {
  it('parses the real AGENTS.md and returns all 6 personas', () => {
    const config = validateAgentsConfig(REAL_AGENTS_MD);
    const ids = Object.keys(config.personas);
    expect(ids).toContain('po');
    expect(ids).toContain('architect');
    expect(ids).toContain('dev');
    expect(ids).toContain('a11y');
    expect(ids).toContain('qa');
    expect(ids).toContain('docs');
  });

  it('returns the source file path and a validatedAt timestamp', () => {
    const config = validateAgentsConfig(REAL_AGENTS_MD);
    expect(config.sourceFile).toBe(REAL_AGENTS_MD);
    expect(config.validatedAt).toBeInstanceOf(Date);
  });

  it('throws when AGENTS.md does not exist at the given path', () => {
    expect(() => validateAgentsConfig('/nonexistent/path/AGENTS.md')).toThrow(
      'AGENTS.md not found at: /nonexistent/path/AGENTS.md',
    );
  });

  it('throws when AGENTS.md is missing required personas', () => {
    const tmpFile = path.join(os.tmpdir(), `agents-test-${Date.now()}.md`);
    // Write a file that mentions only some personas
    fs.writeFileSync(
      tmpFile,
      `# Test\n@isolate-po is mentioned\n@isolate-architect is mentioned\n`,
    );

    try {
      expect(() => validateAgentsConfig(tmpFile)).toThrow(
        'AGENTS.md is missing required persona definitions',
      );
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('passes when a custom AGENTS.md mentions all 6 required personas', () => {
    const tmpFile = path.join(os.tmpdir(), `agents-full-${Date.now()}.md`);
    fs.writeFileSync(
      tmpFile,
      [
        '# Agent Docs',
        '### @isolate-po',
        '### @isolate-architect',
        '### @isolate-dev',
        '### @isolate-a11y',
        '### @isolate-qa',
        '### @isolate-docs',
      ].join('\n'),
    );

    try {
      const config = validateAgentsConfig(tmpFile);
      expect(Object.keys(config.personas)).toHaveLength(6);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('error message lists all missing persona names', () => {
    const tmpFile = path.join(os.tmpdir(), `agents-partial-${Date.now()}.md`);
    fs.writeFileSync(tmpFile, `# Minimal\n@isolate-po only\n`);

    try {
      expect(() => validateAgentsConfig(tmpFile)).toThrow('@isolate-architect');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});
