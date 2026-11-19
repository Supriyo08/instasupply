import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  style?: ViewStyle | ViewStyle[];
  padded?: boolean;
  accent?: string;
  accessibilityLabel?: string;
}

export function Card({ children, onPress, style, padded = true, accent, accessibilityLabel }: CardProps) {
  const { colors, radius, dark } = useTheme();
  const base: ViewStyle = {
    backgroundColor: colors.surface,
    borderColor: accent ?? colors.border,
    borderRadius: radius.lg,
    borderWidth: accent ? 1.5 : StyleSheet.hairlineWidth,
    padding: padded ? 16 : 0,
    shadowColor: '#0E1325',
    shadowOpacity: dark ? 0 : 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: dark ? 0 : 1,
  };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [base, style, pressed ? { opacity: 0.85 } : null]}
    >
      {children}
    </Pressable>
  );
}
