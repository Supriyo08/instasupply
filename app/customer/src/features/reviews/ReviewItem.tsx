import { formatRelativeTime, initials, type StoreReview } from '@instasupply/shared';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Rating, Text } from '@/components/ui';
import { avatarTint } from '@/features/product/constants';
import { colors, radius, spacing } from '@/theme/tokens';

/** One store review: initials on a pastel, name, stars, when, and the text. */
export const ReviewItem = memo(function ReviewItem({
  review,
  now,
  mine = false,
}: {
  review: StoreReview;
  now: number;
  mine?: boolean;
}) {
  const edited = review.updatedAt - review.createdAt > 60_000;
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.avatar, { backgroundColor: avatarTint(review.customerId) }]}>
          <Text variant="captionMedium">{initials(review.authorName)}</Text>
        </View>
        <View style={styles.who}>
          <Text variant="bodyMedium">{mine ? `${review.authorName} (you)` : review.authorName}</Text>
          <Text variant="caption" color="muted">
            {formatRelativeTime(review.updatedAt, now)}
            {edited ? ' · edited' : ''}
          </Text>
        </View>
      </View>
      <Rating value={review.rating} size={14} />
      {review.text ? <Text color="muted">{review.text}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  card: { backgroundColor: colors.surface, borderRadius: radius.sm, gap: spacing.sm, padding: spacing.lg },
  head: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  who: { flex: 1 },
});
