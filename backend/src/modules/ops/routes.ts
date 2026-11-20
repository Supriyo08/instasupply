/**
 * Ops endpoints (docs/PLATFORM.md §5.3.10): dashboard, store statistics and job state for staff; the dev SMS
 * and email outbox for staff (rows with `sensitive = true`, codes and links, for admins only); the
 * transactional outbox and its retry for admins.
 */
import type { JobState, OpsDashboard, OpsStoreRow, OutboxEvent, Page } from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireStaff } from '../../platform/auth/policies';
import { withTransaction } from '../../platform/db/tx';
import { failedPrecondition, invalidArgument, notFound } from '../../platform/http/errors';
import { decodeCursor, pageQuerySchema, readPage } from '../../platform/http/pagination';
import { defineRoute } from '../../platform/http/route';
import { buildDashboard, buildJobStates, buildStoreRows } from './dashboard';
import {
  listDevOutbox,
  listOutboxEvents,
  outboxStatus,
  retryDeadEvent,
  type DevOutboxRow,
  type OutboxRow,
} from './repository';

/** A superset of the shared `DevOutboxMessage` (which knows SMS only), as §5.4 declares it. */
export interface OutboxMessage {
  id: string;
  channel: 'sms' | 'email';
  to: string;
  subject: string | null;
  /** Null when redacted: a sensitive message that a real provider delivered. */
  body: string | null;
  purpose: DevOutboxRow['purpose'];
  provider: DevOutboxRow['provider'];
  status: DevOutboxRow['status'];
  createdAt: number;
}

const toOutboxMessage = (row: DevOutboxRow): OutboxMessage => ({
  id: row.id,
  channel: row.channel,
  to: row.to_address,
  subject: row.subject,
  body: row.body,
  purpose: row.purpose,
  provider: row.provider,
  status: row.status,
  createdAt: row.created_at,
});

/** The payload is shown without the internal marker; a sensitive event still pending shows none. */
function toOutboxEvent(row: OutboxRow): OutboxEvent {
  const { __sensitive: sensitive, ...payload } = row.payload ?? {};
  return {
    id: row.id,
    event: row.event,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAt: row.run_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    payload: sensitive === true ? null : payload,
  };
}

const DevOutboxQuerySchema = pageQuerySchema
  .extend({ channel: z.enum(['sms', 'email']).optional() })
  .strict();
const OutboxQuerySchema = pageQuerySchema
  .extend({ status: z.enum(['pending', 'processing', 'dead']).optional() })
  .strict();

const single = <T>(items: T[]): Page<T> => ({ items, nextCursor: null });

export function registerOpsRoutes(app: FastifyInstance): void {
  defineRoute(app, {
    method: 'GET',
    url: '/ops/dashboard',
    policy: requireStaff,
    handler: (ctx): Promise<OpsDashboard> => buildDashboard(ctx.deps, ctx.deps.clock.now()),
  });

  defineRoute(app, {
    method: 'GET',
    url: '/ops/stores',
    policy: requireStaff,
    handler: async (ctx): Promise<Page<OpsStoreRow>> =>
      single(await buildStoreRows(ctx.deps, ctx.deps.clock.now(), ctx.origin)),
  });

  defineRoute(app, {
    method: 'GET',
    url: '/ops/jobs',
    policy: requireStaff,
    handler: async (ctx): Promise<Page<JobState>> => single(await buildJobStates(ctx.deps)),
  });

  defineRoute(app, {
    method: 'GET',
    url: '/dev-outbox',
    policy: requireStaff,
    query: DevOutboxQuerySchema,
    handler: async (ctx, { query }, actor): Promise<Page<OutboxMessage>> => {
      let after: [number, string] | null = null;
      if (query.cursor !== undefined) {
        const [value, id] = decodeCursor(query.cursor);
        if (typeof value !== 'number') invalidArgument('That page cursor is not valid. Reload the list.');
        after = [value, id];
      }
      const rows = await listDevOutbox(
        ctx.deps.pool,
        { channel: query.channel ?? null, includeSensitive: actor!.isAdmin },
        after,
        query.limit,
      );
      return readPage(rows, query.limit, toOutboxMessage, (row) => [row.created_at, row.id]);
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: '/ops/outbox-events',
    policy: requireAdmin,
    query: OutboxQuerySchema,
    handler: async (ctx, { query }): Promise<Page<OutboxEvent>> => {
      let before: number | null = null;
      if (query.cursor !== undefined) {
        const [value] = decodeCursor(query.cursor);
        if (typeof value !== 'number') invalidArgument('That page cursor is not valid. Reload the list.');
        before = value;
      }
      const rows = await listOutboxEvents(ctx.deps.pool, query.status ?? null, before, query.limit);
      return readPage(rows, query.limit, toOutboxEvent, (row) => [row.id, String(row.id)]);
    },
  });

  defineRoute(app, {
    method: 'POST',
    url: '/ops/outbox-events/:id/retry',
    policy: requireAdmin,
    params: z.object({ id: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
    status: 204,
    handler: async (ctx, { params }) => {
      const status = await outboxStatus(ctx.deps.pool, params.id);
      if (status === null) notFound('That outbox event does not exist.');
      if (status !== 'dead') failedPrecondition('Only a dead event can be retried.', { status });
      const after = await withTransaction(ctx.deps, (tx) => retryDeadEvent(tx, params.id));
      if (after === null) failedPrecondition('Only a dead event can be retried.');
    },
  });
}
