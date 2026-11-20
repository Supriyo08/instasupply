/** Labels for material lists and quotes (MARKETPLACE §1.3 quotes, §2.5). */
import type { Quote, QuoteStatus } from '@instasupply/shared';

import type { Tone } from '@/components/ui/Badge';

export const QUOTE_STATUS_META: Record<QuoteStatus, { label: string; tone: Tone }> = {
  submitted: { label: 'New', tone: 'warning' },
  in_review: { label: 'In review', tone: 'info' },
  quoted: { label: 'Quoted', tone: 'brand' },
  accepted: { label: 'Accepted', tone: 'success' },
  declined: { label: 'Declined', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

/** "ASAP", "This week", "By Fri, Nov 27". */
export function neededByLabel(neededBy: Quote['request']['neededBy']): string {
  if (neededBy.kind === 'asap') return 'ASAP';
  if (neededBy.kind === 'this_week') return 'This week';
  return neededBy.date ? `By ${neededBy.date}` : 'On a date';
}

/** A Canadian number in E.164 as WhatsApp wants it: digits only. */
export function whatsappHref(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}`;
}
