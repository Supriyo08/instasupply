import { formatDistance, formatMoney, type Product } from '@instasupply/shared';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Skeleton, StockPill, Text } from '@/components/ui';
import { useFamilyOffers } from '@/features/catalog/hooks';
import { useListings } from '@/features/catalog/useListings';
import { colors, radius, spacing } from '@/theme/tokens';

/** "Also at": the same item at other stores (family offers) with price, km and stock. */
export function AlsoAt({ product }: { product: Product }) {
  const offers = useFamilyOffers(product.familyKey);
  const others = useMemo(
    () => offers.data.filter((offer) => offer.id !== product.id),
    [offers.data, product.id],
  );
  const { listings } = useListings(others);

  if (!product.familyKey || (!offers.loading && listings.length === 0) || offers.error) return null;
  return (
    <View style={styles.section}>
      <Text variant="heading">Also at</Text>
      {offers.loading && listings.length === 0 ? (
        <Skeleton style={styles.skeleton} />
      ) : (
        <View style={styles.card}>
          {listings.map((listing, index) => {
            const distance = listing.view?.distanceM != null ? formatDistance(listing.view.distanceM) : null;
            return (
              <Pressable
                key={listing.product.id}
                accessibilityRole="button"
                accessibilityLabel={`${listing.product.storeName}, ${formatMoney(listing.product.priceCents)} per ${listing.product.unit}${distance ? `, ${distance}` : ''}`}
                onPress={() => router.push(`/product/${listing.product.id}`)}
                style={({ pressed }) => [
                  styles.row,
                  index > 0 ? styles.divider : null,
                  pressed ? styles.pressed : null,
                ]}
              >
                <View style={styles.info}>
                  <Text variant="bodyMedium" numberOfLines={1}>
                    {listing.product.storeName}
                  </Text>
                  <View style={styles.meta}>
                    {distance ? (
                      <Text variant="caption" color="muted">
                        {distance}
                      </Text>
                    ) : null}
                    <StockPill available={listing.available} />
                  </View>
                </View>
                <Text variant="captionMedium" color="primaryDark">
                  {formatMoney(listing.product.priceCents)}
                  <Text variant="micro" color="muted">{` / ${listing.product.unit}`}</Text>
                </Text>
                <Icon name="chevron-right" size={18} color={colors.textSubtle} />
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: spacing.md },
  divider: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  info: { flex: 1, gap: 2 },
  meta: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  pressed: { opacity: 0.7 },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md },
  section: { gap: spacing.md },
  skeleton: { height: 120 },
});
