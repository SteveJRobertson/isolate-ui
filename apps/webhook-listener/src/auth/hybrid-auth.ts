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

  // Partial App credentials — some but not all vars set means misconfiguration, not a fallback
  const appVarsDefined = [appId, privateKeyPath, installationId].filter(
    Boolean,
  ).length;
  if (appVarsDefined > 0 && appVarsDefined < 3) {
    const missing = [
      !appId && 'GITHUB_APP_ID',
      !privateKeyPath && 'GITHUB_APP_PRIVATE_KEY_PATH',
      !installationId && 'GITHUB_APP_INSTALLATION_ID',
    ].filter(Boolean);
    throw new Error(
      `[hybrid-auth] Incomplete GitHub App credentials. Missing: ${missing.join(', ')}. ` +
        `Set all three to use App authentication, or unset all to fall back to GITHUB_TOKEN.`,
    );
  }

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

  const token = process.env['GITHUB_TOKEN'];
  if (token) {
    console.log('[hybrid-auth] Using PAT (GitHub Token) authentication');
    return new Octokit({ auth: token });
  }

  throw new Error(
    '[hybrid-auth] No GitHub authentication credentials found. ' +
      'Set GITHUB_TOKEN for PAT authentication, or set GITHUB_APP_ID, ' +
      'GITHUB_APP_PRIVATE_KEY_PATH, and GITHUB_APP_INSTALLATION_ID for GitHub App authentication.',
  );
}
