import { formatDistance, formatMoney, pluralize } from '@instasupply/shared';
import { router } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, IconButton, PromiseLabel, StockPill, Text } from '@/components/ui';
import { ProductArt } from '@/features/product/ProductArt';
import { useAddToCart } from '@/features/product/useAddToCart';
import { canOrderFrom, storeLine } from '@/features/stores/status';
import { colors, radius, spacing } from '@/theme/tokens';

import type { FamilyGroup, Listing } from '../listings';

function distanceOf(listing: Listing): string | null {
  return listing.view?.distanceM != null ? formatDistance(listing.view.distanceM) : null;
}

/** A single listing in search and category results: store, km, price, stock pill and promise. */
export const ListingRow = memo(function ListingRow({ listing }: { listing: Listing }) {
  const { product, view, available } = listing;
  const cart = useAddToCart();
  const orderable = canOrderFrom(view?.store ?? null) && available > 0;
  const store = storeLine(product.storeName, distanceOf(listing));
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${product.name}, ${formatMoney(product.priceCents)} per ${product.unit}, ${store}`}
        onPress={() => router.push(`/product/${product.id}`)}
        style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
      >
        <ProductArt product={product} size={64} dimmed={available <= 0} />
        <View style={styles.info}>
          <Text variant="bodyMedium" numberOfLines={2}>
            {product.name}
          </Text>
          <Text variant="caption" color="muted" numberOfLines={1}>
            {[product.size, store].filter(Boolean).join(' · ')}
          </Text>
          <Text variant="captionMedium" color="primaryDark">
            {formatMoney(product.priceCents)}
            <Text variant="micro" color="muted">{` / ${product.unit}`}</Text>
            {product.compareAtCents && product.compareAtCents > product.priceCents ? (
              <Text variant="micro" color="subtle" style={styles.strike}>
                {`  ${formatMoney(product.compareAtCents)}`}
              </Text>
            ) : null}
          </Text>
          <View style={styles.meta}>
            <StockPill available={available} />
            {available > 0 ? <PromiseLabel promise={view?.availability.promise ?? null} size="sm" /> : null}
          </View>
        </View>
      </Pressable>
      {orderable ? (
        <View style={styles.add}>
          <IconButton
            icon="plus"
            label={`Add ${product.name} to cart`}
            color={colors.white}
            background={colors.primary}
            size={34}
            onPress={() => cart.add(product, 1)}
          />
        </View>
      ) : null}
    </View>
  );
});

/**
 * The same item at several stores ("2x4x8 SPF stud · from $4.79 · 2 stores · nearest 13.0 km · in
 * stock"), with one line per store, cheapest first.
 */
export const FamilyCard = memo(function FamilyCard({ group }: { group: FamilyGroup }) {
  const first = group.listings[0];
  if (!first) return null;
  const summary = [
    `from ${formatMoney(group.fromCents)}`,
    pluralize(group.storeCount, 'store'),
    group.nearestM != null ? `nearest ${formatDistance(group.nearestM)}` : null,
    group.inStock ? 'in stock' : 'out of stock',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={styles.family}>
      <View style={styles.familyHead} accessible accessibilityLabel={`${group.name}, ${summary}`}>
        <ProductArt product={first.product} size={56} dimmed={!group.inStock} />
        <View style={styles.info}>
          <Text variant="bodyMedium" numberOfLines={2}>
            {group.name}
          </Text>
          <Text variant="caption" color="muted">
            {summary}
          </Text>
        </View>
      </View>
      {group.listings.map((listing) => (
        <FamilyOffer key={listing.product.id} listing={listing} />
      ))}
    </View>
  );
});

function FamilyOffer({ listing }: { listing: Listing }) {
  const { product, view, available } = listing;
  const store = storeLine(product.storeName, distanceOf(listing));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${store}, ${formatMoney(product.priceCents)} per ${product.unit}`}
      onPress={() => router.push(`/product/${product.id}`)}
      style={({ pressed }) => [styles.offer, pressed ? styles.pressed : null]}
    >
      <View style={styles.info}>
        <Text variant="captionMedium" numberOfLines={1}>
          {store}
        </Text>
        <View style={styles.meta}>
          <StockPill available={available} />
          {available > 0 ? <PromiseLabel promise={view?.availability.promise ?? null} size="sm" /> : null}
        </View>
      </View>
      <Text variant="captionMedium" color="primaryDark">
        {formatMoney(product.priceCents)}
        <Text variant="micro" color="muted">{` / ${product.unit}`}</Text>
      </Text>
      <Icon name="chevron-right" size={18} color={colors.textSubtle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  add: { justifyContent: 'center', paddingRight: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.sm, flexDirection: 'row' },
  family: { backgroundColor: colors.surface, borderRadius: radius.sm, paddingBottom: spacing.xs },
  familyHead: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, padding: spacing.md },
  info: { flex: 1, gap: 2 },
  meta: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 2 },
  offer: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    marginHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pressed: { opacity: 0.85 },
  row: { flex: 1, flexDirection: 'row', gap: spacing.md, padding: spacing.md },
  strike: { textDecorationLine: 'line-through' },
});
