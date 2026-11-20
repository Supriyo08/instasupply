/**
 * modules/drivers (workstream `deliveries`, docs/PLATFORM.md §15.2): driver registration, vehicle review,
 * driver status, the payout account endpoint and the `markStaleDriversOffline` job.
 */
import type {
  OkResponse,
  RegisterDriverResponse,
  ReviewDriverVehicleRequest,
  SetDriverStatusRequest,
} from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../container';
import { requireActiveDriver, requireAdmin, requireAuth } from '../../platform/auth/policies';
import { withTransaction } from '../../platform/db/tx';
import { defineCommand } from '../../platform/http/command';
import { registerJob } from '../../platform/scheduler/registry';
import { setDriverStatus } from './driver-status';
import { reviewDriverVehicle, updateDriverVehicle } from './driver-vehicle';
import { registerDriver } from './register-driver';
import { setStaleDriversOffline } from './repository';
import { registerDriverRoutes } from './routes';
import {
  RegisterDriverRequestSchema,
  ReviewDriverVehicleRequestSchema,
  SetDriverStatusRequestSchema,
  UpdateDriverVehicleRequestSchema,
  type RegisterDriverBody,
} from './schemas';

/** A driver whose last fix is older than this is shown offline (MARKETPLACE §5.7). */
export const STALE_LOCATION_MS = 10 * 60_000;

/** `markStaleDriversOffline`, every 5 minutes (§9.5): one UPDATE, one live event per driver. */
export async function runMarkStaleDriversOffline(deps: Deps, now: number): Promise<Record<string, number>> {
  const offline = await withTransaction(deps, (tx) => setStaleDriversOffline(tx, now - STALE_LOCATION_MS), {
    now,
  });
  return { offline };
}

export function register(app: FastifyInstance, _deps: Deps): void {
  registerDriverRoutes(app);

  defineCommand<RegisterDriverBody, RegisterDriverResponse>({
    name: 'registerDriver',
    policy: requireAuth,
    schema: RegisterDriverRequestSchema,
    handler: (ctx, req, actor) => registerDriver(ctx, actor!, req),
  });
  defineCommand<SetDriverStatusRequest, OkResponse>({
    name: 'setDriverStatus',
    policy: requireAdmin,
    schema: SetDriverStatusRequestSchema,
    handler: (ctx, req, actor) => setDriverStatus(ctx, actor!, req),
  });
  defineCommand<{ vehicle: Record<string, unknown> }, OkResponse>({
    name: 'updateDriverVehicle',
    policy: requireActiveDriver,
    schema: UpdateDriverVehicleRequestSchema,
    handler: (ctx, req, actor) => updateDriverVehicle(ctx, actor!, req.vehicle),
  });
  defineCommand<ReviewDriverVehicleRequest, OkResponse>({
    name: 'reviewDriverVehicle',
    policy: requireAdmin,
    schema: ReviewDriverVehicleRequestSchema,
    handler: (ctx, req) => reviewDriverVehicle(ctx, req),
  });
  registerJob({
    name: 'markStaleDriversOffline',
    schedule: { everyMs: 5 * 60_000 },
    run: runMarkStaleDriversOffline,
  });
}
