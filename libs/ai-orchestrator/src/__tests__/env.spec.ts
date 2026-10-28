import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateOrchestratorEnv } from '../config';

describe('validateOrchestratorEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Start from a clean slate so unrelated env vars from the host/CI
    // runner don't leak into these assertions.
    process.env = { ...originalEnv };
    delete process.env.GITHUB_TOKEN;
    delete process.env.WEBHOOK_SECRET;
    delete process.env.LANGCHAIN_TRACING_V2;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns successfully when all optional vars are absent', () => {
    expect(() => validateOrchestratorEnv()).not.toThrow();
  });

  it('throws a clear, formatted Error (not a crash) when a field fails validation', () => {
    // WEBHOOK_SECRET has a .min(32) constraint; a short value should fail
    // schema validation and surface as a readable message, not throw a
    // secondary TypeError from the error-formatting code itself.
    process.env.WEBHOOK_SECRET = 'too-short';

    expect(() => validateOrchestratorEnv()).toThrow(
      /Orchestrator environment validation failed.*WEBHOOK_SECRET/s,
    );
  });

  it('includes the custom message for GITHUB_TOKEN when set but empty', () => {
    process.env.GITHUB_TOKEN = '';

    expect(() => validateOrchestratorEnv()).toThrow(
      /GITHUB_TOKEN must be non-empty if provided/,
    );
  });
});
