import { formatCurrency, formatRelativeTime } from '@instasupply/shared';
import { useId, type ComponentProps, type ReactNode } from 'react';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import {
  BasketIcon,
  CatalogIcon,
  ClockIcon,
  OrdersIcon,
  RupeeIcon,
  StockIcon,
  TrendIcon,
  TruckIcon,
  type IconComponent,
} from '@/components/ui/icons';
import { StatCard } from '@/components/ui/Layout';
import { LOW_STOCK_LIMIT, stockLevel } from '@/features/catalog/catalog-filters';
import { catalogHref } from '@/features/catalog/url-state';
import { OrderStatusBadge } from '@/features/orders/components/OrderBadges';
import { ordersHref } from '@/features/orders/order-format';
import { cn } from '@/lib/cn';

import { MAX_DOCS, useLowStock, useOrderQueue, useTodaySales } from './store-hooks';

type Sales = ReturnType<typeof useTodaySales>;
type Queue = ReturnType<typeof useOrderQueue>;
type LowStock = ReturnType<typeof useLowStock>;
type Source = { loading: boolean; error: Error | null };

const ROW = 'flex items-center gap-3 px-5 py-3 hover:bg-slate-50';

/** Shop KPIs, best sellers, low stock and the latest orders for today. */
export function StoreSummary({ now, className }: { now: number; className?: string }) {
  const headingId = useId();
  const sales = useTodaySales(now);
  const queue = useOrderQueue();
  const stock = useLowStock();

  return (
    <section aria-labelledby={headingId} className={cn('min-w-0', className)}>
      <div className="mb-4">
        <h2 id={headingId} className="text-base font-semibold text-slate-900">
          Store today
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          {sales.capped
            ? `Figures cover the latest ${MAX_DOCS} orders placed today.`
            : 'Shop orders since midnight, updating in real time.'}
        </p>
      </div>
      <StoreKpis sales={sales} queue={queue} now={now} />
      {/* The last column matches the dashboard's 360px rail, so Low stock sits under Needs attention. */}
      <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_360px]">
        <RecentOrders sales={sales} now={now} />
        <TopProducts sales={sales} />
        <LowStockList stock={stock} />
      </div>
    </section>
  );
}

// ---------- KPI tiles ----------

const PENDING = (
  <span className="inline-block h-7 w-14 animate-pulse rounded-md bg-slate-200/70 align-middle" aria-hidden />
);

/** Tile value and hint, or placeholders while the listener loads or after it fails. */
const kpi = (source: Source, value: ReactNode, hint: string) =>
  source.error
    ? { value: '—', hint: "Couldn't load orders" }
    : source.loading
      ? { value: PENDING, hint: 'Loading…' }
      : { value, hint };

/** StatCard in its own size container, so an Amount can step down a size in a narrow tile. */
function Tile(props: ComponentProps<typeof StatCard>) {
  return (
    <div className="@container grid">
      <StatCard {...props} />
    </div>
  );
}

/** Whole rupees: long totals drop one size in narrow tiles instead of overflowing. */
function Amount({ value }: { value: number }) {
  return <span className="@max-[13rem]:text-xl">{formatCurrency(Math.round(value))}</span>;
}

function StoreKpis({ sales, queue, now }: { sales: Sales; queue: Queue; now: number }) {
  const { totals } = sales;
  const basket = totals.averageBasket == null ? '—' : <Amount value={totals.averageBasket} />;
  const basketHint =
    totals.averageItems == null
      ? 'No orders yet'
      : `${totals.averageItems.toLocaleString(undefined, { maximumFractionDigits: 1 })} items per order`;
  const queueHint = queue.oldestAwaiting
    ? `Oldest placed ${formatRelativeTime(queue.oldestAwaiting, now)}`
    : 'Queue is empty';

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
      <Tile
        label="Orders today"
        icon={OrdersIcon}
        to={ordersHref('all')}
        {...kpi(
          sales,
          sales.capped ? `${totals.orders}+` : totals.orders,
          totals.cancelled ? `${totals.cancelled} cancelled` : 'Since midnight',
        )}
      />
      <Tile
        label="Revenue today"
        icon={RupeeIcon}
        tone="success"
        {...kpi(sales, <Amount value={totals.revenue} />, 'Excludes cancelled orders')}
      />
      <Tile label="Average basket" icon={BasketIcon} tone="info" {...kpi(sales, basket, basketHint)} />
      <Tile
        label="Awaiting dispatch"
        icon={ClockIcon}
        tone="warning"
        to={ordersHref('placed')}
        {...kpi(queue, queue.awaiting, queueHint)}
      />
      <Tile
        label="Out for delivery"
        icon={TruckIcon}
        to={ordersHref('out_for_delivery')}
        {...kpi(queue, queue.outForDelivery, 'On the way to shoppers')}
      />
    </div>
  );
}

// ---------- lists ----------

function HeaderLink({ to, icon: Icon, children }: { to: string; icon: IconComponent; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700"
    >
      <Icon size={14} aria-hidden /> {children}
    </Link>
  );
}

function ListCard({
  title,
  description,
  action,
  source,
  count,
  empty,
  className,
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  source: Source;
  count: number;
  empty: { icon: IconComponent; title: string; description: string };
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn('flex min-w-0 flex-col', className)}>
      <CardHeader title={title} description={description} action={action} />
      {source.error ? (
        <ErrorState error={source.error} className="m-5" />
      ) : source.loading ? (
        <div className="space-y-3 p-5" role="status">
          <span className="sr-only">Loading {title.toLowerCase()}…</span>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-9 w-full" />
          ))}
        </div>
      ) : count === 0 ? (
        <EmptyState {...empty} className="flex-1 py-10" />
      ) : (
        <ul className="divide-y divide-slate-100">{children}</ul>
      )}
    </Card>
  );
}

function RecentOrders({ sales, now }: { sales: Sales; now: number }) {
  return (
    <ListCard
      title="Recent orders"
      description="The latest shop orders placed today."
      action={
        <HeaderLink to={ordersHref('all')} icon={OrdersIcon}>
          View all orders
        </HeaderLink>
      }
      source={sales}
      count={sales.recent.length}
      empty={{
        icon: OrdersIcon,
        title: 'No orders yet today',
        description: 'New shop orders appear here as they come in.',
      }}
      className="md:col-span-2 xl:col-span-1"
    >
      {sales.recent.map((order) => (
        <li key={order.id}>
          <Link to={`/orders/${order.id}`} className={ROW}>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-[13px] font-semibold text-slate-900">{order.number}</span>
                <OrderStatusBadge status={order.status} />
              </span>
              <span className="mt-0.5 block truncate text-xs text-slate-500">
                {order.customerName} · {formatRelativeTime(order.createdAt, now)}
              </span>
            </span>
            <span
              className={cn(
                'shrink-0 text-sm font-semibold tabular-nums',
                order.status === 'cancelled' ? 'text-slate-400 line-through' : 'text-slate-900',
              )}
            >
              {formatCurrency(order.total)}
            </span>
          </Link>
        </li>
      ))}
    </ListCard>
  );
}

function TopProducts({ sales }: { sales: Sales }) {
  const best = sales.topProducts[0]?.units || 1;
  return (
    <ListCard
      title="Top products today"
      description="By units sold, excluding cancelled orders."
      source={sales}
      count={sales.topProducts.length}
      empty={{
        icon: TrendIcon,
        title: 'No sales yet today',
        description: 'Best sellers show up after the first order.',
      }}
    >
      {sales.topProducts.map((product, index) => (
        <li key={product.productId}>
          <Link to={catalogHref({ q: product.name })} className={ROW}>
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand-50 text-xs font-semibold text-brand-700 tabular-nums">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-900">
                {product.name} <span className="font-normal text-slate-400">{product.unit}</span>
              </span>
              <span className="mt-1.5 block h-1.5 rounded-full bg-slate-100" aria-hidden>
                <span
                  className="block h-full rounded-full bg-brand-500"
                  style={{ width: `${(product.units / best) * 100}%` }}
                />
              </span>
            </span>
            <span className="shrink-0 text-right tabular-nums">
              <span className="block text-sm font-semibold text-slate-900">{product.units} sold</span>
              <span className="block text-xs text-slate-500">{formatCurrency(product.revenue)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ListCard>
  );
}

function LowStockList({ stock }: { stock: LowStock }) {
  const scope = stock.total > stock.items.length ? `${stock.total} active products` : 'Active products';
  return (
    <ListCard
      title="Low stock"
      description={`${scope} at ${LOW_STOCK_LIMIT} units or fewer.`}
      action={
        stock.total > 0 ? (
          // The catalogue's "low" filter leaves out sold-out products, so this opens every active
          // product, lowest stock first: everything listed here comes first.
          <HeaderLink to={catalogHref({ status: 'active', sort: 'stock-asc' })} icon={CatalogIcon}>
            View all
          </HeaderLink>
        ) : null
      }
      source={stock}
      count={stock.items.length}
      empty={{
        icon: StockIcon,
        title: 'Stock looks healthy',
        description: `No active product has ${LOW_STOCK_LIMIT} or fewer units left.`,
      }}
    >
      {stock.items.map((product) => {
        // Catalogue levels: "out" (none left) and "low" (1 to the limit) are separate filters.
        const level = stockLevel(product);
        const out = level === 'out';
        return (
          <li key={product.id}>
            <Link
              to={catalogHref({ status: level === 'ok' ? 'all' : level, q: product.name })}
              className={ROW}
            >
              <span
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-lg',
                  out ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600',
                )}
              >
                <StockIcon size={15} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900">{product.name}</span>
                <span className="block truncate text-xs text-slate-500">{product.unit}</span>
              </span>
              <Badge tone={out ? 'danger' : 'warning'}>
                {out ? 'Out of stock' : `${product.stock} left`}
              </Badge>
            </Link>
          </li>
        );
      })}
    </ListCard>
  );
}
