import { formatCurrency } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { QuantityStepper, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

import type { ProductPurchase } from './useProductPurchase';

/** White "Quantity   − 3 +" row from the Big Cart product page. */
export function QuantityRow({ purchase }: { purchase: ProductPurchase }) {
  return (
    <View style={styles.row}>
      <View style={styles.label}>
        <Text variant="caption" color="muted">
          Quantity
        </Text>
        {purchase.quantity > 1 ? (
          <Text variant="captionMedium" accessibilityLabel={`Total ${formatCurrency(purchase.lineTotal)}`}>
            {formatCurrency(purchase.lineTotal)}
          </Text>
        ) : null}
      </View>
      <QuantityStepper
        value={purchase.quantity}
        min={purchase.min}
        max={purchase.max}
        onChange={purchase.setQuantity}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { flex: 1 },
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    flexDirection: 'row',
    minHeight: 54,
    paddingLeft: spacing.gutter,
    paddingRight: spacing.xs,
  },
});
