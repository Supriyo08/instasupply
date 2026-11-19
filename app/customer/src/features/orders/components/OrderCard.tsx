import {
  ORDER_STATUS_META,
  formatCurrency,
  formatDateTime,
  isOrderOpen,
  pluralize,
  type Order,
} from '@instasupply/shared';
import { router } from 'expo-router';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Icon, Text } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

import { STATUS_ICONS, TONES, orderTitle } from './order-ui';
import { OrderProgressBar } from './OrderProgressBar';
import { OrderStatusPill } from './StatusPill';

/** "My Orders" card: status icon, number, date, items + total, progress and status. */
export const OrderCard = memo(function OrderCard({ order }: { order: Order }) {
  const meta = ORDER_STATUS_META[order.status];
  const tone = TONES[meta.tone];
  const placed = formatDateTime(order.createdAt);
  const open = isOrderOpen(order.status);

  return (
    <Card
      onPress={() => router.push(`/orders/${order.id}`)}
      accessibilityLabel={`${orderTitle(order)}, ${meta.label}. Placed ${placed}. ${pluralize(order.itemCount, 'item')}, total ${formatCurrency(order.total)}.`}
      style={styles.card}
    >
      <View style={styles.top}>
        <View style={[styles.icon, { backgroundColor: tone.bg }]}>
          <Icon name={STATUS_ICONS[order.status]} size={24} color={tone.fg} />
        </View>
        <View style={styles.info}>
          <Text variant="subheading" numberOfLines={1}>
            {orderTitle(order)}
          </Text>
          <Text variant="caption" color="muted" numberOfLines={1}>
            Placed on {placed}
          </Text>
          <View style={styles.meta}>
            <Text variant="caption" color="muted">
              Items: <Text variant="captionMedium">{order.itemCount}</Text>
            </Text>
            <Text variant="caption" color="muted">
              Total:{' '}
              <Text variant="captionMedium" color="primaryDark">
                {formatCurrency(order.total)}
              </Text>
            </Text>
          </View>
        </View>
        <Icon name="chevron-right" size={20} color={colors.textSubtle} />
      </View>

      <OrderProgressBar order={order} />

      <View style={styles.footer}>
        <OrderStatusPill status={order.status} />
        <Text variant="captionMedium" color={open ? 'primary' : 'muted'}>
          {open ? 'Track order' : 'View details'}
        </Text>
      </View>
    </Card>
  );
});

const styles = StyleSheet.create({
  card: { gap: spacing.md + 2 },
  footer: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between' },
  icon: { alignItems: 'center', borderRadius: 28, height: 56, justifyContent: 'center', width: 56 },
  info: { flex: 1, gap: 1 },
  meta: { flexDirection: 'row', gap: spacing.lg, marginTop: 2 },
  top: { alignItems: 'center', flexDirection: 'row', gap: spacing.md + 2 },
});
