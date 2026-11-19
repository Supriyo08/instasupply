import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { Icon, Text, type IconName } from '@/components/ui';
import { colors, radius } from '@/theme/tokens';

/** Small tinted pill button for card actions (Edit, Set as default, Delete). */
export function ActionChip({
  icon,
  label,
  onPress,
  danger = false,
  busy = false,
  disabled = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
  busy?: boolean;
  disabled?: boolean;
}) {
  const tint = danger ? colors.danger : colors.primaryDark;
  const inactive = busy || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy, disabled: inactive }}
      disabled={inactive}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: danger ? colors.dangerSoft : colors.primarySoft },
        disabled ? styles.disabled : null,
        pressed ? styles.pressed : null,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={tint} /> : <Icon name={icon} size={15} color={tint} />}
      <Text variant="captionMedium" style={{ color: tint }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
});
