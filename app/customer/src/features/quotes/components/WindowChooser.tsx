import { formatDayET, fromLocal, type WindowOption } from '@instasupply/shared';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Chip, Icon, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

/**
 * Delivery options: ASAP with its promise, or a day chip (today … +6) and its 2-hour slots. Slots that
 * cannot be chosen are greyed out with the reason ("Too soon — earliest 2:00 pm").
 */
export function WindowChooser({
  windows,
  value,
  onChange,
  now,
}: {
  windows: readonly WindowOption[];
  value: string | null;
  onChange: (windowId: string) => void;
  now: number;
}) {
  const asap = windows.find((window) => window.kind === 'asap') ?? null;
  const scheduled = windows.filter((window) => window.kind === 'scheduled');
  const days = [...new Set(scheduled.map((window) => window.date))];
  const selected = windows.find((window) => window.id === value) ?? null;
  const [day, setDay] = useState<string | null>(
    selected?.kind === 'scheduled' ? selected.date : (days[0] ?? null),
  );
  const slots = scheduled.filter((window) => window.date === day);

  return (
    <View style={styles.wrap}>
      {asap ? (
        <Option window={asap} selected={value === asap.id} onPress={() => onChange(asap.id)} title="ASAP" />
      ) : null}
      {days.length > 0 ? (
        <>
          <Text variant="captionMedium" color="muted">
            Or schedule a 2-hour window
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
            {days.map((date) => (
              <Chip
                key={date}
                label={formatDayET(fromLocal(date, 12 * 60), now)}
                selected={day === date}
                onPress={() => setDay(date)}
              />
            ))}
          </ScrollView>
          {slots.map((window) => (
            <Option
              key={window.id}
              window={window}
              selected={value === window.id}
              onPress={() => onChange(window.id)}
            />
          ))}
        </>
      ) : null}
    </View>
  );
}

function Option({
  window,
  selected,
  onPress,
  title,
}: {
  window: WindowOption;
  selected: boolean;
  onPress: () => void;
  title?: string;
}) {
  const disabled = !window.available;
  const detail = window.available ? window.label : window.reason;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={`${title ?? window.label}${disabled ? `, unavailable: ${window.reason}` : ''}`}
      disabled={disabled}
      onPress={onPress}
      style={[styles.option, selected ? styles.selected : null, disabled ? styles.disabled : null]}
    >
      <Icon
        name={selected ? 'check-circle' : 'circle'}
        size={18}
        color={selected ? colors.primaryDark : colors.textSubtle}
      />
      <View style={styles.flex}>
        <Text variant="bodyMedium">{title ?? window.label}</Text>
        {title || disabled ? (
          <Text variant="caption" color={disabled ? 'muted' : 'primaryDark'}>
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  days: { gap: spacing.sm },
  disabled: { opacity: 0.55 },
  flex: { flex: 1 },
  option: {
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
  wrap: { gap: spacing.sm },
});
