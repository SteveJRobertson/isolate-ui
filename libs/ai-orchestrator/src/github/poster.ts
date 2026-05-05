import { Octokit } from '@octokit/rest';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TechnicalSpecRow {
  slot: string;
  primitive: string;
  tokens: string;
}

export interface RefinementCommentPayload {
  /** GitHub issue number to post the comment on. */
  issueNumber: number;
  /** GitHub repo owner (e.g. 'SteveJRobertson'). */
  owner: string;
  /** GitHub repo name (e.g. 'isolate-ui'). */
  repo: string;
  /** Rows for the Technical Specification table. */
  technicalSpec: TechnicalSpecRow[];
  /** Edge cases that must be handled (e.g. Loading, Error, Empty, Disabled, A11y). */
  edgeCases: string[];
  /** Persona sign-off states — true = approved, false = pending/rejected. */
  signoffs: Record<string, boolean>;
  /** Optional: URL of the Storybook preview or relevant link. */
  previewUrl?: string;
  /** Rejection reason if the loop was paused by iteration limit. */
  rejectionReason?: string;
}

export interface PostCommentResult {
  /** URL of the created comment. */
  commentUrl: string;
  /** Numeric ID of the created comment. */
  commentId: number;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

/**
 * Render the technical specification as a Markdown table.
 */
export function formatTechnicalSpecTable(rows: TechnicalSpecRow[]): string {
  if (rows.length === 0) {
    return '_No technical specification provided._';
  }
  const header = '| Slot | Primitive | Tokens |';
  const divider = '|------|-----------|--------|';
  const body = rows
    .map((r) => `| ${r.slot} | ${r.primitive} | ${r.tokens} |`)
    .join('\n');
  return [header, divider, body].join('\n');
}

/**
 * Render the edge cases as a Markdown list.
 */
export function formatEdgeCaseList(edgeCases: string[]): string {
  if (edgeCases.length === 0) return '_No edge cases specified._';
  return edgeCases.map((c) => `- ${c}`).join('\n');
}

/**
 * Render the persona sign-off list as a Markdown task list.
 * Checked (✅) = approved; unchecked = pending/rejected.
 */
export function formatPersonaSignoffs(
  signoffs: Record<string, boolean>,
): string {
  const entries = Object.entries(signoffs);
  if (entries.length === 0) return '_No sign-offs recorded._';
  return entries
    .map(([id, approved]) => `- [${approved ? 'x' : ' '}] @isolate-${id}`)
    .join('\n');
}

/**
 * Build the full Markdown comment body from a payload.
 */
export function buildCommentBody(payload: RefinementCommentPayload): string {
  const sections: string[] = [
    '## 🔍 Definition of Ready — Refinement Loop Report',
    '',
  ];

  if (payload.rejectionReason) {
    sections.push(
      '> ⚠️ **Human review required** — iteration limit reached.',
      `> **Last rejection reason:** ${payload.rejectionReason}`,
      '',
    );
  }

  sections.push(
    '### Technical Specification',
    '',
    formatTechnicalSpecTable(payload.technicalSpec),
    '',
    '### Edge Cases',
    '',
    formatEdgeCaseList(payload.edgeCases),
    '',
    '### Persona Sign-off',
    '',
    formatPersonaSignoffs(payload.signoffs),
  );

  if (payload.previewUrl) {
    sections.push('', `**Preview:** ${payload.previewUrl}`);
  }

  return sections.join('\n');
}

// ── API call ──────────────────────────────────────────────────────────────────

/**
 * Post a refinement loop report as a GitHub issue comment.
 *
 * Requires a valid GITHUB_TOKEN with `repo` scope.
 * Silently skips posting and returns null when token is absent.
 *
 * @param payload - Comment data
 * @param token   - GitHub personal access token (GITHUB_TOKEN)
 * @returns PostCommentResult on success, null when token is absent
 */
export async function postRefinementLoopComment(
  payload: RefinementCommentPayload,
  token: string | undefined,
): Promise<PostCommentResult | null> {
  if (!token) return null;

  const octokit = new Octokit({ auth: token });
  const body = buildCommentBody(payload);

  const response = await octokit.rest.issues.createComment({
    owner: payload.owner,
    repo: payload.repo,
    issue_number: payload.issueNumber,
    body,
  });

  return {
    commentUrl: response.data.html_url,
    commentId: response.data.id,
  };
}
