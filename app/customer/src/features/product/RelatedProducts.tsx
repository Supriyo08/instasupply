import type { Product } from '@instasupply/shared';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ProductCard } from '@/components/catalog/ProductCard';
import { SectionHeader, Skeleton } from '@/components/ui';
import { useCategoryProducts } from '@/features/catalog/hooks';
import { spacing } from '@/theme/tokens';

import { isAvailable } from './constants';

const CARD_WIDTH = 158;
const MAX_ITEMS = 10;

/** "You may also like": other products from the same category, in-stock ones first. */
export function RelatedProducts({ product }: { product: Product }) {
  const { data, loading } = useCategoryProducts(product.categoryId);
  const items = useMemo(
    () =>
      data
        .filter((item) => item.id !== product.id)
        .sort((a, b) => Number(isAvailable(b)) - Number(isAvailable(a)))
        .slice(0, MAX_ITEMS),
    [data, product.id],
  );

  if (!loading && items.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.title}>
        <SectionHeader
          title="You may also like"
          onSeeAll={() => router.push(`/category/${product.categoryId}`)}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.list}>
        {items.length === 0
          ? [0, 1, 2].map((key) => <Skeleton key={key} style={styles.placeholder} />)
          : items.map((item) => (
              // A row wrapper gives the card (flex: 1) a fixed width while its height follows content.
              <View key={item.id} style={styles.card}>
                <ProductCard product={item} />
              </View>
            ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', width: CARD_WIDTH },
  list: { gap: 14, paddingHorizontal: spacing.gutter },
  placeholder: { height: 236, width: CARD_WIDTH },
  section: { gap: spacing.md, paddingTop: spacing.xxl },
  title: { paddingHorizontal: spacing.gutter },
});
