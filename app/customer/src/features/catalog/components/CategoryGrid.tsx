import type { Category } from '@instasupply/shared';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ArtImage, EmptyState, ErrorState, Skeleton, Text } from '@/components/ui';
import { useCategories } from '@/features/catalog/hooks';
import { colors, radius, spacing } from '@/theme/tokens';

import { sortCategories, type CategorySort } from './CategorySortSheet';

const COLUMNS = 3;
const CIRCLE = 64;
/** Shared by tiles and spacers: flex cells with padding only line up when every cell has it. */
const CELL_PADDING = 6;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) rows.push(items.slice(index, index + size));
  return rows;
}

/** Categories screen body: three columns of white tiles, with loading, error and empty states. */
export function CategoriesContent({ sort }: { sort: CategorySort }) {
  const { data, loading, error, retry } = useCategories();
  const sorted = useMemo(() => sortCategories(data, sort), [data, sort]);

  if (loading) return <CategoryGridSkeleton />;
  if (error) return <ErrorState title="Couldn't load categories" error={error} onRetry={retry} />;
  if (sorted.length === 0) {
    return (
      <EmptyState
        art="scene-local-suppliers"
        title="No categories yet"
        message="We're stocking the shelves. Check back in a little while."
      />
    );
  }
  return (
    <View style={styles.grid}>
      {chunk(sorted, COLUMNS).map((row) => (
        <View key={row.map((category) => category.id).join('-')} style={styles.row}>
          {row.map((category) => (
            <CategoryTile key={category.id} category={category} />
          ))}
          {Array.from({ length: COLUMNS - row.length }, (_, spacer) => (
            <View key={`spacer-${spacer}`} style={styles.spacer} />
          ))}
        </View>
      ))}
    </View>
  );
}

function CategoryTile({ category }: { category: Category }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={category.name}
      accessibilityHint="Shows the products in this category"
      onPress={() => router.push(`/category/${category.id}`)}
      style={({ pressed }) => [styles.tile, pressed ? styles.pressed : null]}
    >
      <View style={[styles.circle, { backgroundColor: category.tint }]}>
        <ArtImage artKey={category.iconKey} size={38} />
      </View>
      <Text variant="caption" color="muted" align="center" numberOfLines={1}>
        {category.name}
      </Text>
    </Pressable>
  );
}

function CategoryGridSkeleton() {
  return (
    <View style={styles.grid} accessibilityRole="progressbar" accessibilityLabel="Loading categories">
      {[0, 1, 2].map((row) => (
        <View key={row} style={styles.row}>
          {[0, 1, 2].map((column) => (
            <View key={column} style={styles.tile}>
              <Skeleton style={styles.circleSkeleton} />
              <Skeleton style={styles.labelSkeleton} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    borderRadius: radius.pill,
    height: CIRCLE,
    justifyContent: 'center',
    width: CIRCLE,
  },
  circleSkeleton: { borderRadius: radius.pill, height: CIRCLE, width: CIRCLE },
  grid: { gap: spacing.md },
  labelSkeleton: { height: 10, width: '60%' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  row: { flexDirection: 'row', gap: spacing.md },
  spacer: { flex: 1, paddingHorizontal: CELL_PADDING },
  tile: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    flex: 1,
    gap: 10,
    paddingHorizontal: CELL_PADDING,
    paddingVertical: 18,
  },
});
