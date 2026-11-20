import { StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/**
 * A store's promise from `storeAvailability()` ("Delivery by 1:50 pm", "Pickup ready in 25 min",
 * "Opens tomorrow 6:30 am", "Joining InstaSupply"), in the green that marks promises (§7.1).
 * Renders nothing for a null promise.
 */
export function PromiseLabel({ promise, size = 'md' }: { promise: string | null; size?: 'sm' | 'md' }) {
  if (!promise) return null;
  const icon: IconName = promise.startsWith('Delivery')
    ? 'truck'
    : promise.startsWith('Pickup')
      ? 'shopping-bag'
      : 'clock';
  const live = icon !== 'clock';
  return (
    <View style={styles.row}>
      <Icon name={icon} size={size === 'sm' ? 12 : 14} color={live ? colors.primaryDark : colors.textMuted} />
      <Text
        variant={size === 'sm' ? 'micro' : 'captionMedium'}
        color={live ? 'primaryDark' : 'muted'}
        numberOfLines={1}
      >
        {promise}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
});
