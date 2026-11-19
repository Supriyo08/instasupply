/**
 * Commands: POST /api/v1/call/<name> (docs/PLATFORM.md §5.1). The request type is the body, the response
 * type the answer; the names are exactly `CALLABLES` of @instasupply/shared.
 */
import { CALLABLES, type CallableName } from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Actor } from '../auth/actor';
import type { RequestContext } from './context';
import { ApiError, notFound } from './errors';
import { consumeAll, type RateLimitUse } from './rate-limit';
import { parse } from './validation';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Set on POST /call/:name so the completion log line can name the command. */
    commandRoute?: boolean;
  }
}

export interface CommandSpec<Req, Res> {
  name: CallableName;
  /** Runs first. Throws unauthenticated / permission-denied. Returns the actor (null for public commands). */
  policy: (ctx: RequestContext) => Actor | null;
  schema: z.ZodType<Req>;
  /** Database-backed limits of §4.6, consumed before the handler. */
  limits?: (ctx: RequestContext, req: Req) => RateLimitUse[];
  handler: (ctx: RequestContext, req: Req, actor: Actor | null) => Promise<Res>;
}

interface Registered {
  spec: CommandSpec<unknown, unknown>;
  /** The wave-2 module that owns a not-implemented placeholder (§15 rule 1), else null. */
  stubOwner: string | null;
}

const registry = new Map<string, Registered>();

/**
 * Process-wide registry: every app built in this process runs the same module code, so a later
 * registration of the same name (a second app in a test file) replaces the earlier one.
 */
export function defineCommand<Req, Res>(spec: CommandSpec<Req, Res>): void {
  if (!Object.prototype.hasOwnProperty.call(CALLABLES, spec.name)) {
    throw new Error(`defineCommand: "${spec.name}" is not in CALLABLES`);
  }
  // A real registration replaces a placeholder, whatever the order of the module register() calls.
  registry.set(spec.name, { spec: spec as CommandSpec<unknown, unknown>, stubOwner: null });
}

/** A command whose module is still being written: same policy-free contract, answers internal "not implemented". */
export function defineStubCommand(name: CallableName, owner: string): void {
  const existing = registry.get(name);
  if (existing && existing.stubOwner === null) return;
  registry.set(name, {
    stubOwner: owner,
    spec: {
      name,
      policy: (ctx) => ctx.actor,
      schema: z.unknown(),
      handler: async () => {
        throw new ApiError('internal', 'not implemented', null, { command: name, owner });
      },
    },
  });
}

export function registeredCommands(): { name: string; stubOwner: string | null }[] {
  return [...registry.entries()]
    .map(([name, entry]) => ({ name, stubOwner: entry.stubOwner }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const nameSchema = z.object({ name: z.string().min(1).max(64) });

export function registerCommandRoute(app: FastifyInstance): void {
  app.post(
    '/api/v1/call/:name',
    { config: { policy: 'guarded', commandRoute: true } },
    async (request, reply) => {
      const { name } = parse(nameSchema, request.params);
      const entry = Object.prototype.hasOwnProperty.call(CALLABLES, name) ? registry.get(name) : undefined;
      if (!entry) notFound(`There is no command called ${name}.`);
      const ctx = request.ctx;
      const actor = entry.spec.policy(ctx);
      const body = parse(entry.spec.schema, request.body ?? {});
      if (entry.spec.limits) await consumeAll(ctx.deps, entry.spec.limits(ctx, body));
      const result = await entry.spec.handler(ctx, body, actor);
      return reply.code(200).send(result ?? { ok: true });
    },
  );
}
