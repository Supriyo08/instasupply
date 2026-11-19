import { formatCurrency, pluralize, type Order } from '@instasupply/shared';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Divider, Skeleton, Text } from '@/components/ui';
import { colors, radius } from '@/theme/tokens';

function paymentLabel(order: Order) {
  if (order.paymentMethod === 'cod') return 'Cash on delivery';
  return order.card ? `Card •••• ${order.card.last4}` : 'Card (test mode)';
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.row}>
      <Text variant="caption" color="muted">
        {label}
      </Text>
      {children}
    </View>
  );
}

/** Small receipt under the success message: order number now, live total and payment once loaded. */
export function OrderReceipt({
  number,
  order,
  loading,
}: {
  number: string | null;
  order: Order | null;
  loading: boolean;
}) {
  const reference = number ?? order?.number ?? null;
  if (!reference && !order && !loading) return null;
  return (
    <View style={styles.card}>
      <Row label="Order number">
        {reference ? (
          <Text variant="bodyMedium" selectable>
            {reference}
          </Text>
        ) : (
          <Skeleton style={styles.value} />
        )}
      </Row>
      <Divider />
      {order ? (
        <>
          <Row label={pluralize(order.itemCount, 'item')}>
            <Text variant="bodyMedium" color="primaryDark">
              {formatCurrency(order.total)}
            </Text>
          </Row>
          <Row label="Payment">
            <Text variant="bodyMedium">{paymentLabel(order)}</Text>
          </Row>
          <Row label="Deliver to">
            <Text variant="bodyMedium" numberOfLines={1} style={styles.shrink}>
              {order.address.label} · {order.address.city}
            </Text>
          </Row>
        </>
      ) : loading ? (
        <View style={styles.loading}>
          <Skeleton style={styles.line} />
          <Skeleton style={styles.line} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    gap: 12,
    padding: 16,
  },
  line: { height: 14, width: '100%' },
  loading: { gap: 10 },
  row: { alignItems: 'center', flexDirection: 'row', gap: 16, justifyContent: 'space-between' },
  shrink: { flexShrink: 1, textAlign: 'right' },
  value: { height: 16, width: 96 },
});
