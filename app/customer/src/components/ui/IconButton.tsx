import { Pressable, StyleSheet, View } from 'react-native';

import { colors } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export function IconButton({
  icon,
  label,
  onPress,
  color = colors.text,
  background = 'transparent',
  size = 40,
  badge,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  color?: string;
  background?: string;
  size?: number;
  badge?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: background,
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      <Icon name={icon} size={Math.round(size * 0.5)} color={color} />
      {badge ? (
        <View style={styles.badge}>
          <Text variant="micro" color="white">
            {badge > 99 ? '99+' : badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderColor: colors.surface,
    borderRadius: 9,
    borderWidth: 1.5,
    justifyContent: 'center',
    minWidth: 18,
    paddingHorizontal: 3,
    position: 'absolute',
    right: -2,
    top: -2,
  },
  button: { alignItems: 'center', justifyContent: 'center' },
});
