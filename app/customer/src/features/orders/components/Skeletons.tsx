import { StyleSheet, View } from 'react-native';

import { Skeleton } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

const LINE_WIDTHS = ['62%', '44%', '70%'] as const;

/** White card placeholder shaped like an order / notification row. */
export function SkeletonCard({
  circle = 52,
  lines = 3,
  bar = false,
}: {
  circle?: number;
  lines?: 1 | 2 | 3;
  bar?: boolean;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Skeleton style={{ borderRadius: circle / 2, height: circle, width: circle }} />
        <View style={styles.lines}>
          {LINE_WIDTHS.slice(0, lines).map((width, index) => (
            <Skeleton key={width} style={{ height: index === 0 ? 14 : 10, width }} />
          ))}
        </View>
      </View>
      {bar ? <Skeleton style={styles.bar} /> : null}
    </View>
  );
}

/** Placeholder list shown while a realtime list loads. */
export function SkeletonList({ count, ...card }: { count: number } & Parameters<typeof SkeletonCard>[0]) {
  return (
    <View style={styles.list} accessibilityRole="progressbar" accessibilityLabel="Loading">
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={index} {...card} />
      ))}
    </View>
  );
}

/** Track Order placeholder: summary card, timeline and items. */
export function OrderDetailSkeleton() {
  return (
    <View style={styles.list} accessibilityRole="progressbar" accessibilityLabel="Loading order">
      <SkeletonCard circle={60} />
      <View style={styles.card}>
        {[0, 1, 2, 3, 4].map((step) => (
          <View key={step} style={styles.row}>
            <Skeleton style={styles.stepCircle} />
            <View style={styles.lines}>
              <Skeleton style={styles.stepTitle} />
              <Skeleton style={styles.stepDetail} />
            </View>
          </View>
        ))}
      </View>
      <SkeletonCard circle={44} lines={2} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { height: 4 },
  card: { backgroundColor: colors.surface, borderRadius: radius.sm, gap: spacing.lg, padding: spacing.lg },
  lines: { flex: 1, gap: spacing.sm },
  list: { gap: spacing.md },
  row: { alignItems: 'center', flexDirection: 'row', gap: 14 },
  stepCircle: { borderRadius: 23, height: 46, width: 46 },
  stepDetail: { height: 10, width: '35%' },
  stepTitle: { height: 13, width: '55%' },
});
