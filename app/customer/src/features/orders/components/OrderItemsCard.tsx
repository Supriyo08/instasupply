import { formatCurrency, pluralize, type OrderItem } from '@instasupply/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ArtImage, Card, Text } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

import { backdropFor } from './order-ui';

/** Items in the order with their art, "price × qty" in brand green and the line total. */
export function OrderItemsCard({ items, itemCount }: { items: OrderItem[]; itemCount: number }) {
  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text variant="heading">Items</Text>
        <Text variant="caption" color="muted">
          {pluralize(itemCount, 'item')}
        </Text>
      </View>
      {items.map((item, index) => (
        <Pressable
          key={item.productId}
          accessibilityRole="button"
          accessibilityLabel={`${item.name}, ${item.unit}, ${item.quantity} × ${formatCurrency(item.price)}, ${formatCurrency(item.lineTotal)}`}
          accessibilityHint="Opens the product"
          onPress={() => router.push(`/product/${item.productId}`)}
          style={({ pressed }) => [
            styles.row,
            index > 0 ? styles.rowDivider : null,
            pressed ? styles.pressed : null,
          ]}
        >
          <View style={styles.art}>
            <View style={[styles.backdrop, { backgroundColor: backdropFor(index) }]} />
            <ArtImage artKey={item.imageKey} uri={item.imageUrl} size={44} />
          </View>
          <View style={styles.info}>
            <Text variant="captionMedium" color="primaryDark">
              {formatCurrency(item.price)} × {item.quantity}
            </Text>
            <Text variant="bodyMedium" numberOfLines={1}>
              {item.name}
            </Text>
            <Text variant="caption" color="muted">
              {item.unit}
            </Text>
          </View>
          <Text variant="bodyMedium">{formatCurrency(item.lineTotal)}</Text>
        </Pressable>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  art: { alignItems: 'center', height: 56, justifyContent: 'center', width: 56 },
  backdrop: { borderRadius: 28, height: 56, position: 'absolute', width: 56 },
  card: { gap: spacing.xs },
  header: {
    alignItems: 'baseline',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  info: { flex: 1 },
  pressed: { opacity: 0.7 },
  row: { alignItems: 'center', flexDirection: 'row', gap: 14, paddingVertical: spacing.md },
  rowDivider: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
});
