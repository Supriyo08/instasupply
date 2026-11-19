import { pluralize, type PricedCart } from '@instasupply/shared';
import { Pressable, StyleSheet, View } from 'react-native';

import { PriceSummary } from '@/components/catalog/PriceSummary';
import { Divider, Text } from '@/components/ui';
import type { CartItem } from '@/features/cart/useCartDetails';
import { colors, radius } from '@/theme/tokens';

import { ProductThumb } from './ProductThumb';

const MAX_THUMBS = 5;

/** Compact order recap for the payment step: item thumbnails, then the price breakdown. */
export function OrderSummaryCard({
  items,
  priced,
  promoCode,
  onEditCart,
}: {
  items: CartItem[];
  priced: PricedCart;
  promoCode: string | null;
  onEditCart: () => void;
}) {
  const shown = items.slice(0, MAX_THUMBS);
  const extra = items.length - shown.length;
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text variant="heading">Order summary</Text>
          <Text variant="caption" color="muted">
            {pluralize(priced.itemCount, 'item')}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit cart"
          hitSlop={10}
          onPress={onEditCart}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Text variant="captionMedium" color="primary">
            Edit cart
          </Text>
        </Pressable>
      </View>

      <View
        accessible
        accessibilityLabel={items.map((item) => `${item.quantity} × ${item.product.name}`).join(', ')}
        style={styles.thumbs}
      >
        {shown.map((item) => (
          <ProductThumb key={item.product.id} product={item.product} quantity={item.quantity} size={44} />
        ))}
        {extra > 0 ? (
          <View style={styles.more}>
            <Text variant="captionMedium" color="muted">
              +{extra}
            </Text>
          </View>
        ) : null}
      </View>

      <Divider />
      <PriceSummary priced={priced} />
      {promoCode && !priced.promo && priced.promoError ? (
        <Text variant="caption" color="warning">
          {`${promoCode} isn't applied: ${priced.promoError}`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, gap: 14, padding: 16 },
  header: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  more: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
