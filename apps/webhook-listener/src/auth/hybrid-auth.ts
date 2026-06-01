import { readFileSync } from 'node:fs';
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';

/**
 * Creates an authenticated Octokit instance using the best available credentials.
 *
 * Priority:
 * 1. GitHub App authentication — requires GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_PATH,
 *    and GITHUB_APP_INSTALLATION_ID to all be set.
 * 2. PAT authentication — requires GITHUB_TOKEN to be set.
 *
 * Throws if neither set of credentials is available, or if App credentials are
 * present but invalid (non-integer IDs, unreadable key file).
 */
export async function getAuthenticatedOctokit(): Promise<Octokit> {
  const appId = process.env['GITHUB_APP_ID'];
  const privateKeyPath = process.env['GITHUB_APP_PRIVATE_KEY_PATH'];
  const installationId = process.env['GITHUB_APP_INSTALLATION_ID'];

  // GitHub App credentials must be all-or-nothing (validated at startup by validateEnv).
  // If we reach here with partial credentials, something is very wrong.
  if (appId && privateKeyPath && installationId) {
    const appIdNum = Number(appId);
    if (isNaN(appIdNum) || !Number.isInteger(appIdNum) || appIdNum <= 0) {
      throw new Error(
        `[hybrid-auth] GITHUB_APP_ID must be a positive integer, got: "${appId}"`,
      );
    }

    const installationIdNum = Number(installationId);
    if (
      isNaN(installationIdNum) ||
      !Number.isInteger(installationIdNum) ||
      installationIdNum <= 0
    ) {
      throw new Error(
        `[hybrid-auth] GITHUB_APP_INSTALLATION_ID must be a positive integer, got: "${installationId}"`,
      );
    }

    let privateKey: string;
    try {
      privateKey = readFileSync(privateKeyPath, 'utf8');
    } catch (err) {
      throw new Error(
        `[hybrid-auth] Failed to read GitHub App private key file at "${privateKeyPath}": ${String(err)}`,
      );
    }

    console.log('[hybrid-auth] Using GitHub App authentication');
    return new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: appIdNum,
        privateKey,
        installationId: installationIdNum,
      },
    });
  }

  // Fallback to GITHUB_TOKEN (guaranteed to be set by startup validation).
  const token = process.env['GITHUB_TOKEN']!;
  console.log('[hybrid-auth] Using PAT (GitHub Token) authentication');
  return new Octokit({ auth: token });
}
