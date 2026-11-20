import { formatMoney, type Amounts, type Order } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Card, Divider, Text } from '@/components/ui';
import { spacing } from '@/theme/tokens';

import { cardText, paymentText, releasedCents } from '../order-format';

/**
 * The receipt (MARKETPLACE §7.3 orders/[id]): what the order costs now, against what was placed when a
 * store shorted or cancelled items; HST with the registration number contractors need for input tax
 * credits; what was released or refunded; and the card.
 */
export function OrderReceipt({ order, hstNumber }: { order: Order; hstNumber: string | null }) {
  const placed = order.placed;
  const current = order.current;
  const changed = placed.totalCents !== current.totalCents;
  const released = releasedCents(order);
  const card = cardText(order);
  const discount =
    placed.discounts[0]?.label ?? (placed.promoCode ? `Promo ${placed.promoCode}` : 'Discount');
  return (
    <Card style={styles.card}>
      <Text variant="heading" accessibilityRole="header">
        Receipt
      </Text>
      <AmountRows amounts={current} discountLabel={discount} free={order.placed.freeDelivery != null} />
      <Text variant="caption" color="muted">
        {hstNumber ? `HST registration no. ${hstNumber}` : 'HST registration number available from support.'}
      </Text>
      <Divider />
      <Row label="Total" value={formatMoney(current.totalCents)} strong />
      {changed ? <Row label="Placed total" value={formatMoney(placed.totalCents)} muted strike /> : null}
      {released > 0 ? <Row label="Released to your card" value={formatMoney(released)} muted /> : null}
      {order.payment.refundedCents > 0 ? (
        <Row label="Refunded" value={formatMoney(order.payment.refundedCents)} muted />
      ) : null}
      <Divider />
      <Row label={card ?? 'Payment'} value={paymentText(order)} muted />
    </Card>
  );
}

function AmountRows({
  amounts,
  discountLabel,
  free,
}: {
  amounts: Amounts;
  discountLabel: string;
  free: boolean;
}) {
  return (
    <View style={styles.rows}>
      <Row label="Items" value={formatMoney(amounts.itemsCents)} />
      {amounts.discountCents > 0 ? (
        <Row label={discountLabel} value={`−${formatMoney(amounts.discountCents)}`} />
      ) : null}
      <Row
        label="Delivery"
        value={
          amounts.deliveryFeeCents > 0
            ? formatMoney(amounts.deliveryFeeCents)
            : free
              ? 'Free'
              : formatMoney(0)
        }
      />
      {amounts.unloadFeeCents > 0 ? (
        <Row label="Labourer" value={formatMoney(amounts.unloadFeeCents)} />
      ) : null}
      <Row label="HST 13 %" value={formatMoney(amounts.taxCents)} />
    </View>
  );
}

function Row({
  label,
  value,
  strong = false,
  muted = false,
  strike = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
  strike?: boolean;
}) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant={strong ? 'heading' : 'body'} color={muted ? 'muted' : 'default'} style={styles.label}>
        {label}
      </Text>
      <Text
        variant={strong ? 'heading' : 'bodyMedium'}
        color={strong ? 'primaryDark' : muted ? 'muted' : 'default'}
        style={strike ? styles.strike : null}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  label: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  rows: { gap: spacing.sm },
  strike: { textDecorationLine: 'line-through' },
});
