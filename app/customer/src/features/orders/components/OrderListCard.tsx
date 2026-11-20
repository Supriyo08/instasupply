import { formatMoney, isOrderOpen, orderHeadline, pluralize, type Order } from '@instasupply/shared';
import { router } from 'expo-router';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Icon, StatusPill, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

import { orderTone, paymentText, placedAtText } from '../order-format';

/** One order on the Orders tab: number, date, headline, stores, total and Reorder. */
export const OrderListCard = memo(function OrderListCard({
  order,
  now,
  onReorder,
  reordering,
}: {
  order: Order;
  now: number;
  onReorder: (order: Order) => void;
  reordering: boolean;
}) {
  const headline = orderHeadline(order);
  const stores = order.storeOrders.map((storeOrder) => storeOrder.storeName).join(', ');
  const site = order.fulfilment === 'pickup' ? 'Pickup' : (order.jobsite?.label ?? 'Delivery');
  const open = isOrderOpen(order.status);
  return (
    <Card
      onPress={() => router.push(`/orders/${order.id}`)}
      accessibilityLabel={`Order ${order.number}, ${headline}, ${formatMoney(order.current.totalCents)}. Opens the order.`}
      style={styles.card}
    >
      <View style={styles.top}>
        <View style={[styles.icon, { backgroundColor: open ? colors.primarySoft : colors.background }]}>
          <Icon
            name={order.fulfilment === 'pickup' ? 'shopping-bag' : 'truck'}
            size={20}
            color={open ? colors.primaryDark : colors.textMuted}
          />
        </View>
        <View style={styles.title}>
          <Text variant="heading">{order.number}</Text>
          <Text variant="caption" color="muted">
            {placedAtText(order, now)} · {site}
          </Text>
        </View>
        <Text variant="heading" color="primaryDark">
          {formatMoney(order.current.totalCents)}
        </Text>
      </View>
      <StatusPill label={headline} tone={orderTone(order.status)} />
      <Text variant="caption" color="muted" numberOfLines={2}>
        {pluralize(order.itemCount, 'item')} · {pluralize(order.storeCount, 'store')} · {stores}
      </Text>
      <View style={styles.bottom}>
        <Text variant="captionMedium" style={styles.payment} numberOfLines={1}>
          {paymentText(order)}
        </Text>
        {order.source === 'cart' || order.source === 'quote' ? (
          <Button
            label="Reorder"
            icon="repeat"
            variant="secondary"
            size="md"
            loading={reordering}
            onPress={() => onReorder(order)}
            style={styles.reorder}
          />
        ) : null}
      </View>
    </Card>
  );
});

const styles = StyleSheet.create({
  bottom: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  card: { gap: spacing.sm + 2 },
  icon: { alignItems: 'center', borderRadius: radius.pill, height: 42, justifyContent: 'center', width: 42 },
  payment: { flex: 1 },
  reorder: { alignSelf: 'auto', minWidth: 128 },
  title: { flex: 1 },
  top: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
});
