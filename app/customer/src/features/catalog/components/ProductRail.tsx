import type { Product } from '@instasupply/shared';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ErrorState, SectionHeader, Skeleton } from '@/components/ui';
import { spacing } from '@/theme/tokens';

import { useListings } from '../useListings';

import { ProductCard } from './ProductCard';

const CARD_WIDTH = 164;

/** A titled horizontal row of product cards (Home "Buy again", "Popular near you"). Hidden when empty. */
export function ProductRail({
  title,
  products,
  loading,
  error,
  onRetry,
  onSeeAll,
}: {
  title: string;
  products: readonly Product[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onSeeAll?: () => void;
}) {
  const { listings } = useListings(products);
  if (error && products.length === 0) {
    return (
      <View style={styles.section}>
        <SectionHeader title={title} />
        <ErrorState title={`Couldn't load ${title.toLowerCase()}`} error={error} onRetry={onRetry} />
      </View>
    );
  }
  if (!loading && listings.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHeader title={title} onSeeAll={onSeeAll} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        style={styles.bleed}
      >
        {loading && listings.length === 0
          ? [0, 1, 2].map((key) => <Skeleton key={key} style={styles.skeleton} />)
          : listings.map((listing) => (
              <ProductCard key={listing.product.id} listing={listing} width={CARD_WIDTH} />
            ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // The rail scrolls under the screen gutter, edge to edge.
  bleed: { marginHorizontal: -spacing.gutter },
  row: { gap: spacing.md, paddingHorizontal: spacing.gutter },
  section: { gap: spacing.md },
  skeleton: { height: 268, width: CARD_WIDTH },
});
