import { StyleSheet, View } from 'react-native';

import { Icon, Text, Toggle, type IconName } from '@/components/ui';
import { colors, radius } from '@/theme/tokens';

/** Notification setting card from the design: title, description and a switch. */
export function PreferenceRow({
  icon,
  title,
  description,
  value,
  onValueChange,
  disabled,
}: {
  icon: IconName;
  title: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.card}>
      <View style={[styles.icon, { backgroundColor: value ? colors.primarySoft : colors.surfaceMuted }]}>
        <Icon name={icon} size={18} color={value ? colors.primary : colors.textMuted} />
      </View>
      <View style={styles.text}>
        <Text variant="subheading">{title}</Text>
        <Text variant="caption" color="muted">
          {description}
        </Text>
      </View>
      <Toggle label={title} value={value} onValueChange={onValueChange} disabled={disabled} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  icon: { alignItems: 'center', borderRadius: 19, height: 38, justifyContent: 'center', width: 38 },
  text: { flex: 1, gap: 3 },
});
