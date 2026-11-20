import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, Card, EmptyState, ErrorState, Header, Screen, Skeleton, Text } from '@/components/ui';
import { ReviewItem } from '@/features/reviews/ReviewItem';
import { StoreRating } from '@/features/stores/components/StoreRating';
import { useStore, useStoreReviews } from '@/features/stores/hooks';
import { useNow } from '@/hooks/useNow';
import { spacing } from '@/theme/tokens';

/**
 * A store's reviews, newest first (MARKETPLACE §7.3). Customers rate a store from a completed store
 * order (orders/[id] → store/[id]/review), so there is no "write" button here.
 */
export default function StoreReviewsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore(id);
  const reviews = useStoreReviews(id);
  const now = useNow(60_000);

  return (
    <Screen header={<Header title="Reviews" />} refreshing={reviews.refreshing} onRefresh={reviews.retry}>
      {store.data ? (
        <Card style={styles.summary}>
          <Text variant="heading">{store.data.name}</Text>
          <StoreRating rating={store.data.rating} count={store.data.ratingCount} />
          <Text variant="caption" color="muted">
            Reviews come from customers who received an order from this store.
          </Text>
        </Card>
      ) : null}

      {reviews.loading && reviews.items.length === 0 ? (
        <View style={styles.list}>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} style={styles.skeleton} />
          ))}
        </View>
      ) : reviews.error && reviews.items.length === 0 ? (
        <ErrorState title="Couldn't load reviews" error={reviews.error} onRetry={reviews.retry} />
      ) : reviews.items.length === 0 ? (
        <EmptyState
          art="scene-order-confirmed"
          title="No reviews yet"
          message="Ordered from this store? Rate it from your order once it's delivered or picked up."
        />
      ) : (
        <View style={styles.list}>
          {reviews.items.map((review) => (
            <ReviewItem key={review.id} review={review} now={now} />
          ))}
          {reviews.hasMore ? (
            <Button
              label="Show more reviews"
              variant="secondary"
              loading={reviews.loadingMore}
              onPress={reviews.loadMore}
            />
          ) : null}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  skeleton: { height: 120 },
  summary: { gap: spacing.xs },
});
