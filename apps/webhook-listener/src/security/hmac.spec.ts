import { verifyHmac } from './hmac';
import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';

describe('verifyHmac', () => {
  const secret = 'testsecret';

  it('returns true for a valid signature', () => {
    const payload = Buffer.from('testpayload');
    const hash =
      'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
    expect(verifyHmac(secret, payload, hash)).toBe(true);
  });

  it('returns false for an undefined signature', () => {
    const payload = Buffer.from('testpayload');
    expect(verifyHmac(secret, payload, undefined)).toBe(false);
  });

  it('returns false for a signature with the wrong prefix', () => {
    const payload = Buffer.from('testpayload');
    const hash =
      'sha1=' + createHmac('sha256', secret).update(payload).digest('hex');
    expect(verifyHmac(secret, payload, hash)).toBe(false);
  });

  it('returns false for a signature with the wrong length', () => {
    const payload = Buffer.from('testpayload');
    const hash = 'sha256=' + '123';
    expect(verifyHmac(secret, payload, hash)).toBe(false);
  });

  it('returns false for a signature with non-hex characters', () => {
    const payload = Buffer.from('testpayload');
    const hash = 'sha256=' + 'g'.repeat(64); // 'g' is not a valid hex character
    expect(verifyHmac(secret, payload, hash)).toBe(false);
  });

  it('returns false for a valid format but wrong secret', () => {
    const payload = Buffer.from('testpayload');
    const hash =
      'sha256=' +
      createHmac('sha256', 'wrongsecret').update(payload).digest('hex');
    expect(verifyHmac(secret, payload, hash)).toBe(false);
  });

  it('returns true for a valid signature over an empty payload', () => {
    const payload = Buffer.alloc(0);
    const hash =
      'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
    expect(verifyHmac(secret, payload, hash)).toBe(true);
  });
});
