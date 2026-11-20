import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme/tokens';

import { useProductSearch } from '../hooks';
import { NO_FILTERS, rankResults, type ListingFilters, type ListingSort } from '../listings';
import { useListings } from '../useListings';

import { ListingResults } from './ListingResults';
import { ListingToolbar } from './ListingToolbar';

/**
 * Listings across nearby stores for a search term or a category, with the shared filters and sorts
 * (MARKETPLACE §7.3). "In stock" is asked of the server; the other filters, the distance and the
 * grouping by family run on the device.
 */
export function ProductListing({
  q = null,
  categoryId = null,
  initialSort = 'best',
  empty,
}: {
  q?: string | null;
  /** Fixed category (a category page): its chip is hidden. */
  categoryId?: string | null;
  initialSort?: ListingSort;
  empty: ReactNode;
}) {
  const fixedCategory = categoryId !== null;
  const [filters, setFilters] = useState<ListingFilters>(NO_FILTERS);
  const [sort, setSort] = useState<ListingSort>(initialSort);
  const search = useProductSearch({
    q: q?.trim() || null,
    categoryId: categoryId ?? filters.categoryId,
    inStock: filters.inStock || null,
  });
  const { listings, storesLoading } = useListings(search.data);
  const items = useMemo(
    () => rankResults(listings, { ...filters, categoryId: null }, sort),
    [listings, filters, sort],
  );
  const loading = search.loading || (storesLoading && sort !== 'best');

  return (
    <View style={styles.wrap}>
      <ListingToolbar
        filters={filters}
        onFiltersChange={setFilters}
        sort={sort}
        onSortChange={setSort}
        showCategory={!fixedCategory}
        resultCount={loading || search.error || items.length === 0 ? null : items.length}
      />
      <ListingResults
        items={items}
        loading={loading}
        error={search.error}
        onRetry={search.retry}
        empty={empty}
      />
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { gap: spacing.md } });
