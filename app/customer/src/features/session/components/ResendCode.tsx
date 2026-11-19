import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

import { formatSeconds } from './motion';

/** "Didn't receive the code? Resend a new code" with the server's resend cooldown. */
export function ResendCode({
  remaining,
  sending,
  onResend,
}: {
  remaining: number;
  sending: boolean;
  onResend: () => void;
}) {
  const waiting = remaining > 0;
  const disabled = waiting || sending;
  return (
    <View style={styles.wrap}>
      <Text color="muted" align="center">
        Didn&apos;t receive the code?
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={waiting ? `Resend a new code in ${remaining} seconds` : 'Resend a new code'}
        accessibilityState={{ disabled, busy: sending }}
        disabled={disabled}
        hitSlop={10}
        onPress={onResend}
        style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
      >
        {sending ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        <Text variant="bodyMedium" color={disabled ? 'subtle' : 'default'}>
          {waiting ? `Resend a new code in ${formatSeconds(remaining)}` : 'Resend a new code'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  action: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  wrap: { alignItems: 'center', gap: spacing.xs },
});
