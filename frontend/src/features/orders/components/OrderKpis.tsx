import { formatCurrency, formatRelativeTime, startOfDay, type Order } from '@instasupply/shared';
import { useMemo } from 'react';

import { ErrorState } from '@/components/ui/Feedback';
import { BasketIcon, ClockIcon, OrdersIcon, RupeeIcon } from '@/components/ui/icons';
import { StatCard } from '@/components/ui/Layout';
import type { OrderRecord } from '@/lib/data';

import { TODAY_LIMIT, useOrdersSince } from '../hooks';
import { ordersHref } from '../order-format';

const roundMoney = (value: number) => Math.round(value * 100) / 100;

function summarize(orders: readonly Order[]) {
  let cancelled = 0;
  let revenue = 0;
  let items = 0;
  for (const order of orders) {
    if (order.status === 'cancelled') {
      cancelled += 1;
      continue;
    }
    revenue += order.total;
    items += order.itemCount;
  }
  const kept = orders.length - cancelled;
  return {
    count: orders.length,
    cancelled,
    revenue: roundMoney(revenue),
    average: kept ? Math.round(revenue / kept) : null,
    itemsPerOrder: kept ? items / kept : null,
  };
}

/** Today's numbers (since local midnight) plus the live dispatch queue. */
export function OrderKpis({
  now,
  openOrders,
  openLoading,
}: {
  now: number;
  /** Open orders, newest first (from useOpenOrders). */
  openOrders: readonly OrderRecord[];
  openLoading: boolean;
}) {
  const today = useOrdersSince(startOfDay(now));
  const stats = useMemo(() => summarize(today.data), [today.data]);
  const awaiting = useMemo(() => openOrders.filter((order) => order.status === 'placed'), [openOrders]);

  if (today.error) return <ErrorState error={today.error} className="mb-6" />;

  const loading = today.loading && today.data.length === 0;
  const queueLoading = openLoading && openOrders.length === 0;
  // Newest first, so the last one has waited longest.
  const oldest = awaiting[awaiting.length - 1];
  const capped = today.data.length >= TODAY_LIMIT;

  return (
    <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
      <StatCard
        label="Orders today"
        value={loading ? '—' : `${stats.count}${capped ? '+' : ''}`}
        hint={stats.cancelled ? `${stats.cancelled} cancelled` : 'Since midnight'}
        icon={OrdersIcon}
      />
      <StatCard
        label="Revenue today"
        value={loading ? '—' : formatCurrency(stats.revenue)}
        hint="Excludes cancelled orders"
        icon={RupeeIcon}
        tone="success"
      />
      <StatCard
        label="Average basket"
        value={loading || stats.average == null ? '—' : formatCurrency(stats.average)}
        hint={
          loading
            ? undefined
            : stats.itemsPerOrder != null
              ? `${stats.itemsPerOrder.toFixed(1)} items per order`
              : 'No orders yet today'
        }
        icon={BasketIcon}
        tone="info"
      />
      <StatCard
        label="Awaiting dispatch"
        value={queueLoading ? '—' : awaiting.length}
        hint={
          queueLoading
            ? undefined
            : oldest
              ? `Oldest placed ${formatRelativeTime(oldest.createdAt, now)}`
              : 'Queue is empty'
        }
        icon={ClockIcon}
        tone="warning"
        to={ordersHref('placed')}
      />
    </div>
  );
}
