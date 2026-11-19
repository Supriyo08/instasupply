import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { FilledIcon, Icon, Text, type IconName } from '@/components/ui';
import { colors, fonts, radius, spacing } from '@/theme/tokens';

import { SORT_OPTIONS, type SortMode } from './filters';

/** Titled block of the filter sheet, separated from the next one by a hairline. */
export function FilterSection({
  title,
  children,
  last = false,
}: {
  title: string;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <View style={[styles.section, last ? null : styles.sectionDivider]}>
      <Text variant="subheading">{title}</Text>
      {children}
    </View>
  );
}

/** Round check used by the filter and sort sheets (filled green when on). */
export function CheckMark({ checked }: { checked: boolean }) {
  return (
    <View style={[styles.check, checked ? styles.checkOn : styles.checkOff]}>
      {checked ? <Icon name="check" size={13} color={colors.white} /> : null}
    </View>
  );
}

export function PriceRangeFields({
  min,
  max,
  onChangeMin,
  onChangeMax,
  error,
}: {
  min: string;
  max: string;
  onChangeMin: (text: string) => void;
  onChangeMax: (text: string) => void;
  error: string | null;
}) {
  return (
    <View style={styles.priceBlock}>
      <View style={styles.priceRow}>
        <PriceField
          label="Minimum price"
          placeholder="Min"
          value={min}
          onChange={onChangeMin}
          invalid={!!error}
        />
        <View style={styles.dash} />
        <PriceField
          label="Maximum price"
          placeholder="Max"
          value={max}
          onChange={onChangeMax}
          invalid={!!error}
        />
      </View>
      {error ? (
        <Text variant="caption" color="danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function PriceField(props: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (text: string) => void;
  invalid: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const border = props.invalid ? colors.danger : focused ? colors.primaryLight : colors.background;
  return (
    <View style={[styles.priceField, { borderColor: border }]}>
      <Text variant="bodyMedium" color="muted">
        ₹
      </Text>
      <TextInput
        accessibilityLabel={props.label}
        value={props.value}
        onChangeText={(text) => props.onChange(text.replace(/\D/g, '').slice(0, 6))}
        placeholder={props.placeholder}
        placeholderTextColor={colors.textSubtle}
        inputMode="numeric"
        maxLength={6}
        returnKeyType="done"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={styles.priceInput}
      />
    </View>
  );
}

/** Tap a star for "n stars & up"; tap the selected star again to clear. */
export function StarRatingPicker({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <View style={styles.starBox}>
      <View style={styles.stars} accessibilityRole="radiogroup" accessibilityLabel="Minimum rating">
        {[1, 2, 3, 4, 5].map((star) => (
          <Pressable
            key={star}
            accessibilityRole="radio"
            accessibilityLabel={`${star} ${star === 1 ? 'star' : 'stars'} and up`}
            accessibilityState={{ checked: value === star }}
            hitSlop={4}
            onPress={() => onChange(value === star ? 0 : star)}
          >
            <FilledIcon
              name={star <= value ? 'star' : 'star-outline'}
              size={24}
              color={star <= value ? colors.star : colors.textSubtle}
            />
          </Pressable>
        ))}
      </View>
      <Text variant="caption" color="muted">
        {value ? `${value}+ ${value === 1 ? 'star' : 'stars'}` : 'Any rating'}
      </Text>
    </View>
  );
}

export function CheckRow({
  icon,
  label,
  checked,
  onToggle,
}: {
  icon: IconName;
  label: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={() => onToggle(!checked)}
      style={({ pressed }) => [styles.checkRow, pressed ? styles.pressed : null]}
    >
      <Icon name={icon} size={18} color={colors.textMuted} />
      <Text style={styles.checkLabel}>{label}</Text>
      <CheckMark checked={checked} />
    </Pressable>
  );
}

export function SortOptions({ value, onChange }: { value: SortMode; onChange: (value: SortMode) => void }) {
  return (
    <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Sort by">
      {SORT_OPTIONS.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(option.value)}
            style={[styles.chip, selected ? styles.chipOn : null]}
          >
            <Text variant="captionMedium" style={selected ? styles.chipTextOn : null}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  check: { alignItems: 'center', borderRadius: radius.pill, height: 22, justifyContent: 'center', width: 22 },
  checkLabel: { flex: 1 },
  checkOff: { borderColor: colors.textSubtle, borderWidth: 1.5 },
  checkOn: { backgroundColor: colors.primary },
  checkRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, minHeight: 44 },
  chip: {
    backgroundColor: colors.background,
    borderColor: colors.background,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipTextOn: { color: colors.primaryDark },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  dash: { backgroundColor: colors.textSubtle, height: 1.5, width: 10 },
  pressed: { opacity: 0.7 },
  priceBlock: { gap: 6 },
  priceField: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 48,
    paddingHorizontal: 14,
  },
  // The field's border already shows focus, so hide the browser's focus ring on the web
  // (a 0px solid outline replaces Chrome's `outline-style: auto`, which ignores the width).
  priceInput: {
    color: colors.text,
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 14,
    minWidth: 0,
    outlineStyle: 'solid',
    outlineWidth: 0,
    paddingVertical: 10,
  },
  priceRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  section: { gap: spacing.md, paddingBottom: spacing.lg },
  sectionDivider: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  starBox: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    flexDirection: 'row',
    height: 48,
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  stars: { flexDirection: 'row', gap: 6 },
});
