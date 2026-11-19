import { pluralize, type Product } from '@instasupply/shared';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ProductGrid } from '@/components/catalog/ProductGrid';
import { Button, EmptyState, ErrorState, Header, Icon, IconButton, Screen, Text } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

import { ActiveFilterChips } from './ActiveFilterChips';
import { activeFilters, applyFilters, DEFAULT_FILTERS, sortLabel, type ProductFilters } from './filters';
import { FilterSheet } from './FilterSheet';
import { ProductGridSkeleton } from './ProductGridSkeleton';

export interface ProductListingProps {
  title: string;
  products: Product[];
  loading: boolean;
  error: Error | null;
  /** The category doesn't exist (old link or removed). */
  notFound?: boolean;
  /** Loads the products again after `error`: the `retry` of the hooks that feed this screen. */
  onRetry: () => void;
}

/** A category or the featured shelf: header with the filter button, filter chips, grid and states. */
export function ProductListingScreen({
  title,
  products,
  loading,
  error,
  notFound = false,
  onRetry,
}: ProductListingProps) {
  const [filters, setFilters] = useState<ProductFilters>(DEFAULT_FILTERS);
  const [sheetOpen, setSheetOpen] = useState(false);
  const visible = useMemo(() => applyFilters(products, filters), [products, filters]);
  const activeCount = activeFilters(filters).length;
  const ready = !notFound && !loading && !error && products.length > 0;

  const filterButton = ready ? (
    <IconButton
      icon="sliders"
      label={activeCount > 0 ? `Filter and sort, ${activeCount} active` : 'Filter and sort'}
      badge={activeCount}
      onPress={() => setSheetOpen(true)}
    />
  ) : null;

  return (
    <>
      <Screen header={<Header title={title} right={filterButton} />}>
        {ready ? (
          <>
            <View style={styles.toolbar}>
              <Text variant="captionMedium" color="muted">
                {visible.length === products.length
                  ? pluralize(products.length, 'product')
                  : `${visible.length} of ${pluralize(products.length, 'product')}`}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Sorted by ${sortLabel(filters.sort)}. Change filters and sort`}
                hitSlop={8}
                onPress={() => setSheetOpen(true)}
                style={({ pressed }) => [styles.sort, pressed ? styles.pressed : null]}
              >
                <Text variant="caption" color="muted">
                  Sort:
                </Text>
                <Text variant="captionMedium">{sortLabel(filters.sort)}</Text>
                <Icon name="chevron-down" size={14} color={colors.text} />
              </Pressable>
            </View>
            <ActiveFilterChips filters={filters} onChange={setFilters} />
            {visible.length > 0 ? (
              <ProductGrid products={visible} />
            ) : (
              <EmptyState
                art="scene-empty-cart"
                title="No matching products"
                message="Try a wider price range or remove a filter to see more."
                action={
                  <Button
                    label="Clear filters"
                    variant="secondary"
                    onPress={() => setFilters(DEFAULT_FILTERS)}
                  />
                }
              />
            )}
          </>
        ) : (
          <ListingStatus notFound={notFound} loading={loading} error={error} onRetry={onRetry} />
        )}
      </Screen>
      <FilterSheet
        visible={sheetOpen}
        value={filters}
        products={products}
        onApply={(next) => {
          setFilters(next);
          setSheetOpen(false);
        }}
        onClose={() => setSheetOpen(false)}
      />
    </>
  );
}

/** Everything that isn't a product grid: not found, loading, error and an empty aisle. */
function ListingStatus({
  notFound,
  loading,
  error,
  onRetry,
}: Pick<ProductListingProps, 'loading' | 'error' | 'onRetry'> & { notFound: boolean }) {
  // Back to the categories screen if it is already in the stack, otherwise replace this one.
  const browse = (label: string, variant: 'primary' | 'secondary') => (
    <Button label={label} variant={variant} onPress={() => router.dismissTo('/categories')} />
  );
  if (notFound) {
    return (
      <EmptyState
        art="scene-local-suppliers"
        title="Category not found"
        message="This aisle may have moved. Have a look at all our categories instead."
        action={browse('Browse categories', 'primary')}
      />
    );
  }
  if (loading) return <ProductGridSkeleton count={6} />;
  if (error) return <ErrorState title="Couldn't load products" error={error} onRetry={onRetry} />;
  return (
    <EmptyState
      art="scene-local-suppliers"
      title="Nothing here yet"
      message="We're restocking this aisle. Check back soon or explore other categories."
      action={browse('Explore categories', 'secondary')}
    />
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
  sort: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  toolbar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
});
