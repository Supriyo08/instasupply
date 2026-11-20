/**
 * `/stores/:storeId` (MARKETPLACE §9, CLIENTS §4.5). Tabs: Profile & hours, Settings (status, radius,
 * commission, payout account, onboarding checklist), Team (invite owner or staff, suspend), Catalog,
 * Orders, Reviews. The tab is kept in `?tab=`.
 */
import { useLiveQuery } from '@instasupply/api-client/react';
import {
  CITIES,
  STORE_SPECIALTY_ART,
  STORE_SPECIALTY_LABELS,
  formatAddressLine,
  formatPhone,
} from '@instasupply/shared';
import { Link, useParams, useSearchParams } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { MessageIcon, StarIcon, StoreIcon } from '@/components/ui/icons';
import { PageHeader, Tabs } from '@/components/ui/Layout';
import { ItemThumb } from '@/features/orders/components/ItemThumb';
import { isNetworkError, queries } from '@/lib/api';

import { StoreProfileForm } from './components/StoreProfileForm';
import { StoreSettingsForm } from './components/StoreSettingsForm';
import { CatalogTab, ReviewsTab, StoreOrdersTab, TeamTab } from './components/StoreTabs';
import { STORE_STATUS_META } from './store-format';

type Tab = 'profile' | 'settings' | 'team' | 'catalog' | 'orders' | 'reviews';
const TABS: { value: Tab; label: string }[] = [
  { value: 'profile', label: 'Profile & hours' },
  { value: 'settings', label: 'Settings' },
  { value: 'team', label: 'Team' },
  { value: 'catalog', label: 'Catalog' },
  { value: 'orders', label: 'Orders' },
  { value: 'reviews', label: 'Reviews' },
];

export default function StoreDetailPage() {
  const { storeId } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((item) => item.value === params.get('tab'))?.value ?? 'profile';
  const store = useLiveQuery(queries.store(storeId));
  const settings = useLiveQuery(queries.storeSettings(storeId));

  if (store.loading && !store.data) return <PageSpinner label="Loading store" />;
  if (!store.data) {
    if (store.error) {
      return (
        <ErrorState
          error={store.error}
          onRetry={store.retry}
          title={isNetworkError(store.error) ? "Can't reach the server" : "Couldn't load this store"}
        />
      );
    }
    return (
      <EmptyState
        icon={StoreIcon}
        title="Store not found"
        action={
          <Link to="/stores" className="text-sm font-semibold text-brand-600">
            All stores
          </Link>
        }
      />
    );
  }

  const data = store.data;
  const status = STORE_STATUS_META[data.status];
  const settingsBody =
    settings.data == null ? (
      settings.error ? (
        <ErrorState error={settings.error} onRetry={settings.retry} />
      ) : (
        <PageSpinner label="Loading settings" />
      )
    ) : null;

  return (
    <>
      <PageHeader
        back={{ to: '/stores', label: 'Stores' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <ItemThumb
              item={{
                imageUrl: data.photoUrl,
                imageKey: data.imageKey ?? STORE_SPECIALTY_ART[data.specialty],
              }}
            />
            {data.name}
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
            {data.status === 'live' && !data.acceptingOrders ? <Badge tone="warning">Paused</Badge> : null}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{STORE_SPECIALTY_LABELS[data.specialty]}</span>
            <span>
              {formatAddressLine(data.address)} · {CITIES[data.cityId]?.name ?? data.cityId}
            </span>
            <a href={`tel:${data.phone}`} className="text-brand-700 hover:underline">
              {formatPhone(data.phone)}
            </a>
            {data.ratingCount > 0 ? (
              <span className="inline-flex items-center gap-1">
                <StarIcon size={14} className="text-amber-500" aria-hidden /> {data.rating.toFixed(1)} (
                {data.ratingCount})
              </span>
            ) : null}
          </span>
        }
        actions={
          <Link
            to={`/support/store_${encodeURIComponent(data.id)}`}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
          >
            <MessageIcon size={16} aria-hidden /> Store support chat
          </Link>
        }
      />
      <Tabs<Tab>
        ariaLabel="Store sections"
        value={tab}
        items={TABS}
        onChange={(value) => {
          const next = new URLSearchParams(params);
          if (value === 'profile') next.delete('tab');
          else next.set('tab', value);
          setParams(next, { replace: true });
        }}
      />
      <div className="mt-6" role="tabpanel">
        {tab === 'profile'
          ? (settingsBody ?? <StoreProfileForm key={data.id} store={data} settings={settings.data} />)
          : null}
        {tab === 'settings' && settings.data ? (
          <StoreSettingsForm key={data.id} store={data} settings={settings.data} />
        ) : tab === 'settings' ? (
          settingsBody
        ) : null}
        {tab === 'team' ? <TeamTab storeId={data.id} /> : null}
        {tab === 'catalog' ? <CatalogTab storeId={data.id} /> : null}
        {tab === 'orders' ? <StoreOrdersTab storeId={data.id} /> : null}
        {tab === 'reviews' ? <ReviewsTab storeId={data.id} /> : null}
      </div>
    </>
  );
}
