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

export interface MeshStalematePayload {
  /** GitHub issue number to post the comment on. */
  issueNumber: number;
  /** GitHub repo owner (e.g. 'SteveJRobertson'). */
  owner: string;
  /** GitHub repo name (e.g. 'isolate-ui'). */
  repo: string;
  /** Number of mesh jumps that triggered the stalemate. */
  meshLoopCount: number;
  /**
   * The persona that was the active next_recipient when the final mesh jump
   * was attempted — i.e. the diversion point in the deterministic workflow.
   */
  originPersona: string | null;
  /** Raw content of the last agent message that triggered the mesh jump. */
  lastMessage: string;
  /**
   * GitHub username of the issue author to @mention in the stalemate comment.
   * A real @mention is posted (no zero-width space) so the author receives a
   * GitHub notification and can review the stalemate promptly.
   */
  issueAuthor: string;
  /** The configured jump limit (MeshRouterConfig.maxMeshLoops). */
  maxMeshLoops: number;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

/**
 * Sanitize untrusted LLM-produced text for safe embedding in GitHub Markdown.
 * Neutralizes @mentions and collapses newlines.
 */
function sanitizeLlmText(text: string): string {
  const safe = text ?? '';
  return safe
    .replace(/@/g, '@\u200b') // insert zero-width space between @ and username to break mention parsing
    .replace(/\r?\n|\r/g, ' ') // collapse newlines
    .trim();
}

/**
 * Sanitize a string for embedding inside a Markdown table cell.
 * Builds on sanitizeLlmText and additionally escapes pipe characters,
 * which would break the table structure.
 */
function sanitizeTableCell(text: string): string {
  return sanitizeLlmText(text).replace(/\|/g, '\\|');
}

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
    .map(
      (r) =>
        `| ${sanitizeTableCell(r.slot)} | ${sanitizeTableCell(r.primitive)} | ${sanitizeTableCell(r.tokens)} |`,
    )
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
 * Always renders all three refinement-loop personas (po, dev, qa) in order.
 * Checked = approved; unchecked = pending or not yet reached.
 */
export function formatPersonaSignoffs(
  signoffs: Record<string, boolean>,
  personas = ['po', 'dev', 'qa'],
): string {
  return personas
    .map((id) => `- [${signoffs[id] ? 'x' : ' '}] @isolate-${id}`)
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
    const safeReason = sanitizeLlmText(payload.rejectionReason);
    sections.push(
      '> ⚠️ **Human review required** — iteration limit reached.',
      `> **Last rejection reason:** ${safeReason}`,
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
    // Strip newlines to prevent header injection or table breakage.
    const safeUrl = payload.previewUrl.replace(/\r?\n|\r/g, '').trim();
    sections.push('', `**Preview:** ${safeUrl}`);
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

// ── Mesh stalemate comment ────────────────────────────────────────────────────

/**
 * Build the Markdown body for a mesh stalemate notification comment.
 *
 * A real @mention is posted for the issue author so they receive a GitHub
 * notification and can review the stalemate promptly.
 *
 * The lastMessage excerpt is passed through sanitizeLlmText to neutralize any
 * @mentions embedded in LLM-produced content and collapse newlines to keep the
 * blockquote single-line.
 */
export function buildStalemateCommentBody(
  payload: MeshStalematePayload,
): string {
  // Real @mention for the issue author so they receive a GitHub notification.
  const authorMention = `@${payload.issueAuthor.replace(/@/g, '')}`;
  const safeOrigin = payload.originPersona
    ? `\`@isolate-${payload.originPersona}\``
    : '_unknown_';
  const originId = payload.originPersona ?? 'po';
  const safeLastMessage = sanitizeLlmText(payload.lastMessage);

  const sections: string[] = [
    '## 🔴 Ambiguity Mesh — Stalemate',
    '',
    `> ⚠️ **Human review required** — the mesh router reached its jump limit.`,
    `> **Notifying:** ${authorMention}`,
    '',
    '### Summary',
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| Mesh jumps | ${payload.meshLoopCount} |`,
    `| Jump limit | ${payload.maxMeshLoops} |`,
    `| Diversion point | ${safeOrigin} |`,
    '',
    '### Last Message That Triggered the Stalemate',
    '',
    `> ${safeLastMessage}`,
    '',
    '### How to Resume',
    '',
    '1. Review the conversation context and resolve the ambiguity manually.',
    '2. Re-invoke the orchestrator with the same `thread_id`, passing an initial',
    `   state where \`next_recipient\` is set to the persona ID \`"${originId}"\`.`,
    '3. The workflow will resume from the diversion point.',
  ];

  return sections.join('\n');
}

/**
 * Post a mesh stalemate notification as a GitHub issue comment.
 *
 * Requires a valid GITHUB_TOKEN with `repo` scope.
 * Silently skips posting and returns null when token is absent.
 *
 * @param payload - Stalemate comment data
 * @param token   - GitHub personal access token (GITHUB_TOKEN)
 * @returns PostCommentResult on success, null when token is absent
 */
export async function postMeshStalemateComment(
  payload: MeshStalematePayload,
  token: string | undefined,
): Promise<PostCommentResult | null> {
  if (!token) return null;

  const octokit = new Octokit({ auth: token });
  const body = buildStalemateCommentBody(payload);

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
