import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { colors, gradient, radius, shadows } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  /** primary = brand gradient, secondary = white with border, ghost = text only, danger = soft red. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** Icon pinned to the right edge (e.g. the bag on "Add to cart"). */
  trailingIcon?: IconName;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  size?: 'md' | 'lg';
  style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  trailingIcon,
  icon,
  loading = false,
  disabled = false,
  size = 'lg',
  style,
}: ButtonProps) {
  const inactive = disabled || loading;
  const height = size === 'lg' ? 56 : 46;
  const foreground =
    variant === 'primary'
      ? colors.white
      : variant === 'danger'
        ? colors.danger
        : variant === 'ghost'
          ? colors.primary
          : colors.text;

  const content = (
    <View style={[styles.content, { height }]}>
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={18} color={foreground} /> : null}
          <Text variant="subheading" style={{ color: foreground }}>
            {label}
          </Text>
          {trailingIcon ? (
            <Icon name={trailingIcon} size={20} color={foreground} style={styles.trailing} />
          ) : null}
        </>
      )}
    </View>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={() => {
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && !inactive ? shadows.brand : null,
        {
          opacity: inactive ? 0.55 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
          backgroundColor:
            variant === 'secondary'
              ? colors.surface
              : variant === 'danger'
                ? colors.dangerSoft
                : 'transparent',
          borderWidth: variant === 'secondary' ? 1 : 0,
        },
        style,
      ]}
    >
      {variant === 'primary' ? (
        <LinearGradient
          colors={gradient.colors}
          start={gradient.start}
          end={gradient.end}
          style={styles.gradient}
        >
          {content}
        </LinearGradient>
      ) : (
        content
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignSelf: 'stretch', borderColor: colors.border, borderRadius: radius.sm },
  content: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  gradient: { borderRadius: radius.sm },
  trailing: { position: 'absolute', right: 18 },
});
