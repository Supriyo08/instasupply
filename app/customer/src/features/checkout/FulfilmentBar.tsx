import type { Fulfilment } from '@instasupply/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, SegmentedControl, Text } from '@/components/ui';
import { useCart } from '@/features/cart/CartProvider';
import { useSite } from '@/features/site/SiteProvider';
import { colors, radius, spacing } from '@/theme/tokens';

const OPTIONS: readonly { value: Fulfilment; label: string }[] = [
  { value: 'delivery', label: 'Delivery' },
  { value: 'pickup', label: 'Pickup' },
];

/** Delivery | Pickup, and for delivery the "Deliver to · Leslieville semi reno ▾" switcher (→ site). */
export function FulfilmentBar({ showSite = true }: { showSite?: boolean }) {
  const cart = useCart();
  const { site } = useSite();
  return (
    <View style={styles.wrap}>
      <SegmentedControl options={OPTIONS} value={cart.fulfilment} onChange={cart.setFulfilment} />
      {showSite && cart.fulfilment === 'delivery' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={site ? `Deliver to ${site.label}. Change` : 'Choose where we deliver'}
          onPress={() => router.push('/site')}
          style={({ pressed }) => [styles.site, pressed ? styles.pressed : null]}
        >
          <Icon name="map-pin" size={16} color={colors.primaryDark} />
          <Text variant="caption" color="muted">
            Deliver to ·
          </Text>
          <Text variant="captionMedium" numberOfLines={1} style={styles.label}>
            {site?.label ?? 'Choose a jobsite'}
          </Text>
          <Icon name="chevron-down" size={16} color={colors.text} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { flexShrink: 1 },
  pressed: { opacity: 0.7 },
  site: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: spacing.xs,
    maxWidth: '100%',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  wrap: { gap: spacing.md },
});
