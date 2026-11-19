/**
 * Token formats (docs/PLATFORM.md §6.2). The access token carries identity only (sub, sid); everything the
 * old custom claims carried is read from `users` on every request.
 */
import { randomBytes } from 'node:crypto';
import { errors as joseErrors, jwtVerify, SignJWT } from 'jose';
import type { Config } from '../../config/env';
import { isRequestId } from '../ids';

const ISSUER = 'instasupply';
const AUDIENCE = 'instasupply-api';

type TokenConfig = Pick<Config, 'JWT_SECRET' | 'JWT_SECRET_PREVIOUS' | 'ACCESS_TOKEN_TTL_SECONDS'>;

const key = (secret: string): Uint8Array => new TextEncoder().encode(secret);

export async function signAccessToken(
  config: TokenConfig,
  input: { uid: string; sessionId: string; now: number },
): Promise<string> {
  const iat = Math.floor(input.now / 1000);
  return new SignJWT({ sid: input.sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(input.uid)
    .setIssuedAt(iat)
    .setExpirationTime(iat + config.ACCESS_TOKEN_TTL_SECONDS)
    .sign(key(config.JWT_SECRET));
}

export type AccessTokenResult =
  | { ok: true; uid: string; sessionId: string; exp: number }
  | { ok: false; reason: 'token_invalid' | 'token_expired' };

/** Verifies with the current secret, then with JWT_SECRET_PREVIOUS while a rotation is in progress. */
export async function verifyAccessToken(
  config: TokenConfig,
  token: string,
  now: number,
): Promise<AccessTokenResult> {
  const secrets = [config.JWT_SECRET, ...(config.JWT_SECRET_PREVIOUS ? [config.JWT_SECRET_PREVIOUS] : [])];
  let expired = false;
  for (const secret of secrets) {
    try {
      const { payload } = await jwtVerify(token, key(secret), {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
        clockTolerance: 5,
        currentDate: new Date(now),
      });
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.sid !== 'string' ||
        typeof payload.exp !== 'number'
      ) {
        return { ok: false, reason: 'token_invalid' };
      }
      return { ok: true, uid: payload.sub, sessionId: payload.sid, exp: payload.exp * 1000 };
    } catch (error) {
      // An expired token signed with a valid secret is "expired"; a signature failure tries the next secret.
      if (error instanceof joseErrors.JWTExpired) expired = true;
    }
  }
  return { ok: false, reason: expired ? 'token_expired' : 'token_invalid' };
}

/** A token secret: 32 random bytes, base64url. */
export const newSecret = (): string => randomBytes(32).toString('base64url');

export const formatRefreshToken = (tokenId: string, secret: string): string => `isr_${tokenId}.${secret}`;
export const formatSetPasswordToken = (tokenId: string, secret: string): string => `isp_${tokenId}.${secret}`;

const TOKEN = /^(isr|isp)_([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/;

export interface ParsedToken {
  tokenId: string;
  secret: string;
}

function parse(prefix: 'isr' | 'isp', value: unknown): ParsedToken | null {
  if (typeof value !== 'string') return null;
  const match = TOKEN.exec(value);
  if (!match || match[1] !== prefix || !isRequestId(match[2])) return null;
  return { tokenId: match[2]!, secret: match[3]! };
}

export const parseRefreshToken = (value: unknown): ParsedToken | null => parse('isr', value);
export const parseSetPasswordToken = (value: unknown): ParsedToken | null => parse('isp', value);
