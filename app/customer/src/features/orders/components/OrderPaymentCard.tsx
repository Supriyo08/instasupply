import { findPromo, type Order, type PricedCart } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { PriceSummary } from '@/components/catalog/PriceSummary';
import { Card, Divider, FilledIcon, Icon, Text } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

import { paymentMethodLabel, paymentStateOf } from './order-ui';
import { StatusPill } from './StatusPill';

/** The order's own (server-priced) totals in the shared PriceSummary, plus payment method and status. */
function pricedFromOrder(order: Order): PricedCart {
  return {
    itemCount: order.itemCount,
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    discount: order.discount,
    total: order.total,
    promo: findPromo(order.promoCode),
    promoError: null,
    amountToFreeDelivery: 0,
  };
}

export function OrderPaymentCard({ order }: { order: Order }) {
  const payment = paymentStateOf(order);
  const method = paymentMethodLabel(order);
  return (
    <Card style={styles.card}>
      <Text variant="heading">Payment summary</Text>
      <PriceSummary priced={pricedFromOrder(order)} />
      <Divider />
      <View
        style={styles.method}
        accessible
        accessibilityLabel={`Payment: ${method}. ${payment.label}. ${payment.note}`}
      >
        <View style={styles.methodIcon}>
          {order.paymentMethod === 'card' ? (
            <Icon name="credit-card" size={20} color={colors.primary} />
          ) : (
            <FilledIcon name="cash-outline" size={21} color={colors.primary} />
          )}
        </View>
        <View style={styles.methodText}>
          <Text variant="bodyMedium" numberOfLines={1}>
            {method}
          </Text>
          <Text variant="caption" color="muted">
            {payment.note}
          </Text>
        </View>
        <StatusPill label={payment.label} tone={payment.tone} size="sm" />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 14 },
  method: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  methodIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  methodText: { flex: 1 },
});
