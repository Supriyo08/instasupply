/**
 * The common part of the four store-order commands (docs/PLATFORM.md §9.2.2, §9.2.4): keys first, the object
 * check on the row's own store (§7.4), then the locks in rank order and the version check under lock.
 */
import type { Delivery, StoreOrder } from '@instasupply/shared';
import type { Deps } from '../../container';
import type { Actor } from '../../platform/auth/actor';
import { lockGraph, type LockedGraph } from '../../platform/db/locks';
import type { Tx } from '../../platform/db/tx';
import { ApiError, failCode, notFound, permissionDenied } from '../../platform/http/errors';
import { canActOnStoreOrder } from './access';
import { loadStoreOrderKeys, toStoreOrder, type StoreOrderKeys } from './store-orders.repository';

export async function keysForAction(deps: Deps, actor: Actor, storeOrderId: string): Promise<StoreOrderKeys> {
  const keys = await loadStoreOrderKeys(deps.pool, storeOrderId);
  if (!keys) notFound('That order does not exist.');
  if (!canActOnStoreOrder(actor, keys)) permissionDenied();
  return keys;
}

export interface Locked {
  graph: LockedGraph;
  so: StoreOrder;
}

/** users → orders → store_orders → deliveries → job_offers → products (catalog lines). */
export async function lockStoreOrder(
  tx: Tx,
  keys: StoreOrderKeys,
  opts: { withOffers?: boolean } = {},
): Promise<Locked> {
  const graph = await lockGraph(tx, {
    storeOrderIds: [keys.id],
    withOffers: opts.withOffers ?? true,
    productIds: keys.productIds,
  });
  const row = graph.storeOrders.get(keys.id);
  if (!row) throw new ApiError('not-found', 'That order does not exist.');
  return { graph, so: toStoreOrder(row) };
}

/** Keeps the locked snapshot of a delivery in step with what this transaction wrote. */
export function refreshDelivery(graph: LockedGraph, delivery: Delivery): void {
  const row = graph.deliveries.get(delivery.id);
  if (!row) return;
  const { id: _id, createdAt: _c, updatedAt, ...doc } = delivery;
  row.doc = doc as unknown as Record<string, unknown>;
  row.status = delivery.status;
  row.driver_id = delivery.driverId;
  row.updated_at = updatedAt;
}

export function checkVersion(so: StoreOrder, expectedVersion: number): void {
  if (so.version !== expectedVersion) {
    failCode('VERSION_CONFLICT', `${so.number} changed in the meantime. Reload it and try again.`, {
      version: so.version,
    });
  }
}
