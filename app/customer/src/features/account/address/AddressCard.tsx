import { formatAddress, type Address } from '@instasupply/shared';
import { LayoutAnimation, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Badge, Icon, Text } from '@/components/ui';
import { colors, radius } from '@/theme/tokens';

import { ActionChip } from '../ActionChip';
import { displayPhone } from '../format';
import { labelIcon } from './address-form';

export type AddressBusy = 'default' | 'delete' | null;

/** Big Cart address card: pin on a soft green circle, recipient, address, phone; expands to actions. */
export function AddressCard({
  address,
  expanded,
  busy,
  onToggle,
  onEdit,
  onMakeDefault,
  onDelete,
}: {
  address: Address;
  expanded: boolean;
  /** Which action is running for this card, if any. */
  busy: AddressBusy;
  onToggle: () => void;
  onEdit: () => void;
  onMakeDefault: () => void;
  onDelete: () => void;
}) {
  const toggle = () => {
    if (Platform.OS !== 'web') LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onToggle();
  };
  return (
    <View style={[styles.card, address.isDefault ? styles.cardDefault : null]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${address.label}${address.isDefault ? ', default' : ''}: ${address.name}, ${formatAddress(address)}`}
        accessibilityHint={expanded ? 'Hides the address actions' : 'Shows edit, default and delete actions'}
        accessibilityState={{ expanded }}
        onPress={toggle}
        style={styles.main}
      >
        <View style={styles.pinRing}>
          <View style={styles.pin}>
            <Icon name="map-pin" size={20} color={colors.primary} />
          </View>
        </View>
        <View style={styles.body}>
          <View style={styles.titleRow}>
            {address.isDefault ? <Badge label="Default" /> : null}
            <View style={styles.label}>
              <Icon name={labelIcon(address.label)} size={12} color={colors.textMuted} />
              <Text variant="micro" color="muted">
                {address.label}
              </Text>
            </View>
          </View>
          <Text variant="subheading" numberOfLines={1}>
            {address.name}
          </Text>
          <Text variant="caption" color="muted" numberOfLines={expanded ? undefined : 2}>
            {formatAddress(address)}
          </Text>
          {expanded && address.landmark ? (
            <Text variant="caption" color="muted">
              Landmark: {address.landmark}
            </Text>
          ) : null}
          <Text variant="captionMedium">{displayPhone(address.phone)}</Text>
        </View>
        <View style={[styles.chevron, expanded ? styles.chevronOpen : null]}>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.primary} />
        </View>
      </Pressable>
      {expanded ? (
        <View style={styles.actions}>
          <ActionChip icon="edit-2" label="Edit" onPress={onEdit} disabled={!!busy} />
          {address.isDefault ? null : (
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
            label="Delete"
            onPress={onDelete}
            danger
            busy={busy === 'delete'}
            disabled={busy === 'default'}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  body: { flex: 1, gap: 2 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  cardDefault: { borderColor: colors.primaryLight },
  chevron: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  chevronOpen: { backgroundColor: colors.primaryTint },
  label: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  main: { alignItems: 'center', flexDirection: 'row', gap: 14, padding: 14 },
  pin: {
    alignItems: 'center',
    backgroundColor: colors.primaryTint,
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  pinRing: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.primarySoft,
    borderRadius: 30,
    height: 60,
    justifyContent: 'center',
    width: 60,
  },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginBottom: 2 },
});
