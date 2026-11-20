/**
 * The marketplace order a delivery belongs to, shown on the delivery page. Deliberately light: it
 * must not pull the illustrations (@instasupply/art) into the delivery screens.
 */
import { formatDateTimeET, formatMoney, orderHeadline, pluralize, type Order } from '@instasupply/shared';
import { Link } from 'react-router';

import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/Card';
import { ErrorState, Skeleton } from '@/components/ui/Feedback';
import { ChevronRightIcon } from '@/components/ui/icons';

import { useOrder } from '../hooks';
import { customerLine, orderHref } from '../order-format';
import { OrderStatusBadge, PaymentBadge, StoreOrderStatusBadge } from './OrderBadges';

function OrderSummary({ order }: { order: Order }) {
  return (
    <div className="space-y-3">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[13px] font-semibold text-slate-900">{order.number}</span>
          <OrderStatusBadge status={order.status} />
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          {customerLine(order)} · {pluralize(order.itemCount, 'item')} · placed{' '}
          {formatDateTimeET(order.createdAt)}
        </p>
        <p className="mt-1 text-sm text-slate-700">{orderHeadline(order)}</p>
      </div>
      <ul className="space-y-1.5 text-sm" aria-label="Store orders">
        {order.storeOrders.map((so) => (
          <li key={so.storeOrderId} className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-slate-700">
              <span className="font-mono text-xs">{so.number}</span> · {so.storeName}
            </span>
            <StoreOrderStatusBadge status={so.status} />
          </li>
        ))}
      </ul>
      <dl className="divide-y divide-slate-100 border-t border-slate-100">
        <DetailRow label="Total">{formatMoney(order.current.totalCents)}</DetailRow>
        <DetailRow label="Payment">
          <PaymentBadge status={order.payment.status} />
        </DetailRow>
      </dl>
    </div>
  );
}

export function LinkedOrderCard({ orderId }: { orderId: string }) {
  const order = useOrder(orderId);

  return (
    <Card>
      <CardHeader
        title="Marketplace order"
        description="Placed by the customer in the InstaSupply app."
        action={
          <Link
            to={orderHref(orderId)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"
          >
            View order <ChevronRightIcon size={14} aria-hidden />
          </Link>
        }
      />
      <CardBody>
        {order.error && !order.data ? (
          <ErrorState error={order.error} onRetry={order.retry} />
        ) : order.loading && !order.data ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : order.data ? (
          <OrderSummary order={order.data} />
        ) : (
          <p className="text-sm text-slate-500">The order for this delivery was not found.</p>
        )}
      </CardBody>
    </Card>
  );
}
