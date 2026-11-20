import { formatMoney, type StoreOrderLine } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { ArtImage, Badge, Text } from '@/components/ui';
import { useCategoryTint } from '@/features/catalog/hooks';
import { radius, spacing } from '@/theme/tokens';

import { quantityText, shortageText } from '../order-format';

/** The lines of one store order: art, name, quantity × price, and what was shorted. */
export function StoreOrderLines({ lines }: { lines: readonly StoreOrderLine[] }) {
  return (
    <View style={styles.list}>
      {lines.map((line) => (
        <LineRow key={line.lineId} line={line} />
      ))}
    </View>
  );
}

function LineRow({ line }: { line: StoreOrderLine }) {
  const tint = useCategoryTint(line.categoryId);
  const shortage = shortageText(line);
  const quantity = quantityText(line.quantity, line.unit);
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${line.name}, ${quantity} at ${formatMoney(line.unitPriceCents)} each${shortage ? `, ${shortage}` : ''}`}
    >
      <View style={[styles.art, { backgroundColor: tint }]}>
        <ArtImage artKey={line.imageKey} uri={line.imageUrl} size={34} />
      </View>
      <View style={styles.text}>
        <Text variant="bodyMedium" numberOfLines={2}>
          {line.name}
        </Text>
        <Text variant="caption" color="muted">
          {quantity} × {formatMoney(line.unitPriceCents)}
          {line.size ? ` · ${line.size}` : ''}
        </Text>
        {line.kind === 'custom' ? <Badge label="Special order" tone="info" /> : null}
        {shortage ? (
          <Text variant="captionMedium" color="warning">
            {shortage}
          </Text>
        ) : null}
      </View>
      <Text variant="bodyMedium">{formatMoney(line.unitPriceCents * line.fulfilledQty)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  art: { alignItems: 'center', borderRadius: radius.lg, height: 46, justifyContent: 'center', width: 46 },
  list: { gap: spacing.md },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md },
  text: { flex: 1, gap: 2 },
});
