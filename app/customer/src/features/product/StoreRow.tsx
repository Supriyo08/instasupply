import { formatDistance, STORE_SPECIALTY_LABELS } from '@instasupply/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, PromiseLabel, Text } from '@/components/ui';
import { StoreArt } from '@/features/stores/components/StoreArt';
import { StoreBadge } from '@/features/stores/components/StoreBadge';
import type { StoreView } from '@/features/stores/hooks';
import { colors, radius, spacing } from '@/theme/tokens';

/** "Sold by" row of the product page: the store, its distance and promise; opens the store. */
export function StoreRow({ view }: { view: StoreView }) {
  const { store, availability, distanceM } = view;
  const distance = distanceM != null ? formatDistance(distanceM) : store.areaLabel;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Sold by ${store.name}, ${distance}${availability.promise ? `, ${availability.promise}` : ''}`}
      onPress={() => router.push(`/store/${store.id}`)}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <StoreArt store={store} width={56} height={56} />
      <View style={styles.info}>
        <Text variant="caption" color="muted">
          Sold by
        </Text>
        <Text variant="subheading" numberOfLines={1}>
          {store.name}
        </Text>
        <Text variant="caption" color="muted" numberOfLines={1}>
          {STORE_SPECIALTY_LABELS[store.specialty]} · {distance}
        </Text>
        <PromiseLabel promise={availability.promise} size="sm" />
        <StoreBadge badge={availability.badge} />
      </View>
      <Icon name="chevron-right" size={20} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  info: { flex: 1, gap: 2 },
  pressed: { opacity: 0.85 },
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
});
