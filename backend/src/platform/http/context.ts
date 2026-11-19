import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import type { Deps } from '../../container';
import type { Actor } from '../auth/actor';
import type { ApiError } from './errors';

/** What every route and command handler gets (docs/PLATFORM.md §2.1). */
export interface RequestContext {
  /** The signed-in caller, or null for an anonymous request (or one whose token failed, see authFailure). */
  actor: Actor | null;
  /** Why the token was refused, when one was sent; `requireAuth` throws it. */
  authFailure: ApiError | null;
  /** clientAddress(req): the only address the server ever uses (§4.6). Never logged raw. */
  ip: string;
  requestId: string;
  log: FastifyBaseLogger;
  deps: Deps;
  /** publicOrigin(req): media and local upload URLs are built on it (§11.1). */
  origin: string;
  /** The X-Client header, when sent (`customer/1.4.0 (android)`). */
  client: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    ctx: RequestContext;
  }
}

export const contextOf = (request: FastifyRequest): RequestContext => request.ctx;

/** `customer/1.4.0 (android)` → its parts; anything else → nulls. */
export function parseClientHeader(value: string | null): {
  name: string | null;
  version: string | null;
  platform: 'ios' | 'android' | 'web' | null;
} {
  const match = value
    ? /^([a-z][a-z0-9-]{0,30})\/([0-9A-Za-z.+-]{1,30})(?: \((ios|android|web)\))?$/.exec(value)
    : null;
  if (!match) return { name: null, version: null, platform: null };
  return {
    name: match[1]!,
    version: match[2]!,
    platform: (match[3] as 'ios' | 'android' | 'web' | undefined) ?? null,
  };
}
