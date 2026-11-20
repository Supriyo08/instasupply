/**
 * The store-order REST endpoints of docs/PLATFORM.md §5.3.5: HTTP only (policy, schema, the object check of
 * §7.3 on the loaded row, serialize). A supplier's list is always scoped to their own store (§7.4); a customer
 * lists the store orders of one of their own orders.
 */
import type { Page, StoreOrder, StoreOrderPrivateMeta, StoreOrderProof } from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../container';
import type { Actor } from '../../platform/auth/actor';
import { requireAuth, requireStaff, resolveStoreScope } from '../../platform/auth/policies';
import { invalidArgument, notFound, permissionDenied } from '../../platform/http/errors';
import { decodeCursor, readPage, type CursorValue } from '../../platform/http/pagination';
import type { RequestContext } from '../../platform/http/context';
import { defineRoute } from '../../platform/http/route';
import { fileUrl } from '../../platform/storage/files.service';
import { canReadStoreOrder } from './access';
import { StoreOrderListQuerySchema, StoreOrderParamsSchema, type StoreOrderListQuery } from './schemas';
import {
  findStoreOrder,
  listStoreOrders,
  orderCustomerId,
  readDelivery,
  readMeta,
  toStoreOrder,
  type StoreOrderFilter,
  type StoreOrderSort,
} from './store-orders.repository';

async function scopedFilter(deps: Deps, actor: Actor, query: StoreOrderListQuery): Promise<StoreOrderFilter> {
  let storeId = query.storeId;
  let customerId = query.customerId;
  if (actor.isStaff) {
    // Staff filter freely.
  } else if (actor.role === 'supplier') {
    storeId = resolveStoreScope(actor, query.storeId);
    if (query.customerId !== undefined) invalidArgument('customerId is a staff filter.');
  } else if (actor.role === 'customer' && actor.isActive) {
    if (query.customerId !== undefined && query.customerId !== actor.uid) permissionDenied();
    if (query.orderId === undefined) {
      invalidArgument('Send the orderId of one of your orders.', { fields: { orderId: 'required' } });
    }
    const owner = await orderCustomerId(deps.pool, query.orderId);
    if (owner === null) notFound('That order does not exist.');
    if (owner !== actor.uid) permissionDenied();
    customerId = actor.uid;
  } else {
    permissionDenied();
  }

  const sort: StoreOrderSort = query.sort ?? (query.orderId !== undefined ? 'letter' : 'createdAt:desc');
  if ((sort === 'readyBy:asc' || sort === 'completedAt:desc') && storeId === undefined) {
    invalidArgument(`sort=${sort} needs a storeId.`, { fields: { storeId: 'required' } });
  }
  let after: StoreOrderFilter['after'];
  if (query.cursor) {
    const [value, id] = decodeCursor(query.cursor);
    if (sort !== 'letter' && typeof value !== 'number')
      invalidArgument('That page cursor is not valid. Reload the list.');
    after = { value, id };
  }
  return {
    orderId: query.orderId,
    storeId,
    customerId,
    statuses: query.status,
    acceptOverdue: query.acceptOverdue === 'true' ? true : undefined,
    readyByDate: query.readyByDate,
    readyByDateAfter: query.readyByDateAfter,
    completedSince: query.completedSince,
    createdSince: query.createdSince,
    sort,
    limit: query.limit,
    after,
  };
}

export async function listForActor(
  deps: Deps,
  actor: Actor,
  query: StoreOrderListQuery,
): Promise<Page<StoreOrder>> {
  const filter = await scopedFilter(deps, actor, query);
  const rows = await listStoreOrders(deps.pool, filter);
  return readPage(rows, filter.limit, toStoreOrder, (row): [CursorValue, string] => {
    switch (filter.sort) {
      case 'readyBy:asc':
        return [row.ready_by, row.id];
      case 'completedAt:desc':
        return [row.completed_at, row.id];
      case 'letter':
        return [null, row.id];
      case 'createdAt:desc':
        return [row.created_at, row.id];
    }
  });
}

async function readable(ctx: RequestContext, actor: Actor, id: string): Promise<StoreOrder> {
  const so = await findStoreOrder(ctx.deps.pool, id);
  if (!so) notFound('That order does not exist.');
  if (!canReadStoreOrder(actor, so)) permissionDenied();
  return so;
}

export function registerStoreOrderRoutes(app: FastifyInstance): void {
  defineRoute(app, {
    method: 'GET',
    url: '/store-orders',
    policy: requireAuth,
    query: StoreOrderListQuerySchema,
    handler: async (ctx, { query }, actor) => listForActor(ctx.deps, actor!, query),
  });

  defineRoute(app, {
    method: 'GET',
    url: '/store-orders/:storeOrderId',
    policy: requireAuth,
    params: StoreOrderParamsSchema,
    handler: async (ctx, { params }, actor): Promise<StoreOrder> =>
      readable(ctx, actor!, params.storeOrderId),
  });

  defineRoute(app, {
    method: 'GET',
    url: '/store-orders/:storeOrderId/private',
    policy: requireStaff,
    params: StoreOrderParamsSchema,
    handler: async (ctx, { params }): Promise<StoreOrderPrivateMeta> => {
      const meta = await readMeta(ctx.deps.pool, params.storeOrderId);
      if (!meta) notFound('That order does not exist.');
      return meta;
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: '/store-orders/:storeOrderId/proof',
    policy: requireAuth,
    params: StoreOrderParamsSchema,
    handler: async (ctx, { params }, caller): Promise<StoreOrderProof> => {
      const actor = caller!;
      const so = await findStoreOrder(ctx.deps.pool, params.storeOrderId);
      if (!so) notFound('That order does not exist.');
      // canReadProof from the store order's side: its customer, or staff (§7.3).
      if (!actor.isStaff && so.customerId !== actor.uid) permissionDenied();
      const delivery = so.deliveryId ? await readDelivery(ctx.deps.pool, so.deliveryId) : null;
      const now = ctx.deps.clock.now();
      const photoPath = delivery?.proof?.photoPath ?? null;
      const photo = photoPath ? await fileUrl(ctx, actor, photoPath) : null;
      return {
        photoUrl: photo?.url ?? null,
        expiresAt: photo?.expiresAt ?? now,
        recipientName: delivery?.proof?.recipientName ?? null,
        deliveredAt: delivery?.deliveredAt ?? null,
      };
    },
  });
}
