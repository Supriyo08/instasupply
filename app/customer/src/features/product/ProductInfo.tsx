import { discountPercent, formatCurrency, pluralize, type Product } from '@instasupply/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge, Icon, Rating, Text, type IconName } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

import { isAvailable, LOW_STOCK } from './constants';
import { ExpandableText } from './ExpandableText';
import { FavoriteButton } from './FavoriteButton';

const BADGES = {
  new: { label: 'New', tone: 'new' },
  bestseller: { label: 'Bestseller', tone: 'info' },
  organic: { label: 'Organic', tone: 'brand' },
} as const;

/** Price, name, pack size, rating, stock and description: the Big Cart product sheet. */
export function ProductInfo({ product }: { product: Product }) {
  const discount = discountPercent(product);
  const badge = product.badge ? BADGES[product.badge] : null;
  // Products created in the back office may not have a description yet.
  const description = (product.description ?? '').trim();

  return (
    <View style={styles.info}>
      <View style={styles.priceRow}>
        <Text variant="heading" color="primaryDark">
          {formatCurrency(product.price)}
        </Text>
        {discount && product.mrp ? (
          <Text
            color="subtle"
            style={styles.strike}
            accessibilityLabel={`Maximum retail price ${formatCurrency(product.mrp)}`}
          >
            {formatCurrency(product.mrp)}
          </Text>
        ) : null}
        {discount ? (
          <View>
            <Badge label={`-${discount}%`} tone="sale" />
          </View>
        ) : null}
        <View style={styles.spacer} />
        <FavoriteButton productId={product.id} name={product.name} />
      </View>

      <Text variant="title" accessibilityRole="header">
        {product.name}
      </Text>
      <View style={styles.metaRow}>
        <Text variant="caption" color="muted">
          {product.unit}
        </Text>
        {badge ? <Badge label={badge.label} tone={badge.tone} /> : null}
      </View>

      <ReviewsLink product={product} />
      <StockNote product={product} />
      {description ? (
        <View style={styles.description}>
          <ExpandableText text={description} />
        </View>
      ) : null}
    </View>
  );
}

/** ★★★★½ 4.5 (89 reviews) › — or an invitation to write the first review. */
function ReviewsLink({ product }: { product: Product }) {
  const hasReviews = product.ratingCount > 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        hasReviews
          ? `Rated ${product.rating.toFixed(1)} out of 5 from ${pluralize(product.ratingCount, 'review')}. Read reviews`
          : 'No reviews yet. Write the first review'
      }
      hitSlop={6}
      onPress={() => router.push(`/product/${product.id}/${hasReviews ? 'reviews' : 'write-review'}`)}
      style={({ pressed }) => [styles.reviews, pressed ? styles.pressed : null]}
    >
      {hasReviews ? (
        <>
          <Rating value={product.rating} count={product.ratingCount} />
          <Icon name="chevron-right" size={16} color={colors.textMuted} />
        </>
      ) : (
        <>
          <Rating value={0} />
          <Text variant="caption" color="muted">
            No reviews yet ·
          </Text>
          <Text variant="captionMedium" color="primary">
            Write the first one
          </Text>
        </>
      )}
    </Pressable>
  );
}

function StockNote({ product }: { product: Product }) {
  let note: { icon: IconName; text: string; tone: 'danger' | 'warning' } | null = null;
  if (!isAvailable(product)) {
    note = { icon: 'alert-circle', text: 'Out of stock right now. Check back soon!', tone: 'danger' };
  } else if (product.stock <= LOW_STOCK) {
    note = { icon: 'zap', text: `Only ${product.stock} left, order soon`, tone: 'warning' };
  }
  if (!note) return null;
  return (
    <View style={styles.note}>
      <Icon name={note.icon} size={14} color={note.tone === 'danger' ? colors.danger : colors.warning} />
      <Text variant="captionMedium" color={note.tone}>
        {note.text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  description: { marginTop: spacing.sm },
  info: { gap: spacing.xs },
  metaRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginTop: -spacing.xs },
  note: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs },
  pressed: { opacity: 0.6 },
  priceRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  reviews: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  spacer: { flex: 1 },
  strike: { textDecorationLine: 'line-through' },
});
