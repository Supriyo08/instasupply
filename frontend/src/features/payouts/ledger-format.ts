import type { LedgerKind, Payout, StatusTone } from '@instasupply/shared';

/** Staff wording for ledger entries and payouts (MARKETPLACE §3.9). */
export const LEDGER_KIND_LABEL: Record<LedgerKind, string> = {
  sale: 'Sale',
  commission: 'Commission',
  delivery: 'Delivery pay',
  failed_attempt: 'Failed attempt pay',
  cancellation: 'Cancellation pay',
  clawback: 'Clawback',
  adjustment: 'Adjustment',
};

export const PAYOUT_STATUS_META: Record<Payout['status'], { label: string; tone: StatusTone }> = {
  pending: { label: 'Sending', tone: 'warning' },
  paid: { label: 'Paid', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
};

/** "Test" until Stripe Connect is set up (MARKETPLACE §9). */
export const PAYOUT_PROVIDER_LABEL: Record<Payout['provider'], string> = {
  test: 'Test transfer',
  stripe: 'Stripe',
};
