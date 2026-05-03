import * as fs from 'fs';
import * as path from 'path';
import { AGENT_PERSONAS, AgentPersona, getPersonaIds } from '../agents';

/**
 * Required persona IDs — the orchestrator will throw if any are missing.
 */
const REQUIRED_PERSONA_IDS = [
  'po',
  'architect',
  'dev',
  'a11y',
  'qa',
  'docs',
] as const;

export type RequiredPersonaId = (typeof REQUIRED_PERSONA_IDS)[number];

/**
 * Parsed output from AGENTS.md.
 */
export interface AgentsConfig {
  personas: Record<string, AgentPersona>;
  validatedAt: Date;
  sourceFile: string;
}

/**
 * Walk up the directory tree to find the workspace root (identified by nx.json).
 * This is more robust than counting `..` levels, which breaks under different runtimes.
 */
export function findWorkspaceRoot(startDir: string): string {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'nx.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error(
    `Could not locate workspace root (no nx.json found). Started from: ${startDir}`,
  );
}

/**
 * Parses the root AGENTS.md file and validates all required personas are present.
 *
 * The parser scans for any occurrence of `@isolate-<id>` anywhere in the file
 * (headings, inline references, bold text, etc.). This is intentionally permissive —
 * the requirement is that each persona is mentioned, not that it appears in a
 * specific heading format.
 *
 * Fail-fast: throws hard errors if AGENTS.md is missing or required personas
 * are absent. This prevents the orchestrator from running in a degraded state.
 *
 * @param agentsMdPath - Absolute path to AGENTS.md (defaults to workspace root)
 */
export function parseAgentsConfig(agentsMdPath?: string): AgentsConfig {
  const resolvedPath =
    agentsMdPath ?? path.join(findWorkspaceRoot(__dirname), 'AGENTS.md');

  // Fail-fast: file must exist
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `AGENTS.md not found at: ${resolvedPath}\n` +
        `The orchestrator requires AGENTS.md to be present at the workspace root.`,
    );
  }

  const content = fs.readFileSync(resolvedPath, 'utf-8');

  // Validate that the AGENTS.md contains persona markers for all required roles.
  // We look for headings that reference each persona name.
  const mentionedPersonas = detectPersonasInContent(content);
  const missingPersonas = REQUIRED_PERSONA_IDS.filter(
    (id) => !mentionedPersonas.includes(id),
  );

  if (missingPersonas.length > 0) {
    throw new Error(
      `AGENTS.md is missing required persona definitions: ${missingPersonas.map((id) => `@isolate-${id}`).join(', ')}\n` +
        `Each persona must appear in AGENTS.md. ` +
        `Expected: ${REQUIRED_PERSONA_IDS.map((id) => `@isolate-${id}`).join(', ')}`,
    );
  }

  return {
    personas: AGENT_PERSONAS,
    validatedAt: new Date(),
    sourceFile: resolvedPath,
  };
}

/**
 * Scans AGENTS.md content for persona references.
 *
 * Detects patterns like:
 *   - @isolate-po
 *   - **@isolate-architect**
 *   - ### @isolate-dev
 */
function detectPersonasInContent(content: string): RequiredPersonaId[] {
  const personaPattern = /@isolate-(po|architect|dev|a11y|qa|docs)/g;
  const found = new Set<RequiredPersonaId>();
  let match: RegExpExecArray | null;

  while ((match = personaPattern.exec(content)) !== null) {
    found.add(match[1] as RequiredPersonaId);
  }

  return Array.from(found);
}

/**
 * Validate that a persona ID is known.
 * Throws a clear error if not — prevents silent failures.
 */
export function assertPersonaExists(id: string): void {
  const known = getPersonaIds();
  if (!known.includes(id)) {
    throw new Error(
      `Unknown persona ID: "${id}". ` +
        `Valid personas are: ${known.join(', ')}`,
    );
  }
}
