import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');

describe('Deployment Artifacts', () => {
  describe('ecosystem.config.js', () => {
    const ecosystemPath = path.join(ROOT, 'ecosystem.config.js');

    it('exists at workspace root', () => {
      expect(fs.existsSync(ecosystemPath)).toBe(true);
    });

    it('exports a valid PM2 ecosystem configuration object', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const config = require(ecosystemPath);
      expect(config).toHaveProperty('apps');
      expect(Array.isArray(config.apps)).toBe(true);
      expect(config.apps.length).toBeGreaterThan(0);
    });

    it('includes webhook-listener app configuration', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const config = require(ecosystemPath);
      const webhookApp = config.apps.find(
        (app: { name?: string }) => app.name === 'webhook-listener',
      );
      expect(webhookApp).toBeDefined();
    });

    it('webhook-listener app points to dist/apps/webhook-listener/main.js', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const config = require(ecosystemPath);
      const webhookApp = config.apps.find(
        (app: { name?: string }) => app.name === 'webhook-listener',
      );
      expect(webhookApp.script).toBe('dist/apps/webhook-listener/main.js');
    });

    it('webhook-listener uses clustering for production (instances: max)', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const config = require(ecosystemPath);
      const webhookApp = config.apps.find(
        (app: { name?: string }) => app.name === 'webhook-listener',
      );
      expect(webhookApp.instances).toBe('max');
    });

    it('includes restart policy configuration', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const config = require(ecosystemPath);
      const webhookApp = config.apps.find(
        (app: { name?: string }) => app.name === 'webhook-listener',
      );
      expect(webhookApp).toHaveProperty('max_restarts');
      expect(webhookApp).toHaveProperty('min_uptime');
      expect(webhookApp).toHaveProperty('kill_timeout');
    });

    it('includes logging configuration', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const config = require(ecosystemPath);
      const webhookApp = config.apps.find(
        (app: { name?: string }) => app.name === 'webhook-listener',
      );
      expect(webhookApp).toHaveProperty('error_file');
      expect(webhookApp).toHaveProperty('out_file');
    });
  });

  describe('.env.production.example', () => {
    const envExamplePath = path.join(ROOT, '.env.production.example');

    it('exists at workspace root', () => {
      expect(fs.existsSync(envExamplePath)).toBe(true);
    });

    it('contains GITHUB_TOKEN variable', () => {
      const content = fs.readFileSync(envExamplePath, 'utf-8');
      expect(content).toMatch(/^[\s]*GITHUB_TOKEN\s*=/m);
    });

    it('contains WEBHOOK_SECRET variable', () => {
      const content = fs.readFileSync(envExamplePath, 'utf-8');
      expect(content).toMatch(/^[\s]*WEBHOOK_SECRET\s*=/m);
    });

    it('contains GITHUB_OWNER variable', () => {
      const content = fs.readFileSync(envExamplePath, 'utf-8');
      expect(content).toMatch(/^[\s]*GITHUB_OWNER\s*=/m);
    });

    it('contains GITHUB_REPO variable', () => {
      const content = fs.readFileSync(envExamplePath, 'utf-8');
      expect(content).toMatch(/^[\s]*GITHUB_REPO\s*=/m);
    });

    it('contains HOST variable', () => {
      const content = fs.readFileSync(envExamplePath, 'utf-8');
      expect(content).toMatch(/^[\s]*HOST\s*=/m);
    });

    it('contains PORT variable', () => {
      const content = fs.readFileSync(envExamplePath, 'utf-8');
      expect(content).toMatch(/^[\s]*PORT\s*=/m);
    });

    it('contains DATABASE_PATH variable', () => {
      const content = fs.readFileSync(envExamplePath, 'utf-8');
      expect(content).toMatch(/^[\s]*DATABASE_PATH\s*=/m);
    });

    it('contains STARTUP_SYNC_WINDOW_MS variable', () => {
      const content = fs.readFileSync(envExamplePath, 'utf-8');
      expect(content).toMatch(/^[\s]*STARTUP_SYNC_WINDOW_MS\s*=/m);
    });

    it('includes documentation comments for each variable', () => {
      const content = fs.readFileSync(envExamplePath, 'utf-8');
      // Should have more comment lines than variable lines
      const commentLines = content
        .split('\n')
        .filter((line) => line.trim().startsWith('#'));
      const varLines = content
        .split('\n')
        .filter((line) => line.match(/^[\s]*[A-Z_]+\s*=/));
      expect(commentLines.length).toBeGreaterThanOrEqual(varLines.length);
    });

    it('does not contain actual secrets or real values', () => {
      const content = fs.readFileSync(envExamplePath, 'utf-8');
      // Variables should be empty, placeholder text, or examples only
      const dangerousPatterns = [
        /GITHUB_TOKEN\s*=\s*ghp_\w+/i, // GitHub token pattern
        /WEBHOOK_SECRET\s*=\s*[a-f0-9]{40}/i, // SHA1 pattern
      ];
      dangerousPatterns.forEach((pattern) => {
        expect(content).not.toMatch(pattern);
      });
    });
  });

  describe('.gitignore', () => {
    const gitignorePath = path.join(ROOT, '.gitignore');

    it('exists at workspace root', () => {
      expect(fs.existsSync(gitignorePath)).toBe(true);
    });

    it('contains .env.production entry to exclude secrets', () => {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      expect(content).toMatch(/^\.env\.production$/m);
    });

    it('does not exclude .env.production.example', () => {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      // Should NOT have .env.production.example in gitignore
      expect(content).not.toMatch(/\.env\.production\.example/);
    });
  });
});
