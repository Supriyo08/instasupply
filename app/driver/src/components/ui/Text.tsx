import { Text as NativeText, type TextProps as NativeTextProps } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import type { Palette, TypographyVariant } from '@/theme/tokens';

type ColorName = 'default' | 'muted' | 'subtle' | 'primary' | 'danger' | 'success' | 'warning' | 'inverse';

export interface TextProps extends NativeTextProps {
  variant?: TypographyVariant;
  color?: ColorName;
  align?: 'left' | 'center' | 'right';
}

const colorFor = (palette: Palette, color: ColorName) =>
  ({
    default: palette.text,
    muted: palette.textMuted,
    subtle: palette.textSubtle,
    primary: palette.primary,
    danger: palette.danger,
    success: palette.success,
    warning: palette.warning,
    inverse: palette.textInverse,
  })[color];

export function Text({ variant = 'body', color = 'default', align, style, ...props }: TextProps) {
  const theme = useTheme();
  return (
    <NativeText
      {...props}
      style={[theme.typography[variant], { color: colorFor(theme.colors, color), textAlign: align }, style]}
    />
  );
}
