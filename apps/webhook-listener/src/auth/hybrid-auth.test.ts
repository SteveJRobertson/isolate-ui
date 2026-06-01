import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn() };
});

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({ rest: {} })),
}));

import { getAuthenticatedOctokit } from './hybrid-auth';
import { Octokit } from '@octokit/rest';

const mockReadFileSync = vi.mocked(readFileSync);
const MockOctokit = vi.mocked(Octokit);

const FAKE_PEM =
  '-----BEGIN RSA PRIVATE KEY-----\nfakekey\n-----END RSA PRIVATE KEY-----';

describe('getAuthenticatedOctokit', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      GITHUB_APP_ID: process.env['GITHUB_APP_ID'],
      GITHUB_APP_PRIVATE_KEY_PATH: process.env['GITHUB_APP_PRIVATE_KEY_PATH'],
      GITHUB_APP_INSTALLATION_ID: process.env['GITHUB_APP_INSTALLATION_ID'],
      GITHUB_TOKEN: process.env['GITHUB_TOKEN'],
    };
    delete process.env['GITHUB_APP_ID'];
    delete process.env['GITHUB_APP_PRIVATE_KEY_PATH'];
    delete process.env['GITHUB_APP_INSTALLATION_ID'];
    delete process.env['GITHUB_TOKEN'];
    mockReadFileSync.mockReset();
    MockOctokit.mockClear();
    MockOctokit.mockImplementation(() => ({ rest: {} }));
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    vi.restoreAllMocks();
  });

  // ── GitHub App Authentication ─────────────────────────────────────────────

  describe('GitHub App Authentication', () => {
    it('returns an Octokit instance when App credentials are provided', async () => {
      process.env['GITHUB_APP_ID'] = '12345';
      process.env['GITHUB_APP_PRIVATE_KEY_PATH'] = '/path/to/key.pem';
      process.env['GITHUB_APP_INSTALLATION_ID'] = '67890';
      mockReadFileSync.mockReturnValue(FAKE_PEM);

      const octokit = await getAuthenticatedOctokit();

      expect(octokit).toBeDefined();
      expect(octokit.rest).toBeDefined();
    });

    it('reads the private key from GITHUB_APP_PRIVATE_KEY_PATH', async () => {
      process.env['GITHUB_APP_ID'] = '12345';
      process.env['GITHUB_APP_PRIVATE_KEY_PATH'] = '/path/to/key.pem';
      process.env['GITHUB_APP_INSTALLATION_ID'] = '67890';
      mockReadFileSync.mockReturnValue(FAKE_PEM);

      await getAuthenticatedOctokit();

      expect(mockReadFileSync).toHaveBeenCalledWith('/path/to/key.pem', 'utf8');
    });

    it('throws when the private key file cannot be read', async () => {
      process.env['GITHUB_APP_ID'] = '12345';
      process.env['GITHUB_APP_PRIVATE_KEY_PATH'] = '/nonexistent/key.pem';
      process.env['GITHUB_APP_INSTALLATION_ID'] = '67890';
      mockReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      await expect(getAuthenticatedOctokit()).rejects.toThrow(
        /Failed to read/i,
      );
    });

    it('throws with incomplete App credentials message when partial App vars are set', async () => {
      process.env['GITHUB_APP_ID'] = '12345';
      // GITHUB_APP_PRIVATE_KEY_PATH and GITHUB_APP_INSTALLATION_ID are absent

      await expect(getAuthenticatedOctokit()).rejects.toThrow(
        /Incomplete GitHub App credentials/i,
      );
    });
  });

  // ── PAT (Personal Access Token) Fallback ───────────────────────────────────

  describe('PAT Fallback Authentication', () => {
    it('returns an Octokit instance when GITHUB_TOKEN is set', async () => {
      process.env['GITHUB_TOKEN'] = 'ghp_test1234567890abcdef';

      const octokit = await getAuthenticatedOctokit();

      expect(octokit).toBeDefined();
      expect(octokit.rest).toBeDefined();
    });

    it('prefers App auth over PAT when both are available', async () => {
      process.env['GITHUB_APP_ID'] = '12345';
      process.env['GITHUB_APP_PRIVATE_KEY_PATH'] = '/path/to/key.pem';
      process.env['GITHUB_APP_INSTALLATION_ID'] = '67890';
      process.env['GITHUB_TOKEN'] = 'ghp_test1234567890abcdef';
      mockReadFileSync.mockReturnValue(FAKE_PEM);

      await getAuthenticatedOctokit();

      // App auth was selected — readFileSync was called for the private key
      expect(mockReadFileSync).toHaveBeenCalledWith('/path/to/key.pem', 'utf8');
    });
  });

  // ── Fallback and Error Handling ────────────────────────────────────────────

  describe('Authentication Fallback and Error Handling', () => {
    it('throws when neither App nor PAT credentials are provided', async () => {
      await expect(getAuthenticatedOctokit()).rejects.toThrow(
        /GITHUB_TOKEN|App credentials/i,
      );
    });

    it('logs the PAT auth method when GITHUB_TOKEN is used', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      process.env['GITHUB_TOKEN'] = 'ghp_test1234567890abcdef';

      await getAuthenticatedOctokit();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/PAT|GitHub Token/i),
      );
    });

    it('logs the GitHub App auth method when App credentials are used', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      process.env['GITHUB_APP_ID'] = '12345';
      process.env['GITHUB_APP_PRIVATE_KEY_PATH'] = '/path/to/key.pem';
      process.env['GITHUB_APP_INSTALLATION_ID'] = '67890';
      mockReadFileSync.mockReturnValue(FAKE_PEM);

      await getAuthenticatedOctokit();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/GitHub App/i),
      );
    });
  });

  // ── Environment Variable Validation ────────────────────────────────────────

  describe('Environment Variable Validation', () => {
    it('throws when GITHUB_APP_ID is not a valid integer', async () => {
      process.env['GITHUB_APP_ID'] = 'not-a-number';
      process.env['GITHUB_APP_PRIVATE_KEY_PATH'] = '/path/to/key.pem';
      process.env['GITHUB_APP_INSTALLATION_ID'] = '67890';

      await expect(getAuthenticatedOctokit()).rejects.toThrow(/GITHUB_APP_ID/i);
    });

    it('throws when GITHUB_APP_INSTALLATION_ID is not a valid integer', async () => {
      process.env['GITHUB_APP_ID'] = '12345';
      process.env['GITHUB_APP_PRIVATE_KEY_PATH'] = '/path/to/key.pem';
      process.env['GITHUB_APP_INSTALLATION_ID'] = 'not-a-number';

      await expect(getAuthenticatedOctokit()).rejects.toThrow(
        /GITHUB_APP_INSTALLATION_ID/i,
      );
    });
  });

  // ── Integration with Command Handlers ──────────────────────────────────────

  describe('Integration with Command Handlers', () => {
    it('CommandContext includes octokit as a required field', async () => {
      const { makeCommandContext } = await import('../__tests__/test-helpers');
      const mockOctokit = {
        rest: { issues: { createComment: vi.fn() } },
      } as any;
      const ctx = makeCommandContext({ octokit: mockOctokit });

      expect(ctx.octokit).toBe(mockOctokit);
    });

    it('postErrorReply uses ctx.octokit to post the comment', async () => {
      const { postErrorReply } = await import('../commands/context');
      const { makeCommandContext } = await import('../__tests__/test-helpers');
      const createComment = vi.fn().mockResolvedValue({});
      const mockOctokit = { rest: { issues: { createComment } } } as any;
      const ctx = makeCommandContext({
        octokit: mockOctokit,
        issueNumber: 42,
        username: 'test-user',
        owner: 'owner',
        repo: 'repo',
      });

      await postErrorReply(ctx, 'test error');

      expect(createComment).toHaveBeenCalledWith(
        expect.objectContaining({ issue_number: 42 }),
      );
    });
  });
});
