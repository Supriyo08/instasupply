import type { Product } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { useCategoryTint } from '@/features/catalog/hooks';
import { colors, radius, spacing } from '@/theme/tokens';

import { HeroBackdrop } from './HeroBackdrop';
import { ProductArt } from './ProductArt';

/** Top of the product page: the category pastel backdrop with the art large on its circle. */
export function ProductHero({
  product,
  height,
  artSize,
  soldOut,
}: {
  product: Product;
  height: number;
  artSize: number;
  soldOut: boolean;
}) {
  const tint = useCategoryTint(product.categoryId);
  return (
    <View style={[styles.hero, { height }]}>
      <HeroBackdrop tint={tint} />
      <View accessible accessibilityRole="image" accessibilityLabel={product.name}>
        <ProductArt product={product} size={artSize} dimmed={soldOut} />
      </View>
      {soldOut ? (
        <View style={styles.soldOut}>
          <Text variant="captionMedium" color="white">
            Out of stock
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
