import { formatDistance, STORE_SPECIALTY_LABELS } from '@instasupply/shared';
import { router } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { PromiseLabel, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

import type { StoreView } from '../hooks';

import { StoreArt } from './StoreArt';
import { StoreBadge } from './StoreBadge';
import { StoreRating } from './StoreRating';

/**
 * A store as the Stores tab and the Home carousel show it: art, name, specialty, km, promise
 * ("Delivery by 1:50 pm" / "Pickup ready in 25 min" / "Opens tomorrow 6:30 am" / "Joining
 * InstaSupply"), ★ rating and the §2.8 badge. `compact` is the narrow carousel card.
 */
export const StoreCard = memo(function StoreCard({
  view,
  compact = false,
  width,
  highlighted = false,
}: {
  view: StoreView;
  compact?: boolean;
  width?: number;
  highlighted?: boolean;
}) {
  const { store, availability, distanceM } = view;
  const specialty = STORE_SPECIALTY_LABELS[store.specialty];
  const distance = distanceM != null ? formatDistance(distanceM) : null;
  const label = [store.name, specialty, distance, availability.promise, availability.badge]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push(`/store/${store.id}`)}
      style={({ pressed }) => [
        styles.card,
        compact ? styles.compact : styles.wide,
        width ? { width } : null,
        highlighted ? styles.highlighted : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <StoreArt
        store={store}
        width={compact ? (width ?? 220) - 2 * spacing.md : 88}
        height={compact ? 104 : 88}
      />
      <View style={styles.info}>
        <Text variant="subheading" numberOfLines={1}>
          {store.name}
        </Text>
        <Text variant="caption" color="muted" numberOfLines={1}>
          {[specialty, distance ?? store.areaLabel].join(' · ')}
        </Text>
        <PromiseLabel promise={availability.promise} size="sm" />
        <View style={styles.meta}>
          <StoreRating rating={store.rating} count={store.ratingCount} />
          <StoreBadge badge={availability.badge} />
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1.5,
  },
  compact: { gap: spacing.sm, padding: spacing.md },
  highlighted: { borderColor: colors.primary },
  info: { flex: 1, gap: 3 },
  meta: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pressed: { opacity: 0.85 },
  wide: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, padding: spacing.md },
});
