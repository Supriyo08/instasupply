import { discountPercent, formatMoney, shortStoreName, type Product } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Badge, StockPill, Text } from '@/components/ui';
import { spacing } from '@/theme/tokens';

import { ExpandableText } from './ExpandableText';
import { FavoriteButton } from './FavoriteButton';

const BADGES = { new: 'New', bestseller: 'Bestseller', deal: 'Deal' } as const;

/** Brand, name, size, "$4.79 / each" with the compare-at price, SKU, stock and the description. */
export function ProductInfo({ product, available }: { product: Product; available: number }) {
  const discount = discountPercent(product);
  return (
    <View style={styles.wrap}>
      <View style={styles.priceRow}>
        <Text variant="title" color="primaryDark">
          {formatMoney(product.priceCents)}
          <Text variant="bodyMedium" color="muted">{` / ${product.unit}`}</Text>
        </Text>
        {discount && product.compareAtCents ? (
          <>
            <Text
              color="subtle"
              style={styles.strike}
              accessibilityLabel={`Was ${formatMoney(product.compareAtCents)}`}
            >
              {formatMoney(product.compareAtCents)}
            </Text>
            <Badge label={`-${discount}%`} tone="sale" />
          </>
        ) : null}
      </View>
      <View style={styles.nameRow}>
        <View style={styles.name}>
          {product.brand ? (
            <Text variant="captionMedium" color="muted">
              {product.brand}
            </Text>
          ) : null}
          <Text variant="title" accessibilityRole="header">
            {product.name}
          </Text>
          {product.size ? <Text color="muted">{product.size}</Text> : null}
        </View>
        <FavoriteButton productId={product.id} name={product.name} />
      </View>
      <View style={styles.meta}>
        <StockPill available={available} storeName={shortStoreName(product.storeName)} size="md" />
        {product.badge ? (
          <Badge label={BADGES[product.badge]} tone={product.badge === 'new' ? 'new' : 'brand'} />
        ) : null}
        <Text variant="caption" color="muted">
          SKU {product.sku}
        </Text>
      </View>
      <ExpandableText text={product.description} />
    </View>
  );
}

const styles = StyleSheet.create({
  meta: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  name: { flex: 1, gap: 2 },
  nameRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  priceRow: { alignItems: 'baseline', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  strike: { textDecorationLine: 'line-through' },
  wrap: { gap: spacing.md },
});
