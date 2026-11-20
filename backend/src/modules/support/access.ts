/** The support-thread predicate of docs/PLATFORM.md §7.3, written once. */
import type { SupportSenderRole } from '@instasupply/shared';
import type { Actor } from '../../platform/auth/actor';
import { permissionDenied } from '../../platform/http/errors';

/** Customer and `threadId === uid`; or active supplier and `threadId === 'store_' + storeId`. */
export function ownsSupportThread(actor: Actor, threadId: string): boolean {
  if (actor.role === 'customer') return actor.isActive && threadId === actor.uid;
  if (actor.role === 'supplier') {
    return actor.isActive && actor.storeId !== null && threadId === `store_${actor.storeId}`;
  }
  return false;
}

/** Staff or the owner, else permission-denied. Answers which side the caller is on. */
export function requireThreadAccess(actor: Actor, threadId: string): 'staff' | 'owner' {
  if (actor.isStaff) return 'staff';
  if (ownsSupportThread(actor, threadId)) return 'owner';
  return permissionDenied();
}

/** `senderRole` is derived from the caller, never taken from the request (§5.3.6). */
export function senderRoleOf(actor: Actor): SupportSenderRole {
  if (actor.isStaff) return 'staff';
  return actor.role === 'supplier' ? 'supplier' : 'customer';
}
