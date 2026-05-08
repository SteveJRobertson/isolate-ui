#!/usr/bin/env node
/**
 * Validate a PR title against the project's commitlint rules.
 *
 * Mirrors the CI step in .github/workflows/ci.yml:
 *   echo "$TITLE" | pnpm exec commitlint --verbose
 *
 * Usage:
 *   pnpm lint:pr-title "feat(react-button): add disabled state"
 *
 * Exit code 0 = valid, non-zero = invalid (commitlint prints the reason).
 */

import { spawnSync } from 'node:child_process';

const title = process.argv[2];

if (!title) {
  console.error(
    'Error: PR title argument is required.\n' +
      'Usage: pnpm lint:pr-title "<type>(<scope>): <subject>"',
  );
  process.exit(1);
}

const result = spawnSync('pnpm', ['exec', 'commitlint', '--verbose'], {
  input: title,
  encoding: 'utf8',
  stdio: ['pipe', 'inherit', 'inherit'],
});

process.exit(result.status ?? 1);
