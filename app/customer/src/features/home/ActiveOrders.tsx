import { formatClockET, formatMoney, orderHeadline, pluralize, type Order } from '@instasupply/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppMap, fitKeyFor, type MapMarker } from '@/components/map';
import { Card, ErrorState, Icon, PromiseLabel, Skeleton, Text } from '@/components/ui';
import { useCustomerOrders, useTracking } from '@/features/orders/hooks';
import { useNow } from '@/hooks/useNow';
import { colors, spacing } from '@/theme/tokens';

import { arrivalLabel } from './arrival';
import { outForDelivery, PAYMENT_LABELS } from './order-labels';

const MAX_CARDS = 3;

/** Up to three active orders; the first one out for delivery gets the mini map (CLIENTS §7.4). */
export function ActiveOrders({ uid }: { uid: string }) {
  const orders = useCustomerOrders(uid, 'active');
  const shown = orders.items.slice(0, MAX_CARDS);
  const mapOrderId = shown.find((order) => outForDelivery(order))?.id ?? null;

  if (orders.loading && shown.length === 0) return <Skeleton style={styles.skeleton} />;
  if (orders.error && shown.length === 0) {
    return <ErrorState title="Couldn't load your orders" error={orders.error} onRetry={orders.retry} />;
  }
  if (shown.length === 0) return null;
  return (
    <View style={styles.list}>
      <Text variant="heading">Active orders</Text>
      {shown.map((order) => (
        <ActiveOrderCard key={order.id} order={order} withMap={order.id === mapOrderId} />
      ))}
    </View>
  );
}

function ActiveOrderCard({ order, withMap }: { order: Order; withMap: boolean }) {
  const moving = withMap ? outForDelivery(order) : null;
  const tracking = useTracking(moving?.trackingToken ?? null);
  const now = useNow(15_000);
  const headline = orderHeadline(order);
  const arrival = arrivalLabel(tracking.data, now);
  const nextDeliverBy = order.storeOrders
    .map((storeOrder) => storeOrder.deliverBy)
    .filter((at): at is number => typeof at === 'number' && at > now)
    .sort((a, b) => a - b)[0];
  const promise = arrival ?? (nextDeliverBy ? `Delivery by ${formatClockET(nextDeliverBy)}` : null);
  const facts = [
    pluralize(order.itemCount, 'item'),
    pluralize(order.storeCount, 'store'),
    formatMoney(order.current.totalCents),
    PAYMENT_LABELS[order.payment.status],
  ].join(' · ');

  const markers: MapMarker[] = [];
  const data = tracking.data;
  if (data?.pickup)
    markers.push({
      id: 'store',
      kind: 'store',
      position: data.pickup.location,
      title: data.pickup.storeName,
    });
  if (data) markers.push({ id: 'site', kind: 'site', position: data.destination, title: 'Your site' });
  if (data?.driver?.location) {
    markers.push({
      id: 'driver',
      kind: 'driver',
      position: data.driver.location,
      heading: data.driver.heading,
      glide: true,
      title: data.driver.firstName,
    });
  }
  // Store and site frame the map; the driver glides inside it without refitting the camera.
  const fitPoints = markers.filter((marker) => marker.kind !== 'driver').map((marker) => marker.position);

  return (
    <Card style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Order ${order.number}, ${headline}. ${promise ? `${promise}. ` : ''}${facts}`}
        onPress={() => router.push(`/orders/${order.id}`)}
        style={({ pressed }) => [styles.body, pressed ? styles.pressed : null]}
      >
        <View style={styles.head}>
          <View style={styles.headCopy}>
            <Text variant="subheading" numberOfLines={1}>
              {headline}
            </Text>
            <Text variant="caption" color="muted">
              {order.number}
              {order.jobsite ? ` · ${order.jobsite.label}` : ''}
            </Text>
          </View>
          <Icon name="chevron-right" size={20} color={colors.textMuted} />
        </View>
        <PromiseLabel promise={promise} />
        <Text variant="caption" color="muted" numberOfLines={1}>
          {order.itemsSummary}
        </Text>
        <Text variant="captionMedium">{facts}</Text>
      </Pressable>
      {withMap && data ? (
        <AppMap
          markers={markers}
          fit={{ key: fitKeyFor(fitPoints), points: fitPoints }}
          style={styles.map}
          accessibilityLabel={`Map of ${order.number}: ${data.driver?.firstName ?? 'the driver'} on the way to your site`}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.sm },
  card: { gap: spacing.md },
  head: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  headCopy: { flex: 1 },
  list: { gap: spacing.md },
  map: { borderRadius: 8, height: 140, overflow: 'hidden' },
  pressed: { opacity: 0.85 },
  skeleton: { height: 120 },
});
