import { formatCurrency, type PricedCart } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Divider, Text } from '@/components/ui';

/** Subtotal / shipping / discount / total block (cart and checkout). */
export function PriceSummary({ priced }: { priced: PricedCart }) {
  const row = (label: string, value: string, tone?: 'primaryDark') => (
    <View style={styles.row}>
      <Text variant="caption" color="muted">
        {label}
      </Text>
      <Text variant="caption" color={tone ?? 'muted'}>
        {value}
      </Text>
    </View>
  );
  return (
    <View style={styles.box}>
      {row('Subtotal', formatCurrency(priced.subtotal))}
      {row(
        'Shipping charges',
        priced.deliveryFee === 0 ? 'Free' : formatCurrency(priced.deliveryFee),
        priced.deliveryFee === 0 ? 'primaryDark' : undefined,
      )}
      {priced.discount > 0
        ? row(
            `Discount${priced.promo ? ` (${priced.promo.code})` : ''}`,
            `−${formatCurrency(priced.discount)}`,
            'primaryDark',
          )
        : null}
      <Divider />
      <View style={styles.row}>
        <Text variant="heading">Total</Text>
        <Text variant="heading">{formatCurrency(priced.total)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  row: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
});
