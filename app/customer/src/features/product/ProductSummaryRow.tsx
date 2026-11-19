import { formatCurrency, type Product } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

import { ProductArt } from './ProductArt';

/** Compact "which product is this about" card at the top of the review screens. */
export function ProductSummaryRow({ product }: { product: Product }) {
  return (
    <View style={styles.row}>
      <ProductArt product={product} size={56} />
      <View style={styles.text}>
        <Text variant="subheading" numberOfLines={1}>
          {product.name}
        </Text>
        <Text variant="caption" color="muted">
          {product.unit}
        </Text>
      </View>
      <Text variant="bodyMedium" color="primaryDark">
        {formatCurrency(product.price)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  text: { flex: 1 },
});
