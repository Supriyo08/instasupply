import {
  formatDateTimeET,
  formatMoney,
  type LedgerEntry,
  type LedgerKind,
  type Payout,
} from '@instasupply/shared';
import type { WithId } from '@instasupply/api-client';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge, Icon, Skeleton, Text } from '@/components/ui';
import { useDelivery } from '@/features/deliveries/hooks';
import { useTheme } from '@/theme/ThemeProvider';

const KIND_LABELS: Record<LedgerKind, string> = {
  delivery: 'Delivery',
  failed_attempt: 'Failed attempt',
  cancellation: 'Cancellation',
  clawback: 'Clawback',
  adjustment: 'Adjustment',
  sale: 'Sale',
  commission: 'Commission',
};

/** "+$47.75" for credits, "−$12.00" for debits. */
export function signedMoney(cents: number): string {
  return cents < 0 ? `−${formatMoney(-cents)}` : `+${formatMoney(cents)}`;
}

/**
 * One ledger entry. A delivery entry opens to show its parts from `delivery.payout`: the offer, the
 * wait at the store and the boost (MARKETPLACE §10, §3.10).
 */
export function EntryRow({ entry, now }: { entry: WithId<LedgerEntry>; now: number }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const expandable = entry.kind === 'delivery' && entry.deliveryId != null;
  const kind = KIND_LABELS[entry.kind] ?? entry.kind;
  const held = entry.heldForIssueId != null;
  const amount = signedMoney(entry.amountCents);
  const content = (
    <View style={styles.row}>
      <View style={styles.flex}>
        <View style={styles.kindRow}>
          <Text variant="bodyStrong">{kind}</Text>
          {held ? <Badge label="On hold" tone="warning" /> : null}
          {entry.payoutId ? <Badge label="Paid" tone="success" /> : null}
        </View>
        <Text variant="caption" color="muted" numberOfLines={2}>
          {entry.description}
        </Text>
        <Text variant="caption" color="subtle">
          {formatDateTimeET(entry.createdAt, now)}
        </Text>
      </View>
      <Text variant="bodyStrong" color={entry.amountCents < 0 ? 'danger' : 'success'}>
        {amount}
      </Text>
      {expandable ? (
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSubtle} />
      ) : null}
    </View>
  );
  const label = `${kind}, ${amount}, ${entry.description}${held ? ', on hold while an issue is open' : ''}`;
  if (!expandable) {
    return (
      <View accessible accessibilityLabel={label} style={[styles.item, { borderBottomColor: colors.border }]}>
        {content}
      </View>
    );
  }
  return (
    <View style={[styles.item, { borderBottomColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={open ? 'Hides the breakdown' : 'Shows the breakdown'}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
      >
        {content}
      </Pressable>
      {open && entry.deliveryId ? <PayoutParts deliveryId={entry.deliveryId} /> : null}
    </View>
  );
}

function PayoutParts({ deliveryId }: { deliveryId: string }) {
  const delivery = useDelivery(deliveryId);
  const payout = delivery.data?.payout ?? null;
  if (delivery.loading) return <Skeleton height={60} style={styles.parts} />;
  if (!payout) {
    return (
      <Text variant="caption" color="subtle" style={styles.parts}>
        No breakdown for this delivery.
      </Text>
    );
  }
  const parts = [
    { label: 'Offer', cents: payout.offerCents },
    { label: 'Wait at the store', cents: payout.waitCents },
    { label: 'Boost', cents: payout.boostCents },
  ];
  return (
    <View style={styles.parts}>
      {delivery.data ? (
        <Text variant="caption" color="muted">
          {delivery.data.orderId} · {delivery.data.pickup?.storeName ?? 'Manual delivery'}
        </Text>
      ) : null}
      {parts.map((part) => (
        <View key={part.label} style={styles.partRow}>
          <Text variant="caption" color="muted">
            {part.label}
          </Text>
          <Text variant="caption">{formatMoney(part.cents)}</Text>
        </View>
      ))}
      <View style={styles.partRow}>
        <Text variant="caption" style={styles.bold}>
          Total
        </Text>
        <Text variant="caption" style={styles.bold}>
          {formatMoney(payout.totalCents)}
        </Text>
      </View>
    </View>
  );
}

const PAYOUT_STATUS = {
  pending: { label: 'Sending', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
} as const;

/** One daily payout with its reference (MARKETPLACE §3.9). */
export function PayoutRow({ payout, now }: { payout: WithId<Payout>; now: number }) {
  const { colors } = useTheme();
  const status = PAYOUT_STATUS[payout.status];
  return (
    <View
      accessible
      accessibilityLabel={`Payout for ${payout.periodDate}, ${formatMoney(payout.netCents)}, ${status.label}${payout.reference ? `, reference ${payout.reference}` : ''}`}
      style={[styles.item, { borderBottomColor: colors.border }]}
    >
      <View style={styles.row}>
        <View style={styles.flex}>
          <View style={styles.kindRow}>
            <Text variant="bodyStrong">{payout.periodDate}</Text>
            <Badge label={status.label} tone={status.tone} />
          </View>
          <Text variant="caption" color="muted">
            {payout.entryCount} {payout.entryCount === 1 ? 'entry' : 'entries'}
            {payout.debitsCents !== 0
              ? ` · ${formatMoney(payout.creditsCents)} less ${formatMoney(Math.abs(payout.debitsCents))}`
              : ''}
          </Text>
          <Text variant="caption" color="subtle" selectable>
            {payout.reference ? `Ref. ${payout.reference}` : 'Reference pending'}
            {payout.paidAt ? ` · ${formatDateTimeET(payout.paidAt, now)}` : ''}
          </Text>
        </View>
        <Text variant="heading">{formatMoney(payout.netCents)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bold: { fontWeight: '700' },
  flex: { flex: 1, gap: 2 },
  item: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 12 },
  kindRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  partRow: { flexDirection: 'row', justifyContent: 'space-between' },
  parts: { gap: 4, marginLeft: 4, marginTop: 8 },
  row: { alignItems: 'center', flexDirection: 'row', gap: 10 },
});
