/**
 * `/orders` (MARKETPLACE §9, CLIENTS §4.5): two tabs. "Orders" lists parent orders (filters: status,
 * store, needs attention); "Store orders" lists every store's part with its SLA timer (filters:
 * status, store, overdue for acceptance). Both are paged and live, filtered by the server. Counts come
 * from `GET /ops/dashboard`, never from a page of rows (R47, R48).
 */
import type { QueryValue } from '@instasupply/api-client';
import {
  ORDER_STATUSES,
  ORDER_STATUS_META,
  STORE_ORDER_META,
  STORE_ORDER_STATUSES,
  formatMoney,
  formatRelativeTime,
  orderHeadline,
  type Order,
} from '@instasupply/shared';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';

import { Card } from '@/components/ui/Card';
import { LoadMore } from '@/components/ui/Data';
import { ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { Select, Toggle } from '@/components/ui/Form';
import { ChevronRightIcon } from '@/components/ui/icons';
import { PageHeader, Tabs } from '@/components/ui/Layout';
import { LiveStatusBar } from '@/components/ui/LiveStatus';
import { StoreSelect } from '@/features/stores/components/StoreSelect';
import { useNow, useOpsDashboard } from '@/lib/data';

import { ArtEmptyState } from './components/ItemThumb';
import { AttentionBadge, OrderStatusBadge, PaymentBadge } from './components/OrderBadges';
import { StoreOrdersTable } from './components/StoreOrdersTable';
import { useOpsOrders, useOpsStoreOrders } from './hooks';
import { customerLine, orderHref } from './order-format';

type Tab = 'orders' | 'store-orders';

function OrdersTable({ orders, now }: { orders: Order[]; now: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <caption className="sr-only">Orders, newest first</caption>
        <thead className="border-b border-slate-200 bg-slate-50/70 text-xs text-slate-500">
          <tr>
            <th scope="col" className="px-5 py-3 font-medium">
              Order
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              Customer
            </th>
            <th scope="col" className="hidden px-3 py-3 font-medium lg:table-cell">
              Stores
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-3 text-right font-medium">
              Total
            </th>
            <th scope="col" className="w-10 py-3 pr-5">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {orders.map((order) => (
            <tr key={order.id} className="transition-colors hover:bg-slate-50">
              <td className="px-5 py-3 align-top">
                <Link
                  to={orderHref(order.id)}
                  className="font-mono text-[13px] font-semibold text-slate-900 hover:text-brand-700"
                >
                  {order.number}
                </Link>
                <p className="mt-1 text-xs whitespace-nowrap text-slate-400">
                  {formatRelativeTime(order.createdAt, now)}
                  {order.source !== 'cart' ? ` · ${order.source}` : ''}
                </p>
              </td>
              <td className="max-w-60 px-3 py-3 align-top">
                <p className="truncate font-medium text-slate-900">{customerLine(order)}</p>
                <p className="truncate text-xs text-slate-500">
                  {order.fulfilment === 'pickup' ? 'Pickup' : (order.jobsite?.areaLabel ?? 'Jobsite')}
                  {order.window ? ` · ${order.window.label}` : ''}
                </p>
              </td>
              <td className="hidden max-w-60 px-3 py-3 align-top lg:table-cell">
                <p className="truncate text-slate-700">
                  {order.storeOrders.map((so) => so.storeName).join(', ')}
                </p>
                <p className="truncate text-xs text-slate-400">{order.itemsSummary}</p>
              </td>
              <td className="px-3 py-3 align-top">
                <div className="flex flex-wrap gap-1.5">
                  <OrderStatusBadge status={order.status} />
                  {order.needsAttention ? <AttentionBadge /> : null}
                </div>
                <p className="mt-1 text-xs text-slate-500">{orderHeadline(order)}</p>
              </td>
              <td className="px-3 py-3 text-right align-top">
                <p className="font-medium text-slate-900 tabular-nums">
                  {formatMoney(order.current.totalCents)}
                </p>
                <PaymentBadge status={order.payment.status} className="mt-1" />
              </td>
              <td className="py-3 pr-5 align-top text-slate-300">
                <ChevronRightIcon size={16} aria-hidden />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrdersTab({ status, storeId, attention }: { status: string; storeId: string; attention: boolean }) {
  const now = useNow();
  const filters = useMemo(() => {
    const next: Record<string, QueryValue> = {};
    if (status) next.status = status;
    if (storeId) next.storeId = storeId;
    if (attention) next.needsAttention = true;
    return next;
  }, [attention, status, storeId]);
  const orders = useOpsOrders(filters);

  if (orders.loading && orders.items.length === 0) return <PageSpinner label="Loading orders" />;
  if (orders.error && orders.items.length === 0) {
    return <ErrorState error={orders.error} onRetry={orders.retry} className="m-5" />;
  }
  if (orders.items.length === 0) {
    return (
      <ArtEmptyState
        artKey={attention ? 'scene-order-confirmed' : 'scene-jobsite-delivery'}
        title={attention ? 'Nothing needs attention' : 'No orders match'}
        description={
          attention
            ? 'Failed deliveries and stores that did not accept in time show up here.'
            : 'Try another status or store.'
        }
      />
    );
  }
  return (
    <>
      <OrdersTable orders={orders.items} now={now} />
      <LoadMore hasMore={orders.hasMore} loadingMore={orders.loadingMore} onLoadMore={orders.loadMore} />
    </>
  );
}

function StoreOrdersTab({ status, storeId, overdue }: { status: string; storeId: string; overdue: boolean }) {
  const now = useNow();
  const filters = useMemo(() => {
    const next: Record<string, QueryValue> = {};
    if (status) next.status = status;
    if (storeId) next.storeId = storeId;
    if (overdue) next.acceptOverdue = true;
    return next;
  }, [overdue, status, storeId]);
  const storeOrders = useOpsStoreOrders(filters);

  if (storeOrders.loading && storeOrders.items.length === 0)
    return <PageSpinner label="Loading store orders" />;
  if (storeOrders.error && storeOrders.items.length === 0) {
    return <ErrorState error={storeOrders.error} onRetry={storeOrders.retry} className="m-5" />;
  }
  if (storeOrders.items.length === 0) {
    return (
      <ArtEmptyState
        artKey="scene-local-suppliers"
        title={overdue ? 'Every store answered in time' : 'No store orders match'}
        description={
          overdue
            ? 'Store orders not accepted by their deadline show up here.'
            : 'Try another status or store.'
        }
      />
    );
  }
  return (
    <>
      <StoreOrdersTable storeOrders={storeOrders.items} now={now} />
      <LoadMore
        hasMore={storeOrders.hasMore}
        loadingMore={storeOrders.loadingMore}
        onLoadMore={storeOrders.loadMore}
      />
    </>
  );
}

export default function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'store-orders' ? 'store-orders' : 'orders';
  const status = params.get('status') ?? '';
  const storeId = params.get('store') ?? '';
  const flag = params.get('attention') === '1';
  const dashboard = useOpsDashboard().data;

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };

  const statusOptions =
    tab === 'orders'
      ? ORDER_STATUSES.map((value) => ({ value, label: ORDER_STATUS_META[value].label }))
      : STORE_ORDER_STATUSES.map((value) => ({ value, label: STORE_ORDER_META[value].label }));

  return (
    <>
      <PageHeader
        title="Orders"
        description="Every order placed in the InstaSupply app, and each store's part of it."
        actions={<LiveStatusBar />}
      />
      <Tabs<Tab>
        ariaLabel="Order views"
        value={tab}
        onChange={(value) =>
          update({ tab: value === 'orders' ? null : value, status: null, attention: null })
        }
        items={[
          { value: 'orders', label: 'Orders' },
          {
            value: 'store-orders',
            label: 'Store orders',
            count: dashboard?.acceptOverdue ? dashboard.acceptOverdue : undefined,
          },
        ]}
      />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="w-48">
          <Select
            aria-label="Status"
            value={status}
            onChange={(event) => update({ status: event.target.value || null })}
          >
            <option value="">All statuses</option>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-56">
          <StoreSelect value={storeId} onChange={(value) => update({ store: value || null })} />
        </div>
        <Toggle
          checked={flag}
          onChange={(checked) => update({ attention: checked ? '1' : null })}
          label={tab === 'orders' ? 'Needs attention' : 'Overdue for acceptance'}
          description={
            tab === 'orders'
              ? dashboard
                ? `${dashboard.failedDeliveries} failed deliveries, ${dashboard.acceptOverdue} overdue acceptances`
                : 'Failed deliveries and late acceptances'
              : dashboard
                ? `${dashboard.acceptOverdue} right now`
                : 'Not accepted by the deadline'
          }
        />
      </div>
      <Card className="mt-4 overflow-hidden" role="tabpanel">
        {tab === 'orders' ? (
          <OrdersTab status={status} storeId={storeId} attention={flag} />
        ) : (
          <StoreOrdersTab status={status} storeId={storeId} overdue={flag} />
        )}
      </Card>
    </>
  );
}
