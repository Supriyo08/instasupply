import { formatMoney } from '@instasupply/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, Card, ErrorState, Screen, Skeleton, Text } from '@/components/ui';
import { singleParam } from '@/features/checkout/navigation';
import { GetUpdatesCard, paymentLine, StorePromiseRows } from '@/features/checkout/OrderPlaced';
import { SuccessHero } from '@/features/checkout/SuccessHero';
import { useOrder } from '@/features/orders/hooks';
import { RequireAccount } from '@/features/session/RequireAccount';
import { useNow } from '@/hooks/useNow';
import { spacing } from '@/theme/tokens';

function OrderPlaced() {
  const params = useLocalSearchParams<{ orderId?: string; number?: string; total?: string }>();
  const orderId = singleParam(params.orderId) ?? null;
  const order = useOrder(orderId);
  const now = useNow(30_000);
  const number = order.data?.number ?? singleParam(params.number) ?? 'Your order';
  const total = Number(singleParam(params.total));

  const track = () => {
    if (orderId) router.replace({ pathname: '/orders/[id]', params: { id: orderId } });
    else router.replace('/orders');
  };

  return (
    <Screen
      safeTop
      footer={
        <>
          <Button label="Track order" icon="map" onPress={track} />
          <Button label="Keep shopping" variant="secondary" onPress={() => router.dismissTo('/')} />
        </>
      }
    >
      <SuccessHero />
      <View style={styles.heading}>
        <Text variant="title" align="center" accessibilityRole="header">
          Order {number} placed
        </Text>
        <Text color="muted" align="center">
          Each store is confirming its part now. We’ll keep you posted at every step.
        </Text>
      </View>

      <Card style={styles.card}>
        {order.loading && !order.data ? (
          <View accessible accessibilityLabel="Loading your order" style={styles.skeletons}>
            <Skeleton style={styles.skeleton} />
            <Skeleton style={styles.skeleton} />
          </View>
        ) : order.error && !order.data ? (
          <ErrorState title="Couldn't load the order details" error={order.error} onRetry={order.retry} />
        ) : order.data ? (
          <>
            <StorePromiseRows order={order.data} now={now} />
            <View style={styles.payment}>
              <Text variant="bodyMedium">{paymentLine(order.data)}</Text>
              <Text variant="caption" color="muted">
                Charged when your order is complete, for what was supplied.
              </Text>
            </View>
          </>
        ) : (
          <Text color="muted">
            {Number.isFinite(total)
              ? `Card held · ${formatMoney(total)}`
              : 'Your order details are in Orders.'}
          </Text>
        )}
      </Card>

      <GetUpdatesCard />
    </Screen>
  );
}

/** "Order IS-10042 placed", one row per store with its promise, "Card held · $388.25", Track order. */
export default function OrderSuccessScreen() {
  return (
    <RequireAccount title="Order placed">
      <OrderPlaced />
    </RequireAccount>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.lg },
  heading: { gap: spacing.sm },
  payment: { gap: 2 },
  skeleton: { borderRadius: 8, height: 40 },
  skeletons: { gap: spacing.md },
});
