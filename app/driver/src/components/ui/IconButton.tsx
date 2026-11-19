import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface IconButtonProps {
  icon: IconName;
  label: string;
  onPress?: () => void;
  badge?: number;
  tone?: 'default' | 'primary' | 'success';
  size?: number;
}

export function IconButton({ icon, label, onPress, badge, tone = 'default', size = 44 }: IconButtonProps) {
  const { colors } = useTheme();
  const background =
    tone === 'primary' ? colors.primarySoft : tone === 'success' ? colors.successSoft : colors.surface;
  const foreground = tone === 'primary' ? colors.primary : tone === 'success' ? colors.success : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.button,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: background,
          borderColor: colors.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Icon name={icon} size={size * 0.45} color={foreground} />
      {badge ? (
        <View style={[styles.badge, { backgroundColor: colors.danger, borderColor: colors.background }]}>
          <Text variant="micro" style={{ color: '#FFFFFF' }}>
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
    borderRadius: 10,
    borderWidth: 2,
    justifyContent: 'center',
    minWidth: 20,
    paddingHorizontal: 4,
    position: 'absolute',
    right: -4,
    top: -4,
  },
  button: { alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
});
