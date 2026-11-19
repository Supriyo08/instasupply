import { CALLABLES, type CallableContracts } from '@instasupply/shared';

import type { HttpPipeline } from './http';
import type { QueryKey } from './query/types';

/**
 * One `[Request, Response]` tuple per command, from the shared contracts (MARKETPLACE §5.3).
 * `sendTestNotification` has no request in shared (`void`); it is sent as `{}` (PLATFORM §5.2).
 */
export type CallableMap = {
  [N in keyof CallableContracts]: [
    CallableContracts[N]['request'] extends void ? Record<string, never> : CallableContracts[N]['request'],
    CallableContracts[N]['response'],
  ];
};

export type CallableName = keyof CallableMap;

export interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** `false` skips the default cache invalidation of the command. */
  invalidate?: false;
}

export type Call = <N extends CallableName>(
  name: N,
  data: CallableMap[N][0],
  options?: CallOptions,
) => Promise<CallableMap[N][1]>;

// A name missing on either side is a build error (CLIENTS §1.6).
type AssertTrue<T extends true> = T;
type _EveryCallableIsTyped = AssertTrue<keyof typeof CALLABLES extends CallableName ? true : false>;
type _EveryTypeIsACallable = AssertTrue<CallableName extends keyof typeof CALLABLES ? true : false>;

export interface CallInvalidation {
  /** Key prefixes marked stale after success; 'all' is `cache.invalidateAll()`. */
  prefixes: readonly QueryKey[] | 'all';
  /** The command changed the caller's own account: reload /me. */
  refreshProfile?: boolean;
}

const STORE_ORDER_ACTION: CallInvalidation = {
  prefixes: [
    ['store-order'],
    ['store-orders'],
    ['order'],
    ['orders'],
    ['products'],
    ['product'],
    ['deliveries'],
    ['delivery'],
    ['job-offers'],
  ],
};
const STORE_PROFILE: CallInvalidation = {
  prefixes: [['stores'], ['store'], ['store-settings'], ['ops-stores'], ['products']],
};
const ACCOUNTS: CallInvalidation = { prefixes: [['users'], ['user'], ['deliveries'], ['job-offers']] };
const DELIVERY: CallInvalidation = {
  prefixes: [
    ['deliveries'],
    ['delivery'],
    ['delivery-events'],
    ['delivery-stats'],
    ['job-offers'],
    ['job-offer'],
    ['route'],
    ['store-orders'],
    ['store-order'],
    ['orders'],
    ['order'],
    ['ledger'],
  ],
};
const QUOTES: CallInvalidation = { prefixes: [['quotes'], ['quote'], ['support-messages']] };
const ISSUES: CallInvalidation = {
  prefixes: [
    ['issues'],
    ['issue'],
    ['store-order'],
    ['store-orders'],
    ['order'],
    ['orders'],
    ['ledger'],
    ['payouts'],
  ],
};
const PROFILE_ONLY: CallInvalidation = { prefixes: [], refreshProfile: true };
const NONE: CallInvalidation = { prefixes: [] };
const CHECKOUT: CallInvalidation = {
  prefixes: [
    ['orders'],
    ['order'],
    ['store-orders'],
    ['jobsites'],
    ['products'],
    ['product'],
    ['quotes'],
    ['quote'],
    ['buy-again'],
  ],
  refreshProfile: true,
};

/** What each command changes (CLIENTS §1.6 "Default invalidation"), so a screen sees its own write without the socket. */
export const CALL_INVALIDATIONS: Readonly<Record<CallableName, CallInvalidation>> = {
  registerCustomer: PROFILE_ONLY,
  registerDriver: PROFILE_ONLY,
  verifyPhoneOtp: PROFILE_ONLY,
  updateDriverVehicle: PROFILE_ONLY,
  placeOrder: CHECKOUT,
  acceptQuote: CHECKOUT,
  cancelOrder: {
    prefixes: [['orders'], ['order'], ['store-orders'], ['store-order'], ['products'], ['product']],
    refreshProfile: true,
  },
  acceptStoreOrder: STORE_ORDER_ACTION,
  updateStoreOrderStatus: STORE_ORDER_ACTION,
  rejectStoreOrder: STORE_ORDER_ACTION,
  completePickup: STORE_ORDER_ACTION,
  updateStoreProfile: STORE_PROFILE,
  updateStoreSettings: STORE_PROFILE,
  createStore: STORE_PROFILE,
  inviteSupplierUser: ACCOUNTS,
  setSupplierUserStatus: ACCOUNTS,
  createStaffUser: ACCOUNTS,
  setDriverStatus: ACCOUNTS,
  reviewDriverVehicle: ACCOUNTS,
  claimJob: DELIVERY,
  checkInAtStore: DELIVERY,
  updateDeliveryStatus: DELIVERY,
  completeDelivery: DELIVERY,
  assignDelivery: DELIVERY,
  resolveFailedDelivery: DELIVERY,
  createDeliveries: DELIVERY,
  boostJobPayout: DELIVERY,
  optimizeRoute: { prefixes: [['route']] },
  submitMaterialList: QUOTES,
  sendQuote: QUOTES,
  closeQuote: QUOTES,
  reopenQuote: QUOTES,
  reportIssue: ISSUES,
  resolveIssue: ISSUES,
  suggestStore: { prefixes: [['suggestions']] },
  runJobNow: { prefixes: 'all' },
  geocodeAddress: NONE,
  requestPhoneOtp: NONE,
  sendTestNotification: NONE,
};

export interface CallDeps {
  http: HttpPipeline;
  invalidate(prefix: QueryKey): Promise<void>;
  invalidateAll(): Promise<void>;
  refreshProfile(): Promise<unknown>;
}

/**
 * `POST /call/<name>`. The bearer is sent when there is one: `suggestStore` and `geocodeAddress` work
 * signed out, the server answers `unauthenticated` to every other command without a session. Never
 * repeated by the client: the user retries, and the client-generated id makes that safe (D17).
 */
export function createCall(deps: CallDeps): Call {
  return async (name, data, options) => {
    const result = await deps.http.request<CallableMap[typeof name][1]>({
      method: 'POST',
      path: `/call/${CALLABLES[name]}`,
      body: data ?? {},
      auth: 'optional',
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
    });
    if (options?.invalidate !== false) {
      const rule = CALL_INVALIDATIONS[name];
      if (rule.prefixes === 'all') void deps.invalidateAll();
      else for (const prefix of rule.prefixes) void deps.invalidate(prefix);
      if (rule.refreshProfile) deps.refreshProfile().catch(() => undefined);
    }
    return result;
  };
}
