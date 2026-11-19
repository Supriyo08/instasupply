import { initials } from '@instasupply/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { colors, gradient, spacing } from '@/theme/tokens';

/** Delivery partner: first name and vehicle only (the public tracking view carries no other PII). */
export function DriverRow({ name, vehicle }: { name: string; vehicle: string | null }) {
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`Your delivery partner is ${name}${vehicle ? `, ${vehicle}` : ''}`}
    >
      <LinearGradient
        colors={gradient.colors}
        start={gradient.start}
        end={gradient.end}
        style={styles.avatar}
      >
        <Text variant="heading" color="white">
          {initials(name)}
        </Text>
      </LinearGradient>
      <View style={styles.text}>
        <Text variant="bodyMedium" numberOfLines={1}>
          {name}
        </Text>
        <Text variant="caption" color="muted" numberOfLines={1}>
          {vehicle ? `Delivery partner · ${vehicle}` : 'Your delivery partner'}
        </Text>
      </View>
      <View style={styles.vehicle}>
        <Icon name="truck" size={18} color={colors.primary} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', borderRadius: 22, height: 44, justifyContent: 'center', width: 44 },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  text: { flex: 1 },
  vehicle: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
});
