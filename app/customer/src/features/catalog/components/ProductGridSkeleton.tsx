import { StyleSheet, View } from 'react-native';

import { Skeleton } from '@/components/ui';
import { colors, radius } from '@/theme/tokens';

/** Placeholder shaped like ProductGrid (two columns of product cards) while products load. */
export function ProductGridSkeleton({ count = 4 }: { count?: number }) {
  const rows = Array.from({ length: Math.ceil(count / 2) }, (_, row) => row);
  return (
    <View style={styles.grid} accessibilityRole="progressbar" accessibilityLabel="Loading products">
      {rows.map((row) => (
        <View key={row} style={styles.row}>
          <CardSkeleton />
          <CardSkeleton />
        </View>
      ))}
    </View>
  );
}

function CardSkeleton() {
  return (
    <View style={styles.card}>
      <Skeleton style={styles.art} />
      <Skeleton style={styles.price} />
      <Skeleton style={styles.name} />
      <Skeleton style={styles.unit} />
      <View style={styles.footer}>
        <Skeleton style={styles.button} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  art: { borderRadius: radius.pill, height: 84, marginBottom: 12, marginTop: 26, width: 84 },
  button: { height: 12, width: 84 },
  card: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    flex: 1,
    gap: 7,
    height: 240,
    overflow: 'hidden',
  },
  footer: {
    alignItems: 'center',
    alignSelf: 'stretch',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    height: 42,
    justifyContent: 'center',
    marginTop: 'auto',
  },
  grid: { gap: 14 },
  name: { height: 14, width: '62%' },
  price: { height: 10, width: 46 },
  row: { flexDirection: 'row', gap: 14 },
  unit: { height: 10, width: 38 },
});
