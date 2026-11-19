import { ORDER_STATUS_META, type Order, type OrderStatus } from '@instasupply/shared';

import { Badge } from '@/components/ui/Badge';
import { CardIcon, CashIcon } from '@/components/ui/icons';

import { paymentMethodLabel, paymentStatusMeta } from '../order-format';

/** Order status in the shopper's words, coloured with the shared status tone. */
export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  const meta = ORDER_STATUS_META[status];
  return (
    <Badge tone={meta.tone} dot className={className}>
      {meta.label}
    </Badge>
  );
}

/** Compact payment chip: "COD · To collect", "Card •••• 4242 · Paid". */
export function PaymentBadge({
  order,
  className,
}: {
  order: Pick<Order, 'status' | 'paymentMethod' | 'paymentStatus' | 'card'>;
  className?: string;
}) {
  const meta = paymentStatusMeta(order);
  const Icon = order.paymentMethod === 'cod' ? CashIcon : CardIcon;
  return (
    <Badge tone={meta.tone} className={className}>
      <Icon size={12} aria-hidden />
      {paymentMethodLabel(order)} · {meta.label}
    </Badge>
  );
}
