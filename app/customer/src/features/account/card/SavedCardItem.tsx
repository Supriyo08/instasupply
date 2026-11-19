import type { SavedCard } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Icon, Text, type IconName } from '@/components/ui';
import { colors, radius } from '@/theme/tokens';

import { ActionChip } from '../ActionChip';
import { describeCard, expiryLabel, isCardExpired, maskedCardNumber } from './card-format';
import { CardVisual } from './CardVisual';

export type CardBusy = 'default' | 'delete' | null;

/** White pill on the card face ("Default" / "Expired"). */
function Pill({ icon, label, danger }: { icon: IconName; label: string; danger?: boolean }) {
  const tint = danger ? colors.danger : colors.primaryDark;
  return (
    <View style={styles.pill}>
      <Icon name={icon} size={11} color={tint} />
      <Text variant="micro" style={[styles.pillText, { color: tint }]}>
        {label}
      </Text>
    </View>
  );
}

/** A saved card: the green card art plus a bar with its default status and actions. */
export function SavedCardItem({
  card,
  busy,
  onMakeDefault,
  onDelete,
}: {
  card: SavedCard;
  busy: CardBusy;
  onMakeDefault: () => void;
  onDelete: () => void;
}) {
  const expiry = expiryLabel(card.expMonth, card.expYear);
  const expired = isCardExpired(card);
  const label = [
    describeCard(card.brand, card.last4, expiry),
    card.isDefault ? 'default card' : null,
    expired ? 'expired' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={styles.item}>
      <CardVisual
        brand={card.brand}
        number={maskedCardNumber(card.last4)}
        holder={card.holder}
        expiry={expiry}
        dimmed={expired}
        accessibilityLabel={label}
        badge={
          expired ? (
            <Pill icon="alert-circle" label="Expired" danger />
          ) : card.isDefault ? (
            <Pill icon="check" label="Default" />
          ) : null
        }
      />
      <View style={styles.bar}>
        {card.isDefault ? (
          <View style={styles.status}>
            <Icon name="check-circle" size={16} color={colors.primary} />
            <Text variant="captionMedium" color="primary">
              Default for checkout
            </Text>
          </View>
        ) : expired ? (
          <Text variant="caption" color="danger" style={styles.status}>
            Expired. Remove it or add a new card.
          </Text>
        ) : (
          <ActionChip
            icon="check-circle"
            label="Set as default"
            onPress={onMakeDefault}
            busy={busy === 'default'}
            disabled={busy === 'delete'}
          />
        )}
        <ActionChip
          icon="trash-2"
          label="Remove"
          danger
          onPress={onDelete}
          busy={busy === 'delete'}
          disabled={busy === 'default'}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    maxWidth: 420,
    paddingHorizontal: 12,
    paddingVertical: 10,
    width: '100%',
  },
  item: { gap: 12 },
  pill: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  pillText: { letterSpacing: 0.3, textTransform: 'uppercase' },
  status: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 6 },
});
