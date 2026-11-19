/**
 * scrypt from node:crypto (docs/PLATFORM.md §6.1): N = 2^15, r = 8, p = 3, 32-byte key, 16-byte salt. The
 * parameters are stored in the hash string, so tests can hash cheaply (N = 2^10) without a special case in
 * verification, and `needsRehash` can upgrade old hashes at login.
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { isTestProcess } from '../../config/env';

interface Params {
  N: number;
  r: number;
  p: number;
}

const PRODUCTION: Params = { N: 2 ** 15, r: 8, p: 3 };
const TEST: Params = { N: 2 ** 10, r: 8, p: 1 };
const KEY_LENGTH = 32;
const MAXMEM = 64 * 1024 * 1024;

export const MAX_PASSWORD_LENGTH = 128;

function currentParams(): Params {
  return isTestProcess() ? TEST : PRODUCTION;
}

function derive(password: string, salt: Buffer, params: Params): Promise<Buffer> {
  const options: ScryptOptions = { N: params.N, r: params.r, p: params.p, maxmem: MAXMEM };
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, options, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const params = currentParams();
  const salt = randomBytes(16);
  const key = await derive(password, salt, params);
  return [
    'scrypt',
    `N=${params.N},r=${params.r},p=${params.p}`,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

const HASH = /^scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

function parseHash(stored: string): { params: Params; salt: Buffer; key: Buffer } | null {
  const match = HASH.exec(stored);
  if (!match) return null;
  return {
    params: { N: Number(match[1]), r: Number(match[2]), p: Number(match[3]) },
    salt: Buffer.from(match[4]!, 'base64url'),
    key: Buffer.from(match[5]!, 'base64url'),
  };
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const key = await derive(password, parsed.salt, parsed.params);
  return key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
}

export function needsRehash(stored: string): boolean {
  const parsed = parseHash(stored);
  if (!parsed) return true;
  const want = currentParams();
  return parsed.params.N < want.N || parsed.params.r < want.r || parsed.params.p < want.p;
}

/**
 * A fixed hash with the current cost, verified when there is no account (or no password yet), so a login
 * for an unknown email takes as long as one for a known email.
 */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(12).toString('base64url'));
  return dummyHash;
}
