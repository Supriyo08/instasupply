import { FREE_DELIVERY_THRESHOLD, formatCurrency, type PricedCart } from '@instasupply/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { colors, gradient, radius } from '@/theme/tokens';

/** "Add ₹X more for free delivery" with a brand-green bar that fills as the subtotal grows. */
export function FreeDeliveryProgress({ priced }: { priced: PricedCart }) {
  const reached = priced.amountToFreeDelivery <= 0;
  const progress = Math.max(0, Math.min(1, priced.subtotal / FREE_DELIVERY_THRESHOLD));
  const fill = useRef(new Animated.Value(progress)).current;

  useEffect(() => {
    Animated.timing(fill, { toValue: progress, duration: 450, useNativeDriver: false }).start();
  }, [fill, progress]);

  const remaining = formatCurrency(priced.amountToFreeDelivery);
  return (
    <View
      accessible
      accessibilityLabel={
        reached ? 'Your order qualifies for free delivery' : `Add ${remaining} more for free delivery`
      }
      style={styles.card}
    >
      <View style={styles.top}>
        <View style={styles.icon}>
          <Icon name={reached ? 'check' : 'truck'} size={18} color={colors.primary} />
        </View>
        <View style={styles.copy}>
          {reached ? (
            <Text variant="bodyMedium">You&apos;ve unlocked free delivery</Text>
          ) : (
            <Text variant="bodyMedium">
              Add{' '}
              <Text variant="bodyMedium" color="primaryDark">
                {remaining}
              </Text>{' '}
              more for free delivery
            </Text>
          )}
          <Text variant="caption" color="muted">
            {reached
              ? 'No delivery charges on this order.'
              : `Free delivery on orders of ${formatCurrency(FREE_DELIVERY_THRESHOLD)} and above`}
          </Text>
        </View>
      </View>
      <View style={styles.track}>
        <Animated.View
          style={[
            styles.fill,
            { width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
          ]}
        >
          <LinearGradient
            colors={gradient.colors}
            start={gradient.start}
            end={gradient.end}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, gap: 12, padding: 14 },
  copy: { flex: 1, gap: 1 },
  fill: { borderRadius: 3, height: '100%', overflow: 'hidden' },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 19,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  top: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  track: { backgroundColor: colors.background, borderRadius: 3, height: 6, overflow: 'hidden' },
});
