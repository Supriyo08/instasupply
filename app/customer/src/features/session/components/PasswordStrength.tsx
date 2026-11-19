import { isStrongPassword } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

const LEVELS = {
  1: { label: 'Weak', color: colors.danger },
  2: { label: 'Good', color: colors.warning },
  3: { label: 'Strong', color: colors.primary },
} as const;

type Level = keyof typeof LEVELS;

/** "Weak" until the password passes the shared rule; "Strong" for long or varied passwords. */
function levelOf(password: string): Level {
  if (!isStrongPassword(password).ok) return 1;
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  return password.length >= 12 || variety >= 3 ? 3 : 2;
}

/** Three-bar strength meter shown under the new-password field. */
export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const level = levelOf(password);
  const { label, color } = LEVELS[level];
  return (
    <View style={styles.row} accessible accessibilityLabel={`Password strength: ${label}`}>
      <View style={styles.bars}>
        {([1, 2, 3] as const).map((bar) => (
          <View key={bar} style={[styles.bar, { backgroundColor: bar <= level ? color : colors.border }]} />
        ))}
      </View>
      <Text variant="micro" style={[styles.label, { color }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderRadius: 2, flex: 1, height: 4 },
  bars: { flex: 1, flexDirection: 'row', gap: spacing.xs },
  label: { minWidth: 44, textAlign: 'right' },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, marginTop: -spacing.sm },
});
