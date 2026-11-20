import type { Product } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { ArtImage, Text } from '@/components/ui';
import { useCategory } from '@/features/catalog/hooks';
import { colors, fallbackTint } from '@/theme/tokens';

/** Product art on its category's pastel circle (the category icon when it has none), with "×2". */
export function ProductThumb({
  product,
  size = 56,
  quantity,
}: {
  product: Pick<Product, 'categoryId' | 'imageKey' | 'imageUrl'> | null;
  size?: number;
  quantity?: number;
}) {
  const category = useCategory(product?.categoryId).data;
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          styles.circle,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: category?.tint ?? fallbackTint,
          },
        ]}
      >
        <ArtImage
          artKey={product?.imageKey ?? category?.iconKey ?? null}
          uri={product?.imageUrl ?? null}
          size={Math.round(size * 0.8)}
        />
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
  circle: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
