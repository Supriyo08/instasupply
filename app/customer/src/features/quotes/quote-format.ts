import {
  formatDuration,
  isQuoteOfferExpired,
  pluralize,
  toMillis,
  type Quote,
  type QuoteStatus,
  type TimestampLike,
} from '@instasupply/shared';

import { dayAndClock } from '@/features/orders/order-format';
import type { StatusTone } from '@/theme/tokens';

/** The customer's words for each quote status (§2.5). */
export const QUOTE_STATUS: Record<QuoteStatus, { label: string; tone: StatusTone }> = {
  submitted: { label: 'List received', tone: 'warning' },
  in_review: { label: 'Being priced', tone: 'info' },
  quoted: { label: 'Quote ready', tone: 'success' },
  accepted: { label: 'Accepted', tone: 'success' },
  declined: { label: 'Declined', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'warning' },
  cancelled: { label: 'Closed', tone: 'neutral' },
};

/** The status as shown, including an offer whose time ran out before the job marked it expired. */
export function quoteStatusOf(quote: Pick<Quote, 'status' | 'offerValidUntil'>, now: number): QuoteStatus {
  return isQuoteOfferExpired(quote, now) ? 'expired' : quote.status;
}

/** "2x4x8 SPF studs, Drywall 1/2 in + 4 more", or the file count for a list sent as photos. */
export function requestSummary(quote: Pick<Quote, 'request'>): string {
  const lines = quote.request.lines;
  if (lines.length === 0) {
    const files = quote.request.attachments.length;
    return files > 0 ? `${pluralize(files, 'file')} attached` : 'Material list';
  }
  const shown = lines.slice(0, 2).map((line) => line.text);
  const more = lines.length - shown.length;
  return more > 0 ? `${shown.join(', ')} + ${more} more` : shown.join(', ');
}

/** "Valid for 23 h 10 min · until Sat 4:15 pm", or null when there is nothing to count down. */
export function validityText(validUntil: TimestampLike | null, now: number): string | null {
  const until = toMillis(validUntil);
  if (until == null) return null;
  if (until <= now) return 'This quote has expired';
  return `Valid for ${formatDuration((until - now) / 1000)} · until ${dayAndClock(until, now)}`;
}

/** "Expect your quote by 2:15 pm" while staff are pricing it. */
export function respondByText(quote: Pick<Quote, 'respondBy' | 'status'>, now: number): string | null {
  if (quote.status !== 'submitted' && quote.status !== 'in_review') return null;
  return `Expect your quote by ${dayAndClock(quote.respondBy, now)}`;
}

export interface QuoteStep {
  key: string;
  label: string;
  at: TimestampLike | null;
  state: 'done' | 'current' | 'todo' | 'problem';
}

const STEPS: readonly [QuoteStatus, string][] = [
  ['submitted', 'List received'],
  ['in_review', 'Being priced'],
  ['quoted', 'Quote ready'],
  ['accepted', 'Accepted and ordered'],
];

const ENDINGS: Partial<Record<QuoteStatus, string>> = {
  expired: 'Quote expired',
  declined: 'You declined this quote',
  cancelled: 'Closed by InstaSupply',
};

/** Status steps: list received → being priced → quote ready → accepted, or how it ended. */
export function quoteTimeline(quote: Quote, now: number): QuoteStep[] {
  const status = quoteStatusOf(quote, now);
  const ending = ENDINGS[status];
  const atOf = (key: QuoteStatus) =>
    key === 'submitted' ? (quote.statusAt.submitted ?? quote.createdAt) : (quote.statusAt[key] ?? null);
  if (ending) {
    // Every step it reached, then how it ended.
    const reached = STEPS.filter(([key]) => key === 'submitted' || quote.statusAt[key] != null);
    return [
      ...reached.map(([key, label]): QuoteStep => ({ key, label, at: atOf(key), state: 'done' })),
      {
        key: status,
        label: ending,
        at: quote.statusAt[status] ?? quote.offerValidUntil ?? quote.updatedAt,
        state: 'problem',
      },
    ];
  }
  const current = Math.max(
    0,
    STEPS.findIndex(([key]) => key === status),
  );
  return STEPS.map(([key, label], index): QuoteStep => ({
    key,
    label,
    at: index <= current ? atOf(key) : null,
    state: index < current || status === 'accepted' ? 'done' : index === current ? 'current' : 'todo',
  }));
}
