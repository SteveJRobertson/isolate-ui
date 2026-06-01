import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

import * as fs from 'node:fs';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { validateEnv, type ValidatedEnv } from './env-validation';

const mockExistsSync = vi.mocked(fs.existsSync);

describe('env-validation', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    // Save all environment variables
    savedEnv = {
      HOST: process.env['HOST'],
      PORT: process.env['PORT'],
      GITHUB_OWNER: process.env['GITHUB_OWNER'],
      GITHUB_REPO: process.env['GITHUB_REPO'],
      DATABASE_PATH: process.env['DATABASE_PATH'],
      STARTUP_SYNC_WINDOW_MS: process.env['STARTUP_SYNC_WINDOW_MS'],
      GITHUB_TOKEN: process.env['GITHUB_TOKEN'],
      WEBHOOK_SECRET: process.env['WEBHOOK_SECRET'],
      GITHUB_APP_ID: process.env['GITHUB_APP_ID'],
      GITHUB_APP_PRIVATE_KEY_PATH: process.env['GITHUB_APP_PRIVATE_KEY_PATH'],
      GITHUB_APP_INSTALLATION_ID: process.env['GITHUB_APP_INSTALLATION_ID'],
      OPENAI_API_KEY: process.env['OPENAI_API_KEY'],
      ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY'],
    };

    // Clear all env vars for isolated testing
    Object.keys(savedEnv).forEach((key) => {
      delete process.env[key];
    });

    mockExistsSync.mockReset();
    // Mock nx.json exists in a parent directory
    mockExistsSync.mockImplementation((filePath) => {
      return (filePath as string).endsWith('nx.json');
    });

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    // Restore all environment variables
    Object.entries(savedEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
    vi.restoreAllMocks();
  });

  describe('validation succeeds', () => {
    it('returns ValidatedEnv when all required vars present', () => {
      process.env['GITHUB_TOKEN'] = 'ghp_1234567890abcdefghijklmnopqrstu';
      process.env['WEBHOOK_SECRET'] =
        'this_is_a_webhook_secret_thats_long_enough';

      const result = validateEnv();

      expect(result).toBeDefined();
      expect(result).toHaveProperty('GITHUB_TOKEN');
      expect(result).toHaveProperty('WEBHOOK_SECRET');
      expect(result).toHaveProperty('resolvedDatabasePath');
      expect(result).toHaveProperty('HOST', '0.0.0.0');
      expect(result).toHaveProperty('PORT', 8080);
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('applies correct defaults for optional vars', () => {
      process.env['GITHUB_TOKEN'] = 'ghp_1234567890abcdefghijklmnopqrstu';
      process.env['WEBHOOK_SECRET'] =
        'this_is_a_webhook_secret_thats_long_enough';

      const result = validateEnv();

      expect(result.HOST).toBe('0.0.0.0');
      expect(result.PORT).toBe(8080);
      expect(result.GITHUB_OWNER).toBe('SteveJRobertson');
      expect(result.GITHUB_REPO).toBe('isolate-ui');
      expect(result.STARTUP_SYNC_WINDOW_MS).toBe(3600000); // 1 hour
    });

    it('overrides defaults when optional vars are provided', () => {
      process.env['GITHUB_TOKEN'] = 'ghp_1234567890abcdefghijklmnopqrstu';
      process.env['WEBHOOK_SECRET'] =
        'this_is_a_webhook_secret_thats_long_enough';
      process.env['HOST'] = '127.0.0.1';
      process.env['PORT'] = '9000';
      process.env['GITHUB_OWNER'] = 'custom-owner';
      process.env['GITHUB_REPO'] = 'custom-repo';
      process.env['STARTUP_SYNC_WINDOW_MS'] = '7200000';

      const result = validateEnv();

      expect(result.HOST).toBe('127.0.0.1');
      expect(result.PORT).toBe(9000);
      expect(result.GITHUB_OWNER).toBe('custom-owner');
      expect(result.GITHUB_REPO).toBe('custom-repo');
      expect(result.STARTUP_SYNC_WINDOW_MS).toBe(7200000);
    });

    it('resolves database path to absolute path when DATABASE_PATH not set', () => {
      process.env['GITHUB_TOKEN'] = 'ghp_1234567890abcdefghijklmnopqrstu';
      process.env['WEBHOOK_SECRET'] =
        'this_is_a_webhook_secret_thats_long_enough';

      const result = validateEnv();

      // The resolved path should contain the default path structure
      expect(result.resolvedDatabasePath).toMatch(
        /libs.*ai-orchestrator.*state\.db/,
      );
      // Should be an absolute path (not relative)
      expect(path.isAbsolute(result.resolvedDatabasePath)).toBe(true);
    });

    it('uses DATABASE_PATH env var directly if set', () => {
      process.env['GITHUB_TOKEN'] = 'ghp_1234567890abcdefghijklmnopqrstu';
      process.env['WEBHOOK_SECRET'] =
        'this_is_a_webhook_secret_thats_long_enough';
      process.env['DATABASE_PATH'] = '/custom/path/to/db.sqlite';

      const result = validateEnv();

      expect(result.resolvedDatabasePath).toBe('/custom/path/to/db.sqlite');
    });

    it('supports GitHub App authentication when all three vars are present', () => {
      process.env['GITHUB_TOKEN'] = 'ghp_1234567890abcdefghijklmnopqrstu';
      process.env['WEBHOOK_SECRET'] =
        'this_is_a_webhook_secret_thats_long_enough';
      process.env['GITHUB_APP_ID'] = '12345';
      process.env['GITHUB_APP_PRIVATE_KEY_PATH'] = '/path/to/private.pem';
      process.env['GITHUB_APP_INSTALLATION_ID'] = '67890';

      const result = validateEnv();

      expect(result.GITHUB_APP_ID).toBe('12345');
      expect(result.GITHUB_APP_PRIVATE_KEY_PATH).toBe('/path/to/private.pem');
      expect(result.GITHUB_APP_INSTALLATION_ID).toBe('67890');
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe('validation fails', () => {
    it('exits with error when GITHUB_TOKEN is missing', () => {
      process.env['WEBHOOK_SECRET'] =
        'this_is_a_webhook_secret_thats_long_enough';

      const consoleSpy = vi
        .spyOn(console, 'error')
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        .mockImplementation(() => {});

      expect(() => validateEnv()).toThrow();

      expect(consoleSpy).toHaveBeenCalled();
      expect(
        consoleSpy.mock.calls.some((call) =>
          String(call[0]).includes('GITHUB_TOKEN'),
        ),
      ).toBe(true);

      consoleSpy.mockRestore();
    });

    it('exits with error when WEBHOOK_SECRET is missing', () => {
      process.env['GITHUB_TOKEN'] = 'ghp_1234567890abcdefghijklmnopqrstu';

      const consoleSpy = vi
        .spyOn(console, 'error')
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        .mockImplementation(() => {});

      expect(() => validateEnv()).toThrow();

      expect(consoleSpy).toHaveBeenCalled();
      expect(
        consoleSpy.mock.calls.some((call) =>
          String(call[0]).includes('WEBHOOK_SECRET'),
        ),
      ).toBe(true);

      consoleSpy.mockRestore();
    });

    it('exits with error when WEBHOOK_SECRET is less than 32 characters', () => {
      process.env['GITHUB_TOKEN'] = 'ghp_1234567890abcdefghijklmnopqrstu';
      process.env['WEBHOOK_SECRET'] = 'short_secret';

      const consoleSpy = vi
        .spyOn(console, 'error')
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        .mockImplementation(() => {});

      expect(() => validateEnv()).toThrow();

      expect(consoleSpy).toHaveBeenCalled();
      expect(
        consoleSpy.mock.calls.some((call) =>
          String(call[0]).includes('32 characters'),
        ),
      ).toBe(true);

      consoleSpy.mockRestore();
    });

    it('exits with error when only some GitHub App vars are set (all or nothing)', () => {
      process.env['GITHUB_TOKEN'] = 'ghp_1234567890abcdefghijklmnopqrstu';
      process.env['WEBHOOK_SECRET'] =
        'this_is_a_webhook_secret_thats_long_enough';
      // Only set two of three required App vars
      process.env['GITHUB_APP_ID'] = '12345';
      process.env['GITHUB_APP_PRIVATE_KEY_PATH'] = '/path/to/private.pem';
      // Missing GITHUB_APP_INSTALLATION_ID

      const consoleSpy = vi
        .spyOn(console, 'error')
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        .mockImplementation(() => {});

      expect(() => validateEnv()).toThrow();

      expect(consoleSpy).toHaveBeenCalled();
      expect(
        consoleSpy.mock.calls.some((call) =>
          String(call[0]).includes('GitHub App'),
        ),
      ).toBe(true);

      consoleSpy.mockRestore();
    });

    it('does not exit when LLM keys are missing (optional)', () => {
      process.env['GITHUB_TOKEN'] = 'ghp_1234567890abcdefghijklmnopqrstu';
      process.env['WEBHOOK_SECRET'] =
        'this_is_a_webhook_secret_thats_long_enough';

      const result = validateEnv();

      expect(result).toBeDefined();
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe('error messages', () => {
    it('includes redacted values in error logs to avoid exposing secrets', () => {
      process.env['GITHUB_TOKEN'] =
        'ghp_very_long_secret_that_should_be_redacted_1234567890';
      process.env['WEBHOOK_SECRET'] = 'short';

      const consoleSpy = vi
        .spyOn(console, 'error')
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        .mockImplementation(() => {});

      expect(() => validateEnv()).toThrow();

      const errorOutput = consoleSpy.mock.calls
        .map((call) => String(call[0]))
        .join('\n');

      // Should NOT contain the full secret
      expect(errorOutput).not.toContain('very_long_secret_that_should');
      // Should not contain full GITHUB_TOKEN
      expect(errorOutput).not.toContain('ghp_very_long_secret');

      consoleSpy.mockRestore();
    });
  });

  describe('type exports', () => {
    it('exports ValidatedEnv type correctly', () => {
      process.env['GITHUB_TOKEN'] = 'ghp_1234567890abcdefghijklmnopqrstu';
      process.env['WEBHOOK_SECRET'] =
        'this_is_a_webhook_secret_thats_long_enough';

      const result = validateEnv();

      // Verify type properties (TypeScript compile-time check, but runtime validation too)
      expect(typeof result.resolvedDatabasePath).toBe('string');
      expect(typeof result.HOST).toBe('string');
      expect(typeof result.PORT).toBe('number');
      expect(typeof result.STARTUP_SYNC_WINDOW_MS).toBe('number');
    });
  });
});
