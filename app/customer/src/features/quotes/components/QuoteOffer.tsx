import { formatMoney, type QuoteOffer as Offer, type QuoteLine } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Badge, Card, Divider, Notice, Text } from '@/components/ui';
import { quantityText } from '@/features/orders/order-format';
import { spacing } from '@/theme/tokens';

/**
 * A quoted offer: lines by store (special-order lines tagged), what could not be sourced and why, and
 * the totals of the priced snapshot.
 */
export function QuoteOffer({ offer }: { offer: Offer }) {
  const stores = new Map<string, { name: string; lines: QuoteLine[] }>();
  for (const line of offer.lines) {
    const entry = stores.get(line.storeId) ?? { name: line.storeName, lines: [] };
    entry.lines.push(line);
    stores.set(line.storeId, entry);
  }
  const pricing = offer.pricing;
  return (
    <>
      {offer.message ? (
        <Notice tone="info" icon="message-square" title={offer.sentByName} message={offer.message} />
      ) : null}
      {[...stores.entries()].map(([storeId, store]) => {
        const priced = pricing.stores.find((entry) => entry.storeId === storeId);
        return (
          <Card key={storeId} style={styles.card}>
            <View style={styles.row}>
              <Text variant="heading" style={styles.flex}>
                {store.name}
              </Text>
              {priced ? (
                <Text variant="bodyMedium" color="primaryDark">
                  {formatMoney(priced.totalCents)}
                </Text>
              ) : null}
            </View>
            {store.lines.map((line) => (
              <View key={line.lineId} style={styles.line} accessible>
                <View style={styles.flex}>
                  <Text variant="bodyMedium">{line.name}</Text>
                  <Text variant="caption" color="muted">
                    {quantityText(line.quantity, line.unit)} × {formatMoney(line.unitPriceCents)}
                    {line.listPriceCents != null && line.listPriceCents > line.unitPriceCents
                      ? ` (list ${formatMoney(line.listPriceCents)})`
                      : ''}
                    {line.size ? ` · ${line.size}` : ''}
                  </Text>
                  {line.kind === 'custom' ? <Badge label="Special order" tone="info" /> : null}
                  {line.note ? (
                    <Text variant="caption" color="muted">
                      {line.note}
                    </Text>
                  ) : null}
                </View>
                <Text variant="bodyMedium">{formatMoney(line.unitPriceCents * line.quantity)}</Text>
              </View>
            ))}
            {priced && priced.deliveryFeeCents + priced.unloadFeeCents > 0 ? (
              <Text variant="caption" color="muted">
                {priced.deliveryFeeCents > 0 ? `Delivery ${formatMoney(priced.deliveryFeeCents)}` : ''}
                {priced.deliveryFeeCents > 0 && priced.unloadFeeCents > 0 ? ' · ' : ''}
                {priced.unloadFeeCents > 0 ? `Labourer ${formatMoney(priced.unloadFeeCents)}` : ''}
              </Text>
            ) : null}
          </Card>
        );
      })}
      {offer.unmatched.length > 0 ? (
        <Card style={styles.card}>
          <Text variant="heading">Not in this quote</Text>
          {offer.unmatched.map((item) => (
            <View key={`${item.requestLine}-${item.text}`} accessible>
              <Text variant="bodyMedium">{item.text}</Text>
              <Text variant="caption" color="muted">
                {item.reason}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}
      <Card style={styles.card}>
        <Total label="Items" cents={pricing.itemsCents} />
        {pricing.discountCents > 0 ? <Total label="Discount" cents={-pricing.discountCents} /> : null}
        <Total label="Delivery" cents={pricing.deliveryFeeCents} free={pricing.freeDelivery != null} />
        {pricing.unloadFeeCents > 0 ? <Total label="Labourer" cents={pricing.unloadFeeCents} /> : null}
        <Total label="HST 13 %" cents={pricing.taxCents} />
        <Divider />
        <Total label="Total" cents={pricing.totalCents} strong />
        {offer.windowLabel ? (
          <Text variant="caption" color="muted">
            {offer.fulfilment === 'pickup' ? 'Pickup' : 'Delivery'} · {offer.windowLabel}
          </Text>
        ) : null}
      </Card>
    </>
  );
}

function Total({
  label,
  cents,
  strong = false,
  free = false,
}: {
  label: string;
  cents: number;
  strong?: boolean;
  free?: boolean;
}) {
  const value = cents === 0 && free ? 'Free' : cents < 0 ? `−${formatMoney(-cents)}` : formatMoney(cents);
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant={strong ? 'heading' : 'body'} style={styles.flex}>
        {label}
      </Text>
      <Text variant={strong ? 'heading' : 'bodyMedium'} color={strong ? 'primaryDark' : 'default'}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm + 2 },
  flex: { flex: 1, gap: 2 },
  line: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
});
