import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius } from '@/theme/tokens';

import { Text } from './Text';

const TONES = {
  new: { bg: colors.warningSoft, fg: colors.warning },
  sale: { bg: colors.dangerSoft, fg: colors.danger },
  brand: { bg: colors.primarySoft, fg: colors.primaryDark },
  info: { bg: colors.infoSoft, fg: colors.info },
  neutral: { bg: colors.background, fg: colors.textMuted },
  success: { bg: colors.primarySoft, fg: colors.primaryDark },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
} as const;

/** Small uppercase pill. It aligns itself to the start; pass `style` (e.g. alignSelf) to change that. */
export function Badge({
  label,
  tone = 'brand',
  style,
}: {
  label: string;
  tone?: keyof typeof TONES;
  style?: StyleProp<ViewStyle>;
}) {
  const { bg, fg } = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }, style]}>
      <Text variant="micro" style={{ color: fg, textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 2 },
});
