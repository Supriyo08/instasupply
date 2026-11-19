import { StyleSheet, View } from 'react-native';

import { Skeleton } from '@/components/ui';
import { colors, radius } from '@/theme/tokens';

/** Placeholder shaped like the address cards (list) or the address form (editor). */
export function AddressSkeleton({ variant = 'list' }: { variant?: 'list' | 'form' }) {
  if (variant === 'form') {
    return (
      <View style={styles.form} accessibilityLabel="Loading address">
        <Skeleton style={styles.block} />
        <Skeleton style={styles.chips} />
        {[0, 1, 2, 3].map((row) => (
          <Skeleton key={row} style={styles.field} />
        ))}
      </View>
    );
  }
  return (
    <View style={styles.form} accessibilityLabel="Loading addresses">
      {[0, 1].map((row) => (
        <View key={row} style={styles.card}>
          <Skeleton style={styles.pin} />
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
  block: { height: 74 },
  card: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: 14,
    padding: 14,
  },
  chips: { height: 40, width: '70%' },
  field: { height: 56 },
  form: { gap: 12 },
  lines: { flex: 1, gap: 8 },
  long: { height: 12, width: '90%' },
  medium: { height: 12, width: '45%' },
  pin: { borderRadius: 30, height: 60, width: 60 },
  short: { height: 14, width: '35%' },
});
