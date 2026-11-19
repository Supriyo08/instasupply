import { StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

/** The code the driver asks for at the door, shown big like the design's OTP boxes. */
export function HandoffCodeCard({ code }: { code: string }) {
  const digits = code.replace(/\s/g, '').split('');
  // Codes are 4 digits today; longer ones get narrower boxes so they stay on one line.
  const compact = digits.length > 4;
  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={`Hand-off code ${digits.join(' ')}. Share this code with your delivery partner when you receive your order.`}
    >
      <View style={styles.header}>
        <View style={styles.icon}>
          <Icon name="shield" size={18} color={colors.primary} />
        </View>
        <View style={styles.headerText}>
          <Text variant="heading">Hand-off code</Text>
          <Text variant="caption" color="muted">
            Share this code with your delivery partner
          </Text>
        </View>
      </View>
      <View style={styles.digits}>
        {digits.map((digit, index) => (
          <View key={index} style={[styles.digit, compact ? styles.digitCompact : null]}>
            <Text variant={compact ? 'title' : 'display'} style={styles.digitText}>
              {digit}
            </Text>
          </View>
        ))}
      </View>
      <Text variant="caption" color="muted" align="center">
        Only share it once your groceries are in your hands.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primaryLight,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.lg,
  },
  digit: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.primaryLight,
    borderRadius: radius.md,
    borderWidth: 1.5,
    height: 62,
    justifyContent: 'center',
    width: 54,
  },
  digitCompact: { height: 52, width: 38 },
  digitText: { color: colors.primaryDark },
  digits: { flexDirection: 'row', gap: spacing.sm + 2, justifyContent: 'center' },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  headerText: { flex: 1 },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
});
