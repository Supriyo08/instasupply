import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, Chip, Sheet, Text } from '@/components/ui';
import { spacing } from '@/theme/tokens';

import { useCategories, useCategory } from '../hooks';
import {
  LISTING_SORTS,
  NO_FILTERS,
  activeFilterCount,
  type ListingFilters,
  type ListingSort,
} from '../listings';

/**
 * Filter chips (category, Delivery today, Pickup, In stock) and the sort chooser shared by search
 * and category listings (MARKETPLACE §7.3). The category chip is left out on a category's own page.
 */
export function ListingToolbar({
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  showCategory = true,
  resultCount,
}: {
  filters: ListingFilters;
  onFiltersChange: (filters: ListingFilters) => void;
  sort: ListingSort;
  onSortChange: (sort: ListingSort) => void;
  showCategory?: boolean;
  resultCount: number | null;
}) {
  const [sheet, setSheet] = useState<'sort' | 'category' | null>(null);
  const category = useCategory(filters.categoryId);
  const categories = useCategories();
  const set = (patch: Partial<ListingFilters>) => onFiltersChange({ ...filters, ...patch });
  const sortLabel = LISTING_SORTS.find((option) => option.value === sort)?.label ?? 'Best match';
  const active = activeFilterCount(showCategory ? filters : { ...filters, categoryId: null });

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.bleed}
        contentContainerStyle={styles.chips}
      >
        <Chip
          icon="bar-chart-2"
          label={`Sort: ${sortLabel}`}
          accessibilityLabel={`Sort by ${sortLabel}. Change sort`}
          onPress={() => setSheet('sort')}
        />
        {showCategory ? (
          <Chip
            icon="grid"
            label={category.data?.name ?? 'Category'}
            selected={filters.categoryId !== null}
            accessibilityLabel={
              category.data ? `Category ${category.data.name}. Change category` : 'Choose a category'
            }
            onPress={() => setSheet('category')}
          />
        ) : null}
        <Chip
          icon="truck"
          label="Delivery today"
          selected={filters.deliveryToday}
          onPress={() => set({ deliveryToday: !filters.deliveryToday })}
        />
        <Chip
          icon="shopping-bag"
          label="Pickup"
          selected={filters.pickup}
          onPress={() => set({ pickup: !filters.pickup })}
        />
        <Chip
          icon="check-circle"
          label="In stock"
          selected={filters.inStock}
          onPress={() => set({ inStock: !filters.inStock })}
        />
      </ScrollView>
      {resultCount != null ? (
        <View style={styles.summary}>
          <Text variant="caption" color="muted" accessibilityLiveRegion="polite">
            {resultCount === 1 ? '1 result' : `${resultCount} results`}
          </Text>
          {active > 0 ? (
            <Text
              variant="captionMedium"
              color="primary"
              accessibilityRole="button"
              onPress={() =>
                onFiltersChange(showCategory ? NO_FILTERS : { ...NO_FILTERS, categoryId: filters.categoryId })
              }
            >
              Clear filters
            </Text>
          ) : null}
        </View>
      ) : null}

      <Sheet visible={sheet === 'sort'} onClose={() => setSheet(null)} title="Sort by">
        <View style={styles.options}>
          {LISTING_SORTS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={sort === option.value}
              onPress={() => {
                onSortChange(option.value);
                setSheet(null);
              }}
            />
          ))}
        </View>
      </Sheet>

      <Sheet visible={sheet === 'category'} onClose={() => setSheet(null)} title="Category">
        <ScrollView contentContainerStyle={styles.options}>
          <Chip
            label="All categories"
            selected={filters.categoryId === null}
            onPress={() => {
              set({ categoryId: null });
              setSheet(null);
            }}
          />
          {categories.data.map((item) => (
            <Chip
              key={item.id}
              label={item.name}
              selected={filters.categoryId === item.id}
              onPress={() => {
                set({ categoryId: item.id });
                setSheet(null);
              }}
            />
          ))}
        </ScrollView>
        <Button label="Done" variant="secondary" onPress={() => setSheet(null)} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  bleed: { marginHorizontal: -spacing.gutter },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.gutter },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingBottom: spacing.sm },
  summary: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  wrap: { gap: spacing.sm },
});
