import type { Role } from '@instasupply/shared';
import type { CallableRequest } from 'firebase-functions/v2/https';

import { fail, permissionDenied } from './errors';

export interface Actor {
  uid: string;
  role: Role | null;
  name: string | null;
  isStaff: boolean;
  isAdmin: boolean;
  /** Approved and not suspended. */
  isActive: boolean;
}

export function requireAuth(request: CallableRequest<unknown>): Actor {
  if (!request.auth) fail('unauthenticated', 'Please sign in to continue.');
  const { uid, token } = request.auth!;
  const role =
    (['admin', 'dispatcher', 'driver', 'customer'] as const).find((value) => value === token.role) ?? null;
  const isStaff = role === 'admin' || role === 'dispatcher';
  return {
    uid,
    role,
    name: typeof token.name === 'string' ? token.name : null,
    isStaff,
    isAdmin: role === 'admin',
    isActive: token.active === true,
  };
}

export function requireStaff(request: CallableRequest<unknown>): Actor {
  const actor = requireAuth(request);
  if (!actor.isStaff || !actor.isActive) permissionDenied('This action is only available to dispatch staff.');
  return actor;
}

export function requireAdmin(request: CallableRequest<unknown>): Actor {
  const actor = requireAuth(request);
  if (!actor.isAdmin || !actor.isActive) permissionDenied('Only administrators can do this.');
  return actor;
}

export function requireCustomer(request: CallableRequest<unknown>): Actor {
  const actor = requireAuth(request);
  if (actor.role !== 'customer' || !actor.isActive) {
    return fail('permission-denied', 'Sign in with a shopping account to do this.');
  }
  return actor;
}

/** Staff, or an approved driver. */
export function requireOperator(request: CallableRequest<unknown>): Actor {
  const actor = requireAuth(request);
  if (actor.isStaff && actor.isActive) return actor;
  if (actor.role === 'driver' && actor.isActive) return actor;
  if (actor.role === 'driver') {
    return fail('permission-denied', 'Your driver account is waiting for approval.');
  }
  return permissionDenied();
}

export function requireString(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== 'string' || !value.trim()) {
    fail('invalid-argument', `${field} is required.`);
  }
  return (value as string).trim().slice(0, maxLength);
}
