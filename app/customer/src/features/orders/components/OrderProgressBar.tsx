import { ORDER_PROGRESS, type Order } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme/tokens';

import { reachedStepIndex } from './order-ui';

/** Thin five-step indicator (placed → delivered). Decorative: the status pill carries the meaning. */
export function OrderProgressBar({ order }: { order: Pick<Order, 'status' | 'statusAt'> }) {
  const reached = reachedStepIndex(order);
  const fill =
    order.status === 'failed'
      ? colors.danger
      : order.status === 'cancelled'
        ? colors.textSubtle
        : colors.primary;
  return (
    <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {ORDER_PROGRESS.map((step, index) => (
        <View
          key={step}
          style={[styles.segment, { backgroundColor: index <= reached ? fill : colors.border }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4 },
  segment: { borderRadius: 2, flex: 1, height: 4 },
});
