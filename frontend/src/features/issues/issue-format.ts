/** Labels for issues (MARKETPLACE §1.3 issues, §2.6). */
import type { FaultParty, IssueStatus, IssueType } from '@instasupply/shared';

import type { Tone } from '@/components/ui/Badge';

export const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  damaged: 'Damaged',
  wrong_item: 'Wrong item',
  missing_item: 'Missing item',
  short_quantity: 'Short quantity',
  late: 'Late delivery',
  other: 'Other',
};

export const ISSUE_STATUS_META: Record<IssueStatus, { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'warning' },
  in_review: { label: 'In review', tone: 'info' },
  resolved: { label: 'Resolved', tone: 'success' },
};

export const PREFERRED_LABELS: Record<'replacement' | 'refund' | 'return', string> = {
  replacement: 'Wants a replacement',
  refund: 'Wants a refund',
  return: 'Wants to return it',
};

export const FAULT_PARTIES: { id: FaultParty; label: string; hint: string }[] = [
  { id: 'store', label: 'Store', hint: 'The store gives back the refunded items, minus its commission.' },
  { id: 'driver', label: 'Driver', hint: 'The driver is liable for the load: full item value.' },
  { id: 'platform', label: 'InstaSupply', hint: 'We absorb it; nobody is charged back.' },
  { id: 'customer', label: 'Customer', hint: 'Nobody is charged back.' },
];

export const RESOLUTION_LABELS: Record<'refund' | 'replacement' | 'no_action', string> = {
  refund: 'Refund',
  replacement: 'Replacement order',
  no_action: 'No action',
};
