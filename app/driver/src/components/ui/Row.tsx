import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/** A labelled row for detail screens and settings lists. */
export function Row({
  icon,
  label,
  value,
  onPress,
  trailing,
}: {
  icon?: IconName;
  label: string;
  value?: string | null;
  onPress?: () => void;
  trailing?: ReactNode;
}) {
  const { colors } = useTheme();
  const content = (
    <View style={styles.row}>
      {icon ? <Icon name={icon} size={20} color={colors.textSubtle} /> : null}
      <View style={styles.text}>
        <Text variant="caption" color="subtle">
          {label}
        </Text>
        {value ? <Text>{value}</Text> : null}
      </View>
      {trailing ?? (onPress ? <Icon name="chevron-forward" size={18} color={colors.textSubtle} /> : null)}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: 12, paddingVertical: 10 },
  text: { flex: 1, gap: 2 },
});
