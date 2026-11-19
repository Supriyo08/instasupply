import type { Product } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { ProductCard } from './ProductCard';

/** Two-column grid of product cards (inside a ScrollView). */
export function ProductGrid({ products }: { products: Product[] }) {
  const rows: Product[][] = [];
  for (let index = 0; index < products.length; index += 2) rows.push(products.slice(index, index + 2));
  return (
    <View style={styles.grid}>
      {rows.map((row) => (
        <View key={row.map((product) => product.id).join('-')} style={styles.row}>
          {row.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
          {row.length === 1 ? <View style={styles.spacer} /> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: 14 },
  row: { flexDirection: 'row', gap: 14 },
  spacer: { flex: 1 },
});
