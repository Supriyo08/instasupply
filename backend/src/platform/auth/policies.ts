/**
 * Endpoint policies (docs/PLATFORM.md §7.1). Deny by default: every route and command names one of these
 * or is in the public list of §7.2. Messages keep the legacy wording.
 */
import type { CityId, Role, StoreRole, VehicleClass } from '@instasupply/shared';
import { ApiError, permissionDenied } from '../http/errors';
import type { RequestContext } from '../http/context';
import type { Actor } from './actor';

export const MESSAGES = {
  signIn: 'Please sign in to continue.',
  staff: 'This action is only available to dispatch staff.',
  admin: 'Only administrators can do this.',
  customer: 'Sign in with a customer account to do this.',
  driverPending: 'Your driver account is waiting for approval.',
  denied: "You don't have permission to do that.",
  suspended: 'Your account is suspended. Contact InstaSupply support.',
} as const;

export function unauthenticated(
  reason: 'token_invalid' | 'token_expired' | 'session_revoked' | 'refresh_reused' | 'credentials',
  message: string = MESSAGES.signIn,
): ApiError {
  return new ApiError('unauthenticated', message, null, { reason });
}

export function suspendedError(): ApiError {
  return new ApiError('permission-denied', MESSAGES.suspended, null, { reason: 'account_suspended' });
}

/** Signed in, not suspended; role may be null. */
export function requireAuth(ctx: RequestContext): Actor {
  if (ctx.authFailure) throw ctx.authFailure;
  if (!ctx.actor) throw unauthenticated('token_invalid');
  if (ctx.actor.status === 'suspended') throw suspendedError();
  return ctx.actor;
}

/** Role in the list and status active. */
export function requireRole(ctx: RequestContext, ...roles: Role[]): Actor {
  const actor = requireAuth(ctx);
  if (!actor.role || !roles.includes(actor.role) || !actor.isActive) permissionDenied();
  return actor;
}

export function requireStaff(ctx: RequestContext): Actor {
  const actor = requireAuth(ctx);
  if (!actor.isStaff) permissionDenied(MESSAGES.staff);
  return actor;
}

export function requireAdmin(ctx: RequestContext): Actor {
  const actor = requireAuth(ctx);
  if (!actor.isAdmin) permissionDenied(MESSAGES.admin);
  return actor;
}

export function requireCustomer(ctx: RequestContext): Actor {
  const actor = requireAuth(ctx);
  if (actor.role !== 'customer' || !actor.isActive) permissionDenied(MESSAGES.customer);
  return actor;
}

export function requireSupplier(ctx: RequestContext): Actor & { storeId: string; storeRole: StoreRole } {
  const actor = requireAuth(ctx);
  if (actor.role !== 'supplier' || !actor.isActive || !actor.storeId || !actor.storeRole) permissionDenied();
  return actor as Actor & { storeId: string; storeRole: StoreRole };
}

/** Driver, active, with an approved vehicle (its class is what the job board matches on). */
export function requireActiveDriver(
  ctx: RequestContext,
): Actor & { cityId: CityId; capacityClass: VehicleClass } {
  const actor = requireAuth(ctx);
  if (actor.role !== 'driver') permissionDenied();
  if (!actor.isActive || !actor.cityId || !actor.capacityClass) permissionDenied(MESSAGES.driverPending);
  return actor as Actor & { cityId: CityId; capacityClass: VehicleClass };
}

/** Staff, or an active driver. */
export function requireOperator(ctx: RequestContext): Actor {
  const actor = requireAuth(ctx);
  if (actor.isStaff) return actor;
  return requireActiveDriver(ctx);
}

/** Staff pass. A supplier passes only for their own store (and only as owner when ownerOnly). */
export function requireStoreAccess(actor: Actor, storeId: string, opts: { ownerOnly?: boolean } = {}): void {
  if (actor.isStaff) return;
  const member =
    actor.role === 'supplier' && actor.isActive && actor.storeId !== null && actor.storeId === storeId;
  if (!member) permissionDenied();
  if (opts.ownerOnly && actor.storeRole !== 'owner') permissionDenied();
}

/**
 * The scoping rule of §5.3 for store-scoped lists: a supplier always gets their own store (another store is
 * permission-denied, never an empty list); staff get the store they asked for.
 */
export function resolveStoreScope(actor: Actor, requested: string | undefined): string | undefined {
  if (actor.isStaff) return requested;
  if (actor.role !== 'supplier' || !actor.isActive || !actor.storeId) permissionDenied();
  if (requested !== undefined && requested !== actor.storeId) permissionDenied();
  return actor.storeId;
}

export const isSelf = (actor: Actor, uid: string): boolean => actor.uid === uid;

/** The job-board key `${cityId}:${capacityClass}`, from the database row of the caller (§7.4). */
export function audienceKey(actor: Pick<Actor, 'cityId' | 'capacityClass'>): string {
  if (!actor.cityId || !actor.capacityClass) permissionDenied(MESSAGES.driverPending);
  return `${actor.cityId}:${actor.capacityClass}`;
}

/** The policy of a public endpoint: the caller may be anyone; a valid token still identifies them. */
export const publicPolicy = (ctx: RequestContext): Actor | null => ctx.actor;
