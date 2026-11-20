/** Earnings (MARKETPLACE §10, docs/CLIENTS.md §4.6). Balances come from the server, never summed here. */
import { useLiveQuery, usePagedQuery } from '@instasupply/api-client/react';

import { queries } from '@/lib/api';

/** Unpaid and held totals (`LedgerBalance`). */
export function useBalance(uid: string) {
  return useLiveQuery(queries.ledgerBalance('driver', uid));
}

/** Entries not yet in a payout, newest first, paged. */
export function useUnpaidEntries(uid: string) {
  return usePagedQuery(queries.ledger('driver', uid, { unpaid: true }));
}

/** Every entry, newest first, paged. */
export function useLedger(uid: string) {
  return usePagedQuery(queries.ledger('driver', uid, {}));
}

/** Daily payouts with their references, newest first, paged. */
export function usePayouts(uid: string) {
  return usePagedQuery(queries.payouts('driver', uid));
}
