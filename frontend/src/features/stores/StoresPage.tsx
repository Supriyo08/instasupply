/**
 * `/stores` (MARKETPLACE §9, CLIENTS §4.5): every supplier with status, specialty, city, live
 * products, orders in the last 7 days, rating, median time to accept and whether it is open now.
 * One `GET /ops/stores` read (every store), so the search and status filter run on the full list.
 */
import { useLiveQuery } from '@instasupply/api-client/react';
import {
  CITIES,
  STORE_SPECIALTY_ART,
  STORE_SPECIALTY_LABELS,
  formatDuration,
  type OpsStoreRow,
  type StoreStatus,
} from '@instasupply/shared';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { Segmented, TextInput } from '@/components/ui/Form';
import { ChevronRightIcon, PlusIcon, StarIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/Layout';
import { ArtEmptyState, ItemThumb } from '@/features/orders/components/ItemThumb';
import { queries } from '@/lib/api';

import { STORE_STATUS_META } from './store-format';

type StatusFilter = 'all' | StoreStatus;

function StoreRow({ row }: { row: OpsStoreRow }) {
  const { store } = row;
  const status = STORE_STATUS_META[store.status];
  return (
    <tr className="transition-colors hover:bg-slate-50">
      <td className="px-5 py-3">
        <div className="flex items-center gap-3">
          <ItemThumb
            item={{
              imageUrl: store.photoUrl,
              imageKey: store.imageKey ?? STORE_SPECIALTY_ART[store.specialty],
            }}
          />
          <div className="min-w-0">
            <Link
              to={`/stores/${encodeURIComponent(store.id)}`}
              className="font-medium text-slate-900 hover:text-brand-700"
            >
              {store.name}
            </Link>
            <p className="truncate text-xs text-slate-500">{STORE_SPECIALTY_LABELS[store.specialty]}</p>
          </div>
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
          {store.status === 'live' && !store.acceptingOrders ? <Badge tone="warning">Paused</Badge> : null}
        </div>
      </td>
      <td className="hidden px-3 py-3 text-slate-700 md:table-cell">
        {CITIES[store.cityId]?.name ?? store.cityId}
        <span className="block text-xs text-slate-500">{store.areaLabel}</span>
      </td>
      <td className="px-3 py-3 text-right tabular-nums">{row.liveProducts}</td>
      <td className="hidden px-3 py-3 text-right tabular-nums sm:table-cell">{row.ordersLast7Days}</td>
      <td className="hidden px-3 py-3 lg:table-cell">
        {store.ratingCount > 0 ? (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <StarIcon size={14} className="text-amber-500" aria-hidden />
            {store.rating.toFixed(1)}
            <span className="text-xs text-slate-400">({store.ratingCount})</span>
          </span>
        ) : (
          <span className="text-xs text-slate-400">No reviews</span>
        )}
      </td>
      <td className="hidden px-3 py-3 text-right tabular-nums lg:table-cell">
        {row.medianAcceptSeconds == null ? '—' : formatDuration(row.medianAcceptSeconds)}
      </td>
      <td className="px-3 py-3">
        {row.openNow ? <Badge tone="success">Open</Badge> : <Badge tone="neutral">Closed</Badge>}
      </td>
      <td className="py-3 pr-5 text-slate-300">
        <ChevronRightIcon size={16} aria-hidden />
      </td>
    </tr>
  );
}

const HEADERS: { label: string; className: string }[] = [
  { label: 'Store', className: 'px-5' },
  { label: 'Status', className: 'px-3' },
  { label: 'City', className: 'hidden px-3 md:table-cell' },
  { label: 'Live products', className: 'px-3 text-right' },
  { label: 'Orders (7 days)', className: 'hidden px-3 text-right sm:table-cell' },
  { label: 'Rating', className: 'hidden px-3 lg:table-cell' },
  { label: 'Median accept', className: 'hidden px-3 text-right lg:table-cell' },
  { label: 'Now', className: 'px-3' },
];

export default function StoresPage() {
  const navigate = useNavigate();
  const stores = useLiveQuery(queries.opsStores());
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...stores.data]
      .filter((row) => filter === 'all' || row.store.status === filter)
      .filter(
        (row) =>
          !term ||
          row.store.name.toLowerCase().includes(term) ||
          row.store.areaLabel.toLowerCase().includes(term) ||
          STORE_SPECIALTY_LABELS[row.store.specialty].toLowerCase().includes(term),
      )
      .sort((a, b) => a.store.name.localeCompare(b.store.name));
  }, [filter, search, stores.data]);

  const newStore = (
    <Button icon={PlusIcon} onClick={() => navigate('/stores/new')}>
      New store
    </Button>
  );

  let body;
  if (stores.loading && stores.data.length === 0) body = <PageSpinner label="Loading stores" />;
  else if (stores.error && stores.data.length === 0) {
    body = <ErrorState error={stores.error} onRetry={stores.retry} className="m-5" />;
  } else if (stores.data.length === 0) {
    body = (
      <ArtEmptyState
        artKey="scene-local-suppliers"
        title="No stores yet"
        description="Add the first supplier with the new store wizard."
        action={newStore}
      />
    );
  } else if (rows.length === 0) {
    body = (
      <ArtEmptyState
        artKey="scene-local-suppliers"
        title="No stores match"
        description="Try another status or search."
      />
    );
  } else {
    body = (
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <caption className="sr-only">Stores, A to Z</caption>
          <thead className="border-b border-slate-200 bg-slate-50/70 text-xs text-slate-500">
            <tr>
              {HEADERS.map((header) => (
                <th key={header.label} scope="col" className={`py-3 font-medium ${header.className}`}>
                  {header.label}
                </th>
              ))}
              <th scope="col" className="w-10 py-3 pr-5">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <StoreRow key={row.store.id} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Stores"
        description="Lumber yards, electrical, plumbing and building-supply stores across the Greater Toronto Area."
        actions={newStore}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented<StatusFilter>
          ariaLabel="Store status"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'live', label: 'Live' },
            { value: 'onboarding', label: 'Onboarding' },
            { value: 'coming_soon', label: 'Coming soon' },
            { value: 'closed', label: 'Closed' },
          ]}
        />
        <div className="w-full max-w-xs">
          <TextInput
            type="search"
            aria-label="Search stores"
            placeholder="Search by name, area or specialty"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      <Card className="overflow-hidden">{body}</Card>
    </>
  );
}
