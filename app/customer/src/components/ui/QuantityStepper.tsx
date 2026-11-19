import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radius } from '@/theme/tokens';

import { Icon } from './Icon';
import { Text } from './Text';

/** − n + stepper in the brand green. `compact` is the inline variant used on product cards. */
export function QuantityStepper({
  value,
  onChange,
  min = 0,
  max = 20,
  compact = false,
  vertical = false,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  compact?: boolean;
  vertical?: boolean;
  /** What is being counted (e.g. the product name), so screen readers can tell rows apart. */
  label?: string;
}) {
  const size = compact ? 28 : 40;
  const of = label ? ` of ${label}` : '';
  const button = (icon: 'minus' | 'plus', next: number, disabled: boolean) => (
    <Pressable
      key={icon}
      accessibilityRole="button"
      accessibilityLabel={`${icon === 'plus' ? 'Increase' : 'Decrease'} quantity${of}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={() => onChange(next)}
      style={({ pressed }) => [
        styles.button,
        { width: size, height: size, opacity: disabled ? 0.3 : pressed ? 0.6 : 1 },
      ]}
    >
      <Icon name={icon} size={compact ? 16 : 20} color={colors.primary} />
    </Pressable>
  );
  const parts = [
    button('minus', value - 1, value <= min),
    <View key="value" style={[styles.value, vertical ? styles.valueVertical : styles.valueHorizontal]}>
      <Text
        variant={compact ? 'captionMedium' : 'subheading'}
        accessibilityLabel={label ? `${label}, quantity ${value}` : `Quantity ${value}`}
      >
        {value}
      </Text>
    </View>,
    button('plus', value + 1, value >= max),
  ];
  return (
    <View style={[styles.row, vertical ? styles.column : null]}>
      {vertical ? [parts[2], parts[1], parts[0]] : parts}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', justifyContent: 'center' },
  column: { flexDirection: 'column' },
  row: { alignItems: 'center', flexDirection: 'row' },
  value: { alignItems: 'center', justifyContent: 'center', minWidth: 32 },
  valueHorizontal: {
    borderColor: colors.border,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    paddingHorizontal: 10,
  },
  valueVertical: { paddingVertical: 2 },
});

export const stepperRadius = radius.sm;
