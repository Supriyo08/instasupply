import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { colors, radius } from '@/theme/tokens';

/** Dashed "+ Add new address" / "Add card" button. */
export function AddOptionButton({
  label,
  caption,
  onPress,
  style,
}: {
  label: string;
  caption?: string;
  onPress: () => void;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={caption ? `${label}. ${caption}` : label}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { opacity: pressed ? 0.7 : 1 }, style]}
    >
      <View style={styles.plus}>
        <Icon name="plus" size={16} color={colors.primary} />
      </View>
      <View style={styles.copy}>
        <Text variant="bodyMedium" color="primary" align="center">
          {label}
        </Text>
        {caption ? (
          <Text variant="caption" color="muted" align="center">
            {caption}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.primaryLight,
    borderRadius: radius.md,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  copy: { alignItems: 'center' },
  plus: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
});
