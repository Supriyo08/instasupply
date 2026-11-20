/**
 * The commerce commands and REST endpoints (docs/PLATFORM.md §5.2, §5.3.5): registerCustomer, placeOrder,
 * cancelOrder, GET /orders and GET /orders/{orderId}.
 */
import type {
  CancelOrderRequest,
  CancelOrderResponse,
  Order,
  Page,
  PlaceOrderRequest,
  PlaceOrderResponse,
  RegisterCustomerRequest,
  RegisterCustomerResponse,
} from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Actor } from '../../platform/auth/actor';
import { requireAuth, requireCustomer } from '../../platform/auth/policies';
import { defineCommand } from '../../platform/http/command';
import type { RequestContext } from '../../platform/http/context';
import { invalidArgument, notFound, permissionDenied } from '../../platform/http/errors';
import { decodeCursor, readPage } from '../../platform/http/pagination';
import { defineRoute, idParam } from '../../platform/http/route';
import { cancelOrder } from './cancel-order';
import { listOrders, findOrder } from './orders.repository';
import { placeOrder } from './place-order';
import { registerCustomer } from './register-customer';
import {
  CancelOrderRequestSchema,
  OrdersQuerySchema,
  PlaceOrderRequestSchema,
  RegisterCustomerRequestSchema,
  type OrdersQuery,
} from './schemas';

/** A customer (own orders) or staff. */
function requireOrderReader(ctx: RequestContext): Actor {
  const actor = requireAuth(ctx);
  if (actor.isStaff) return actor;
  return requireCustomer(ctx);
}

export function registerCommerceCommands(): void {
  defineCommand<RegisterCustomerRequest, RegisterCustomerResponse>({
    name: 'registerCustomer',
    policy: requireAuth,
    schema: RegisterCustomerRequestSchema,
    handler: (ctx, req, actor) => registerCustomer(ctx.deps, actor!, req),
  });
  defineCommand<PlaceOrderRequest, PlaceOrderResponse>({
    name: 'placeOrder',
    policy: requireCustomer,
    schema: PlaceOrderRequestSchema,
    handler: (ctx, req, actor) => placeOrder(ctx.deps, actor!, req, ctx.origin),
  });
  defineCommand<CancelOrderRequest, CancelOrderResponse>({
    name: 'cancelOrder',
    policy: requireCustomer,
    schema: CancelOrderRequestSchema,
    handler: (ctx, req, actor) => cancelOrder(ctx.deps, actor!, req),
  });
}

export function registerCommerceRoutes(app: FastifyInstance): void {
  defineRoute<Record<string, never>, OrdersQuery, undefined, Page<Order>>(app, {
    method: 'GET',
    url: '/orders',
    policy: requireOrderReader,
    query: OrdersQuerySchema,
    handler: async (ctx, { query }, actor) => {
      const me = actor!;
      let customerId = query.customerId;
      if (!me.isStaff) {
        // The scoping rule of §5.3: a customer only ever gets their own rows.
        if (customerId !== undefined && customerId !== me.uid) permissionDenied();
        customerId = me.uid;
        if (
          query.storeId !== undefined ||
          query.needsAttention !== undefined ||
          query.paymentStatus !== undefined
        ) {
          invalidArgument('That filter is for staff only.', { fields: { storeId: 'staff only' } });
        }
      }
      let after: { createdAt: number; id: string } | null = null;
      if (query.cursor) {
        const [sort, id] = decodeCursor(query.cursor);
        if (typeof sort !== 'number') invalidArgument('That page cursor is not valid. Reload the list.');
        after = { createdAt: sort, id };
      }
      const rows = await listOrders(
        ctx.deps.pool,
        {
          customerId,
          statuses: query.status,
          jobsiteId: query.jobsiteId,
          storeId: query.storeId,
          needsAttention: query.needsAttention === 'true',
          paymentStatuses: query.paymentStatus,
          createdSince: query.createdSince,
          createdUntil: query.createdUntil,
        },
        query.limit,
        after,
      );
      return readPage(
        rows,
        query.limit,
        (order) => order,
        (order) => [order.createdAt, order.id],
      );
    },
  });

  defineRoute<{ orderId: string }, Record<string, never>, undefined, Order>(app, {
    method: 'GET',
    url: '/orders/:orderId',
    policy: requireOrderReader,
    params: z.object({ orderId: idParam }),
    handler: async (ctx, { params }, actor) => {
      const order = await findOrder(ctx.deps.pool, params.orderId);
      if (!order) notFound('That order does not exist.');
      if (!actor!.isStaff && order.customerId !== actor!.uid) permissionDenied();
      return order;
    },
  });
}
