import type { Product } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { ArtImage, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

import { backdropFor, isAvailable } from './constants';
import { HeroBackdrop } from './HeroBackdrop';

/** Top of the product page: the pastel blob backdrop with the product art drawn large. */
export function ProductHero({
  product,
  height,
  artSize,
}: {
  product: Product;
  height: number;
  artSize: number;
}) {
  const available = isAvailable(product);
  return (
    <View style={[styles.hero, { height }]}>
      <HeroBackdrop tint={backdropFor(product.categoryId)} />
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={product.name}
        style={available ? null : styles.dimmed}
      >
        <ArtImage artKey={product.imageKey} uri={product.imageUrl} size={artSize} />
      </View>
      {available ? null : (
        <View style={styles.soldOut}>
          <Text variant="captionMedium" color="white">
            Out of stock
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dimmed: { opacity: 0.5 },
  hero: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    justifyContent: 'flex-end',
    paddingBottom: 30,
  },
  soldOut: {
    backgroundColor: colors.overlay,
    borderRadius: radius.pill,
    bottom: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    position: 'absolute',
  },
});
