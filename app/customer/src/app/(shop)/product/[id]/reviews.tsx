import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';

import { Button, EmptyState, ErrorState, Header, IconButton, Screen } from '@/components/ui';
import { useMyReview, useProduct, useReviews } from '@/features/catalog/hooks';
import { ProductSummaryRow } from '@/features/product/ProductSummaryRow';
import { RatingSummary } from '@/features/product/RatingSummary';
import { ratingStats } from '@/features/product/review-stats';
import { ReviewItem, ReviewItemSkeleton } from '@/features/product/ReviewItem';
import { useCustomer } from '@/features/session/SessionProvider';

const PAGE = 30;

/** All reviews of a product: summary with distribution bars, the shopper's own review first. */
export default function ReviewsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useCustomer();
  const [max, setMax] = useState(PAGE);
  const product = useProduct(id);
  const reviews = useReviews(id, max);
  const mine = useMyReview(id, user.uid).data;

  const others = useMemo(
    () => reviews.data.filter((review) => review.userId !== user.uid),
    [reviews.data, user.uid],
  );
  const stats = useMemo(() => ratingStats(mine ? [mine, ...others] : others), [mine, others]);
  const writeLabel = mine ? 'Edit your review' : 'Write a review';
  const write = () => router.push(`/product/${id}/write-review`);

  let body: ReactNode;
  if (reviews.loading && reviews.data.length === 0) {
    body = [0, 1, 2].map((key) => <ReviewItemSkeleton key={key} />);
  } else if (reviews.error && stats.count === 0) {
    body = <ErrorState title="Couldn't load reviews" error={reviews.error} onRetry={reviews.retry} />;
  } else if (stats.count === 0) {
    body = (
      <EmptyState
        art="scene-material-list"
        title="No reviews yet"
        message={`Be the first to tell other shoppers what you think${product.data ? ` of ${product.data.name}` : ''}.`}
        action={<Button label="Write a review" icon="edit-3" onPress={write} />}
      />
    );
  } else {
    body = (
      <>
        <RatingSummary stats={stats} actionLabel={writeLabel} onAction={write} />
        {mine ? <ReviewItem review={mine} mine onEdit={write} /> : null}
        {others.map((review) => (
          <ReviewItem key={review.id} review={review} />
        ))}
        {reviews.data.length >= max ? (
          <Button
            variant="secondary"
            size="md"
            label="Show more reviews"
            loading={reviews.loading}
            onPress={() => setMax((value) => value + PAGE)}
          />
        ) : null}
      </>
    );
  }

  return (
    <Screen
      header={
        <Header title="Reviews" right={<IconButton icon="plus" label={writeLabel} onPress={write} />} />
      }
    >
      {product.data ? <ProductSummaryRow product={product.data} /> : null}
      {body}
    </Screen>
  );
}
