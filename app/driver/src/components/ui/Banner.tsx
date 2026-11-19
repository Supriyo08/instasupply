import type { StatusTone } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { toneColors } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

const ICONS: Partial<Record<StatusTone, IconName>> = {
  danger: 'alert-circle',
  warning: 'warning',
  success: 'checkmark-circle',
  info: 'information-circle',
  brand: 'sparkles',
};

export function Banner({
  tone = 'info',
  title,
  message,
}: {
  tone?: StatusTone;
  title?: string;
  message: string;
}) {
  const { colors, radius } = useTheme();
  const { fg, bg } = toneColors(colors, tone);
  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: bg, borderRadius: radius.md }]}>
      <Icon name={ICONS[tone] ?? 'information-circle'} size={20} color={fg} />
      <View style={styles.text}>
        {title ? (
          <Text variant="bodyStrong" style={{ color: fg }}>
            {title}
          </Text>
        ) : null}
        <Text variant="caption" style={{ color: fg }}>
          {message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { alignItems: 'flex-start', flexDirection: 'row', gap: 10, padding: 12 },
  text: { flex: 1, gap: 2 },
});
