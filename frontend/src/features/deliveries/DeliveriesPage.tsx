import {
  ACTIVE_STATUSES,
  addLocalDays,
  formatRelativeTime,
  localDateOf,
  startOfLocalDay,
  STORE_ORDER_META,
  type DeliveryStatus,
} from '@instasupply/shared';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { LoadMore } from '@/components/ui/Data';
import { Callout, ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { Select, TextInput } from '@/components/ui/Form';
import {
  ChevronRightIcon,
  FailedIcon,
  InfoIcon,
  PlusIcon,
  SearchIcon,
  UploadIcon,
} from '@/components/ui/icons';
import { PageHeader, Tabs, type TabItem } from '@/components/ui/Layout';
import {
  mergeById,
  useClosedToday,
  useDrivers,
  useFailedStoreOrders,
  useNow,
  useOpenDeliveries,
  useRecentDeliveries,
  useStartOfToday,
  type DeliveryRecord,
} from '@/lib/data';

import { AssignDialog } from './components/AssignDialog';
import { DeliveriesTable } from './components/DeliveriesTable';
import { SceneEmpty } from './components/SceneArt';
import { CreateDeliveryModal } from './create/CreateDeliveryModal';
import { KIND_LABEL } from './delivery-format';
import { ImportCsvModal } from './import/ImportCsvModal';

type Tab = 'all' | 'unassigned' | 'active' | 'delivered' | 'failed' | 'cancelled';
type Range = 'today' | '7d' | '30d';
type Kind = 'all' | 'marketplace' | 'manual';

/** A non-paged list stops at this many rows (CLIENTS §4.1 `maxRows`); a full list says so (R47, R48). */
const LIST_CAP = 2_000;

const matchesTab = (status: DeliveryStatus, tab: Tab) => {
  if (tab === 'all') return true;
  if (tab === 'active') return ACTIVE_STATUSES.includes(status);
  return status === tab;
};

const TABS: Tab[] = ['all', 'unassigned', 'active', 'delivered', 'failed', 'cancelled'];

export default function DeliveriesPage() {
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab') as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'all';
  const [range, setRange] = useState<Range>('7d');
  const [kind, setKind] = useState<Kind>('all');
  const [search, setSearch] = useState('');
  const [driverFilter, setDriverFilter] = useState('');
  const [assigning, setAssigning] = useState<DeliveryRecord | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const createOpen = params.get('create') === '1';

  // Ranges are Toronto calendar days, whatever the dispatcher's computer is set to (MARKETPLACE §4.1).
  const today = useStartOfToday();
  const since = useMemo(() => {
    if (range === 'today') return today;
    return startOfLocalDay(addLocalDays(localDateOf(today), range === '7d' ? -6 : -29));
  }, [range, today]);
  const open = useOpenDeliveries();
  const closedToday = useClosedToday();
  const recent = useRecentDeliveries(since);
  const failedOrders = useFailedStoreOrders();
  const drivers = useDrivers();

  // Open work is always shown regardless of age; finished work is limited to the date range, plus
  // everything that finished today.
  const all = useMemo(
    () => mergeById(open.data, closedToday.data, recent.data),
    [closedToday.data, open.data, recent.data],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all
      .filter((delivery) => (kind === 'all' ? true : delivery.kind === kind))
      .filter((delivery) => (driverFilter ? delivery.driverId === driverFilter : true))
      .filter((delivery) =>
        term
          ? [
              delivery.orderId,
              delivery.customer.name,
              delivery.customer.phone ?? '',
              delivery.address,
              delivery.driverName ?? '',
              delivery.pickup?.storeName ?? '',
            ]
              .join(' ')
              .toLowerCase()
              .includes(term)
          : true,
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [all, driverFilter, kind, search]);

  const counts = useMemo(() => {
    const result: Record<Tab, number> = {
      all: 0,
      unassigned: 0,
      active: 0,
      delivered: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const delivery of filtered) {
      for (const key of TABS) if (matchesTab(delivery.status, key)) result[key] += 1;
    }
    return result;
  }, [filtered]);

  const visible = filtered.filter((delivery) => matchesTab(delivery.status, tab));
  const capped = open.data.length >= LIST_CAP || recent.data.length >= LIST_CAP;

  const tabs: TabItem<Tab>[] = [
    { value: 'all', label: 'All', count: counts.all },
    { value: 'unassigned', label: 'Unassigned', count: counts.unassigned },
    { value: 'active', label: 'In progress', count: counts.active },
    { value: 'delivered', label: 'Delivered', count: counts.delivered },
    { value: 'failed', label: 'Failed', count: counts.failed },
    { value: 'cancelled', label: 'Cancelled', count: counts.cancelled },
  ];

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const loading = (open.loading || recent.loading) && all.length === 0;
  const error = all.length === 0 ? (open.error ?? recent.error ?? closedToday.error) : null;
  const filtering = !!search || !!driverFilter || kind !== 'all';

  return (
    <>
      <PageHeader
        title="Deliveries"
        description="Every trip from the stores to the jobsites, and dispatch's own deliveries."
        actions={
          <>
            <Button variant="secondary" icon={UploadIcon} onClick={() => setImportOpen(true)}>
              Import CSV
            </Button>
            <Button icon={PlusIcon} onClick={() => setParam('create', '1')}>
              New delivery
            </Button>
          </>
        }
      />

      {tab === 'failed' || tab === 'all' ? (
        <FailedStoreOrders failed={failedOrders} now={now} compact={tab === 'all'} />
      ) : null}

      <Card>
        <div className="px-5 pt-2">
          <Tabs
            ariaLabel="Delivery status"
            items={tabs}
            value={tab}
            onChange={(value) => setParam('tab', value === 'all' ? null : value)}
          />
        </div>
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <SearchIcon
              size={16}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <TextInput
              aria-label="Search deliveries"
              className="pl-9"
              placeholder="Search order, site contact, phone, address, store or driver"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Select
            aria-label="Kind of delivery"
            className="lg:w-40"
            value={kind}
            onChange={(event) => setKind(event.target.value as Kind)}
          >
            <option value="all">All kinds</option>
            <option value="marketplace">{KIND_LABEL.marketplace}s</option>
            <option value="manual">{KIND_LABEL.manual} deliveries</option>
          </Select>
          <Select
            aria-label="Filter by driver"
            className="lg:w-48"
            value={driverFilter}
            onChange={(event) => setDriverFilter(event.target.value)}
          >
            <option value="">All drivers</option>
            {drivers.data
              .filter((driver) => driver.status === 'active')
              .map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.displayName}
                </option>
              ))}
          </Select>
          <Select
            aria-label="Date range for finished deliveries"
            className="lg:w-44"
            value={range}
            onChange={(event) => setRange(event.target.value as Range)}
          >
            <option value="today">Created today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </Select>
        </div>

        {capped ? (
          <div className="border-b border-slate-100 px-5 py-2">
            <Callout tone="info" icon={InfoIcon}>
              Showing the newest {LIST_CAP.toLocaleString('en-CA')} deliveries of a list; older ones are not
              loaded. Narrow the date range, or open a delivery by its link.
            </Callout>
          </div>
        ) : null}

        {error ? (
          <ErrorState
            error={error}
            onRetry={() => (open.error ? open.retry() : recent.retry())}
            className="m-5"
          />
        ) : loading ? (
          <PageSpinner label="Loading deliveries" />
        ) : visible.length === 0 ? (
          <SceneEmpty
            artKey="scene-jobsite-delivery"
            title={filtering ? 'No deliveries match your filters' : 'Nothing here yet'}
            description={
              filtering
                ? 'Try a different search or clear the filters.'
                : tab === 'all'
                  ? 'Store orders appear here once they are placed. Create a manual delivery or import a CSV for dispatch trips.'
                  : 'No deliveries in this tab for the selected dates.'
            }
            action={
              !filtering && tab === 'all' ? (
                <Button icon={PlusIcon} onClick={() => setParam('create', '1')}>
                  New delivery
                </Button>
              ) : undefined
            }
          />
        ) : (
          <DeliveriesTable deliveries={visible} now={now} onAssign={setAssigning} />
        )}
      </Card>

      <CreateDeliveryModal open={createOpen} onClose={() => setParam('create', null)} />
      <ImportCsvModal open={importOpen} onClose={() => setImportOpen(false)} />
      <AssignDialog delivery={assigning} open={!!assigning} onClose={() => setAssigning(null)} />
    </>
  );
}

/**
 * Store orders whose delivery failed: they wait for a re-attempt or a return to the store, with no date
 * bound, so an order created weeks ago that failed yesterday is still on screen (R54).
 */
function FailedStoreOrders({
  failed,
  now,
  compact,
}: {
  failed: ReturnType<typeof useFailedStoreOrders>;
  now: number;
  compact: boolean;
}) {
  if (failed.items.length === 0) {
    if (compact || failed.loading) return null;
    if (failed.error) {
      return (
        <ErrorState
          error={failed.error}
          onRetry={failed.retry}
          title="Couldn't load failed store orders"
          className="mb-4"
        />
      );
    }
    return null;
  }
  return (
    <Card className="mb-4 border-rose-200">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2 text-rose-700">
            <FailedIcon size={16} aria-hidden /> Failed store orders waiting for a decision
          </span>
        }
        description="Re-attempt the delivery or return the load to the store from the delivery page."
        action={
          <Badge tone="danger">
            {failed.items.length}
            {failed.hasMore ? '+' : ''}
          </Badge>
        }
      />
      <ul className="divide-y divide-slate-100">
        {(compact ? failed.items.slice(0, 3) : failed.items).map((order) => (
          <li key={order.id}>
            <Link
              to={order.deliveryId ? `/deliveries/${order.deliveryId}` : `/orders/${order.orderId}`}
              className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900">
                  <span className="font-mono">{order.number}</span> · {order.storeName}
                </span>
                <span className="block truncate text-xs text-slate-500">
                  {order.companyName ?? order.customerName} · {order.jobsite?.areaLabel ?? 'Jobsite'} ·{' '}
                  {STORE_ORDER_META.failed.label.toLowerCase()}{' '}
                  {formatRelativeTime(order.statusAt.failed ?? order.updatedAt, now)}
                </span>
              </span>
              <ChevronRightIcon size={16} className="shrink-0 text-slate-300" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      {compact && failed.items.length > 3 ? (
        <Link
          to="/deliveries?tab=failed"
          className="block border-t border-slate-100 px-5 py-2.5 text-xs font-semibold text-brand-600 hover:text-brand-700"
        >
          See all failed store orders
        </Link>
      ) : null}
      {!compact ? (
        <LoadMore hasMore={failed.hasMore} loadingMore={failed.loadingMore} onLoadMore={failed.loadMore} />
      ) : null}
    </Card>
  );
}
