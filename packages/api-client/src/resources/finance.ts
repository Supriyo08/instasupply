import { seg } from './context';

/** Ledger and payouts (PLATFORM §5.3.8). Balances are always the server's, never summed on the client. */
export const financePaths = {
  ledgerEntries: '/ledger-entries',
  ledgerBalance: '/ledger/balance',
  payouts: '/payouts',
  payout: (payoutId: string) => `/payouts/${seg(payoutId)}`,
} as const;
