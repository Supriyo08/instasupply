import type { Product } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { ArtImage } from '@/components/ui';

import { backdropFor } from './constants';

/** Product art on its pastel category circle (favourites rows, review headers). */
export function ProductArt({
  product,
  size,
}: {
  product: Pick<Product, 'categoryId' | 'imageKey' | 'imageUrl'>;
  size: number;
}) {
  return (
    <View
      style={[
        styles.circle,
        {
          backgroundColor: backdropFor(product.categoryId),
          borderRadius: size / 2,
          height: size,
          width: size,
        },
      ]}
    >
      <ArtImage artKey={product.imageKey} uri={product.imageUrl} size={Math.round(size * 0.78)} />
    </View>
  );
}

const styles = StyleSheet.create({ circle: { alignItems: 'center', justifyContent: 'center' } });
