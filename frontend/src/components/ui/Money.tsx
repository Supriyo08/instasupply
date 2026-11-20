import { formatMoney } from '@instasupply/shared';

import { cn } from '@/lib/cn';

/**
 * Integer cents as Canadian dollars ("$1,234.50"), tabular figures, never computed on the client:
 * every amount comes from the server or from `priceCheckout` / `refundForLines` in shared (MARKETPLACE §3).
 */
export function Money({
  cents,
  className,
  emptyLabel = '—',
}: {
  cents: number | null | undefined;
  className?: string;
  emptyLabel?: string;
}) {
  return (
    <span className={cn('tabular-nums', className)}>{cents == null ? emptyLabel : formatMoney(cents)}</span>
  );
}
