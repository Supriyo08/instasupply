import { CATEGORIES, type CategoryId, type Product } from '@instasupply/shared';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, Chip, EmptyState, ErrorState, IconButton, Input, Skeleton, Text } from '@/components/ui';
import { ProductCard } from '@/features/catalog/components/ProductCard';
import { useDebouncedValue } from '@/features/search/useDebouncedValue';
import { useListings } from '@/features/catalog/useListings';
import { colors, spacing } from '@/theme/tokens';

import { useStoreProducts } from '../hooks';

function pairs<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += 2) rows.push(items.slice(index, index + 2));
  return rows;
}

/** A store's own catalogue: its category chips, the in-store search and a two-column grid. */
export function StoreProducts({
  storeId,
  storeName,
  categoryIds,
}: {
  storeId: string;
  storeName: string;
  categoryIds: readonly CategoryId[];
}) {
  const [categoryId, setCategoryId] = useState<CategoryId | null>(null);
  const [text, setText] = useState('');
  const q = useDebouncedValue(text.trim(), 300);
  const products = useStoreProducts(storeId, { categoryId, q: q.length >= 2 ? q : null });
  const items: Product[] = products.items;
  const { listings } = useListings(items);
  const rows = useMemo(() => pairs(listings), [listings]);

  return (
    <View style={styles.wrap}>
      <Text variant="heading">Shop {storeName}</Text>
      <Input
        icon="search"
        placeholder={`Search ${storeName}`}
        value={text}
        onChangeText={setText}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        maxLength={60}
        trailing={
          text ? (
            <IconButton
              icon="x"
              label="Clear search"
              size={28}
              color={colors.textMuted}
              onPress={() => setText('')}
            />
          ) : null
        }
      />
      {categoryIds.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.bleed}
          contentContainerStyle={styles.chips}
        >
          <Chip label="All" selected={categoryId === null} onPress={() => setCategoryId(null)} />
          {categoryIds.map((id) => (
            <Chip
              key={id}
              label={CATEGORIES[id]?.name ?? id}
              selected={categoryId === id}
              onPress={() => setCategoryId(categoryId === id ? null : id)}
            />
          ))}
        </ScrollView>
      ) : null}

      {products.loading && items.length === 0 ? (
        <View style={styles.grid}>
          {[0, 1].map((row) => (
            <View key={row} style={styles.row}>
              <Skeleton style={styles.skeleton} />
              <Skeleton style={styles.skeleton} />
            </View>
          ))}
        </View>
      ) : products.error && items.length === 0 ? (
        <ErrorState
          title="Couldn't load this store's products"
          error={products.error}
          onRetry={products.retry}
        />
      ) : items.length === 0 ? (
        <EmptyState
          art="scene-local-suppliers"
          title={q || categoryId ? 'Nothing matches' : 'No products listed yet'}
          message={
            q || categoryId ? 'Try another word or category.' : `${storeName} is still adding its catalogue.`
          }
        />
      ) : (
        <View style={styles.grid}>
          {rows.map((row) => (
            <View key={row.map((listing) => listing.product.id).join('|')} style={styles.row}>
              {row.map((listing) => (
                <ProductCard key={listing.product.id} listing={listing} showStore={false} />
              ))}
              {row.length === 1 ? <View style={styles.spacer} /> : null}
            </View>
          ))}
          {products.hasMore ? (
            <Button
              label="Show more products"
              variant="secondary"
              loading={products.loadingMore}
              onPress={products.loadMore}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bleed: { marginHorizontal: -spacing.gutter },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.gutter },
  grid: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  skeleton: { flex: 1, height: 268 },
  spacer: { flex: 1 },
  wrap: { gap: spacing.md },
});
