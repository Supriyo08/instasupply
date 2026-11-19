import { formatAddress, type Address } from '@instasupply/shared';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { colors, radius } from '@/theme/tokens';

/** "Delivering to" recap on the payment step, with a link back to change it. */
export function DeliveryAddressCard({ address, onChange }: { address: Address; onChange: () => void }) {
  return (
    <View style={styles.card}>
      <View style={styles.icon}>
        <Icon name="map-pin" size={18} color={colors.primary} />
      </View>
      <View style={styles.info}>
        <Text variant="micro" color="muted" style={styles.caps} numberOfLines={1}>
          Delivering to · {address.label}
        </Text>
        <Text variant="bodyMedium" numberOfLines={1}>
          {address.name}
        </Text>
        <Text variant="caption" color="muted" numberOfLines={2}>
          {formatAddress(address)}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Change delivery address"
        hitSlop={10}
        onPress={onChange}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Text variant="captionMedium" color="primary">
          Change
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  caps: { letterSpacing: 0.5, textTransform: 'uppercase' },
  card: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: 14,
    padding: 14,
  },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  info: { flex: 1, gap: 1 },
});
