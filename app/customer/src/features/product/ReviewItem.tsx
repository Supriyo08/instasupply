import { formatRelativeTime, initials, toMillis, type Review } from '@instasupply/shared';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge, Skeleton, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

import { avatarTint } from './constants';
import { StarRow } from './StarRow';

/** "3 h ago", "12 Nov · edited"; pending server timestamps read as "just now". */
function reviewedAt(review: Review): string {
  const updated = toMillis(review.updatedAt);
  if (updated == null) return 'just now';
  const created = toMillis(review.createdAt);
  const edited = created != null && updated - created > 60_000;
  return `${formatRelativeTime(updated)}${edited ? ' · edited' : ''}`;
}

/** One review: pastel initials avatar, name, when, stars and text. */
export const ReviewItem = memo(function ReviewItem({
  review,
  mine = false,
  onEdit,
}: {
  review: Review;
  mine?: boolean;
  onEdit?: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.avatar, { backgroundColor: avatarTint(review.userId) }]}>
          <Text variant="captionMedium">{initials(review.userName)}</Text>
        </View>
        <View style={styles.who}>
          <View style={styles.nameRow}>
            <Text variant="bodyMedium" numberOfLines={1} style={styles.name}>
              {review.userName}
            </Text>
            {mine ? (
              <View>
                <Badge label="You" tone="brand" />
              </View>
            ) : null}
          </View>
          <Text variant="caption" color="muted">
            {reviewedAt(review)}
          </Text>
        </View>
        {mine && onEdit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit your review"
            hitSlop={10}
            onPress={onEdit}
          >
            <Text variant="captionMedium" color="primary">
              Edit
            </Text>
          </Pressable>
        ) : null}
      </View>
      <StarRow value={review.rating} />
      {review.text ? <Text color="muted">{review.text}</Text> : null}
    </View>
  );
});

export function ReviewItemSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Skeleton style={styles.avatarSkeleton} />
        <View style={styles.who}>
          <Skeleton style={styles.line} />
          <Skeleton style={styles.shortLine} />
        </View>
      </View>
      <Skeleton style={styles.textLine} />
      <Skeleton style={styles.shortLine} />
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  avatarSkeleton: { borderRadius: 20, height: 40, width: 40 },
  card: { backgroundColor: colors.surface, borderRadius: radius.sm, gap: spacing.sm, padding: spacing.lg },
  head: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  line: { height: 14, width: 140 },
  name: { flexShrink: 1 },
  nameRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  shortLine: { height: 12, width: 90 },
  textLine: { height: 12, width: '92%' },
  who: { flex: 1, gap: 2 },
});
