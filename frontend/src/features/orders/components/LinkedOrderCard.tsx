/**
 * The shop order a delivery fulfils, shown on the delivery page. Deliberately light: it must not
 * pull illustrations (@instasupply/art) into the delivery screens.
 */
import { formatCurrency, formatDateTime, pluralize } from '@instasupply/shared';
import { Link } from 'react-router';

import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/Card';
import { ErrorState, Skeleton } from '@/components/ui/Feedback';
import { CashIcon, ChevronRightIcon } from '@/components/ui/icons';
import type { OrderRecord } from '@/lib/data';

import { useOrder } from '../hooks';
import { cashToCollect } from '../order-format';
import { OrderStatusBadge, PaymentBadge } from './OrderBadges';

const PREVIEW_LINES = 4;

function OrderSummary({ order }: { order: OrderRecord }) {
  const cash = cashToCollect(order);
  const more = order.items.length - PREVIEW_LINES;

  return (
    <div className="space-y-3">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[13px] font-semibold text-slate-900">{order.number}</span>
          <OrderStatusBadge status={order.status} />
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          {pluralize(order.itemCount, 'item')} · placed {formatDateTime(order.createdAt)}
        </p>
      </div>
      <ul className="space-y-1 text-sm" aria-label="Items">
        {order.items.slice(0, PREVIEW_LINES).map((item, index) => (
          <li key={`${item.productId}-${index}`} className="flex justify-between gap-3">
            <span className="min-w-0 truncate text-slate-700">
              {item.quantity} × {item.name}
            </span>
            <span className="shrink-0 text-slate-500 tabular-nums">{formatCurrency(item.lineTotal)}</span>
          </li>
        ))}
        {more > 0 ? <li className="text-xs text-slate-400">+{pluralize(more, 'more product')}</li> : null}
      </ul>
      <dl className="divide-y divide-slate-100 border-t border-slate-100">
        <DetailRow label="Total">{formatCurrency(order.total)}</DetailRow>
        <DetailRow label="Payment">
          <PaymentBadge order={order} />
        </DetailRow>
        {cash != null ? (
          <DetailRow label="Cash to collect">
            <span className="inline-flex items-center gap-1.5 text-amber-700">
              <CashIcon size={14} aria-hidden /> {formatCurrency(cash)}
            </span>
          </DetailRow>
        ) : null}
      </dl>
    </div>
  );
}

export function LinkedOrderCard({ orderId }: { orderId: string }) {
  const order = useOrder(orderId);

  return (
    <Card>
      <CardHeader
        title="Shop order"
        description="Placed by the shopper in the customer app."
        action={
          <Link
            to={`/orders/${orderId}`}
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"
          >
            View order <ChevronRightIcon size={14} aria-hidden />
          </Link>
        }
      />
      <CardBody>
        {order.error ? (
          <ErrorState error={order.error} />
        ) : order.loading && !order.data ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : order.data ? (
          <OrderSummary order={order.data} />
        ) : (
          <p className="text-sm text-slate-500">The shop order for this delivery was not found.</p>
        )}
      </CardBody>
    </Card>
  );
}
