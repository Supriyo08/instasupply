import { describeError } from '@instasupply/expo-firebase';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme/tokens';

import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/**
 * What a screen or list shows when its data failed to load. Laid out like `EmptyState`, with an
 * icon in place of the illustration and always a way to try again: pass the data hook's `error`
 * and `retry`.
 */
export function ErrorState({
  title,
  error,
  message,
  onRetry,
  icon = 'alert-circle',
}: {
  title: string;
  /** What was caught; shown in plain words (`describeError`). */
  error?: unknown;
  /** Shown instead of the text worked out from `error`. */
  message?: string;
  onRetry: () => void;
  icon?: IconName;
}) {
  return (
    <View style={styles.container} accessibilityRole="alert">
      <View style={styles.icon}>
        <Icon name={icon} size={30} color={colors.danger} />
      </View>
      <Text variant="title" align="center">
        {title}
      </Text>
      <Text color="muted" align="center" style={styles.message}>
        {message ?? describeError(error, 'Check your connection and try again.')}
      </Text>
      <View style={styles.action}>
        <Button label="Try again" variant="secondary" icon="refresh-cw" onPress={onRetry} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  action: { alignSelf: 'stretch', marginTop: 12 },
  container: { alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 32 },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.dangerSoft,
    borderRadius: 44,
    height: 88,
    justifyContent: 'center',
    marginBottom: 8,
    width: 88,
  },
  message: { maxWidth: 300 },
});
