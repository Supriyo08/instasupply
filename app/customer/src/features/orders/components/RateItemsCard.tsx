import type { OrderItem } from '@instasupply/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ArtImage, Card, FilledIcon, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

import { backdropFor } from './order-ui';

/** After delivery: one "Rate" button per item, opening the product's write-review screen. */
export function RateItemsCard({ items }: { items: OrderItem[] }) {
  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={styles.badge}>
          <FilledIcon name="star" size={20} color={colors.star} />
        </View>
        <View style={styles.headerText}>
          <Text variant="heading">Rate your items</Text>
          <Text variant="caption" color="muted">
            How was everything? Your review helps other shoppers.
          </Text>
        </View>
      </View>
      {items.map((item, index) => (
        <View key={item.productId} style={styles.row}>
          <View style={[styles.art, { backgroundColor: backdropFor(index) }]}>
            <ArtImage artKey={item.imageKey} uri={item.imageUrl} size={30} />
          </View>
          <Text variant="bodyMedium" numberOfLines={1} style={styles.name}>
            {item.name}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Rate ${item.name}`}
            hitSlop={6}
            onPress={() => router.push(`/product/${item.productId}/write-review`)}
            style={({ pressed }) => [styles.rate, pressed ? styles.pressed : null]}
          >
            <FilledIcon name="star-outline" size={14} color={colors.primaryDark} />
            <Text variant="captionMedium" style={styles.rateLabel}>
              Rate
            </Text>
          </Pressable>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  art: { alignItems: 'center', borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  badge: {
    alignItems: 'center',
    backgroundColor: colors.warningSoft,
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  card: { gap: 14 },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  headerText: { flex: 1 },
  name: { flex: 1 },
  pressed: { opacity: 0.6 },
  rate: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  rateLabel: { color: colors.primaryDark },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
});
