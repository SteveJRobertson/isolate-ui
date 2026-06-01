import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Documentation verification tests for Issue #112.
 *
 * These tests verify that the deployment documentation includes:
 * 1. GitHub App setup instructions (step-by-step)
 * 2. Security warnings for private key management
 * 3. Comparison between PAT and GitHub App authentication
 * 4. Troubleshooting section for common App auth errors
 * 5. Updated ecosystem.config.js with App environment variables
 *
 * Note: These tests are documentation-only verifications and serve as
 * a manual reference. They are not discovered by the Vitest workspace
 * configuration (which only includes src/ and project-specific tests).
 * They can be run manually with:
 *   pnpm vitest docs/__tests__/deployment-docs-github-app.test.ts
 *
 * Tests will pass once the documentation is updated.
 */

const DOCS_PATH = path.join(__dirname, '../MAC_MINI_DEPLOYMENT.md');
const CONFIG_PATH = path.join(__dirname, '../../ecosystem.config.js');

function readFileContent(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    throw new Error(
      `Failed to read file ${filePath}: ${(error as Error).message}`,
    );
  }
}

describe('Documentation: GitHub App Authentication (#112)', () => {
  // ── ecosystem.config.js Updates ───────────────────────────────────────────

  describe('ecosystem.config.js - Environment Variables', () => {
    it('FAILING: includes GITHUB_APP_ID example variable', () => {
      const content = readFileContent(CONFIG_PATH);
      expect(content).toContain('GITHUB_APP_ID');
    });

    it('FAILING: includes GITHUB_APP_PRIVATE_KEY_PATH example variable', () => {
      const content = readFileContent(CONFIG_PATH);
      expect(content).toContain('GITHUB_APP_PRIVATE_KEY_PATH');
    });

    it('FAILING: includes GITHUB_APP_INSTALLATION_ID example variable', () => {
      const content = readFileContent(CONFIG_PATH);
      expect(content).toContain('GITHUB_APP_INSTALLATION_ID');
    });

    it('FAILING: includes GITHUB_TOKEN as fallback example', () => {
      const content = readFileContent(CONFIG_PATH);
      expect(content).toContain('GITHUB_TOKEN');
    });

    it('FAILING: provides clear comments explaining each variable', () => {
      const content = readFileContent(CONFIG_PATH);
      // Should have explanatory comments for App credentials
      expect(content).toMatch(/GitHub App|App ID|Installation ID|Private Key/i);
    });
  });

  // ── MAC_MINI_DEPLOYMENT.md: GitHub App Setup Section ─────────────────────

  describe('MAC_MINI_DEPLOYMENT.md - GitHub App Setup', () => {
    it('FAILING: contains "GitHub App" section header', () => {
      const content = readFileContent(DOCS_PATH);
      expect(content.toLowerCase()).toContain('github app');
    });

    it('FAILING: includes step-by-step numbered instructions for App setup', () => {
      const content = readFileContent(DOCS_PATH);
      // Should have numbered steps like "1. ", "2. ", etc. in App section
      // Steps may start with "Go to", "Click", "Find", etc., not necessarily create/register/set up
      expect(content).toMatch(/step \d+:|\d+\.\s+/i);
    });

    it('FAILING: documents how to create a GitHub App (if not already created)', () => {
      const content = readFileContent(DOCS_PATH);
      expect(content.toLowerCase()).toMatch(/create|register|new app/i);
    });

    it('FAILING: explains how to generate a private key', () => {
      const content = readFileContent(DOCS_PATH);
      expect(content.toLowerCase()).toMatch(
        /private key|generate|download|\.pem/i,
      );
    });

    it('FAILING: documents installation ID and how to find it', () => {
      const content = readFileContent(DOCS_PATH);
      expect(content).toContain('installation');
      expect(content.toLowerCase()).toMatch(/installation id|find|locate/i);
    });
  });

  // ── Security Warnings ─────────────────────────────────────────────────────

  describe('MAC_MINI_DEPLOYMENT.md - Security Best Practices', () => {
    it('FAILING: includes security warning for private key handling', () => {
      const content = readFileContent(DOCS_PATH);
      expect(content.toLowerCase()).toMatch(/security|warning|private key/i);
      expect(content.toLowerCase()).toMatch(/chmod|permission|600/i);
    });

    it('FAILING: warns against committing private key files', () => {
      const content = readFileContent(DOCS_PATH);
      expect(content.toLowerCase()).toMatch(/do not|never|commit|gitignore/i);
    });

    it('FAILING: explains secure storage for .pem files', () => {
      const content = readFileContent(DOCS_PATH);
      expect(content.toLowerCase()).toMatch(/\.pem|secure|store|location/i);
    });
  });

  // ── PAT vs GitHub App Comparison ──────────────────────────────────────────

  describe('MAC_MINI_DEPLOYMENT.md - Authentication Comparison', () => {
    it('FAILING: compares PAT and GitHub App authentication methods', () => {
      const content = readFileContent(DOCS_PATH);
      expect(content.toLowerCase()).toMatch(
        /(pat|personal access token).*app/i,
      );
    });

    it('FAILING: lists advantages of GitHub App auth', () => {
      const content = readFileContent(DOCS_PATH);
      expect(content.toLowerCase()).toMatch(
        /fine.?grained|permission|rate limit|advantage/i,
      );
    });

    it('FAILING: explains when to use PAT vs App', () => {
      const content = readFileContent(DOCS_PATH);
      expect(content.toLowerCase()).toMatch(/when.*use|choose/i);
    });
  });

  // ── Troubleshooting Section ───────────────────────────────────────────────

  describe('MAC_MINI_DEPLOYMENT.md - Troubleshooting', () => {
    it('FAILING: includes a "Troubleshooting" or "Common Issues" section', () => {
      const content = readFileContent(DOCS_PATH);
      expect(content.toLowerCase()).toMatch(/troubleshoot|common issue|error/i);
    });

    it('FAILING: documents incomplete GitHub App credentials error', () => {
      const content = readFileContent(DOCS_PATH);
      expect(content.toLowerCase()).toMatch(/incomplete.*app.*credential/i);
    });

    it('FAILING: documents file path errors (including tilde/dotenv expansion issues)', () => {
      const content = readFileContent(DOCS_PATH);
      expect(content.toLowerCase()).toMatch(
        /failed to read|path|file|absolute path/i,
      );
    });

    it('FAILING: documents permission errors when reading key', () => {
      const content = readFileContent(DOCS_PATH);
      expect(content.toLowerCase()).toMatch(/permission.*denied|chmod|600/i);
    });

    it('FAILING: explains how to verify App auth is working', () => {
      const content = readFileContent(DOCS_PATH);
      expect(content.toLowerCase()).toMatch(
        /verify|check.*logs|github app authentication/i,
      );
    });
  });

  // ── Consistency Checks ────────────────────────────────────────────────────

  describe('Cross-file Consistency', () => {
    it('FAILING: environment variable names match between docs and ecosystem.config.js', () => {
      const docContent = readFileContent(DOCS_PATH);
      const configContent = readFileContent(CONFIG_PATH);

      const envVars = [
        'GITHUB_APP_ID',
        'GITHUB_APP_PRIVATE_KEY_PATH',
        'GITHUB_APP_INSTALLATION_ID',
      ];
      envVars.forEach((envVar) => {
        expect(docContent).toContain(envVar);
        expect(configContent).toContain(envVar);
      });
    });

    it('FAILING: ecosystem.config.js examples match the documented procedure', () => {
      const configContent = readFileContent(CONFIG_PATH);
      // Config should have examples that are aligned with docs
      // Both should reference the same environment variable names
      expect(configContent).toMatch(
        /GITHUB_APP_ID|GITHUB_APP_PRIVATE_KEY_PATH|GITHUB_APP_INSTALLATION_ID/,
      );
    });
  });

  // ── Completeness Check ────────────────────────────────────────────────────

  describe('Documentation Completeness', () => {
    it('FAILING: includes all required sections', () => {
      const content = readFileContent(DOCS_PATH);
      const requiredSections = [
        'github app',
        'private key',
        'permission',
        'troubleshoot',
        'compare',
        'pat',
      ];

      requiredSections.forEach((section) => {
        expect(content.toLowerCase()).toContain(section);
      });
    });

    it('FAILING: documentation is accessible to new users (clear language)', () => {
      const content = readFileContent(DOCS_PATH);
      // Basic heuristic: should have numbered steps and clear structure
      expect(content).toMatch(/^\d+\./m); // numbered steps
      expect(content).toMatch(/```bash/); // code blocks
    });
  });
});
