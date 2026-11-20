import { useLiveQuery } from '@instasupply/api-client/react';
import type { Store, WithId } from '@instasupply/shared';
import { useMemo } from 'react';

import { Select } from '@/components/ui/Form';
import { queries } from '@/lib/api';

/** Every store of the market, A to Z (the public list; staff see `onboarding` and `closed` ones too). */
export function useStoreList(): { stores: WithId<Store>[]; loading: boolean } {
  const result = useLiveQuery(queries.stores());
  const stores = useMemo(() => [...result.data].sort((a, b) => a.name.localeCompare(b.name)), [result.data]);
  return { stores, loading: result.loading };
}

/** Store filter for lists: "All stores" plus every store. */
export function StoreSelect({
  value,
  onChange,
  allLabel = 'All stores',
  liveOnly = false,
  id,
  label = 'Store',
}: {
  value: string;
  onChange: (storeId: string) => void;
  allLabel?: string;
  liveOnly?: boolean;
  id?: string;
  label?: string;
}) {
  const { stores } = useStoreList();
  return (
    <Select
      id={id}
      aria-label={id ? undefined : label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{allLabel}</option>
      {stores
        .filter((store) => !liveOnly || store.status === 'live')
        .map((store) => (
          <option key={store.id} value={store.id}>
            {store.name}
            {store.status !== 'live' ? ` (${store.status.replace('_', ' ')})` : ''}
          </option>
        ))}
    </Select>
  );
}
