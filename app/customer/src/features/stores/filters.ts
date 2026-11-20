import type { StoreSpecialty } from '@instasupply/shared';

import type { StoreView } from './hooks';

/** The Stores tab chips and sorts (MARKETPLACE §7.3 stores row). */
export interface StoreFilters {
  deliveryToday: boolean;
  pickup: boolean;
  openNow: boolean;
  specialty: StoreSpecialty | null;
}

export type StoreSort = 'fastest' | 'nearest' | 'rating';

export const STORE_SORTS: readonly { value: StoreSort; label: string }[] = [
  { value: 'fastest', label: 'Fastest' },
  { value: 'nearest', label: 'Nearest' },
  { value: 'rating', label: 'Top rated' },
];

export const NO_STORE_FILTERS: StoreFilters = {
  deliveryToday: false,
  pickup: false,
  openNow: false,
  specialty: null,
};

export function filterStores(views: readonly StoreView[], filters: StoreFilters): StoreView[] {
  return views.filter(({ store, availability }) => {
    if (filters.deliveryToday && availability.deliverBy == null) return false;
    if (filters.pickup && availability.pickupReadyAt == null) return false;
    if (filters.openNow && !availability.openNow) return false;
    if (filters.specialty && store.specialty !== filters.specialty) return false;
    return true;
  });
}

const LAST = Number.POSITIVE_INFINITY;

/** Earliest promise first: delivery by, else pickup ready; stores that promise nothing go last. */
function fastest(view: StoreView): number {
  return Math.min(view.availability.deliverBy ?? LAST, view.availability.pickupReadyAt ?? LAST);
}

/** Live stores before the ones still joining, then by the chosen sort, then nearest. */
export function sortStores(views: readonly StoreView[], sort: StoreSort): StoreView[] {
  const distance = (view: StoreView) => view.distanceM ?? LAST;
  const live = (view: StoreView) => (view.store.status === 'live' ? 0 : 1);
  return [...views].sort((a, b) => {
    if (live(a) !== live(b)) return live(a) - live(b);
    if (sort === 'fastest') {
      const diff = fastest(a) - fastest(b);
      if (diff !== 0 && Number.isFinite(diff)) return diff;
      if (fastest(a) !== fastest(b)) return Number.isFinite(fastest(a)) ? -1 : 1;
    }
    if (sort === 'rating') {
      const diff = b.store.rating - a.store.rating || b.store.ratingCount - a.store.ratingCount;
      if (diff !== 0) return diff;
    }
    return distance(a) - distance(b) || a.store.name.localeCompare(b.store.name);
  });
}
