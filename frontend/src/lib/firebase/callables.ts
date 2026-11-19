/**
 * Typed wrappers for the callable Cloud Functions. Request/response types come from the shared
 * package, so a contract change breaks the build instead of production.
 */
import {
  CALLABLES,
  type AssignDeliveryRequest,
  type CompleteDeliveryRequest,
  type CreateDeliveriesRequest,
  type CreateDeliveriesResponse,
  type CreateStaffUserRequest,
  type CreateStaffUserResponse,
  type GeocodeAddressRequest,
  type GeocodeAddressResponse,
  type OkResponse,
  type OptimizeRouteRequest,
  type OptimizeRouteResponse,
  type SendTestNotificationResponse,
  type SetDriverStatusRequest,
  type UpdateDeliveryStatusRequest,
  type UpdateDeliveryStatusResponse,
} from '@instasupply/shared';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';

import { functions } from './services';

interface CallableContracts {
  createDeliveries: [CreateDeliveriesRequest, CreateDeliveriesResponse];
  assignDelivery: [AssignDeliveryRequest, OkResponse];
  updateDeliveryStatus: [UpdateDeliveryStatusRequest, UpdateDeliveryStatusResponse];
  completeDelivery: [CompleteDeliveryRequest, OkResponse];
  optimizeRoute: [OptimizeRouteRequest, OptimizeRouteResponse];
  geocodeAddress: [GeocodeAddressRequest, GeocodeAddressResponse];
  setDriverStatus: [SetDriverStatusRequest, OkResponse];
  createStaffUser: [CreateStaffUserRequest, CreateStaffUserResponse];
  sendTestNotification: [Record<string, never>, SendTestNotificationResponse];
}

export type CallableName = keyof CallableContracts;

export async function call<Name extends CallableName>(
  name: Name,
  data: CallableContracts[Name][0],
): Promise<CallableContracts[Name][1]> {
  const callable = httpsCallable<CallableContracts[Name][0], CallableContracts[Name][1]>(
    functions,
    CALLABLES[name],
  );
  const result = await callable(data);
  return result.data;
}

const AUTH_MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'That email and password combination is incorrect.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/user-disabled': 'This account has been disabled. Contact your administrator.',
  'auth/user-not-found': 'No account exists with this email.',
  'auth/wrong-password': 'That email and password combination is incorrect.',
  'auth/too-many-requests': 'Too many attempts. Wait a moment and try again.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
};

/** Human-readable message for any Firebase / callable error. */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof FirebaseError) {
    if (AUTH_MESSAGES[error.code]) return AUTH_MESSAGES[error.code]!;
    if (error.code === 'permission-denied' || error.code === 'firestore/permission-denied') {
      return error.message.includes('Missing or insufficient permissions')
        ? "You don't have permission to do that."
        : error.message;
    }
    if (error.code.startsWith('functions/')) {
      if (error.code === 'functions/internal' && error.message === 'internal') return fallback;
      // Newer SDKs append the HTTP status ("… [400]"); users don't need it.
      return error.message.replace(/\s*\[\d{3}\]$/, '');
    }
    return error.message || fallback;
  }
  if (error instanceof Error) return error.message || fallback;
  return fallback;
}
