import { sourceTokens } from '@isolate-ui/tokens';

export interface TokenExistsResult {
  exists: boolean;
  value?: string | number | object;
  path?: string;
  type?: string;
}

type TokenData = Record<string, unknown>;

interface TokenValue {
  $value: string | number;
  $type?: string;
}

function isTokenValue(obj: unknown): obj is TokenValue {
  return typeof obj === 'object' && obj !== null && '$value' in obj;
}

// Max depth for token group detection — design token nesting is intentionally shallow
// (category → scale → value), so recursing beyond 3 levels indicates a non-token object.
const MAX_TOKEN_GROUP_DEPTH = 3;

function isTokenGroup(obj: unknown, depth = 0): boolean {
  if (depth > MAX_TOKEN_GROUP_DEPTH) return false;
  if (typeof obj !== 'object' || obj === null) return false;
  const values = Object.values(obj as TokenData);
  return (
    values.length > 0 &&
    values.some((v) => isTokenValue(v) || isTokenGroup(v, depth + 1))
  );
}

/**
 * Check if a token exists at the given dot-notation path in the design tokens.
 *
 * @param path - Dot-notation path to token (e.g., 'color.primary.500', 'spacing.3')
 * @param tokenData - Optional token data object; uses shared tokens if not provided
 * @returns Result object with existence status and token value if found
 *
 * @example
 * const result = checkTokenExists('color.primary.500');
 * if (result.exists) {
 *   console.log(`Token value: ${result.value}`); // #3b82f6
 * }
 */
export function checkTokenExists(
  path: string,
  tokenData?: TokenData | null,
): TokenExistsResult {
  if (!path || typeof path !== 'string') {
    return { exists: false, path };
  }

  // Only fall back to sourceTokens when tokenData is omitted (undefined).
  // An explicit null means "empty token store" — no fallback.
  const tokens: TokenData =
    tokenData === undefined
      ? (sourceTokens as unknown as TokenData)
      : (tokenData ?? {});
  const parts = path.split('.');
  let current: unknown = tokens;

  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as TokenData)[part];
    } else {
      return { exists: false, path };
    }
  }

  if (isTokenValue(current)) {
    return {
      exists: true,
      value: current.$value,
      path,
      type: current.$type,
    };
  }

  if (isTokenGroup(current)) {
    return {
      exists: true,
      value: current as object,
      path,
      type: 'token-group',
    };
  }

  return { exists: false, path };
}
