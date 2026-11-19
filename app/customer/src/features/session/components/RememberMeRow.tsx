import { Platform, Pressable, StyleSheet, Switch, View } from 'react-native';

import { Text } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

// Same look as the UI kit Toggle, plus react-native-web's `activeThumbColor` (web-only, so it is not
// in the typings): without it the "on" thumb is Material teal on web.
const webThumb = Platform.OS === 'web' ? { activeThumbColor: colors.white } : null;

/** "Remember me" switch on the left, green "Forgot password" link on the right. */
export function RememberMeRow({
  remember,
  onRememberChange,
  onForgotPassword,
}: {
  remember: boolean;
  onRememberChange: (value: boolean) => void;
  onForgotPassword: () => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.remember}>
        <Switch
          accessibilityLabel="Remember me"
          value={remember}
          onValueChange={onRememberChange}
          trackColor={{ true: colors.primary, false: colors.border }}
          thumbColor={Platform.OS === 'ios' ? undefined : colors.white}
          {...webThumb}
        />
        {/* The switch carries the accessible name; the text is just a bigger tap target. */}
        <Text
          variant="caption"
          color="muted"
          accessible={false}
          suppressHighlighting
          onPress={() => onRememberChange(!remember)}
        >
          Remember me
        </Text>
      </View>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Forgot password"
        hitSlop={10}
        onPress={onForgotPassword}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Text variant="captionMedium" color="primary">
          Forgot password
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  remember: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  row: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
});
