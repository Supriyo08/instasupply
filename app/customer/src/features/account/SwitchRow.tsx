import { StyleSheet, View } from 'react-native';

import { Text, Toggle } from '@/components/ui';
import { colors, radius } from '@/theme/tokens';

/** Switch with a label and hint ("Make default", "Save as default card"), as in the design. */
export function SwitchRow({
  label,
  hint,
  value,
  locked,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  locked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <Toggle label={label} value={value} disabled={locked} onValueChange={onChange} />
      <View style={styles.text}>
        <Text variant="captionMedium">{label}</Text>
        <Text variant="caption" color="muted">
          {hint}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  text: { flex: 1 },
});
