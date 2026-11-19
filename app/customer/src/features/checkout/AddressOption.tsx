import { formatAddress, type Address } from '@instasupply/shared';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge, Icon, Text, type IconName } from '@/components/ui';
import { colors, radius } from '@/theme/tokens';

const LABEL_ICONS: Record<string, IconName> = { home: 'home', work: 'briefcase', office: 'briefcase' };

/** Round radio indicator shared by the selectable checkout cards. */
export function RadioMark({ checked }: { checked: boolean }) {
  return (
    <View style={[styles.radio, { borderColor: checked ? colors.primary : colors.border }]}>
      {checked ? <View style={styles.radioDot} /> : null}
    </View>
  );
}

/** Selectable saved address (Big Cart "My Address" card): label chip, name, address, phone. */
export const AddressOption = memo(function AddressOption({
  address,
  selected,
  onSelect,
}: {
  address: Address;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const icon = LABEL_ICONS[address.label.trim().toLowerCase()] ?? 'map-pin';
  const oneLine = formatAddress(address);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${address.label}${address.isDefault ? ', default' : ''}. ${address.name}, ${oneLine}. Phone ${address.phone}`}
      onPress={() => onSelect(address.id)}
      style={({ pressed }) => [
        styles.card,
        { borderColor: selected ? colors.primary : colors.surface, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: selected ? colors.primary : colors.primarySoft }]}>
        <Icon name={icon} size={18} color={selected ? colors.white : colors.primary} />
      </View>
      <View style={styles.info}>
        <View style={styles.tags}>
          <View style={styles.chip}>
            <Text variant="micro" color="muted" style={styles.chipText} numberOfLines={1}>
              {address.label}
            </Text>
          </View>
          {address.isDefault ? <Badge label="Default" tone="brand" /> : null}
        </View>
        <Text variant="bodyMedium" numberOfLines={1}>
          {address.name}
        </Text>
        <Text variant="caption" color="muted" numberOfLines={2}>
          {oneLine}
        </Text>
        {address.landmark ? (
          <Text variant="caption" color="subtle" numberOfLines={1}>
            Near {address.landmark}
          </Text>
        ) : null}
        <View style={styles.phone}>
          <Icon name="phone" size={12} color={colors.textMuted} />
          <Text variant="caption" color="muted">
            {address.phone}
          </Text>
        </View>
      </View>
      <RadioMark checked={selected} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 14,
    padding: 14,
  },
  chip: {
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    maxWidth: 140,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  chipText: { letterSpacing: 0.3, textTransform: 'uppercase' },
  icon: { alignItems: 'center', borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  info: { flex: 1, gap: 2 },
  phone: { alignItems: 'center', flexDirection: 'row', gap: 6, marginTop: 2 },
  radio: {
    alignItems: 'center',
    borderRadius: 11,
    borderWidth: 1.5,
    height: 22,
    justifyContent: 'center',
    marginTop: 9,
    width: 22,
  },
  radioDot: { backgroundColor: colors.primary, borderRadius: 6, height: 12, width: 12 },
  tags: { alignItems: 'center', flexDirection: 'row', gap: 6, marginBottom: 2 },
});
