import { ORDER_OPEN_STATUSES, ORDER_STATUS_META } from '@instasupply/shared';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState } from '@/components/ui/Feedback';
import { Select, TextInput } from '@/components/ui/Form';
import { DownloadIcon, OrdersIcon, SearchIcon } from '@/components/ui/icons';
import { PageHeader, Tabs, type TabItem } from '@/components/ui/Layout';
import { useNow, useOpenOrders } from '@/lib/data';

import { OrderKpis } from './components/OrderKpis';
import { OrdersTable, OrdersTableSkeleton } from './components/OrdersTable';
import { ORDER_LIST_LIMIT, useLatestOrders, useOrdersWithStatus } from './hooks';
import { matchesOrderSearch, parseStatusParam, type OrderTab } from './order-format';
import { downloadOrdersCsv, localStamp } from './orders-csv';

const EMPTY: Record<OrderTab, { title: string; description: string }> = {
  open: { title: 'No open orders', description: 'New orders show up here as soon as a shopper checks out.' },
  attention: {
    title: 'Nothing needs attention',
    description: 'Orders whose delivery attempt failed show up here so you can retry or cancel them.',
  },
  delivered: {
    title: 'No delivered orders yet',
    description: 'Orders move here once the driver completes the delivery.',
  },
  cancelled: {
    title: 'No cancelled orders',
    description: 'Orders cancelled by shoppers or the store show up here.',
  },
  all: { title: 'No orders yet', description: 'Orders placed in the customer app show up here.' },
};

export default function OrdersPage() {
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const filter = parseStatusParam(params.get('status'));
  const [search, setSearch] = useState('');

  // Open and failed orders are always live (tab counts); history loads only while its tab is shown.
  // One listener per tab, so switching tabs never shows the previous tab's rows while loading.
  const open = useOpenOrders();
  const attention = useOrdersWithStatus('failed');
  const delivered = useOrdersWithStatus(filter.tab === 'delivered' ? 'delivered' : null);
  const cancelled = useOrdersWithStatus(filter.tab === 'cancelled' ? 'cancelled' : null);
  const all = useLatestOrders(filter.tab === 'all');
  const source = { open, attention, delivered, cancelled, all }[filter.tab];

  const visible = useMemo(
    () =>
      source.data.filter(
        (order) =>
          (filter.status ? order.status === filter.status : true) && matchesOrderSearch(order, search),
      ),
    [filter.status, search, source.data],
  );

  const setStatus = (value: string | null) => {
    const next = new URLSearchParams(params);
    if (value && value !== 'open') next.set('status', value);
    else next.delete('status');
    setParams(next, { replace: true });
  };

  const clearFilters = () => {
    setSearch('');
    if (filter.status) setStatus(null);
  };

  const exportCsv = () =>
    downloadOrdersCsv(
      visible,
      `instasupply-orders-${filter.status ?? filter.tab}-${localStamp(Date.now())}.csv`,
    );

  const tabs: TabItem<OrderTab>[] = [
    { value: 'open', label: 'Open', count: open.data.length },
    { value: 'attention', label: 'Needs attention', count: attention.data.length },
    { value: 'delivered', label: 'Delivered' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'all', label: 'All' },
  ];

  const filtered = !!search.trim() || !!filter.status;
  const loading = source.loading && source.data.length === 0;
  const capped = filter.tab !== 'open' && source.data.length >= ORDER_LIST_LIMIT;

  return (
    <>
      <PageHeader
        title="Orders"
        description="Shop orders from the customer app, from checkout to the doorstep."
        actions={
          <Button variant="secondary" icon={DownloadIcon} onClick={exportCsv} disabled={visible.length === 0}>
            Export CSV
          </Button>
        }
      />

      <OrderKpis now={now} openOrders={open.data} openLoading={open.loading} />

      <Card>
        <div className="px-5 pt-2">
          <Tabs ariaLabel="Order status" items={tabs} value={filter.tab} onChange={setStatus} />
        </div>
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <SearchIcon
              size={16}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <TextInput
              aria-label="Search orders"
              className="pl-9"
              placeholder="Search order number, customer, phone or city"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {filter.tab === 'open' ? (
            <Select
              aria-label="Filter open orders by status"
              className="sm:w-52"
              value={filter.status ?? ''}
              onChange={(event) => setStatus(event.target.value || null)}
            >
              <option value="">All open orders</option>
              {ORDER_OPEN_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {ORDER_STATUS_META[status].label}
                </option>
              ))}
            </Select>
          ) : null}
        </div>

        {source.error ? (
          <ErrorState error={source.error} className="m-5" />
        ) : loading ? (
          <OrdersTableSkeleton />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={OrdersIcon}
            title={filtered ? 'No orders match your filters' : EMPTY[filter.tab].title}
            description={
              filtered ? 'Try a different order number, name, phone or city.' : EMPTY[filter.tab].description
            }
            action={
              filtered ? (
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <OrdersTable orders={visible} now={now} />
        )}

        {capped && !source.error ? (
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            Showing the latest {ORDER_LIST_LIMIT} orders.
          </p>
        ) : null}
      </Card>
    </>
  );
}
