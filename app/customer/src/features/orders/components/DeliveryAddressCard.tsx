import { formatAddress, type AddressFields } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Badge, Card, Icon, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

/** Delivery address in the "My Address" card style: pin on a pale-green circle, name, lines, phone. */
export function DeliveryAddressCard({ address, notes }: { address: AddressFields; notes: string | null }) {
  const line = formatAddress(address);
  return (
    <Card style={styles.card}>
      <Text variant="heading">Delivery address</Text>
      <View
        style={styles.row}
        accessible
        accessibilityLabel={`Delivering to ${address.name}, ${line}. Phone ${address.phone}`}
      >
        <View style={styles.icon}>
          <Icon name="map-pin" size={22} color={colors.primary} />
        </View>
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text variant="bodyMedium" numberOfLines={1} style={styles.name}>
              {address.name}
            </Text>
            <Badge label={address.label} tone="brand" />
          </View>
          <Text variant="caption" color="muted">
            {line}
          </Text>
          {address.landmark ? (
            <Text variant="caption" color="muted">
              Landmark: {address.landmark}
            </Text>
          ) : null}
          <Text variant="captionMedium">{address.phone}</Text>
        </View>
      </View>
      {notes ? (
        <View style={styles.notes}>
          <Icon name="message-square" size={16} color={colors.textMuted} />
          <Text variant="caption" color="muted" style={styles.flex}>
            {notes}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 14 },
  flex: { flex: 1 },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 26,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  info: { flex: 1, gap: 2 },
  name: { flexShrink: 1 },
  nameRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  notes: {
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  row: { alignItems: 'center', flexDirection: 'row', gap: 14 },
});
