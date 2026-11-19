/**
 * REST endpoints (docs/PLATFORM.md §5.3): a policy, zod schemas for params, query and body, a handler.
 * Deny by default: a route needs a policy; `public` routes must be in the list of §7.2.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, HTTPMethods } from 'fastify';
import { z } from 'zod';
import type { Actor } from '../auth/actor';
import type { RequestContext } from './context';
import { parse } from './validation';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** 'public' (§7.2) or 'guarded' (a policy runs first). Every route has one; a test walks the table. */
    policy?: 'public' | 'guarded';
  }
}

type Schema<T> = z.ZodType<T>;

export interface RouteSpec<P, Q, B, R> {
  method: HTTPMethods;
  /** Relative to /api/v1. */
  url: string;
  /** 'public', or a function that throws unauthenticated / permission-denied and returns the actor. */
  policy: 'public' | ((ctx: RequestContext) => Actor);
  params?: Schema<P>;
  query?: Schema<Q>;
  body?: Schema<B>;
  /** 204 routes answer no body. */
  status?: 200 | 204;
  /** A smaller body limit (bytes), e.g. 256 KiB for /auth/*. */
  bodyLimit?: number;
  handler: (
    ctx: RequestContext,
    input: { params: P; query: Q; body: B },
    actor: Actor | null,
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<R>;
}

/** Path parameters are opaque ids; their own length limit is Fastify's maxParamLength (100). */
export const idParam = z.string().min(1).max(100);

export function defineRoute<P = Record<string, never>, Q = Record<string, never>, B = undefined, R = unknown>(
  app: FastifyInstance,
  spec: RouteSpec<P, Q, B, R>,
): void {
  app.route({
    method: spec.method,
    url: `/api/v1${spec.url}`,
    config: { policy: spec.policy === 'public' ? 'public' : 'guarded' },
    ...(spec.bodyLimit ? { bodyLimit: spec.bodyLimit } : {}),
    handler: async (request, reply) => {
      const ctx = request.ctx;
      const actor = spec.policy === 'public' ? ctx.actor : spec.policy(ctx);
      const input = {
        params: spec.params ? parse(spec.params, request.params) : ({} as P),
        query: spec.query ? parse(spec.query, request.query ?? {}) : ({} as Q),
        body: spec.body ? parse(spec.body, request.body ?? {}) : (undefined as B),
      };
      const result = await spec.handler(ctx, input, actor, request, reply);
      if (reply.sent || (result as unknown) === reply) return reply;
      if (spec.status === 204) return reply.code(204).send();
      return reply.code(200).send(result);
    },
  });
}
