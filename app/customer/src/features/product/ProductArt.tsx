import type { Product } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { ArtImage } from '@/components/ui';
import { useCategoryTint } from '@/features/catalog/hooks';

type ArtFields = Pick<Product, 'categoryId' | 'imageKey' | 'imageUrl'>;

/** The illustration of a product: its own `imageKey`, else its category's icon (`cat-<id>`). */
export function productArtKey(product: Pick<Product, 'categoryId' | 'imageKey'>): string {
  return product.imageKey ?? `cat-${product.categoryId}`;
}

/** Product art (or its photo) on the pastel circle of its category. */
export function ProductArt({
  product,
  size,
  dimmed = false,
}: {
  product: ArtFields;
  size: number;
  dimmed?: boolean;
}) {
  const tint = useCategoryTint(product.categoryId);
  return (
    <View
      style={[
        styles.circle,
        { backgroundColor: tint, borderRadius: size / 2, height: size, width: size },
        dimmed ? styles.dimmed : null,
      ]}
    >
      <ArtImage artKey={productArtKey(product)} uri={product.imageUrl} size={Math.round(size * 0.78)} />
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  dimmed: { opacity: 0.45 },
});
