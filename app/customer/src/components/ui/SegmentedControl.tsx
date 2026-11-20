import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, shadows } from '@/theme/tokens';

import { Text } from './Text';

/** Two to four equal segments: "Active · Past · Quotes", "Delivery | Pickup", "List ⇄ Map". */
export function SegmentedControl<Value extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: readonly { value: Value; label: string }[];
  value: Value;
  onChange: (value: Value) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.track, style]} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => {
              if (!selected) onChange(option.value);
            }}
            style={[styles.segment, selected ? [styles.selected, shadows.overlay] : null]}
          >
            <Text variant="captionMedium" color={selected ? 'default' : 'muted'} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  segment: {
    alignItems: 'center',
    borderRadius: radius.md,
    flex: 1,
    justifyContent: 'center',
    minHeight: 36,
  },
  selected: { backgroundColor: colors.surface },
  track: {
    backgroundColor: colors.border,
    borderRadius: radius.md + 2,
    flexDirection: 'row',
    gap: 2,
    padding: 3,
  },
});
