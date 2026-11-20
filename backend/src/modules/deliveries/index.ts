/**
 * modules/deliveries (workstream `deliveries`, docs/PLATFORM.md §15.2): the delivery commands, the
 * deliveries endpoints, and the cross-module helpers of §9.1 (`stageMarketplaceDelivery`,
 * `stageDeliveryCancellation`, `applyDeliveryEffects`).
 */
import type {
  AssignDeliveryRequest,
  CheckInAtStoreRequest,
  CompleteDeliveryRequest,
  CreateDeliveriesResponse,
  OkResponse,
  ResolveFailedDeliveryRequest,
  UpdateDeliveryStatusRequest,
  UpdateDeliveryStatusResponse,
} from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../container';
import { requireActiveDriver, requireOperator, requireStaff } from '../../platform/auth/policies';
import { defineCommand } from '../../platform/http/command';
import { assignDelivery } from './assign-delivery';
import { checkInAtStore } from './check-in';
import { createDeliveries } from './create-deliveries';
import { configureDeliveryEffects } from './delivery-effects';
import { resolveFailedDelivery } from './resolve-failed';
import { registerDeliveryRoutes } from './routes';
import {
  AssignDeliveryRequestSchema,
  CheckInAtStoreRequestSchema,
  CompleteDeliveryRequestSchema,
  CreateDeliveriesRequestSchema,
  ResolveFailedDeliveryRequestSchema,
  UpdateDeliveryStatusRequestSchema,
} from './schemas';
import { completeDelivery, updateDeliveryStatus } from './update-status';

export { applyDeliveryEffects } from './delivery-effects';
export {
  stageDeliveryCancellation,
  stageMarketplaceDelivery,
  type EventActor,
  type MarketplaceDeliveryInput,
} from './delivery-writer';

export function register(app: FastifyInstance, deps: Deps): void {
  configureDeliveryEffects(deps.config);
  registerDeliveryRoutes(app);

  defineCommand<{ deliveries: Record<string, unknown>[] }, CreateDeliveriesResponse>({
    name: 'createDeliveries',
    policy: requireStaff,
    schema: CreateDeliveriesRequestSchema,
    handler: (ctx, req, actor) => createDeliveries(ctx, actor!, req.deliveries),
  });
  defineCommand<AssignDeliveryRequest, OkResponse>({
    name: 'assignDelivery',
    policy: requireStaff,
    schema: AssignDeliveryRequestSchema,
    handler: (ctx, req, actor) => assignDelivery(ctx, actor!, req),
  });
  defineCommand<UpdateDeliveryStatusRequest, UpdateDeliveryStatusResponse>({
    name: 'updateDeliveryStatus',
    policy: requireOperator,
    schema: UpdateDeliveryStatusRequestSchema,
    handler: (ctx, req, actor) => updateDeliveryStatus(ctx, actor!, req),
  });
  defineCommand<CompleteDeliveryRequest, OkResponse>({
    name: 'completeDelivery',
    policy: requireOperator,
    schema: CompleteDeliveryRequestSchema,
    handler: (ctx, req, actor) => completeDelivery(ctx, actor!, req),
  });
  defineCommand<CheckInAtStoreRequest, OkResponse>({
    name: 'checkInAtStore',
    policy: requireActiveDriver,
    schema: CheckInAtStoreRequestSchema,
    handler: (ctx, req, actor) => checkInAtStore(ctx, actor!, req),
  });
  defineCommand<ResolveFailedDeliveryRequest, OkResponse>({
    name: 'resolveFailedDelivery',
    policy: requireStaff,
    schema: ResolveFailedDeliveryRequestSchema,
    handler: (ctx, req, actor) => resolveFailedDelivery(ctx, actor!, req),
  });
}
