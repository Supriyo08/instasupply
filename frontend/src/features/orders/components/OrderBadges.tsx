import {
  ORDER_STATUS_META,
  STORE_ORDER_META,
  type Fulfilment,
  type OrderStatus,
  type PaymentStatus,
  type StoreOrderStatus,
} from '@instasupply/shared';

import { Badge } from '@/components/ui/Badge';
import { StoreIcon, TruckIcon, WarningIcon } from '@/components/ui/icons';

import { FULFILMENT_LABELS, PAYMENT_STATUS_META } from '../order-format';

/** Parent order status: the colour of the store-order status it stands for (§2.2). */
export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  const meta = ORDER_STATUS_META[status];
  return (
    <Badge tone={meta.tone} dot className={className}>
      {meta.label}
    </Badge>
  );
}

/** Store order status in the supplier and staff wording ("New", "Delivery failed"), §2.1. */
export function StoreOrderStatusBadge({
  status,
  className,
}: {
  status: StoreOrderStatus;
  className?: string;
}) {
  const meta = STORE_ORDER_META[status];
  return (
    <Badge tone={meta.tone} dot className={className}>
      {meta.label}
    </Badge>
  );
}

export function PaymentBadge({ status, className }: { status: PaymentStatus; className?: string }) {
  const meta = PAYMENT_STATUS_META[status];
  return (
    <Badge tone={meta.tone} className={className}>
      {meta.label}
    </Badge>
  );
}

export function FulfilmentBadge({ fulfilment }: { fulfilment: Fulfilment }) {
  const Icon = fulfilment === 'delivery' ? TruckIcon : StoreIcon;
  return (
    <Badge tone="neutral">
      <Icon size={12} aria-hidden />
      {FULFILMENT_LABELS[fulfilment]}
    </Badge>
  );
}

export function AttentionBadge({ label = 'Needs attention' }: { label?: string }) {
  return (
    <Badge tone="danger">
      <WarningIcon size={12} aria-hidden />
      {label}
    </Badge>
  );
}
