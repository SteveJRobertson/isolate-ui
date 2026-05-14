import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Successful result from applyCodeBuffer.
 * code_buffer is cleared to prevent duplicate application in future loop steps.
 */
export interface ApplyCodeBufferSuccess {
  success: true;
  /** Always empty string — callers should persist this back into AgentState. */
  code_buffer: '';
}

/**
 * Failed result from applyCodeBuffer.
 * Full file snapshots are captured as a fallback so no work is lost.
 */
export interface ApplyCodeBufferFailure {
  success: false;
  /** The error message from the failed git apply. */
  error: string;
  /**
   * Snapshot of each affected file's content at the time of failure.
   * Keys are workspace-relative paths; values are the file contents.
   * Store this in AgentState.metadata.file_snapshots so the dev agent
   * can retry or the QA agent can inspect the intended changes.
   */
  file_snapshots: Record<string, string>;
}

export type ApplyCodeBufferResult =
  | ApplyCodeBufferSuccess
  | ApplyCodeBufferFailure;

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Apply a git diff stored in code_buffer to the workspace via `git apply`.
 *
 * Lifecycle contract (from issue #20 spec):
 * - On SUCCESS: returns { success: true, code_buffer: '' }
 *   Callers MUST persist code_buffer: '' back into AgentState to prevent
 *   the same patch being applied twice in subsequent loop steps.
 * - On FAILURE: returns { success: false, error, file_snapshots }
 *   Full file content for each path referenced in the diff is captured in
 *   file_snapshots. Callers should store this in metadata.file_snapshots.
 *
 * Usage (inside a dev persona node):
 * ```typescript
 * const result = await applyCodeBuffer(state.code_buffer, workspaceRoot);
 * if (result.success) {
 *   return { code_buffer: result.code_buffer }; // clears the buffer
 * } else {
 *   return { metadata: { ...state.metadata, file_snapshots: result.file_snapshots } };
 * }
 * ```
 *
 * Security note: the diff is written to a file inside a securely created
 * temporary directory (`fs.promises.mkdtemp` with a random suffix). The path
 * is passed as an argument to `execFile` (no shell expansion), so neither the
 * diff content nor the path can inject shell commands.
 *
 * @param codeBuffer    - Git diff string (output of `git diff` or similar)
 * @param workspaceRoot - Absolute path to the workspace root (git repo root)
 */
export async function applyCodeBuffer(
  codeBuffer: string,
  workspaceRoot: string,
): Promise<ApplyCodeBufferResult> {
  if (!codeBuffer.trim()) {
    // Nothing to apply — treat as success and clear the buffer
    return { success: true, code_buffer: '' };
  }

  // Create a secure, randomly-named temp directory to avoid predictable paths
  // and symlink/race attacks on shared tmp directories.
  const tmpDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'isolate-mesh-'),
  );
  const tmpFile = path.join(tmpDir, 'patch.diff');

  try {
    await fs.promises.writeFile(tmpFile, codeBuffer, 'utf8');

    await execFileAsync('git', ['apply', tmpFile], {
      cwd: workspaceRoot,
    });

    return { success: true, code_buffer: '' };
  } catch (err) {
    // Type-narrow to safely access stderr property from ExecFileException
    let errorMessage = '';
    if (err && typeof err === 'object' && 'stderr' in err) {
      const stderrVal = (err as { stderr?: unknown }).stderr;
      if (typeof stderrVal === 'string') {
        errorMessage = stderrVal.trim();
      }
    }
    // Fall back to error message if stderr is unavailable or empty
    if (!errorMessage) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    // Capture file snapshots for paths referenced in the diff as a fallback
    const snapshots = await captureFileSnapshots(codeBuffer, workspaceRoot);

    return {
      success: false,
      error: errorMessage,
      file_snapshots: snapshots,
    };
  } finally {
    // Always clean up the temp directory and its contents
    try {
      await fs.promises.unlink(tmpFile);
    } catch {
      // File may not exist if writeFile failed
    }
    try {
      await fs.promises.rmdir(tmpDir);
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse file paths from a unified diff and capture the current content of each
 * file. Used as a fallback when `git apply` fails.
 *
 * Parses `--- a/<path>` and `+++ b/<path>` headers from the diff. Skips
 * `/dev/null` (new or deleted files with no on-disk counterpart to snapshot).
 * Silently skips files that don't exist on disk.
 *
 * @param diff          - Unified diff string
 * @param workspaceRoot - Absolute path to the workspace root
 * @returns Record mapping workspace-relative paths to current file content
 */
async function captureFileSnapshots(
  diff: string,
  workspaceRoot: string,
): Promise<Record<string, string>> {
  const snapshots: Record<string, string> = {};
  const seen = new Set<string>();

  // Match --- and +++ line pairs, capturing both source and target
  // Pattern: `--- a/<path>` or `--- /dev/null` followed eventually by `+++ b/<path>` or `+++ /dev/null`
  const fileBlockPattern =
    /^---\s+(?:a\/(.+)|\/(dev\/null))\s*\n\+\+\+\s+(?:b\/(.+)|\/(dev\/null))/gm;

  let match: RegExpExecArray | null;
  while ((match = fileBlockPattern.exec(diff)) !== null) {
    // match[1] = path from --- a/<path>
    // match[2] = /dev/null from --- /dev/null
    // match[3] = path from +++ b/<path>
    // match[4] = /dev/null from +++ /dev/null

    const sourcePath = match[1]; // from --- line
    const targetPath = match[3]; // from +++ line
    const sourceIsDevNull = match[2] ? true : false;
    const targetIsDevNull = match[4] ? true : false;

    // Skip files that are being created (+dev/null source) or deleted (+dev/null target)
    if (sourceIsDevNull || targetIsDevNull) continue;

    // Use the path from whichever side is real (should be both for modifications)
    const filePath = sourcePath || targetPath;
    if (!filePath || seen.has(filePath)) continue;

    seen.add(filePath);

    const absPath = path.resolve(workspaceRoot, filePath);
    // Ensure absPath is within workspaceRoot
    if (!absPath.startsWith(path.resolve(workspaceRoot) + path.sep)) {
      continue; // skip paths that escape the workspace
    }
    try {
      snapshots[filePath] = await fs.promises.readFile(absPath, 'utf8');
    } catch {
      // File doesn't exist or isn't readable — skip silently
    }
  }

  return snapshots;
}
