import { StyleSheet, View } from 'react-native';

import { Skeleton } from '@/components/ui';
import { colors, radius } from '@/theme/tokens';

const range = (count: number) => Array.from({ length: count }, (_, index) => index);

/** Placeholder rows while the cart's products load. */
export function CartRowsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <View accessible accessibilityLabel="Loading your cart" style={styles.list}>
      {range(count).map((index) => (
        <View key={index} style={styles.card}>
          <Skeleton style={styles.thumb} />
          <View style={styles.lines}>
            <Skeleton style={styles.short} />
            <Skeleton style={styles.long} />
            <Skeleton style={styles.tiny} />
          </View>
          <Skeleton style={styles.stepper} />
        </View>
      ))}
    </View>
  );
}

/** Placeholder cards while saved addresses load. */
export function OptionCardsSkeleton({ count = 2, label = 'Loading' }: { count?: number; label?: string }) {
  return (
    <View accessible accessibilityLabel={label} style={styles.list}>
      {range(count).map((index) => (
        <View key={index} style={styles.card}>
          <Skeleton style={styles.icon} />
          <View style={styles.lines}>
            <Skeleton style={styles.short} />
            <Skeleton style={styles.long} />
            <Skeleton style={styles.medium} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: 14,
    padding: 14,
  },
  icon: { borderRadius: 20, height: 40, width: 40 },
  lines: { flex: 1, gap: 8 },
  list: { gap: 12 },
  long: { height: 14, width: '75%' },
  medium: { height: 12, width: '55%' },
  short: { height: 12, width: 72 },
  stepper: { borderRadius: radius.md, height: 72, width: 28 },
  thumb: { borderRadius: 32, height: 64, width: 64 },
  tiny: { height: 10, width: 40 },
});
