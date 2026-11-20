import { formatDistance, formatMoney } from '@instasupply/shared';
import { router } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, IconButton, StockPill, Text } from '@/components/ui';
import type { Listing } from '@/features/catalog/listings';
import { ProductArt } from '@/features/product/ProductArt';
import { useAddToCart } from '@/features/product/useAddToCart';
import { canOrderFrom, storeLine } from '@/features/stores/status';
import { colors, radius, spacing } from '@/theme/tokens';

/** One saved material: art, store and km, price per unit, stock, "Add" and remove. */
export const SavedRow = memo(function SavedRow({
  listing,
  onRemove,
}: {
  listing: Listing;
  onRemove: (productId: string) => void;
}) {
  const { product, view, available } = listing;
  const cart = useAddToCart();
  const inCart = cart.quantityOf(product.id);
  const orderable = canOrderFrom(view?.store ?? null) && available > 0;
  const store = storeLine(product.storeName, view?.distanceM != null ? formatDistance(view.distanceM) : null);
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${product.name}, ${formatMoney(product.priceCents)} per ${product.unit}, ${store}`}
        onPress={() => router.push(`/product/${product.id}`)}
        style={({ pressed }) => [styles.main, pressed ? styles.pressed : null]}
      >
        <ProductArt product={product} size={64} dimmed={available <= 0} />
        <View style={styles.info}>
          <Text variant="bodyMedium" numberOfLines={2}>
            {product.name}
          </Text>
          <Text variant="caption" color="muted" numberOfLines={1}>
            {store}
          </Text>
          <Text variant="captionMedium" color="primaryDark">
            {formatMoney(product.priceCents)}
            <Text variant="micro" color="muted">{` / ${product.unit}`}</Text>
          </Text>
          <StockPill available={available} />
        </View>
      </Pressable>
      <View style={styles.actions}>
        <IconButton
          icon="trash-2"
          label={`Remove ${product.name} from saved items`}
          size={36}
          color={colors.textMuted}
          onPress={() => onRemove(product.id)}
        />
        {orderable ? (
          <Button
            size="md"
            variant={inCart > 0 ? 'secondary' : 'primary'}
            label={inCart > 0 ? `In cart: ${inCart}` : 'Add'}
            onPress={() => (inCart > 0 ? router.push('/cart') : cart.add(product, 1))}
            style={styles.add}
          />
        ) : null}
      </View>
    </View>
  );
});

/** A saved id whose listing is gone (the store removed it, or the store left). */
export function MissingSavedRow({
  productId,
  onRemove,
}: {
  productId: string;
  onRemove: (id: string) => void;
}) {
  return (
    <View style={[styles.card, styles.missing]}>
      <View style={styles.info}>
        <Text variant="bodyMedium">No longer listed</Text>
        <Text variant="caption" color="muted">
          The store took this item off InstaSupply.
        </Text>
      </View>
      <Button
        size="md"
        variant="secondary"
        label="Remove"
        onPress={() => onRemove(productId)}
        style={styles.add}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { alignItems: 'flex-end', gap: spacing.sm, justifyContent: 'space-between' },
  add: { alignSelf: 'auto', minWidth: 92 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  info: { flex: 1, gap: 2 },
  main: { flex: 1, flexDirection: 'row', gap: spacing.md },
  missing: { alignItems: 'center' },
  pressed: { opacity: 0.85 },
});
