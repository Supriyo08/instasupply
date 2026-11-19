import { discountPercent, formatCurrency, MAX_QUANTITY_PER_LINE, type Product } from '@instasupply/shared';
import { router } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { IconButton, QuantityStepper, Skeleton, Text } from '@/components/ui';
import { useCart } from '@/features/cart/CartProvider';
import { colors, radius, spacing } from '@/theme/tokens';

import { isAvailable } from './constants';
import { ProductArt } from './ProductArt';
import { SwipeToRemove } from './SwipeToRemove';

/**
 * Big Cart favourites row: art on a pastel circle, price, name, pack size, cart control, remove.
 * The remove and cart buttons sit beside the row's main pressable (not inside it), so the web never
 * renders a <button> inside a <button>.
 */
export const FavoriteRow = memo(function FavoriteRow({
  product,
  onRemove,
}: {
  product: Product;
  onRemove: (product: Product) => void;
}) {
  const cart = useCart();
  const quantity = cart.quantityOf(product.id);
  const available = isAvailable(product);
  const discount = discountPercent(product);
  const remove = () => onRemove(product);

  return (
    <SwipeToRemove onRemove={remove}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${product.name}, ${formatCurrency(product.price)} for ${product.unit}${available ? '' : ', out of stock'}`}
          onPress={() => router.push(`/product/${product.id}`)}
          style={({ pressed }) => [styles.main, pressed ? styles.pressed : null]}
        >
          <View style={available ? null : styles.dimmed}>
            <ProductArt product={product} size={64} />
          </View>

          <View style={styles.info}>
            <View style={styles.priceRow}>
              <Text variant="captionMedium" color="primaryDark">
                {formatCurrency(product.price)}
              </Text>
              {discount && product.mrp ? (
                <Text variant="micro" color="subtle" style={styles.strike}>
                  {formatCurrency(product.mrp)}
                </Text>
              ) : null}
            </View>
            <Text variant="subheading" numberOfLines={2}>
              {product.name}
            </Text>
            <Text variant="caption" color="muted">
              {product.unit}
            </Text>
            {available ? null : (
              <Text variant="micro" color="danger">
                Out of stock
              </Text>
            )}
          </View>
        </Pressable>

        <IconButton
          icon="trash-2"
          label={`Remove ${product.name} from favorites`}
          color={colors.textMuted}
          size={36}
          onPress={remove}
        />

        <View style={styles.control}>
          {!available ? null : quantity > 0 ? (
            <QuantityStepper
              compact
              vertical
              label={product.name}
              value={quantity}
              max={Math.min(MAX_QUANTITY_PER_LINE, product.stock)}
              onChange={(next) => cart.setQuantity(product.id, next)}
            />
          ) : (
            <IconButton
              icon="plus"
              label={`Add ${product.name} to cart`}
              color={colors.primary}
              background={colors.primarySoft}
              size={34}
              onPress={() => cart.add(product.id)}
            />
          )}
        </View>
      </View>
    </SwipeToRemove>
  );
});

export function FavoriteRowSkeleton() {
  return (
    <View style={styles.row}>
      <Skeleton style={styles.artSkeleton} />
      <View style={styles.info}>
        <Skeleton style={styles.priceSkeleton} />
        <Skeleton style={styles.nameSkeleton} />
        <Skeleton style={styles.unitSkeleton} />
      </View>
      <Skeleton style={styles.controlSkeleton} />
    </View>
  );
}

const styles = StyleSheet.create({
  artSkeleton: { borderRadius: 32, height: 64, width: 64 },
  control: { alignItems: 'center', justifyContent: 'center', minWidth: 36 },
  controlSkeleton: { borderRadius: 17, height: 34, width: 34 },
  dimmed: { opacity: 0.45 },
  info: { flex: 1, gap: spacing.xxs },
  main: { alignItems: 'center', alignSelf: 'stretch', flex: 1, flexDirection: 'row', gap: spacing.md },
  nameSkeleton: { height: 16, width: '80%' },
  pressed: { opacity: 0.85 },
  priceRow: { alignItems: 'baseline', flexDirection: 'row', gap: spacing.xs },
  priceSkeleton: { height: 12, width: 48 },
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 96,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  strike: { textDecorationLine: 'line-through' },
  unitSkeleton: { height: 12, width: 56 },
});
