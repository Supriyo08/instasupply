import { discountPercent, formatCurrency, MAX_QUANTITY_PER_LINE, type Product } from '@instasupply/shared';
import { router } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ArtImage, Badge, FilledIcon, Icon, QuantityStepper, Text } from '@/components/ui';
import { useCart } from '@/features/cart/CartProvider';
import { useFavorites } from '@/features/favorites/FavoritesProvider';
import { colors, productBackdrops, radius } from '@/theme/tokens';

const HEART_SIZE = 20;

/**
 * Grid card from the Big Cart home screen: badge, heart, art on a pastel circle, price, add-to-cart.
 * The heart and the cart controls sit beside the card's main pressable rather than inside it, so
 * the web never renders a <button> inside a <button>.
 */
export const ProductCard = memo(function ProductCard({ product }: { product: Product }) {
  const cart = useCart();
  const favorites = useFavorites();
  const quantity = cart.quantityOf(product.id);
  const favorite = favorites.isFavorite(product.id);
  const discount = discountPercent(product);
  const soldOut = product.stock <= 0;

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${product.name}, ${formatCurrency(product.price)} for ${product.unit}`}
        onPress={() => router.push(`/product/${product.id}`)}
        style={({ pressed }) => (pressed ? styles.pressed : null)}
      >
        <View style={styles.top}>
          <View style={styles.badges}>
            {product.badge === 'new' ? <Badge label="New" tone="new" /> : null}
            {discount ? <Badge label={`-${discount}%`} tone="sale" /> : null}
            {product.badge === 'organic' ? <Badge label="Organic" tone="brand" /> : null}
          </View>
          {/* Keeps the badges clear of the heart, which is layered on top. */}
          <View style={styles.heartSpace} />
        </View>

        <View style={styles.artWrap}>
          <View
            style={[
              styles.backdrop,
              { backgroundColor: productBackdrops[product.categoryId] ?? colors.primaryTint },
            ]}
          />
          <ArtImage artKey={product.imageKey} uri={product.imageUrl} size={96} />
        </View>

        <View style={styles.info}>
          <View style={styles.priceRow}>
            <Text variant="captionMedium" color="primaryDark">
              {formatCurrency(product.price)}
            </Text>
            {product.mrp && product.mrp > product.price ? (
              <Text variant="micro" color="subtle" style={styles.strike}>
                {formatCurrency(product.mrp)}
              </Text>
            ) : null}
          </View>
          <Text variant="subheading" numberOfLines={1} align="center" style={styles.name}>
            {product.name}
          </Text>
          <Text variant="caption" color="muted" align="center">
            {product.unit}
          </Text>
        </View>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          favorite ? `Remove ${product.name} from favorites` : `Add ${product.name} to favorites`
        }
        accessibilityState={{ selected: favorite }}
        hitSlop={10}
        onPress={() => void favorites.toggle(product.id)}
        style={styles.heart}
      >
        {favorite ? (
          <FilledIcon name="heart" size={HEART_SIZE} color={colors.danger} />
        ) : (
          <Icon name="heart" size={18} color={colors.textMuted} />
        )}
      </Pressable>

      <View style={styles.footer}>
        {soldOut ? (
          <Text variant="captionMedium" color="muted">
            Sold out
          </Text>
        ) : quantity > 0 ? (
          <QuantityStepper
            compact
            label={product.name}
            value={quantity}
            max={Math.min(MAX_QUANTITY_PER_LINE, product.stock)}
            onChange={(next) => cart.setQuantity(product.id, next)}
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Add ${product.name} to cart`}
            onPress={() => cart.add(product.id)}
            style={({ pressed }) => [styles.add, pressed ? { opacity: 0.6 } : null]}
          >
            <Icon name="shopping-bag" size={15} color={colors.primary} />
            <Text variant="captionMedium">Add to cart</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  add: { alignItems: 'center', flexDirection: 'row', gap: 8, height: 28, justifyContent: 'center' },
  artWrap: { alignItems: 'center', height: 104, justifyContent: 'center', marginTop: -4 },
  backdrop: { borderRadius: 42, height: 84, position: 'absolute', top: 14, width: 84 },
  badges: { flexDirection: 'row', flexShrink: 1, flexWrap: 'wrap', gap: 4 },
  card: { backgroundColor: colors.surface, borderRadius: radius.sm, flex: 1, overflow: 'hidden' },
  footer: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    height: 42,
    justifyContent: 'center',
  },
  heart: { position: 'absolute', right: 10, top: 10 },
  heartSpace: { height: HEART_SIZE, width: HEART_SIZE },
  info: { alignItems: 'center', gap: 0, paddingBottom: 10, paddingHorizontal: 10 },
  name: { marginTop: 1 },
  pressed: { opacity: 0.9 },
  priceRow: { alignItems: 'baseline', flexDirection: 'row', gap: 6 },
  strike: { textDecorationLine: 'line-through' },
  top: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 30,
    paddingHorizontal: 10,
    paddingTop: 10,
  },
});
