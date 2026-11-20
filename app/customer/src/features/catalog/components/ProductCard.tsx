import { discountPercent, formatDistance, formatMoney, LOW_STOCK_THRESHOLD } from '@instasupply/shared';
import { router } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge, Icon, PromiseLabel, QuantityStepper, StockPill, Text } from '@/components/ui';
import { ProductArt } from '@/features/product/ProductArt';
import { useAddToCart } from '@/features/product/useAddToCart';
import { canOrderFrom, maxOrderQuantity, storeLine } from '@/features/stores/status';
import { colors, radius, spacing } from '@/theme/tokens';

import type { Listing } from '../listings';

const BADGES = { new: 'New', bestseller: 'Bestseller', deal: 'Deal' } as const;

/**
 * Grid card (Home rails, store page): art on the category pastel, price per sell unit, store and
 * distance, stock, and an add button or stepper. The add controls sit beside the card's pressable,
 * so the web never nests a <button> in a <button>.
 */
export const ProductCard = memo(function ProductCard({
  listing,
  showStore = true,
  width,
}: {
  listing: Listing;
  /** Off on a store's own page, where every card is that store. */
  showStore?: boolean;
  width?: number;
}) {
  const { product, view, available } = listing;
  const cart = useAddToCart();
  const quantity = cart.quantityOf(product.id);
  const orderable = canOrderFrom(view?.store ?? null);
  const max = maxOrderQuantity(product, available);
  const discount = discountPercent(product);
  const price = `${formatMoney(product.priceCents)} / ${product.unit}`;

  return (
    <View style={[styles.card, width ? { width } : styles.flex]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${product.name}, ${price}${showStore ? `, at ${product.storeName}` : ''}`}
        onPress={() => router.push(`/product/${product.id}`)}
        style={({ pressed }) => [styles.body, pressed ? styles.pressed : null]}
      >
        <View style={styles.badges}>
          {product.badge ? (
            <Badge label={BADGES[product.badge]} tone={product.badge === 'new' ? 'new' : 'brand'} />
          ) : null}
          {discount ? <Badge label={`-${discount}%`} tone="sale" /> : null}
        </View>
        <View style={styles.art}>
          <ProductArt product={product} size={84} dimmed={available <= 0} />
        </View>
        <View style={styles.priceRow}>
          <Text variant="captionMedium" color="primaryDark">
            {formatMoney(product.priceCents)}
            <Text variant="micro" color="muted">{` / ${product.unit}`}</Text>
          </Text>
          {discount && product.compareAtCents ? (
            <Text variant="micro" color="subtle" style={styles.strike}>
              {formatMoney(product.compareAtCents)}
            </Text>
          ) : null}
        </View>
        <Text variant="bodyMedium" numberOfLines={2} style={styles.name}>
          {product.name}
        </Text>
        {product.size ? (
          <Text variant="caption" color="muted" numberOfLines={1}>
            {product.size}
          </Text>
        ) : null}
        {showStore ? (
          <Text variant="caption" color="muted" numberOfLines={1}>
            {storeLine(product.storeName, view?.distanceM != null ? formatDistance(view.distanceM) : null)}
          </Text>
        ) : null}
        <View style={styles.status}>
          {available <= LOW_STOCK_THRESHOLD ? (
            <StockPill available={available} />
          ) : (
            <PromiseLabel promise={view?.availability.promise ?? null} size="sm" />
          )}
        </View>
      </Pressable>
      <View style={styles.footer}>
        {!orderable ? (
          <Text variant="captionMedium" color="muted">
            Browse only
          </Text>
        ) : available <= 0 ? (
          <Text variant="captionMedium" color="muted">
            Out of stock
          </Text>
        ) : quantity > 0 ? (
          <QuantityStepper
            compact
            label={product.name}
            value={quantity}
            max={Math.max(max, quantity)}
            onChange={(next) => cart.set(product, next, { quiet: true })}
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Add ${product.name} to cart`}
            hitSlop={4}
            onPress={() => cart.add(product, 1)}
            style={({ pressed }) => [styles.add, pressed ? styles.pressed : null]}
          >
            <Icon name="plus" size={15} color={colors.primaryDark} />
            <Text variant="captionMedium" color="primaryDark">
              Add
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  add: { alignItems: 'center', flexDirection: 'row', gap: 6, height: 30, justifyContent: 'center' },
  art: { alignItems: 'center', paddingVertical: spacing.xs },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, minHeight: 18 },
  body: { gap: 2, padding: spacing.md, paddingBottom: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.sm, overflow: 'hidden' },
  flex: { flex: 1 },
  footer: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    height: 42,
    justifyContent: 'center',
  },
  name: { minHeight: 42 },
  pressed: { opacity: 0.85 },
  priceRow: { alignItems: 'baseline', flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.xs },
  status: { marginTop: spacing.xs, minHeight: 18 },
  strike: { textDecorationLine: 'line-through' },
});
