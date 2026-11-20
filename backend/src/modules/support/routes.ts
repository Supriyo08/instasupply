/**
 * Customer and store support (docs/PLATFORM.md §5.3.6, MARKETPLACE D11): one thread per customer (`{uid}`)
 * and one per store (`store_{storeId}`, shared by its members). Staff read and post into every thread and
 * alone change status and assignee; the owner reads and posts into their own thread. Each side resets only
 * its own unread counter. Message lists answer the newest `limit` messages oldest first; `nextCursor` pages
 * into the past.
 */
import type { Page, SupportMessage, SupportThread, WithId } from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import { requireAuth, requireStaff } from '../../platform/auth/policies';
import { withTransaction } from '../../platform/db/tx';
import { invalidArgument, notFound } from '../../platform/http/errors';
import { decodeCursor, readPage } from '../../platform/http/pagination';
import { consumeAll, use } from '../../platform/http/rate-limit';
import { defineRoute } from '../../platform/http/route';
import { requireThreadAccess, senderRoleOf } from './access';
import { postSupportMessage } from './messages';
import {
  activeStaffName,
  findThread,
  listMessages,
  listThreads,
  lockThread,
  markThreadRead,
  messageCursorKey,
  patchThread,
  threadCursorKey,
  toSupportMessage,
  toSupportThread,
} from './repository';
import {
  MessageListQuerySchema,
  SupportMessageInputSchema,
  SupportThreadPatchSchema,
  ThreadListQuerySchema,
  threadParams,
} from './schemas';

function cursorOf(cursor: string | undefined): [number, string] | null {
  if (cursor === undefined) return null;
  const [value, id] = decodeCursor(cursor);
  if (typeof value !== 'number') invalidArgument('That page cursor is not valid. Reload the list.');
  return [value, id];
}

export function registerSupportRoutes(app: FastifyInstance): void {
  defineRoute(app, {
    method: 'GET',
    url: '/support-threads',
    policy: requireStaff,
    query: ThreadListQuerySchema,
    handler: async (ctx, { query }): Promise<Page<WithId<SupportThread>>> => {
      const rows = await listThreads(
        ctx.deps.pool,
        { kind: query.kind ?? null, status: query.status ?? null, unread: query.unread === 'true' },
        cursorOf(query.cursor),
        query.limit,
      );
      return readPage(rows, query.limit, toSupportThread, threadCursorKey);
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: '/support-threads/:threadId',
    policy: requireAuth,
    params: threadParams,
    handler: async (ctx, { params }, actor): Promise<WithId<SupportThread>> => {
      requireThreadAccess(actor!, params.threadId);
      const thread = await findThread(ctx.deps.pool, params.threadId);
      if (!thread) notFound('There are no messages in this conversation yet.');
      return thread;
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: '/support-threads/:threadId/messages',
    policy: requireAuth,
    params: threadParams,
    query: MessageListQuerySchema,
    handler: async (ctx, { params, query }, actor): Promise<Page<SupportMessage>> => {
      requireThreadAccess(actor!, params.threadId);
      const before = cursorOf(query.cursor);
      const rows = await listMessages(ctx.deps.pool, params.threadId, before?.[0] ?? null, query.limit);
      const page = readPage(rows, query.limit, toSupportMessage, messageCursorKey);
      return { items: page.items.reverse(), nextCursor: page.nextCursor };
    },
  });

  defineRoute(app, {
    method: 'POST',
    url: '/support-threads/:threadId/messages',
    policy: requireAuth,
    params: threadParams,
    body: SupportMessageInputSchema,
    handler: async (ctx, { params, body }, actor): Promise<SupportMessage> => {
      const me = actor!;
      requireThreadAccess(me, params.threadId);
      await consumeAll(ctx.deps, [use('support_message', me.uid)]);
      const { message } = await withTransaction(ctx.deps, (tx) =>
        postSupportMessage(tx, {
          threadId: params.threadId,
          id: body.id,
          text: body.text,
          context: body.context,
          sender: { uid: me.uid, name: me.name, role: senderRoleOf(me) },
        }),
      );
      return message;
    },
  });

  defineRoute(app, {
    method: 'POST',
    url: '/support-threads/:threadId/read',
    policy: requireAuth,
    params: threadParams,
    status: 204,
    handler: async (ctx, { params }, actor) => {
      const side = requireThreadAccess(actor!, params.threadId);
      await withTransaction(ctx.deps, (tx) => markThreadRead(tx, params.threadId, side));
    },
  });

  defineRoute(app, {
    method: 'PATCH',
    url: '/support-threads/:threadId',
    policy: requireStaff,
    params: threadParams,
    body: SupportThreadPatchSchema,
    handler: async (ctx, { params, body }): Promise<WithId<SupportThread>> => {
      let assigned: { to: string | null; name: string | null } | undefined;
      if (body.assignedTo !== undefined) {
        if (body.assignedTo === null) assigned = { to: null, name: null };
        else {
          const name = await activeStaffName(ctx.deps.pool, body.assignedTo);
          if (name === null) {
            invalidArgument('Assign the conversation to an active staff member.', {
              fields: { assignedTo: 'not an active staff member' },
            });
          }
          assigned = { to: body.assignedTo, name };
        }
      }
      return withTransaction(ctx.deps, async (tx) => {
        const thread = await lockThread(tx, params.threadId);
        if (!thread) notFound('There are no messages in this conversation yet.');
        await patchThread(tx, params.threadId, {
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(assigned !== undefined ? { assigned } : {}),
        });
        const saved = await findThread(tx, params.threadId);
        return saved!;
      });
    },
  });
}
