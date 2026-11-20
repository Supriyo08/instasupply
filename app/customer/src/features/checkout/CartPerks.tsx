import {
  FIRST_ORDER_DISCOUNT_CENTS,
  FIRST_ORDER_DISCOUNT_MIN_ITEMS_CENTS,
  FREE_DELIVERY_MIN_ITEMS_CENTS,
  formatMoney,
  type PricedCheckout,
} from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Card, Icon, Notice, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

/** "Add $171.42 more for free delivery" with a progress bar towards $500 of items. */
function FreeDeliveryMeter({ pricing }: { pricing: PricedCheckout }) {
  const progress = Math.min(1, pricing.itemsCents / FREE_DELIVERY_MIN_ITEMS_CENTS);
  const reached = pricing.freeDelivery === 'free_threshold';
  const message = reached
    ? 'Free delivery on this order: items reach $500'
    : `Add ${formatMoney(pricing.amountToFreeDeliveryCents)} more for free delivery`;
  return (
    <Card style={styles.meter} accessibilityLabel={message}>
      <View style={styles.meterHead}>
        <Icon name="truck" size={16} color={colors.primaryDark} />
        <Text variant="captionMedium" style={styles.flex}>
          {message}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>
      <Text variant="micro" color="muted">
        Free delivery on orders over $500
      </Text>
    </Card>
  );
}

/**
 * The order-level perks of the cart (MARKETPLACE §7.3, D5): the $500 free-delivery meter and the
 * first-order banners ("$0 delivery fee on your first order", "First order $250+? $20 off").
 */
export function CartPerks({
  pricing,
  firstOrder,
  delivery,
}: {
  pricing: PricedCheckout;
  firstOrder: boolean;
  delivery: boolean;
}) {
  const welcome = pricing.discounts.find((discount) => discount.kind === 'first_order');
  return (
    <View style={styles.perks}>
      {firstOrder && delivery ? (
        <Notice tone="success" icon="gift" message="$0 delivery fee on your first order" />
      ) : null}
      {firstOrder && welcome ? (
        <Notice
          tone="success"
          icon="tag"
          message={`First order: ${formatMoney(welcome.cents)} off your items`}
        />
      ) : firstOrder && pricing.amountToFirstOrderDiscountCents > 0 ? (
        <Notice
          tone="info"
          icon="tag"
          title={`First order ${formatMoney(FIRST_ORDER_DISCOUNT_MIN_ITEMS_CENTS)}+? ${formatMoney(FIRST_ORDER_DISCOUNT_CENTS)} off`}
          message={`Add ${formatMoney(pricing.amountToFirstOrderDiscountCents)} more to get it.`}
        />
      ) : null}
      {delivery && !(firstOrder && pricing.freeDelivery === 'first_order') ? (
        <FreeDeliveryMeter pricing={pricing} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { backgroundColor: colors.primary, borderRadius: radius.pill, height: '100%' },
  flex: { flex: 1 },
  meter: { gap: spacing.sm },
  meterHead: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  perks: { gap: spacing.md },
  track: { backgroundColor: colors.primarySoft, borderRadius: radius.pill, height: 8, overflow: 'hidden' },
});
