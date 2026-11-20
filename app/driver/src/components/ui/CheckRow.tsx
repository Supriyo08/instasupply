import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

import { Icon } from './Icon';
import { Text } from './Text';

/** A tickable line: the attestations of onboarding and the load checklist at the store. */
export function CheckRow({
  label,
  detail,
  checked,
  onToggle,
  disabled = false,
}: {
  label: string;
  detail?: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const { colors, radius } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onToggle}
      style={({ pressed }) => [styles.row, { opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}
    >
      <View
        style={[
          styles.box,
          {
            backgroundColor: checked ? colors.primary : colors.surface,
            borderColor: checked ? colors.primary : colors.border,
            borderRadius: radius.sm - 2,
          },
        ]}
      >
        {checked ? <Icon name="checkmark" size={16} color={colors.onPrimary} /> : null}
      </View>
      <View style={styles.text}>
        <Text variant="bodyStrong">{label}</Text>
        {detail ? (
          <Text variant="caption" color="muted">
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    borderWidth: 1.5,
    height: 24,
    justifyContent: 'center',
    marginTop: 1,
    width: 24,
  },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: 12, minHeight: 44, paddingVertical: 8 },
  text: { flex: 1, gap: 2 },
});
