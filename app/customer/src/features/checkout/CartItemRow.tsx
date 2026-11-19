import { MAX_QUANTITY_PER_LINE, formatCurrency } from '@instasupply/shared';
import { router } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Notice, QuantityStepper, Text } from '@/components/ui';
import type { CartItem } from '@/features/cart/useCartDetails';
import { colors, radius } from '@/theme/tokens';

import { ProductThumb } from './ProductThumb';

/**
 * Shopping cart row from the Big Cart design: art on a pastel circle, "₹40 × 2" in green, name and
 * pack size, a vertical stepper on the right, plus stock warnings with a one-tap fix.
 */
export const CartItemRow = memo(function CartItemRow({
  item,
  onQuantityChange,
  onRemove,
}: {
  item: CartItem;
  onQuantityChange: (productId: string, quantity: number) => void;
  onRemove: (item: CartItem) => void;
}) {
  const { product, quantity, unavailable, limitedTo } = item;
  const max = Math.max(1, Math.min(MAX_QUANTITY_PER_LINE, product.stock));

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${product.name}, ${product.unit}, ${formatCurrency(product.price)} each, quantity ${quantity}. Opens product details`}
          onPress={() => router.push(`/product/${product.id}`)}
          style={({ pressed }) => [styles.main, { opacity: unavailable ? 0.5 : pressed ? 0.75 : 1 }]}
        >
          <ProductThumb product={product} size={64} />
          <View style={styles.info}>
            <Text variant="captionMedium" color="primaryDark">
              {formatCurrency(product.price)} × {quantity}
            </Text>
            <Text variant="subheading" numberOfLines={1}>
              {product.name}
            </Text>
            <Text variant="caption" color="muted" numberOfLines={1}>
              {product.unit}
            </Text>
          </View>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${product.name} from cart`}
          hitSlop={8}
          onPress={() => onRemove(item)}
          style={({ pressed }) => [styles.trash, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Icon name="trash-2" size={16} color={unavailable ? colors.danger : colors.textMuted} />
        </Pressable>

        {unavailable ? null : (
          <View style={styles.stepper}>
            <QuantityStepper
              compact
              vertical
              label={product.name}
              value={quantity}
              min={0}
              max={max}
              onChange={(next) => (next <= 0 ? onRemove(item) : onQuantityChange(product.id, next))}
            />
          </View>
        )}
      </View>

      {unavailable ? (
        <Notice
          tone="danger"
          message={
            product.active
              ? 'Sold out right now. Remove it to check out.'
              : 'No longer sold. Remove it to check out.'
          }
          actionLabel="Remove"
          onAction={() => onRemove(item)}
        />
      ) : limitedTo != null ? (
        <Notice
          tone="warning"
          message={`Only ${limitedTo} left in stock.`}
          actionLabel={`Change to ${limitedTo}`}
          onAction={() => onQuantityChange(product.id, limitedTo)}
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, gap: 10, padding: 14 },
  info: { flex: 1, gap: 1 },
  main: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 14 },
  row: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  stepper: { alignItems: 'center', minWidth: 32 },
  trash: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
});
