import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text, type IconName } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

/**
 * A radio row for the checkout pickers (receiving, delivery time, jobsite, card). Disabled rows stay
 * visible with their reason, so the customer sees why they can't be chosen.
 */
export function OptionRow({
  title,
  subtitle,
  detail,
  icon,
  leading,
  selected,
  disabled = false,
  onPress,
  trailing,
}: {
  title: string;
  subtitle?: string | null;
  /** A second line in the muted colour, or the reason when `disabled`. */
  detail?: string | null;
  icon?: IconName;
  leading?: ReactNode;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  trailing?: ReactNode;
}) {
  const label = [title, subtitle, detail, disabled ? 'unavailable' : null].filter(Boolean).join('. ');
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        selected ? styles.selected : null,
        disabled ? styles.disabled : null,
        pressed ? styles.pressed : null,
      ]}
    >
      {leading ??
        (icon ? (
          <View style={styles.icon}>
            <Icon name={icon} size={18} color={selected ? colors.primaryDark : colors.textMuted} />
          </View>
        ) : null)}
      <View style={styles.body}>
        <Text variant="bodyMedium" color={disabled ? 'subtle' : 'default'}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color={disabled ? 'subtle' : 'muted'}>
            {subtitle}
          </Text>
        ) : null}
        {detail ? (
          <Text variant="caption" color={disabled ? 'warning' : 'muted'}>
            {detail}
          </Text>
        ) : null}
      </View>
      {trailing}
      <View style={[styles.radio, selected ? styles.radioOn : null]}>
        {selected ? <View style={styles.dot} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: 1 },
  disabled: { opacity: 0.75 },
  dot: { backgroundColor: colors.primary, borderRadius: 5, height: 10, width: 10 },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  pressed: { opacity: 0.8 },
  radio: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 11,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  radioOn: { borderColor: colors.primary },
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  selected: { borderColor: colors.primary },
});
