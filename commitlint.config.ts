import type { UserConfig } from '@commitlint/types';
import { RuleConfigSeverity } from '@commitlint/types';

const Configuration: UserConfig = {
  extends: ['@commitlint/config-conventional', '@commitlint/config-nx-scopes'],
  rules: {
    // Allow commits without scope (for global repo changes like "ci: update workflow")
    // Disabled (0) to fully allow scope-less commits without warnings
    'scope-empty': [RuleConfigSeverity.Disabled],
  },
};

export default Configuration;
