import { pluralize } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Button, FilledIcon, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

import type { RatingStats } from './review-stats';
import { StarRow } from './StarRow';

/** Average score with a 5 → 1 star distribution and a write/edit call to action. */
export function RatingSummary({
  stats,
  actionLabel,
  onAction,
}: {
  stats: RatingStats;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={styles.score}>
          <Text variant="display">{stats.average.toFixed(1)}</Text>
          <StarRow value={stats.average} size={15} />
          <Text variant="caption" color="muted">
            {pluralize(stats.count, 'review')}
          </Text>
        </View>
        <View style={styles.bars}>
          {[5, 4, 3, 2, 1].map((star) => (
            <DistributionBar key={star} star={star} count={stats.byStar[star - 1] ?? 0} total={stats.count} />
          ))}
        </View>
      </View>
      <Button variant="secondary" size="md" icon="edit-3" label={actionLabel} onPress={onAction} />
    </View>
  );
}

function DistributionBar({ star, count, total }: { star: number; count: number; total: number }) {
  const share = total > 0 ? count / total : 0;
  return (
    <View
      style={styles.barRow}
      accessible
      accessibilityLabel={`${star} ${star === 1 ? 'star' : 'stars'}: ${pluralize(count, 'review')}`}
    >
      <Text variant="micro" color="muted" style={styles.barStar}>
        {star}
      </Text>
      <FilledIcon name="star" size={10} color={colors.star} />
      <View style={styles.track}>
        <View style={[styles.fill, { flex: share }]} />
        <View style={{ flex: 1 - share }} />
      </View>
      <Text variant="micro" color="muted" style={styles.barCount}>
        {count}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  barCount: { textAlign: 'right', width: 22 },
  barRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  barStar: { textAlign: 'center', width: 8 },
  bars: { flex: 1, gap: spacing.sm, justifyContent: 'center' },
  card: { backgroundColor: colors.surface, borderRadius: radius.sm, gap: spacing.lg, padding: spacing.lg },
  fill: { backgroundColor: colors.star, borderRadius: radius.pill },
  score: { alignItems: 'center', gap: spacing.xxs, justifyContent: 'center', width: 104 },
  top: { flexDirection: 'row', gap: spacing.lg },
  track: {
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    flex: 1,
    flexDirection: 'row',
    height: 6,
    overflow: 'hidden',
  },
});
