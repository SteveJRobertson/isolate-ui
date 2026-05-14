import { vi } from 'vitest';
import { CommandContext } from '../commands/context';

/**
 * Creates a minimal CommandContext for unit tests. Override specific fields
 * by passing a partial object — the returned context has all required fields.
 */
export function makeCommandContext(
  overrides: Partial<
    CommandContext & { graph: Record<string, ReturnType<typeof vi.fn>> }
  > = {},
): CommandContext {
  const graph = overrides.graph ?? {
    getState: vi.fn(),
    invoke: vi.fn(),
  };

  return {
    graph: graph as unknown as CommandContext['graph'],
    threadId: 'issue-1',
    issueNumber: 1,
    username: 'user',
    db: null as unknown as CommandContext['db'],
    octokit: null as unknown as CommandContext['octokit'],
    owner: 'owner',
    repo: 'repo',
    ...overrides,
  } as CommandContext;
}
