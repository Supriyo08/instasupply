import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { colors, radius } from '@/theme/tokens';

import { ADDRESS_LABELS, labelIcon } from './address-form';

/** Home / Work / Other selector; a custom stored label is shown as an extra chip. */
export function LabelChips({ value, onChange }: { value: string; onChange: (label: string) => void }) {
  const known = ADDRESS_LABELS.some((item) => item.value.toLowerCase() === value.toLowerCase());
  const options = known || !value ? ADDRESS_LABELS : [...ADDRESS_LABELS, { value, icon: labelIcon(value) }];
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Address label">
      {options.map((option) => {
        const selected = option.value.toLowerCase() === value.toLowerCase();
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.value}
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.chip,
              selected ? styles.selected : null,
              pressed && !selected ? styles.pressed : null,
            ]}
          >
            <Icon name={option.icon} size={16} color={selected ? colors.primary : colors.textMuted} />
            <Text variant="captionMedium" style={{ color: selected ? colors.primaryDark : colors.text }}>
              {option.value}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  pressed: { opacity: 0.75 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  selected: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
});
