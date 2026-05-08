import { createHmac, timingSafeEqual } from 'crypto';

// SHA-256 produces 32 bytes = 64 hex characters.
const EXPECTED_PREFIX = 'sha256=';
const DIGEST_HEX_LENGTH = 64;
const EXPECTED_SIG_LENGTH = EXPECTED_PREFIX.length + DIGEST_HEX_LENGTH;

/**
 * Verify a GitHub webhook HMAC-SHA256 signature.
 *
 * GitHub sends the signature in the X-Hub-Signature-256 header as:
 *   "sha256=<64-char hex digest>"
 *
 * Compares raw 32-byte digest buffers (not hex strings) via timingSafeEqual
 * to prevent timing-based side-channel attacks. If the provided signature is
 * malformed, a dummy comparison is still performed so the function takes
 * constant time regardless of whether the signature is valid or not.
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
  // Compute expected digest as a 32-byte Buffer.
  const expectedDigest = createHmac('sha256', secret).update(rawBody).digest();

  if (!signature || signature.length !== EXPECTED_SIG_LENGTH) {
    // Wrong format — run a dummy comparison to keep constant time.
    timingSafeEqual(expectedDigest, Buffer.alloc(expectedDigest.length));
    return false;
  }

  // Decode the 64-char hex portion into a 32-byte Buffer.
  const providedDigest = Buffer.from(
    signature.slice(EXPECTED_PREFIX.length),
    'hex',
  );

  // If the hex was invalid, Buffer.from returns a zero-padded buffer of the
  // same length — timingSafeEqual still works and returns false safely.
  return timingSafeEqual(expectedDigest, providedDigest);
}
