import type { UserConfig } from '@commitlint/types';
import { RuleConfigSeverity } from '@commitlint/types';

async function getConfig(): Promise<UserConfig> {
  const nxScopesConfig = await import('@commitlint/config-nx-scopes');
  const { getProjects } = nxScopesConfig.default.utils;

  return {
    extends: ['@commitlint/config-conventional'],
    // Ignore system-generated commits (Copilot agent placeholders, GitHub web editor defaults)
    ignores: [
      (commit) => /^Initial plan(\n|$)/.test(commit),
      (commit) => /^Update \S+\.\w+(\n|$)/.test(commit),
      (commit) => /^fix\(ci\):/.test(commit),
    ],
    rules: {
      // Allow commits without scope (for global repo changes like "ci: update workflow")
      // Disabled (0) to fully allow scope-less commits without warnings
      'scope-empty': [RuleConfigSeverity.Disabled],
      'scope-enum': async (ctx) => [
        RuleConfigSeverity.Error,
        'always',
        [
          ...(await getProjects(ctx)),
          'release', // Allow release commits (e.g. chore(release): ...)
          'deps', // Allow dependency update commits (e.g. chore(deps): ...)
          'commitlint', // Allow commits scoped to commitlint configuration changes
        ],
      ],
    },
  };
}

export default getConfig();
