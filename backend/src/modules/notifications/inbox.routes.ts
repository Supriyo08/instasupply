/**
 * The inbox (docs/PLATFORM.md §5.3.3): `GET /notifications`, `GET /notifications/unread-count`,
 * `POST /notifications/{id}/read`, `POST /notifications/read-all`, `DELETE /notifications/{id}`. Any signed-in
 * account; only the recipient reads, marks or deletes a notification, and nothing but `read` can change.
 */
import type { AppNotification, Page } from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../platform/auth/policies';
import { withTransaction } from '../../platform/db/tx';
import { invalidArgument, notFound, permissionDenied } from '../../platform/http/errors';
import { decodeCursor, pageQuerySchema, readPage } from '../../platform/http/pagination';
import { defineRoute, idParam } from '../../platform/http/route';
import {
  countUnread,
  deleteNotification,
  findRecipient,
  listNotifications,
  markAllRead,
  markRead,
  notificationCursorKey,
  toNotification,
} from './repository';

const InboxQuerySchema = pageQuerySchema.extend({ unread: z.enum(['true', 'false']).optional() }).strict();
const idParams = z.object({ id: idParam });

function timeCursor(cursor: string | undefined): [number, string] | null {
  if (cursor === undefined) return null;
  const [value, id] = decodeCursor(cursor);
  if (typeof value !== 'number') invalidArgument('That page cursor is not valid. Reload the list.');
  return [value, id];
}

/** The recipient check: unknown → not-found, someone else's → permission-denied. */
async function requireRecipient(db: Parameters<typeof findRecipient>[0], id: string, uid: string) {
  const recipient = await findRecipient(db, id);
  if (recipient === null) notFound('That notification does not exist.');
  if (recipient !== uid) permissionDenied();
}

export function registerInboxRoutes(app: FastifyInstance): void {
  defineRoute(app, {
    method: 'GET',
    url: '/notifications',
    policy: requireAuth,
    query: InboxQuerySchema,
    handler: async (ctx, { query }, actor): Promise<Page<AppNotification>> => {
      const rows = await listNotifications(
        ctx.deps.pool,
        actor!.uid,
        { unread: query.unread === 'true' },
        timeCursor(query.cursor),
        query.limit,
      );
      return readPage(rows, query.limit, toNotification, notificationCursorKey);
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: '/notifications/unread-count',
    policy: requireAuth,
    handler: async (ctx, _input, actor): Promise<{ count: number }> => ({
      count: await countUnread(ctx.deps.pool, actor!.uid),
    }),
  });

  defineRoute(app, {
    method: 'POST',
    url: '/notifications/read-all',
    policy: requireAuth,
    status: 204,
    handler: async (ctx, _input, actor) => {
      await withTransaction(ctx.deps, (tx) => markAllRead(tx, actor!.uid));
    },
  });

  defineRoute(app, {
    method: 'POST',
    url: '/notifications/:id/read',
    policy: requireAuth,
    params: idParams,
    status: 204,
    handler: async (ctx, { params }, actor) => {
      await requireRecipient(ctx.deps.pool, params.id, actor!.uid);
      await withTransaction(ctx.deps, (tx) => markRead(tx, params.id, actor!.uid));
    },
  });

  defineRoute(app, {
    method: 'DELETE',
    url: '/notifications/:id',
    policy: requireAuth,
    params: idParams,
    status: 204,
    handler: async (ctx, { params }, actor) => {
      await requireRecipient(ctx.deps.pool, params.id, actor!.uid);
      await withTransaction(ctx.deps, (tx) => deleteNotification(tx, params.id, actor!.uid));
    },
  });
}
