/**
 * Object checks of the catalogue (docs/PLATFORM.md §7.3), written once so every route uses the same
 * predicate, and the bridge from a shared validator's answer to the API's invalid-argument.
 */
import type { ValidationResult } from '@instasupply/shared';
import type { Actor } from '../../platform/auth/actor';
import { invalidArgument } from '../../platform/http/errors';

const isActiveSupplierOf = (actor: Actor, storeId: string): boolean =>
  actor.role === 'supplier' && actor.isActive && actor.storeId !== null && actor.storeId === storeId;

/** Staff, or an active supplier of that store. The store comes from the row or the id, never from the body. */
export const canWriteProduct = (actor: Actor, storeId: string): boolean =>
  actor.isStaff || isActiveSupplierOf(actor, storeId);

/** Admins, or the owner of that store (product delete). */
export const canDeleteProduct = (actor: Actor, storeId: string): boolean =>
  actor.isAdmin || (isActiveSupplierOf(actor, storeId) && actor.storeRole === 'owner');

/** Staff, or the owner of that store (GET /stores/{id}/settings, every field of updateStoreProfile). */
export const isStaffOrOwner = (actor: Actor, storeId: string): boolean =>
  actor.isStaff || (isActiveSupplierOf(actor, storeId) && actor.storeRole === 'owner');

/** Staff, or any active member of that store (`acceptingOrders` alone). */
export const isStaffOrMember = (actor: Actor, storeId: string): boolean =>
  actor.isStaff || isActiveSupplierOf(actor, storeId);

/** The cleaned value of a shared validator, or invalid-argument with `details.fields` (§4.2). */
export function validOrThrow<T>(result: ValidationResult<T>, prefix = ''): T {
  if (result.ok) return result.value;
  const fields: Record<string, string> = {};
  for (const [key, message] of Object.entries(result.errors)) {
    if (typeof message === 'string') fields[prefix ? `${prefix}.${key}` : key] = message;
  }
  const first = Object.values(fields)[0] ?? 'Check the highlighted fields.';
  return invalidArgument(first, { fields });
}
