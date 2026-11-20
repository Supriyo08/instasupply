import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Header,
  Notice,
  Screen,
  Skeleton,
  Text,
} from '@/components/ui';
import { useStoreOrder } from '@/features/orders/hooks';
import { ReviewForm } from '@/features/reviews/ReviewForm';
import { RequireAccount } from '@/features/session/RequireAccount';
import { useMyStoreReview } from '@/features/stores/hooks';
import { spacing } from '@/theme/tokens';

const TITLE = 'Rate Store';

/** 🔒 Rate a completed store order (`?storeOrderId=`), MARKETPLACE §7.3. */
export default function StoreReviewScreen() {
  return (
    <RequireAccount title={TITLE} message="Sign in to rate the stores you ordered from.">
      <ReviewBody />
    </RequireAccount>
  );
}

function ReviewBody() {
  const { id, storeOrderId } = useLocalSearchParams<{ id: string; storeOrderId?: string }>();
  const storeOrder = useStoreOrder(storeOrderId);
  const mine = useMyStoreReview(id, storeOrderId);
  const order = storeOrder.data;

  let body;
  if (!storeOrderId) {
    body = (
      <EmptyState
        art="scene-order-confirmed"
        title="Pick an order to rate"
        message="Open a delivered or picked-up order and tap Rate store."
        action={<Button label="My orders" variant="secondary" onPress={() => router.replace('/orders')} />}
      />
    );
  } else if (storeOrder.loading || mine.loading) {
    body = (
      <View style={styles.wrap}>
        <Skeleton style={styles.cardSkeleton} />
        <Skeleton style={styles.formSkeleton} />
      </View>
    );
  } else if (storeOrder.error && !order) {
    body = (
      <ErrorState title="Couldn't load this order" error={storeOrder.error} onRetry={storeOrder.retry} />
    );
  } else if (!order || order.storeId !== id) {
    body = (
      <EmptyState
        art="scene-report-issue"
        title="Order not found"
        message="This order isn't on your account, or it belongs to another store."
      />
    );
  } else {
    const done = order.status === 'delivered' || order.status === 'picked_up';
    body = (
      <View style={styles.wrap}>
        <Card style={styles.order}>
          <Text variant="subheading">{order.storeName}</Text>
          <Text variant="caption" color="muted">
            {order.number} · {order.itemsSummary}
          </Text>
        </Card>
        {mine.error ? (
          <Notice
            tone="warning"
            message="Couldn't load your earlier review."
            actionLabel="Try again"
            onAction={mine.retry}
          />
        ) : null}
        {done ? (
          <ReviewForm
            key={mine.data?.id ?? 'new'}
            storeId={order.storeId}
            storeOrderId={order.id}
            storeName={order.storeName}
            existing={mine.data}
          />
        ) : (
          <Notice tone="info" message="You can rate this store once the order is delivered or picked up." />
        )}
      </View>
    );
  }

  return <Screen header={<Header title={TITLE} />}>{body}</Screen>;
}

const styles = StyleSheet.create({
  cardSkeleton: { height: 72 },
  formSkeleton: { height: 260 },
  order: { gap: 2 },
  wrap: { gap: spacing.lg },
});
