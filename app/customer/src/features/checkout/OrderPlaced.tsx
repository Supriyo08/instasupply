import {
  formatClockET,
  formatDateTimeET,
  formatDayET,
  formatMoney,
  windowLabel,
  type Order,
  type StoreOrderSummary,
} from '@instasupply/shared';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon, Notice, Text } from '@/components/ui';
import { CARD_BRAND_LABEL } from '@/features/account/card/card-format';
import { usePushPermission } from '@/features/account/usePushPermission';
import { colors, spacing } from '@/theme/tokens';

/** "Delivery by 1:50 pm", "Tomorrow, 7–9 am", "Ready 12:40 pm" for one store order. */
export function storePromise(order: Order, summary: StoreOrderSummary, now: number): string {
  if (summary.fulfilment === 'pickup') {
    return summary.readyAt != null ? `Ready ${formatDateTimeET(summary.readyAt, now)}` : 'Ready time to come';
  }
  if (order.window?.kind === 'scheduled') return windowLabel(order.window, now);
  if (summary.deliverBy != null)
    return `${formatDayET(summary.deliverBy, now)} by ${formatClockET(summary.deliverBy)}`;
  return 'Delivery time to come';
}

/** "Card held · $388.25 on Visa ••4242", or "Paid", "No charge" (MARKETPLACE §3.8 customer copy). */
export function paymentLine(order: Order): string {
  const { payment } = order;
  const card = payment.card ? ` on ${CARD_BRAND_LABEL[payment.card.brand]} ••${payment.card.last4}` : '';
  switch (payment.status) {
    case 'captured':
    case 'partially_refunded':
      return `Paid ${formatMoney(payment.capturedCents)}${card}`;
    case 'voided':
    case 'not_required':
      return 'No charge';
    case 'refunded':
      return `Refunded ${formatMoney(payment.refundedCents)}${card}`;
    default:
      return `Card held · ${formatMoney(payment.authorizedCents || order.placed.totalCents)}${card}`;
  }
}

/** One row per store order: letter, store, items and its promise. */
export function StorePromiseRows({ order, now }: { order: Order; now: number }) {
  return (
    <View style={styles.rows}>
      {order.storeOrders.map((summary) => {
        const promise = storePromise(order, summary, now);
        return (
          <View
            key={summary.storeOrderId}
            style={styles.row}
            accessible
            accessibilityLabel={`${summary.number}, ${summary.storeName}: ${promise}`}
          >
            <View style={styles.letter}>
              <Text variant="captionMedium" color="primaryDark">
                {summary.letter}
              </Text>
            </View>
            <View style={styles.flex}>
              <Text variant="bodyMedium">{summary.storeName}</Text>
              <Text variant="caption" color="muted" numberOfLines={1}>
                {summary.itemsSummary}
              </Text>
            </View>
            <View style={styles.promise}>
              <Icon
                name={summary.fulfilment === 'pickup' ? 'shopping-bag' : 'truck'}
                size={14}
                color={colors.primaryDark}
              />
              <Text variant="captionMedium" color="primaryDark">
                {promise}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** "Get delivery updates": the one place the app asks for push permission after an order (CLIENTS §6.2). */
export function GetUpdatesCard() {
  const { status, enable } = usePushPermission();
  const [busy, setBusy] = useState(false);
  if (status === 'granted' || status === 'checking') return null;
  if (status === 'unsupported') {
    return (
      <Notice
        tone="info"
        icon="bell"
        message="Push alerts aren't set up in this build. Updates appear in your inbox."
      />
    );
  }
  return (
    <Notice
      tone="info"
      icon="bell"
      title="Get delivery updates"
      message={
        status === 'blocked'
          ? 'Notifications are off for InstaSupply. Turn them on in Settings to hear when each store confirms and when your driver is on the way.'
          : 'Hear when each store confirms and when your driver is on the way.'
      }
      actionLabel={busy ? undefined : status === 'blocked' ? 'Settings' : 'Turn on'}
      onAction={() => {
        setBusy(true);
        void enable().finally(() => setBusy(false));
      }}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  letter: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  promise: { alignItems: 'center', flexDirection: 'row', flexShrink: 1, gap: spacing.xs, maxWidth: '45%' },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  rows: { gap: spacing.md },
});
