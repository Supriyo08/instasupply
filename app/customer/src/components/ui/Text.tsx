import { Text as NativeText, type TextProps as NativeTextProps } from 'react-native';

import { colors, typography, type TypographyVariant } from '@/theme/tokens';

type ColorName = 'default' | 'muted' | 'subtle' | 'primary' | 'primaryDark' | 'danger' | 'white' | 'warning';

const COLOR: Record<ColorName, string> = {
  default: colors.text,
  muted: colors.textMuted,
  subtle: colors.textSubtle,
  primary: colors.primary,
  // The darker brand green, for text on white or the grey canvas (prices) where `primary` is too light.
  primaryDark: colors.primaryDark,
  danger: colors.danger,
  white: colors.white,
  warning: colors.warning,
};

export interface TextProps extends NativeTextProps {
  variant?: TypographyVariant;
  color?: ColorName;
  align?: 'left' | 'center' | 'right';
}

export function Text({ variant = 'body', color = 'default', align, style, ...props }: TextProps) {
  return (
    <NativeText {...props} style={[typography[variant], { color: COLOR[color], textAlign: align }, style]} />
  );
}
