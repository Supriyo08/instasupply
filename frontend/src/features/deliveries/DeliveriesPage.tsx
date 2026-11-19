import { ACTIVE_STATUSES, startOfDay, type DeliveryStatus } from '@instasupply/shared';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { Select, TextInput } from '@/components/ui/Form';
import { PackageIcon, PlusIcon, SearchIcon, UploadIcon } from '@/components/ui/icons';
import { PageHeader, Tabs, type TabItem } from '@/components/ui/Layout';
import {
  mergeById,
  useDrivers,
  useNow,
  useOpenDeliveries,
  useRecentDeliveries,
  type DeliveryRecord,
} from '@/lib/data';

import { AssignDialog } from './components/AssignDialog';
import { DeliveriesTable } from './components/DeliveriesTable';
import { CreateDeliveryModal } from './create/CreateDeliveryModal';
import { ImportCsvModal } from './import/ImportCsvModal';

type Tab = 'all' | 'unassigned' | 'active' | 'delivered' | 'failed' | 'cancelled';
type Range = 'today' | '7d' | '30d';

const DAY = 24 * 60 * 60 * 1000;
const RANGE_START: Record<Range, () => number> = {
  today: () => startOfDay(),
  '7d': () => startOfDay() - 6 * DAY,
  '30d': () => startOfDay() - 29 * DAY,
};

const matchesTab = (status: DeliveryStatus, tab: Tab) => {
  if (tab === 'all') return true;
  if (tab === 'active') return ACTIVE_STATUSES.includes(status);
  return status === tab;
};

export default function DeliveriesPage() {
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? 'all';
  const [range, setRange] = useState<Range>('7d');
  const [search, setSearch] = useState('');
  const [driverFilter, setDriverFilter] = useState('');
  const [assigning, setAssigning] = useState<DeliveryRecord | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const createOpen = params.get('create') === '1';

  const since = useMemo(() => RANGE_START[range](), [range]);
  const open = useOpenDeliveries();
  const recent = useRecentDeliveries(since);
  const drivers = useDrivers();

  // Open work is always shown regardless of age; finished work is limited to the date range.
  const all = useMemo(() => mergeById(open.data, recent.data), [open.data, recent.data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all
      .filter((delivery) => (driverFilter ? delivery.driverId === driverFilter : true))
      .filter((delivery) =>
        term
          ? [
              delivery.orderId,
              delivery.customer.name,
              delivery.customer.phone ?? '',
              delivery.address,
              delivery.driverName ?? '',
            ]
              .join(' ')
              .toLowerCase()
              .includes(term)
          : true,
      )
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  }, [all, driverFilter, search]);

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
      (Object.keys(result) as Tab[]).forEach((key) => {
        if (matchesTab(delivery.status, key)) result[key] += 1;
      });
    }
    return result;
  }, [filtered]);

  const visible = filtered.filter((delivery) => matchesTab(delivery.status, tab));

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

  const loading = open.loading && recent.loading && all.length === 0;
  const error = open.error ?? recent.error;

  return (
    <>
      <PageHeader
        title="Deliveries"
        description="Create, assign and follow every order."
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

      <Card>
        <div className="px-5 pt-2">
          <Tabs
            ariaLabel="Delivery status"
            items={tabs}
            value={tab}
            onChange={(value) => setParam('tab', value === 'all' ? null : value)}
          />
        </div>
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <SearchIcon
              size={16}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <TextInput
              aria-label="Search deliveries"
              className="pl-9"
              placeholder="Search order, customer, phone, address or driver"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Select
            aria-label="Filter by driver"
            className="sm:w-48"
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
            aria-label="Date range"
            className="sm:w-40"
            value={range}
            onChange={(event) => setRange(event.target.value as Range)}
          >
            <option value="today">Created today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </Select>
        </div>

        {error ? (
          <ErrorState error={error} className="m-5" />
        ) : loading ? (
          <PageSpinner label="Loading deliveries" />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={PackageIcon}
            title={search || driverFilter ? 'No deliveries match your filters' : 'No deliveries here yet'}
            description={
              search || driverFilter
                ? 'Try a different search or clear the filters.'
                : 'Create a delivery or import a CSV to get started.'
            }
            action={
              !search && !driverFilter ? (
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
