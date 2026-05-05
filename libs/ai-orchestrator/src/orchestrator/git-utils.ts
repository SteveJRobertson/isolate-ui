import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

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
 * Security note: the diff is written to a temp file and passed as a path
 * argument to `git apply`. The cwd is set explicitly to workspaceRoot so the
 * command cannot be redirected. The diff content itself is treated as data,
 * not as a shell command, so injection via diff content is not possible.
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

  // Write diff to a temp file to avoid shell injection through diff content
  const tmpFile = path.join(
    os.tmpdir(),
    `isolate-mesh-patch-${Date.now()}.diff`,
  );

  try {
    fs.writeFileSync(tmpFile, codeBuffer, 'utf8');

    execFileSync('git', ['apply', tmpFile], {
      cwd: workspaceRoot,
      stdio: 'pipe',
    });

    return { success: true, code_buffer: '' };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Capture file snapshots for paths referenced in the diff as a fallback
    const snapshots = captureFileSnapshots(codeBuffer, workspaceRoot);

    return {
      success: false,
      error: errorMessage,
      file_snapshots: snapshots,
    };
  } finally {
    // Always clean up the temp file
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // Ignore cleanup errors — the OS will reclaim temp files eventually
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
function captureFileSnapshots(
  diff: string,
  workspaceRoot: string,
): Record<string, string> {
  const snapshots: Record<string, string> = {};
  const pathPattern = /^(?:---|\+\+\+) (?:a|b)\/(.+)$/gm;
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = pathPattern.exec(diff)) !== null) {
    const relativePath = match[1];
    if (relativePath === '/dev/null' || seen.has(relativePath)) continue;
    seen.add(relativePath);

    const absPath = path.join(workspaceRoot, relativePath);
    try {
      snapshots[relativePath] = fs.readFileSync(absPath, 'utf8');
    } catch {
      // File doesn't exist or isn't readable — skip silently
    }
  }

  return snapshots;
}
