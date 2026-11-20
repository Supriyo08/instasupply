/**
 * `createDeliveries` (staff, MARKETPLACE §5.4; docs/PLATFORM.md §9.2.13), port of
 * legacy/…/create-deliveries.ts: manual deliveries (`kind: 'manual'`, no COD). Rows are validated with the
 * shared `validateDeliveryInput` (a row without a pin is geocoded first); a bad row is reported in
 * `errors` and the others are created. Rows are
 * written in transactions of 80, each locking its pre-assigned drivers first, so `TOO_MANY_JOBS` holds.
 */
import {
  ACTIVE_STATUSES,
  MAX_ACTIVE_JOBS_PER_DRIVER,
  validateDeliveryInput,
  type CreateDeliveriesResponse,
  type DeliveryInput,
  type LatLng,
} from '@instasupply/shared';
import type { Actor } from '../../platform/auth/actor';
import { lockGraph } from '../../platform/db/locks';
import { nextNumber } from '../../platform/db/sequences';
import { withTransaction } from '../../platform/db/tx';
import type { RequestContext } from '../../platform/http/context';
import { geocodeFirst } from '../geocoding';
import { applyDeliveryEffects } from './delivery-effects';
import { eventActorOf, stageNewDelivery } from './delivery-writer';
import { countActiveDeliveries } from './repository';

const DELIVERIES_PER_TRANSACTION = 80;

const firstError = (errors: Record<string, string | undefined>): string =>
  Object.values(errors).find((message): message is string => typeof message === 'string') ??
  'Invalid delivery.';

export async function createDeliveries(
  ctx: RequestContext,
  actor: Actor,
  rows: readonly Record<string, unknown>[],
): Promise<CreateDeliveriesResponse> {
  const errors: CreateDeliveriesResponse['errors'] = [];
  const valid: { index: number; input: DeliveryInput; location: LatLng }[] = [];

  // 1. Validate, and geocode rows that came without a pin (before any transaction, §9.2.13).
  let lastLocation: LatLng | null = null;
  for (const [index, raw] of rows.entries()) {
    const result = validateDeliveryInput(raw);
    if (!result.ok) {
      errors.push({ index, message: firstError(result.errors) });
      continue;
    }
    const near: LatLng | null = lastLocation;
    const location: LatLng | null =
      result.value.location ?? (await geocodeFirst(ctx.deps, result.value.address, near));
    if (!location) {
      errors.push({ index, message: "We couldn't find this address. Drop a pin on the map instead." });
      continue;
    }
    lastLocation = location;
    valid.push({ index, input: result.value, location });
  }

  // 2. Every referenced driver must be an approved driver.
  const driverIds = [...new Set(valid.map((item) => item.input.driverId).filter((id): id is string => !!id))];
  const drivers = new Map<string, string>();
  if (driverIds.length > 0) {
    const { rows: found } = await ctx.deps.pool.query<{ id: string; display_name: string }>(
      `SELECT id, display_name FROM users WHERE id = ANY($1::text[]) AND role = 'driver' AND status = 'active'`,
      [driverIds],
    );
    for (const row of found) drivers.set(row.id, row.display_name);
  }
  const ready = valid.filter((item) => {
    if (item.input.driverId && !drivers.has(item.input.driverId)) {
      errors.push({ index: item.index, message: 'The selected driver is not available.' });
      return false;
    }
    return true;
  });

  // 3. Write them in batches.
  const created: CreateDeliveriesResponse['created'] = [];
  const who = { ...eventActorOf(actor), id: actor.uid };
  for (let start = 0; start < ready.length; start += DELIVERIES_PER_TRANSACTION) {
    const batch = ready.slice(start, start + DELIVERIES_PER_TRANSACTION);
    const batchDrivers = [
      ...new Set(batch.map((item) => item.input.driverId).filter((id): id is string => !!id)),
    ];
    const outcome = await withTransaction(ctx.deps, async (tx) => {
      const graph = await lockGraph(tx, { userIds: batchDrivers });
      const made: CreateDeliveriesResponse['created'] = [];
      const refused: CreateDeliveriesResponse['errors'] = [];
      const active = new Map<string, number>();
      for (const id of batchDrivers) active.set(id, await countActiveDeliveries(tx, id, ACTIVE_STATUSES));
      for (const item of batch) {
        const driverId = item.input.driverId;
        if (driverId) {
          const count = active.get(driverId) ?? 0;
          if (count >= MAX_ACTIVE_JOBS_PER_DRIVER) {
            refused.push({
              index: item.index,
              message: `${drivers.get(driverId)} already has ${MAX_ACTIVE_JOBS_PER_DRIVER} active jobs.`,
            });
            continue;
          }
          active.set(driverId, count + 1);
        }
        const number = await nextNumber(tx, 'order');
        const delivery = await stageNewDelivery(tx, {
          input: item.input,
          location: item.location,
          orderId: `IS-${number}`,
          driver: driverId ? { id: driverId, name: drivers.get(driverId)! } : null,
          actor: who,
        });
        const { trackingToken, ...doc } = delivery;
        await applyDeliveryEffects(tx, graph, null, doc);
        made.push({ index: item.index, id: delivery.id, orderId: delivery.orderId, trackingToken });
      }
      return { made, refused };
    });
    created.push(...outcome.made);
    errors.push(...outcome.refused);
  }

  return { created, errors: errors.sort((a, b) => a.index - b.index) };
}
