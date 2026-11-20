/**
 * Object checks of store orders (docs/PLATFORM.md §7.3), written once so routes, commands and jobs share the
 * same predicates, and the actor a store-order change is recorded with (MARKETPLACE §2.1).
 */
import type { ActorRole, MachineActor, StoreOrder } from '@instasupply/shared';
import type { Actor } from '../../platform/auth/actor';
import type { OrderActor } from './transitions';

type Owned = Pick<StoreOrder, 'customerId' | 'storeId'>;

const isActiveMemberOf = (actor: Actor, storeId: string): boolean =>
  actor.role === 'supplier' && actor.isActive && actor.storeId !== null && actor.storeId === storeId;

/** Staff, the customer who owns it, or an active supplier of its store. */
export function canReadStoreOrder(actor: Actor, so: Owned): boolean {
  return actor.isStaff || so.customerId === actor.uid || isActiveMemberOf(actor, so.storeId);
}

/** Staff, or an active supplier of its store. */
export function canActOnStoreOrder(actor: Actor, so: Pick<StoreOrder, 'storeId'>): boolean {
  return actor.isStaff || isActiveMemberOf(actor, so.storeId);
}

/** The signed-in caller as the store-order machine sees them. */
export function orderActorFrom(actor: Actor): OrderActor {
  const kind: MachineActor = actor.isStaff
    ? 'staff'
    : actor.role === 'supplier'
      ? 'supplier'
      : actor.role === 'driver'
        ? 'driver'
        : 'customer';
  const role: ActorRole = actor.role ?? 'customer';
  return { kind, uid: actor.uid, name: actor.name || null, role };
}

/** Schedules and cascades (`escalateStoreOrders`, `expirePickupHolds`). */
export const SYSTEM_ORDER_ACTOR: OrderActor = {
  kind: 'system',
  uid: null,
  name: 'InstaSupply',
  role: 'system',
};
