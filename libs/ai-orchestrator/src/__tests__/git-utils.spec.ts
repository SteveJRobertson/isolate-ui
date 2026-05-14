import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  type MockedFunction,
} from 'vitest';

// ── Module mocks (hoisted before imports) ────────────────────────────────────

vi.mock('child_process', () => {
  const mockExecFile = vi.fn();
  return {
    execFile: mockExecFile,
  };
});

vi.mock('util', () => ({
  promisify: vi.fn((fn: unknown) => fn),
}));

vi.mock('fs', () => {
  const mockMkdtemp = vi.fn();
  const mockRmdir = vi.fn();
  const mockUnlink = vi.fn();
  const mockWriteFile = vi.fn();
  const mockReadFile = vi.fn();
  return {
    promises: {
      mkdtemp: mockMkdtemp,
      rmdir: mockRmdir,
      unlink: mockUnlink,
      writeFile: mockWriteFile,
      readFile: mockReadFile,
    },
  };
});

vi.mock('os', () => {
  const mockTmpdir = vi.fn();
  return {
    tmpdir: mockTmpdir,
  };
});

// ── Imports under test (after mocks) ─────────────────────────────────────────

import { execFile } from 'child_process';
import * as fsModule from 'fs';
import * as osModule from 'os';
import { applyCodeBuffer } from '../orchestrator/git-utils';

// ── Type definitions and helpers ───────────────────────────────────────────────

interface ExecFileException extends Error {
  message: string;
  stderr?: string;
  stdout?: string;
  code?: string | number;
}

const mockExecFile = execFile as unknown as MockedFunction<
  (cmd: string, args: string[], opts: object) => Promise<void>
>;
const mockMkdtemp = fsModule.promises.mkdtemp as unknown as MockedFunction<
  (prefix: string) => Promise<string>
>;
const mockRmdir = fsModule.promises.rmdir as unknown as MockedFunction<
  (path: string) => Promise<void>
>;
const mockUnlink = fsModule.promises.unlink as unknown as MockedFunction<
  (path: string) => Promise<void>
>;
const mockWriteFile = fsModule.promises.writeFile as unknown as MockedFunction<
  (path: string, data: string, encoding: string) => Promise<void>
>;
const mockReadFile = fsModule.promises.readFile as unknown as MockedFunction<
  (path: string, encoding: string) => Promise<string>
>;
const mockTmpdir = osModule.tmpdir as unknown as MockedFunction<() => string>;

// ── Test suite ─────────────────────────────────────────────────────────────

describe('applyCodeBuffer', () => {
  const WORKSPACE = '/test-workspace';
  const TEMP_DIR = '/tmp/isolate-mesh-abc123';
  const PATCH_FILE = `${TEMP_DIR}/patch.diff`;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTmpdir.mockReturnValue('/tmp');
    mockMkdtemp.mockResolvedValue(TEMP_DIR);
    mockWriteFile.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    mockRmdir.mockResolvedValue(undefined);
    mockReadFile.mockReset();
  });

  describe('empty code buffer', () => {
    it('returns success with cleared buffer when code buffer is empty', async () => {
      const result = await applyCodeBuffer('', WORKSPACE);

      expect(result.success).toBe(true);
      expect((result as any).code_buffer).toBe('');
      expect(mockMkdtemp).not.toHaveBeenCalled();
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it('returns success with cleared buffer when code buffer is whitespace only', async () => {
      const result = await applyCodeBuffer('   \n\t  ', WORKSPACE);

      expect(result.success).toBe(true);
      expect((result as any).code_buffer).toBe('');
      expect(mockMkdtemp).not.toHaveBeenCalled();
      expect(mockExecFile).not.toHaveBeenCalled();
    });
  });

  describe('successful apply', () => {
    it('applies a valid patch and returns success', async () => {
      const patch = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 const x = 1;
-const y = 2;
+const y = 3;
 const z = 4;`;

      mockExecFile.mockResolvedValueOnce(undefined);

      const result = await applyCodeBuffer(patch, WORKSPACE);

      expect(result.success).toBe(true);
      expect((result as any).code_buffer).toBe('');
      expect(mockMkdtemp).toHaveBeenCalledWith('/tmp/isolate-mesh-');
      expect(mockWriteFile).toHaveBeenCalledWith(PATCH_FILE, patch, 'utf8');
      expect(mockExecFile).toHaveBeenCalledWith('git', ['apply', PATCH_FILE], {
        cwd: WORKSPACE,
      });
    });

    it('cleans up temp files on success', async () => {
      const patch = 'diff content';
      mockExecFile.mockResolvedValueOnce(undefined);

      await applyCodeBuffer(patch, WORKSPACE);

      expect(mockUnlink).toHaveBeenCalledWith(PATCH_FILE);
      expect(mockRmdir).toHaveBeenCalledWith(TEMP_DIR);
    });
  });

  describe('git apply failure with stderr', () => {
    it('includes stderr in error message when git apply fails with diagnostics', async () => {
      const patch = 'invalid patch content';
      const gitStderr =
        'error: patch does not apply\nerror: cannot apply to file.ts';

      const execErr: ExecFileException = new Error('Command failed');
      execErr.stderr = gitStderr;
      mockExecFile.mockRejectedValueOnce(execErr as never);

      mockReadFile.mockResolvedValue('current file content');

      const result = await applyCodeBuffer(patch, WORKSPACE);

      expect(result.success).toBe(false);
      expect(result.error).toBe(gitStderr);
    });

    it('trims trailing newlines from stderr', async () => {
      const patch = 'invalid patch';
      const gitStderr = 'error: patch does not apply\n\n';

      const execErr: ExecFileException = new Error('Command failed');
      execErr.stderr = gitStderr;
      mockExecFile.mockRejectedValueOnce(execErr as never);

      mockReadFile.mockResolvedValue('file content');

      const result = await applyCodeBuffer(patch, WORKSPACE);

      expect(result.success).toBe(false);
      expect(result.error).toBe('error: patch does not apply');
    });

    it('captures file snapshots when apply fails with stderr', async () => {
      const patch = `--- a/src/file.ts
+++ b/src/file.ts
@@ -1 +1 @@
-old
+new`;

      const execErr: ExecFileException = new Error('apply failed');
      execErr.stderr = 'error: patch does not apply';
      mockExecFile.mockRejectedValueOnce(execErr as never);

      mockReadFile.mockResolvedValue('file snapshot content');

      const result = await applyCodeBuffer(patch, WORKSPACE);

      expect(result.success).toBe(false);
      expect(result.file_snapshots).toEqual({
        'src/file.ts': 'file snapshot content',
      });
      expect(mockReadFile).toHaveBeenCalledWith(
        '/test-workspace/src/file.ts',
        'utf8',
      );
    });
  });

  describe('git apply failure without stderr (fallback to message)', () => {
    it('falls back to err.message when stderr is empty', async () => {
      const patch = 'patch content';
      const errMessage = 'git apply failed';

      const execErr: ExecFileException = new Error(errMessage);
      execErr.stderr = '';
      mockExecFile.mockRejectedValueOnce(execErr as never);

      mockReadFile.mockResolvedValue('snapshot');

      const result = await applyCodeBuffer(patch, WORKSPACE);

      expect(result.success).toBe(false);
      expect(result.error).toBe(errMessage);
    });

    it('falls back to err.message when stderr is undefined', async () => {
      const patch = 'patch content';
      const errMessage = 'Command failed';

      const execErr: ExecFileException = new Error(errMessage);
      // stderr is undefined
      mockExecFile.mockRejectedValueOnce(execErr as never);

      mockReadFile.mockResolvedValue('snapshot');

      const result = await applyCodeBuffer(patch, WORKSPACE);

      expect(result.success).toBe(false);
      expect(result.error).toBe(errMessage);
    });

    it('falls back to String(err) when err is not an Error instance', async () => {
      const patch = 'patch content';

      mockExecFile.mockRejectedValueOnce('string error' as never);

      mockReadFile.mockResolvedValue('snapshot');

      const result = await applyCodeBuffer(patch, WORKSPACE);

      expect(result.success).toBe(false);
      expect(result.error).toBe('string error');
    });
  });

  describe('file snapshot capture', () => {
    it('parses --- and +++ headers to identify affected files', async () => {
      const patch = `--- a/src/button.ts
+++ b/src/button.ts
@@ -1 +1 @@
-old
+new
--- a/src/styles.ts
+++ b/src/styles.ts
@@ -2 +2 @@
-old style
+new style`;

      const execErr: ExecFileException = new Error('apply failed');
      execErr.stderr = 'failed';
      mockExecFile.mockRejectedValueOnce(execErr as never);

      mockReadFile
        .mockResolvedValueOnce('button content')
        .mockResolvedValueOnce('styles content');

      const result = await applyCodeBuffer(patch, WORKSPACE);

      expect(result.success).toBe(false);
      expect(result.file_snapshots).toEqual({
        'src/button.ts': 'button content',
        'src/styles.ts': 'styles content',
      });
    });

    it('skips /dev/null paths (deleted files)', async () => {
      const patch = `--- a/deleted.ts
+++ /dev/null
@@ -1 +0 @@
-deleted`;

      const execErr: ExecFileException = new Error('failed');
      execErr.stderr = 'error';
      mockExecFile.mockRejectedValueOnce(execErr as never);

      const result = await applyCodeBuffer(patch, WORKSPACE);

      expect(result.success).toBe(false);
      expect(result.file_snapshots).toEqual({});
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it('silently skips files that do not exist on disk', async () => {
      const patch = `--- a/missing.ts
+++ b/missing.ts
@@ -1 +1 @@
-old
+new`;

      const execErr: ExecFileException = new Error('failed');
      execErr.stderr = 'error';
      mockExecFile.mockRejectedValueOnce(execErr as never);

      mockReadFile.mockRejectedValueOnce(new Error('ENOENT') as never);

      const result = await applyCodeBuffer(patch, WORKSPACE);

      expect(result.success).toBe(false);
      expect(result.file_snapshots).toEqual({});
    });

    it('handles duplicate paths in diff by capturing only once', async () => {
      const patch = `--- a/file.ts
+++ b/file.ts
@@ -1 +1 @@
-old
+new
--- a/file.ts
+++ b/file.ts
@@ -2 +2 @@
-old2
+new2`;

      const execErr: ExecFileException = new Error('failed');
      execErr.stderr = 'error';
      mockExecFile.mockRejectedValueOnce(execErr as never);

      mockReadFile.mockResolvedValueOnce('snapshot content');

      const result = await applyCodeBuffer(patch, WORKSPACE);

      expect(result.success).toBe(false);
      expect(result.file_snapshots).toEqual({
        'file.ts': 'snapshot content',
      });
      expect(mockReadFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('cleanup behavior', () => {
    it('cleans up temp files even when apply fails', async () => {
      const patch = 'patch';
      const execErr: ExecFileException = new Error('failed');
      execErr.stderr = 'error';
      mockExecFile.mockRejectedValueOnce(execErr as never);

      mockReadFile.mockResolvedValue('snapshot');

      await applyCodeBuffer(patch, WORKSPACE);

      expect(mockUnlink).toHaveBeenCalledWith(PATCH_FILE);
      expect(mockRmdir).toHaveBeenCalledWith(TEMP_DIR);
    });

    it('cleans up even when writeFile fails', async () => {
      const patch = `--- a/file.ts
+++ b/file.ts
@@ -1 +1 @@
-old
+new`;
      mockWriteFile.mockRejectedValueOnce(new Error('write failed') as never);

      mockReadFile.mockResolvedValueOnce('snapshot');

      const result = await applyCodeBuffer(patch, WORKSPACE);

      // writeFile failure is caught and results in an error response, not a throw
      expect(result.success).toBe(false);
      expect(result.error).toBe('write failed');
      // Cleanup should still attempt
      expect(mockUnlink).toHaveBeenCalled();
      expect(mockRmdir).toHaveBeenCalled();
    });

    it('ignores cleanup errors when unlink fails', async () => {
      const patch = 'patch';
      mockExecFile.mockResolvedValueOnce(undefined);
      mockUnlink.mockRejectedValueOnce(new Error('unlink failed') as never);

      const result = await applyCodeBuffer(patch, WORKSPACE);

      expect(result.success).toBe(true);
      expect(mockRmdir).toHaveBeenCalled();
    });

    it('ignores cleanup errors when rmdir fails', async () => {
      const patch = 'patch';
      mockExecFile.mockResolvedValueOnce(undefined);
      mockRmdir.mockRejectedValueOnce(new Error('rmdir failed') as never);

      const result = await applyCodeBuffer(patch, WORKSPACE);

      expect(result.success).toBe(true);
    });
  });
});
