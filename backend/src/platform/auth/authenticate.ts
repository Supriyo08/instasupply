/**
 * Authorization header → ctx.actor (docs/PLATFORM.md §6.4). A failure is recorded, not thrown: public
 * endpoints still answer, and `requireAuth` throws the recorded reason so the client knows whether to
 * refresh, end the session or show "account suspended".
 */
import type { Deps } from '../../container';
import type { ApiError } from '../http/errors';
import { loadActor, type Actor } from './actor';
import { suspendedError, unauthenticated } from './policies';
import { verifyAccessToken } from './tokens';

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type Authentication = { actor: Actor | null; failure: ApiError | null };

export async function authenticateToken(deps: Deps, token: string): Promise<Authentication> {
  const now = deps.clock.now();
  const verified = await verifyAccessToken(deps.config, token, now);
  if (!verified.ok) return { actor: null, failure: unauthenticated(verified.reason) };
  const loaded = await loadActor(deps.pool, verified.uid, verified.sessionId, now);
  if (!loaded.ok) {
    return {
      actor: null,
      failure: loaded.reason === 'account_suspended' ? suspendedError() : unauthenticated('session_revoked'),
    };
  }
  if (now - loaded.lastUsedAt >= TOUCH_INTERVAL_MS) {
    // Diagnostics only; the request does not wait for it and a failure changes nothing for the caller.
    deps.pool
      .query('UPDATE sessions SET last_used_at = $2 WHERE id = $1 AND last_used_at < $2', [
        verified.sessionId,
        new Date(now),
      ])
      .catch((error: unknown) => deps.log.warn({ err: error }, 'session touch failed'));
  }
  return { actor: loaded.actor, failure: null };
}

/** The bearer token of an Authorization header, or null when there is none. */
export function bearerToken(header: string | undefined): string | null | 'malformed' {
  if (header === undefined || header === '') return null;
  const match = /^Bearer ([A-Za-z0-9_\-.]+)$/.exec(header.trim());
  return match ? match[1]! : 'malformed';
}

export async function authenticateHeader(deps: Deps, header: string | undefined): Promise<Authentication> {
  const token = bearerToken(header);
  if (token === null) return { actor: null, failure: null };
  if (token === 'malformed') return { actor: null, failure: unauthenticated('token_invalid') };
  return authenticateToken(deps, token);
}
