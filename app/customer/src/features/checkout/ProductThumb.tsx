import type { Product } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { ArtImage, Text } from '@/components/ui';
import { colors, productBackdrops } from '@/theme/tokens';

/** Product illustration on its category's pastel circle, with an optional "×2" bubble. */
export function ProductThumb({
  product,
  size = 64,
  quantity,
}: {
  product: Pick<Product, 'categoryId' | 'imageKey' | 'imageUrl'>;
  size?: number;
  quantity?: number;
}) {
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          styles.circle,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: productBackdrops[product.categoryId] ?? colors.primaryTint,
          },
        ]}
      >
        <ArtImage artKey={product.imageKey} uri={product.imageUrl} size={Math.round(size * 0.86)} />
      </View>
      {quantity && quantity > 1 ? (
        <View style={styles.bubble}>
          <Text variant="micro" color="white">
            ×{quantity}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1.5,
    bottom: -3,
    minWidth: 22,
    paddingHorizontal: 4,
    position: 'absolute',
    right: -4,
  },
  circle: { alignItems: 'center', justifyContent: 'center' },
});
