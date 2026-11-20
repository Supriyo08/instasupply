/**
 * The dispatch ↔ driver chat (docs/PLATFORM.md §5.3.6): `GET /threads` (staff), and per driver the thread,
 * its messages, posting (staff as `staff`; the driver as `driver`, only in their own thread and only while
 * active) and resetting the caller's own unread counter. Message lists answer the newest `limit` messages
 * oldest first; `nextCursor` pages into the past.
 */
import type { ChatMessage, ChatMessageInput, ChatThread, Page, WithId } from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Actor } from '../../platform/auth/actor';
import { requireActiveDriver, requireAuth, requireStaff } from '../../platform/auth/policies';
import type { RequestContext } from '../../platform/http/context';
import { withTransaction } from '../../platform/db/tx';
import { invalidArgument, notFound, permissionDenied } from '../../platform/http/errors';
import { decodeCursor, pageQuerySchema, readPage } from '../../platform/http/pagination';
import { consumeAll, use } from '../../platform/http/rate-limit';
import { defineRoute, idParam } from '../../platform/http/route';
import { isRequestId } from '../../platform/ids';
import { postChatMessage } from './messages';
import {
  findChatThread,
  listChatMessages,
  listChatThreads,
  markChatThreadRead,
  messageCursorKey,
  threadCursorKey,
  toChatMessage,
  toChatThread,
} from './repository';

const text = (min: number, max: number) =>
  z
    .string()
    .transform((value) => value.replace(/[^\S\n]+/g, ' ').trim())
    .pipe(z.string().min(min).max(max));

export const ChatMessageInputSchema = z
  .object({
    id: z.string().refine((value) => isRequestId(value), 'Use a UUIDv4 created with api.newRequestId().'),
    text: text(1, 1000),
    deliveryId: idParam.nullable(),
    kind: z.enum(['text', 'quick_reply']),
  })
  .strict() satisfies z.ZodType<ChatMessageInput, unknown>;

const ThreadListQuerySchema = pageQuerySchema
  .extend({ sort: z.enum(['updatedAt:desc']).optional() })
  .strict();
const MessageListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(500).default(100),
    cursor: z.string().min(1).max(500).optional(),
  })
  .strict();
const driverParams = z.object({ driverId: idParam });

function cursorOf(cursor: string | undefined): [number, string] | null {
  if (cursor === undefined) return null;
  const [value, id] = decodeCursor(cursor);
  if (typeof value !== 'number') invalidArgument('That page cursor is not valid. Reload the list.');
  return [value, id];
}

/** Staff, or the driver whose thread it is (`self`). */
function requireThreadReader(actor: Actor, driverId: string): 'staff' | 'driver' {
  if (actor.isStaff) return 'staff';
  if (actor.role === 'driver' && actor.uid === driverId) return 'driver';
  return permissionDenied();
}

/** Posting: staff, or an active driver in their own thread. */
function requirePoster(ctx: RequestContext, driverId: string): { actor: Actor; side: 'staff' | 'driver' } {
  const actor = requireAuth(ctx);
  if (actor.isStaff) return { actor, side: 'staff' };
  const driver = requireActiveDriver(ctx);
  if (driver.uid !== driverId) permissionDenied();
  return { actor: driver, side: 'driver' };
}

export function registerChatRoutes(app: FastifyInstance): void {
  defineRoute(app, {
    method: 'GET',
    url: '/threads',
    policy: requireStaff,
    query: ThreadListQuerySchema,
    handler: async (ctx, { query }): Promise<Page<WithId<ChatThread>>> => {
      const rows = await listChatThreads(ctx.deps.pool, cursorOf(query.cursor), query.limit);
      return readPage(rows, query.limit, toChatThread, threadCursorKey);
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: '/threads/:driverId',
    policy: requireAuth,
    params: driverParams,
    handler: async (ctx, { params }, actor): Promise<WithId<ChatThread>> => {
      requireThreadReader(actor!, params.driverId);
      const thread = await findChatThread(ctx.deps.pool, params.driverId);
      if (!thread) notFound('There are no messages in this conversation yet.');
      return thread;
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: '/threads/:driverId/messages',
    policy: requireAuth,
    params: driverParams,
    query: MessageListQuerySchema,
    handler: async (ctx, { params, query }, actor): Promise<Page<ChatMessage>> => {
      requireThreadReader(actor!, params.driverId);
      const before = cursorOf(query.cursor);
      const rows = await listChatMessages(ctx.deps.pool, params.driverId, before?.[0] ?? null, query.limit);
      const page = readPage(rows, query.limit, toChatMessage, messageCursorKey);
      return { items: page.items.reverse(), nextCursor: page.nextCursor };
    },
  });

  defineRoute(app, {
    method: 'POST',
    url: '/threads/:driverId/messages',
    policy: requireAuth,
    params: driverParams,
    body: ChatMessageInputSchema,
    handler: async (ctx, { params, body }): Promise<ChatMessage> => {
      const { actor, side } = requirePoster(ctx, params.driverId);
      await consumeAll(ctx.deps, [use('chat_message', actor.uid)]);
      const { message } = await withTransaction(ctx.deps, (tx) =>
        postChatMessage(tx, {
          driverId: params.driverId,
          id: body.id,
          text: body.text,
          deliveryId: body.deliveryId,
          kind: body.kind,
          sender: { uid: actor.uid, name: actor.name, role: side },
        }),
      );
      return message;
    },
  });

  defineRoute(app, {
    method: 'POST',
    url: '/threads/:driverId/read',
    policy: requireAuth,
    params: driverParams,
    status: 204,
    handler: async (ctx, { params }, actor) => {
      const side = requireThreadReader(actor!, params.driverId);
      await withTransaction(ctx.deps, (tx) => markChatThreadRead(tx, params.driverId, side));
    },
  });
}
