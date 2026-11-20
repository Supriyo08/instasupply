/**
 * The store-order module (docs/PLATFORM.md §2.1, §15.2 `store-orders`): the four store-order commands, the
 * `GET /store-orders…` endpoints and the jobs `escalateStoreOrders` and `expirePickupHolds`. Other modules
 * call its §9.1 helpers, re-exported here.
 */
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../container';
import { requireAuth } from '../../platform/auth/policies';
import { defineCommand } from '../../platform/http/command';
import { registerJob } from '../../platform/scheduler/registry';
import { acceptStoreOrder } from './accept-store-order';
import { completePickup } from './complete-pickup';
import { rejectStoreOrder } from './reject-store-order';
import { registerStoreOrderRoutes } from './routes';
import { escalateStoreOrders, expirePickupHolds } from './scheduled';
import {
  AcceptStoreOrderRequestSchema,
  CompletePickupRequestSchema,
  RejectStoreOrderRequestSchema,
  UpdateStoreOrderStatusRequestSchema,
} from './schemas';
import { updateStoreOrderStatus } from './update-store-order-status';

export { canActOnStoreOrder, canReadStoreOrder, orderActorFrom, SYSTEM_ORDER_ACTOR } from './access';
export { projectDriverOntoStoreOrder } from './driver-projection';
export { MAX_PICKUP_CODE_ATTEMPTS, stagePickupCode } from './pickup-code';
export {
  stageStockCommit,
  stageStockRelease,
  stageStockReserve,
  stageStockReturn,
  stockLinesOf,
  type StockLine,
} from './stock';
export { applyStoreOrderEffects } from './store-order-effects';
export { insertStoreOrder, toStoreOrder } from './store-orders.repository';
export { stageStoreOrderTransition, type OrderActor, type StoreUnitPriceMeta } from './transitions';

const MINUTE_MS = 60_000;

export function register(app: FastifyInstance, _deps: Deps): void {
  // Policy: any signed-in caller; the handler applies canActOnStoreOrder to the row's own store (§7.4).
  defineCommand({
    name: 'acceptStoreOrder',
    policy: requireAuth,
    schema: AcceptStoreOrderRequestSchema,
    handler: (ctx, req, actor) => acceptStoreOrder(ctx.deps, actor!, req),
  });
  defineCommand({
    name: 'updateStoreOrderStatus',
    policy: requireAuth,
    schema: UpdateStoreOrderStatusRequestSchema,
    handler: (ctx, req, actor) => updateStoreOrderStatus(ctx.deps, actor!, req),
  });
  defineCommand({
    name: 'rejectStoreOrder',
    policy: requireAuth,
    schema: RejectStoreOrderRequestSchema,
    handler: (ctx, req, actor) => rejectStoreOrder(ctx.deps, actor!, req),
  });
  defineCommand({
    name: 'completePickup',
    policy: requireAuth,
    schema: CompletePickupRequestSchema,
    handler: (ctx, req, actor) => completePickup(ctx.deps, actor!, req),
  });

  registerStoreOrderRoutes(app);

  registerJob({
    name: 'escalateStoreOrders',
    schedule: { everyMs: 5 * MINUTE_MS },
    run: escalateStoreOrders,
  });
  registerJob({ name: 'expirePickupHolds', schedule: { everyMs: 30 * MINUTE_MS }, run: expirePickupHolds });
}
