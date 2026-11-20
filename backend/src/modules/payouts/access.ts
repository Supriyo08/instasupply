/**
 * The object check of docs/PLATFORM.md §7.3 for ledger entries and payouts, and the scoping rule of §5.3 for
 * their lists: staff read every payee; the owner of a store reads the store's; a driver reads their own.
 * Store staff (not owners) and everyone else are denied.
 */
import type { Actor } from '../../platform/auth/actor';
import { permissionDenied } from '../../platform/http/errors';

export type PayeeType = 'store' | 'driver';

/** `canReadPayee(actor, type, id)` of §7.3. */
export function canReadPayee(actor: Actor, payeeType: PayeeType, payeeId: string): boolean {
  if (actor.isStaff) return true;
  if (payeeType === 'store') {
    return (
      actor.role === 'supplier' &&
      actor.isActive &&
      actor.storeRole === 'owner' &&
      actor.storeId !== null &&
      actor.storeId === payeeId
    );
  }
  return actor.role === 'driver' && actor.uid === payeeId;
}

/**
 * The payee a list is scoped to (the scoping rule of §5.3). Staff filter freely: either key, both or none.
 * Anyone else always gets their own payee, and asking for another one is `permission-denied`, never an empty
 * list.
 */
export function resolvePayeeScope(
  actor: Actor,
  requested: { payeeType?: PayeeType | undefined; payeeId?: string | undefined },
): { payeeType: PayeeType | null; payeeId: string | null } {
  if (actor.isStaff) return { payeeType: requested.payeeType ?? null, payeeId: requested.payeeId ?? null };
  let own: { payeeType: PayeeType; payeeId: string } | null = null;
  if (actor.role === 'driver') own = { payeeType: 'driver', payeeId: actor.uid };
  else if (actor.role === 'supplier' && actor.isActive && actor.storeRole === 'owner' && actor.storeId) {
    own = { payeeType: 'store', payeeId: actor.storeId };
  }
  if (!own) permissionDenied();
  if (requested.payeeType !== undefined && requested.payeeType !== own.payeeType) permissionDenied();
  if (requested.payeeId !== undefined && requested.payeeId !== own.payeeId) permissionDenied();
  return own;
}
