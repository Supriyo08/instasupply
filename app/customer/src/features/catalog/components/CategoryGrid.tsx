import type { Category } from '@instasupply/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ArtImage, Icon, Skeleton, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

const COLUMNS = 3;
const CIRCLE = 64;
/** Shared by tiles and spacers: flex cells with padding only line up when every cell has it. */
const CELL_PADDING = 6;

type Cell = { kind: 'category'; category: Category } | { kind: 'all' };

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) rows.push(items.slice(index, index + size));
  return rows;
}

/**
 * Three columns of white tiles with the 3D category icon on its pastel circle. `seeAll` adds a last
 * tile that opens every category (Home shows 8 + "See all").
 */
export function CategoryGrid({
  categories,
  seeAll = false,
}: {
  categories: readonly Category[];
  seeAll?: boolean;
}) {
  const cells: Cell[] = [
    ...categories.map((category): Cell => ({ kind: 'category', category })),
    ...(seeAll ? [{ kind: 'all' } as const] : []),
  ];
  return (
    <View style={styles.grid}>
      {chunk(cells, COLUMNS).map((row, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          {row.map((cell) =>
            cell.kind === 'category' ? (
              <CategoryTile key={cell.category.id} category={cell.category} />
            ) : (
              <SeeAllTile key="all" />
            ),
          )}
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
      accessibilityHint="Shows this category across nearby stores"
      onPress={() => router.push(`/category/${category.id}`)}
      style={({ pressed }) => [styles.tile, pressed ? styles.pressed : null]}
    >
      <View style={[styles.circle, { backgroundColor: category.tint }]}>
        <ArtImage artKey={category.iconKey} size={44} />
      </View>
      <Text variant="caption" color="muted" align="center" numberOfLines={1}>
        {category.name}
      </Text>
    </Pressable>
  );
}

function SeeAllTile() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="See all categories"
      onPress={() => router.push('/categories')}
      style={({ pressed }) => [styles.tile, pressed ? styles.pressed : null]}
    >
      <View style={[styles.circle, { backgroundColor: colors.primarySoft }]}>
        <Icon name="grid" size={26} color={colors.primaryDark} />
      </View>
      <Text variant="captionMedium" color="primaryDark" align="center" numberOfLines={1}>
        See all
      </Text>
    </Pressable>
  );
}

export function CategoryGridSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <View style={styles.grid} accessibilityRole="progressbar" accessibilityLabel="Loading categories">
      {Array.from({ length: rows }, (_, row) => (
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
