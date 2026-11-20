import type { StoreOrderLine } from '@instasupply/shared';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, QuantityStepper, Text } from '@/components/ui';
import { quantityText } from '@/features/orders/order-format';
import { colors, radius, spacing } from '@/theme/tokens';

/**
 * Which items have a problem, and how many: a line can be chosen when something of it was supplied
 * (`fulfilledQty`), with a quantity from 1 to that.
 */
export function IssueLinePicker({
  lines,
  chosen,
  onChange,
}: {
  lines: readonly StoreOrderLine[];
  chosen: Readonly<Record<string, number>>;
  onChange: (next: Record<string, number>) => void;
}) {
  return (
    <View style={styles.list}>
      {lines.map((line) => {
        const supplied = line.fulfilledQty;
        const quantity = chosen[line.lineId];
        const selected = quantity !== undefined;
        const disabled = supplied < 1;
        const toggle = () => {
          const next = { ...chosen };
          if (selected) delete next[line.lineId];
          else next[line.lineId] = supplied;
          onChange(next);
        };
        return (
          <View key={line.lineId} style={[styles.row, selected ? styles.selected : null]}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected, disabled }}
              accessibilityLabel={`${line.name}, ${quantityText(supplied, line.unit)} supplied`}
              disabled={disabled}
              onPress={toggle}
              style={styles.check}
              hitSlop={6}
            >
              <View style={[styles.box, selected ? styles.boxOn : null]}>
                {selected ? <Icon name="check" size={14} color={colors.white} /> : null}
              </View>
              <View style={styles.text}>
                <Text variant="bodyMedium" numberOfLines={2} color={disabled ? 'subtle' : 'default'}>
                  {line.name}
                </Text>
                <Text variant="caption" color="muted">
                  {disabled ? 'Not supplied, not charged' : `${quantityText(supplied, line.unit)} supplied`}
                </Text>
              </View>
            </Pressable>
            {selected && supplied > 1 ? (
              <QuantityStepper
                value={quantity}
                min={1}
                max={supplied}
                label={line.name}
                onChange={(value: number) => onChange({ ...chosen, [line.lineId]: value })}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  check: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing.md },
  list: { gap: spacing.sm },
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  selected: { borderColor: colors.primaryLight },
  text: { flex: 1 },
});
