import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Chip, Icon, Text } from '@/components/ui';
import { colors, fonts, radius, spacing } from '@/theme/tokens';

import { BULK_STEPS } from './constants';

const webInput = Platform.OS === 'web' ? ({ outlineStyle: 'solid', outlineWidth: 0 } as const) : null;

/**
 * − n + with the bulk chips (+10, +25, +50). Tap the number to type one; it is clamped to 1…max when
 * the field loses focus.
 */
export function QuantityPicker({
  value,
  onChange,
  max,
  label,
  unit,
}: {
  value: number;
  onChange: (value: number) => void;
  max: number;
  /** The product name, for screen readers. */
  label: string;
  unit: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const clamp = (next: number) => Math.max(1, Math.min(max, Math.round(next)));
  const commit = () => {
    const typed = Number.parseInt(draft.replace(/[^\d]/g, ''), 10);
    const next = Number.isFinite(typed) ? clamp(typed) : value;
    setDraft(String(next));
    if (next !== value) onChange(next);
  };

  const step = (icon: 'minus' | 'plus', next: number, disabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${icon === 'plus' ? 'Increase' : 'Decrease'} quantity of ${label}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={() => onChange(clamp(next))}
      style={({ pressed }) => [styles.step, { opacity: disabled ? 0.3 : pressed ? 0.6 : 1 }]}
    >
      <Icon name={icon} size={20} color={colors.primary} />
    </Pressable>
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text variant="bodyMedium" style={styles.label}>
          Quantity
        </Text>
        <View style={styles.stepper}>
          {step('minus', value - 1, value <= 1)}
          <TextInput
            accessibilityLabel={`Quantity of ${label}, ${unit}`}
            value={draft}
            onChangeText={setDraft}
            onBlur={commit}
            onSubmitEditing={commit}
            keyboardType="number-pad"
            returnKeyType="done"
            selectTextOnFocus
            maxLength={4}
            style={[styles.input, webInput]}
          />
          {step('plus', value + 1, value >= max)}
        </View>
      </View>
      <View style={styles.chips}>
        {BULK_STEPS.map((bulk) => (
          <Chip
            key={bulk}
            label={`+${bulk}`}
            accessibilityLabel={`Add ${bulk} more`}
            disabled={value >= max}
            onPress={() => onChange(clamp(value + bulk))}
          />
        ))}
        <Text variant="caption" color="muted">
          {max > 0 ? `Up to ${max.toLocaleString('en-CA')}` : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  input: {
    borderColor: colors.border,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    color: colors.text,
    fontFamily: fonts.semibold,
    fontSize: 16,
    minWidth: 64,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    textAlign: 'center',
  },
  label: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
  step: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  stepper: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
  },
  wrap: { backgroundColor: colors.surface, borderRadius: radius.sm, gap: spacing.md, padding: spacing.lg },
});
