import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Walk up from startDir until a directory containing nx.json is found.
 * Used to resolve the workspace root for the default database path.
 */
function findWorkspaceRoot(startDir: string): string {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'nx.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error(
    `Could not locate workspace root (no nx.json found). Started from: ${startDir}`,
  );
}

/**
 * Redact sensitive values in error messages.
 * Shows only first 4 chars + *** to avoid exposing secrets in logs.
 */
function redactSecret(value: string): string {
  if (!value || value.length <= 4) {
    return '***';
  }
  return `${value.slice(0, 4)}***`;
}

/**
 * Resolve the absolute database path.
 * If DATABASE_PATH is set, use it as-is.
 * Otherwise, walk up to find workspace root and use the default path.
 */
function resolveAbsoluteDatabasePath(): string {
  if (process.env['DATABASE_PATH']) {
    return process.env['DATABASE_PATH'];
  }

  const workspaceRoot = findWorkspaceRoot(__dirname);
  return path.join(
    workspaceRoot,
    'libs',
    'ai-orchestrator',
    'data',
    'state.db',
  );
}

/**
 * Zod schema for webhook-listener environment variables.
 * Separates required vars from optional vars with sensible defaults.
 * Validates conditional groups (GitHub App auth: all-or-nothing).
 */
const envSchema = z
  .object({
    // Required
    GITHUB_TOKEN: z.string().min(1, 'GITHUB_TOKEN is required'),
    WEBHOOK_SECRET: z
      .string()
      .min(32, 'WEBHOOK_SECRET must be at least 32 characters'),

    // Optional with defaults
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().default(8080),
    GITHUB_OWNER: z.string().default('SteveJRobertson'),
    GITHUB_REPO: z.string().default('isolate-ui'),
    STARTUP_SYNC_WINDOW_MS: z.coerce.number().default(3600000), // 1 hour

    // GitHub App authentication (optional, all-or-nothing)
    GITHUB_APP_ID: z.string().optional(),
    GITHUB_APP_PRIVATE_KEY_PATH: z.string().optional(),
    GITHUB_APP_INSTALLATION_ID: z.string().optional(),

    // LLM keys (optional, lazy validation)
    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
  })
  .refine(
    (data) => {
      const appIdSet = !!data.GITHUB_APP_ID;
      const keyPathSet = !!data.GITHUB_APP_PRIVATE_KEY_PATH;
      const installationIdSet = !!data.GITHUB_APP_INSTALLATION_ID;

      // All three must be set together, or all three must be absent
      const allSet = appIdSet && keyPathSet && installationIdSet;
      const noneSet = !appIdSet && !keyPathSet && !installationIdSet;

      return allSet || noneSet;
    },
    {
      message:
        'GitHub App authentication requires all three vars: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_PATH, and GITHUB_APP_INSTALLATION_ID. Either set all three or set none (fallback to GITHUB_TOKEN).',
      path: ['GITHUB_APP_ID'],
    },
  );

export type ValidatedEnv = z.infer<typeof envSchema> & {
  resolvedDatabasePath: string;
};

/**
 * Validate all environment variables at startup.
 * Returns a typed ValidatedEnv object with all resolved values.
 * Throws an error with a clear, redacted message if validation fails.
 */
export function validateEnv(): ValidatedEnv {
  try {
    // Parse and validate all env vars against schema
    const parsed = envSchema.parse(process.env);

    // Resolve absolute database path (either from env var or workspace walk-up)
    const resolvedDatabasePath = resolveAbsoluteDatabasePath();

    return {
      ...parsed,
      resolvedDatabasePath,
    };
  } catch (err) {
    // If Zod validation error, format a clear message with redacted secrets
    if (err instanceof z.ZodError) {
      const issues = err.issues
        .map((issue) => {
          const path = issue.path.join('.');
          const currentValue = process.env[path];

          if (
            path === 'GITHUB_TOKEN' ||
            path === 'WEBHOOK_SECRET' ||
            path === 'GITHUB_APP_PRIVATE_KEY_PATH'
          ) {
            // Redact sensitive values
            const redacted = currentValue
              ? redactSecret(currentValue)
              : '(not set)';
            return `${path}: ${issue.message} [current: ${redacted}]`;
          }

          return `${path}: ${issue.message}`;
        })
        .join('\n  ');

      const message = `[webhook-listener] Environment validation failed:\n  ${issues}`;
      console.error(message);
      throw new Error(message);
    }

    // If workspace root lookup failed or other error
    console.error(
      '[webhook-listener] Unexpected error during env validation:',
      err,
    );
    throw err;
  }
}
