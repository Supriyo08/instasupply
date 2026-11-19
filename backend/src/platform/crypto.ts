import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * The key of every HMAC (OTP_PEPPER). It is process-wide on purpose: `hmacHex(domain, value)` is the frozen
 * cross-module signature (docs/PLATFORM.md §6.1), and one process serves one configuration.
 * `createDeps` sets it from the configuration before anything is hashed.
 */
let pepper: string | null = null;

export function configureCrypto(otpPepper: string): void {
  pepper = otpPepper;
}

/**
 * HMAC-SHA256(OTP_PEPPER, domain + ':' + value). The domain prefix keeps a value hashed for one purpose (a
 * phone number as a rate-limit subject) from ever matching another (an OTP hash).
 */
export function hmacHex(domain: string, value: string): string {
  if (pepper === null) throw new Error('configureCrypto() was not called');
  return createHmac('sha256', pepper).update(`${domain}:${value}`).digest('hex');
}

export const sha256Hex = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

/** Constant-time comparison of two hex digests; different lengths are simply unequal. */
export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/** `count` uniformly random decimal digits (codes, PINs). */
export function randomDigits(count: number): string {
  let out = '';
  for (let i = 0; i < count; i += 1) out += String(randomInt(0, 10));
  return out;
}
