import { formatFee, formatMoney, type AppliedDiscount, type Amounts } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Divider, Text } from '@/components/ui';
import { spacing } from '@/theme/tokens';

function Row({
  label,
  value,
  struck,
  strong,
  highlight,
}: {
  label: string;
  value: string;
  struck?: string | null;
  strong?: boolean;
  highlight?: boolean;
}) {
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={struck ? `${label}: ${struck}, now ${value}` : `${label}: ${value}`}
    >
      <Text variant={strong ? 'heading' : 'body'} color={strong ? 'default' : 'muted'} style={styles.label}>
        {label}
      </Text>
      <View style={styles.values}>
        {struck ? (
          <Text color="subtle" style={styles.struck}>
            {struck}
          </Text>
        ) : null}
        <Text variant={strong ? 'heading' : 'bodyMedium'} color={highlight ? 'primaryDark' : 'default'}>
          {value}
        </Text>
      </View>
    </View>
  );
}

/**
 * Items, delivery (struck list fee when waived), labourer, discount, HST 13 % and total. The order
 * totals in the cart and at checkout, and each store's summary at checkout.
 */
export function AmountRows({
  amounts,
  delivery,
  deliveryListCents = null,
  discounts = [],
  totalLabel = 'Total',
}: {
  amounts: Amounts;
  delivery: boolean;
  /** The fee before the waiver, struck through when higher than what is charged. */
  deliveryListCents?: number | null;
  discounts?: readonly AppliedDiscount[];
  totalLabel?: string;
}) {
  const struck =
    deliveryListCents != null && deliveryListCents > amounts.deliveryFeeCents
      ? formatMoney(deliveryListCents)
      : null;
  const discountLabel = discounts.length === 1 && discounts[0] ? discounts[0].label : 'Discount';
  return (
    <View style={styles.rows}>
      <Row label="Items" value={formatMoney(amounts.itemsCents)} />
      {delivery ? (
        <Row
          label="Delivery"
          value={formatFee(amounts.deliveryFeeCents)}
          struck={struck}
          highlight={amounts.deliveryFeeCents === 0}
        />
      ) : null}
      {amounts.unloadFeeCents > 0 ? (
        <Row label="Labourer" value={formatMoney(amounts.unloadFeeCents)} />
      ) : null}
      {amounts.discountCents > 0 ? (
        <Row label={discountLabel} value={`-${formatMoney(amounts.discountCents)}`} highlight />
      ) : null}
      <Row label="HST 13%" value={formatMoney(amounts.taxCents)} />
      <Divider />
      <Row label={totalLabel} value={formatMoney(amounts.totalCents)} strong />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  rows: { gap: spacing.sm },
  struck: { textDecorationLine: 'line-through' },
  values: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
});
