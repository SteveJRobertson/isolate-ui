import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verify a GitHub webhook HMAC-SHA256 signature.
 *
 * GitHub sends the signature in the X-Hub-Signature-256 header as:
 *   "sha256=<hex digest>"
 *
 * Uses crypto.timingSafeEqual to prevent timing-based side-channel attacks.
 *
 * @param secret    - The WEBHOOK_SECRET shared with GitHub
 * @param rawBody   - The raw request body buffer (before JSON parsing)
 * @param signature - The value of the X-Hub-Signature-256 header
 * @returns true if the signature is valid, false otherwise
 */
export function verifyHmac(
  secret: string,
  rawBody: Buffer,
  signature: string | undefined,
): boolean {
  if (!signature) return false;

  const expected = `sha256=${createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')}`;

  // Both buffers must be the same length before timingSafeEqual; if they
  // differ, we still need to perform the comparison to avoid timing leaks.
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(signature, 'utf8');

  if (expectedBuf.length !== actualBuf.length) return false;

  return timingSafeEqual(expectedBuf, actualBuf);
}
