/**
 * `storeOrder.driver`, the supplier's view of who is coming (MARKETPLACE §1.4, §2.3), called by
 * `applyDeliveryEffects` inside every delivery transaction. Monotonic: a delivery state no newer than
 * `driverSyncedAt` is ignored, and `driverSyncedAt` is kept when the driver goes away, so a late write cannot
 * bring back a driver who released the job. It writes only when the projected driver object changes
 * (docs/PLATFORM.md §9.2.13), so offer-only changes never touch `store_orders`.
 */
import { driverPhaseFor, firstName, type Delivery, type StoreOrder } from '@instasupply/shared';
import type { LockedGraph, UserRow } from '../../platform/db/locks';
import type { Tx } from '../../platform/db/tx';
import { projectOrderAggregate } from '../commerce/order-aggregate';
import { applyStoreOrderEffects } from './store-order-effects';
import { readDriverCard, readStoreOrder, saveStoreOrder } from './store-orders.repository';
import { refreshGraph } from './transitions';

type DriverSummary = NonNullable<StoreOrder['driver']>;

interface VehicleFields {
  make?: unknown;
  model?: unknown;
  plate?: unknown;
}

function vehicleOf(row: UserRow | undefined): VehicleFields | null {
  const vehicle = (row?.doc as { vehicle?: unknown } | undefined)?.vehicle;
  return vehicle && typeof vehicle === 'object' ? (vehicle as VehicleFields) : null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

async function projectedDriver(
  tx: Tx,
  graph: LockedGraph,
  so: StoreOrder,
  delivery: Delivery,
): Promise<DriverSummary | null> {
  const phase = driverPhaseFor(delivery);
  if (phase === null || !delivery.driverId) return null;
  const row = graph.users.get(delivery.driverId);
  let name = delivery.driverName ?? row?.display_name ?? '';
  let vehicle = vehicleOf(row);
  if (!row) {
    const card = await readDriverCard(tx, delivery.driverId);
    name = delivery.driverName ?? card?.displayName ?? '';
    vehicle = card?.vehicle ?? null;
  }
  const vehicleLabel = [text(vehicle?.make), text(vehicle?.model)].filter((part) => part !== '').join(' ');
  const sameDriver = so.driver !== null && so.driver.firstName === firstName(name);
  return {
    firstName: firstName(name),
    vehicleLabel,
    plate: text(vehicle?.plate),
    phase,
    arrivedAt: delivery.pickup?.arrivedAt ?? null,
    // P1 refreshes it from the driver's position; until then a value set for this driver is kept.
    etaToStoreAt: sameDriver && phase === 'to_store' ? (so.driver?.etaToStoreAt ?? null) : null,
  };
}

const sameSummary = (a: DriverSummary | null, b: DriverSummary | null): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export async function projectDriverOntoStoreOrder(
  tx: Tx,
  graph: LockedGraph,
  delivery: Delivery,
): Promise<void> {
  if (!delivery.storeOrderId) return; // a manual delivery has no store order
  const so = await readStoreOrder(tx, delivery.storeOrderId);
  if (!so) return;
  if (so.driverSyncedAt !== null && delivery.updatedAt <= so.driverSyncedAt) return;
  const driver = await projectedDriver(tx, graph, so, delivery);
  if (sameSummary(driver, so.driver)) return;

  const saved = await saveStoreOrder(tx, { ...so, driver, driverSyncedAt: delivery.updatedAt });
  refreshGraph(graph, saved);
  await applyStoreOrderEffects(tx, graph, so, saved);
  // The order summary shows the driver's first name. Only when this transaction holds the order's lock
  // (it always does through lockGraph): never lock out of rank order here.
  if (graph.orders.has(so.orderId)) await projectOrderAggregate(tx, graph, so.orderId);
}
