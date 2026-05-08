import { createHmac, timingSafeEqual } from 'crypto';

// SHA-256 produces 32 bytes = 64 hex characters.
const EXPECTED_PREFIX = 'sha256=';
const DIGEST_BYTE_LENGTH = 32; // 256 bits
const DIGEST_HEX_LENGTH = DIGEST_BYTE_LENGTH * 2; // 64 hex chars
const EXPECTED_SIG_LENGTH = EXPECTED_PREFIX.length + DIGEST_HEX_LENGTH;

// Valid lowercase hex characters for strict validation.
const HEX_RE = /^[0-9a-f]{64}$/;

/**
 * Verify a GitHub webhook HMAC-SHA256 signature.
 *
 * GitHub sends the signature in the X-Hub-Signature-256 header as:
 *   "sha256=<64-char lowercase hex digest>"
 *
 * Compares raw 32-byte digest buffers via timingSafeEqual to prevent
 * timing-based side-channel attacks. All rejection paths (missing, wrong
 * length, wrong prefix, invalid hex) still run a dummy timingSafeEqual so
 * the function takes constant time regardless of the failure reason.
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

  // Validate format: must be exactly "sha256=" + 64 lowercase hex chars.
  const isValidFormat =
    !!signature &&
    signature.length === EXPECTED_SIG_LENGTH &&
    signature.startsWith(EXPECTED_PREFIX) &&
    HEX_RE.test(signature.slice(EXPECTED_PREFIX.length));

  if (!isValidFormat) {
    // Run a dummy comparison to avoid timing differences on rejection.
    timingSafeEqual(expectedDigest, Buffer.alloc(expectedDigest.length));
    return false;
  }

  // Decode the 64-char hex portion. HEX_RE guarantees valid lowercase hex so
  // Buffer.from always returns exactly 32 bytes — timingSafeEqual is safe.
  const providedDigest = Buffer.from(
    signature.slice(EXPECTED_PREFIX.length),
    'hex',
  );

  return timingSafeEqual(expectedDigest, providedDigest);
}
