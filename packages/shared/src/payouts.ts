/**
 * Ledger, payouts and store suggestions (§1.3, §3.9). Every dollar owed to a store or a driver is an
 * append-only ledger entry; the daily run adds up each payee's unpaid entries and pays the net.
 */
import type { TimestampLike } from './types';

/** InstaSupply's share of a store's sales when the store's settings give no rate: 10 % (§3.9). */
export const DEFAULT_COMMISSION_BPS = 1000;
/** The highest commission an admin can set for a store: 30 % (§5.4 `createStore`). */
export const MAX_COMMISSION_BPS = 3000;

export type LedgerKind =
  'sale' | 'commission' | 'delivery' | 'failed_attempt' | 'cancellation' | 'clawback' | 'adjustment';

/**
 * `ledgerEntries/{entryId}`. The id is deterministic (`sale_{storeOrderId}`, `commission_{storeOrderId}`
 * and so on), so a retried trigger cannot count the same money twice.
 */
export interface LedgerEntry {
  payeeType: 'store' | 'driver';
  payeeId: string;
  kind: LedgerKind;
  /** Signed: commissions and clawbacks are negative. */
  amountCents: number;
  orderId: string | null;
  storeOrderId: string | null;
  deliveryId: string | null;
  issueId: string | null;
  description: string;
  /** Null until a payout includes the entry. */
  payoutId: string | null;
  /** While set, payouts skip the entry: the store order has an open issue. */
  heldForIssueId: string | null;
  createdAt: TimestampLike;
}

/** `payouts/{payeeType}_{payeeId}_{runKey}`: one batch per payee per daily run. */
export interface Payout {
  payeeType: 'store' | 'driver';
  payeeId: string;
  payeeName: string;
  /** `YYYYMMDD-HHMM` of the run cutoff in Toronto. */
  runKey: string;
  /** Toronto date, `YYYY-MM-DD`. */
  periodDate: string;
  entryIds: string[];
  entryCount: number;
  creditsCents: number;
  debitsCents: number;
  netCents: number;
  /** `pending` until the transfer returns, so a crash never pays twice. */
  status: 'pending' | 'paid' | 'failed';
  provider: 'test' | 'stripe';
  reference: string | null;
  createdAt: TimestampLike;
  paidAt: TimestampLike | null;
}

/** `storeSuggestions/{id}`: "Suggest a store". */
export interface StoreSuggestion {
  storeName: string;
  city: string;
  /** From `SUGGEST_STORE_INTERESTS`. */
  interests: string[];
  email: string | null;
  /** Uid, or null for a guest. */
  suggestedBy: string | null;
  source: 'app' | 'web';
  status: 'new' | 'contacted' | 'onboarding' | 'dismissed';
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}
