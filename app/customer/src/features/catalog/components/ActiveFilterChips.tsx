import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

import { activeFilters, DEFAULT_FILTERS, type ProductFilters } from './filters';

/** One removable chip per applied filter, plus "Clear all" when there are several. */
export function ActiveFilterChips({
  filters,
  onChange,
}: {
  filters: ProductFilters;
  onChange: (filters: ProductFilters) => void;
}) {
  const active = activeFilters(filters);
  if (active.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.bleed}
      contentContainerStyle={styles.row}
    >
      {active.map((filter) => (
        <Pressable
          key={filter.key}
          accessibilityRole="button"
          accessibilityLabel={`Remove filter: ${filter.label}`}
          onPress={() => onChange(filter.without(filters))}
          style={({ pressed }) => [styles.chip, pressed ? styles.pressed : null]}
        >
          <Text variant="captionMedium" style={styles.chipText}>
            {filter.label}
          </Text>
          <Icon name="x" size={14} color={colors.primaryDark} />
        </Pressable>
      ))}
      {active.length > 1 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear all filters"
          onPress={() => onChange(DEFAULT_FILTERS)}
          style={({ pressed }) => [styles.clear, pressed ? styles.pressed : null]}
        >
          <Text variant="captionMedium" color="primary">
            Clear all
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bleed: { flexGrow: 0, marginHorizontal: -spacing.gutter },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderColor: colors.primaryLight,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingLeft: 12,
    paddingRight: 10,
    paddingVertical: 5,
  },
  chipText: { color: colors.primaryDark },
  clear: { justifyContent: 'center', paddingHorizontal: spacing.sm },
  pressed: { opacity: 0.7 },
  row: { gap: spacing.sm, paddingHorizontal: spacing.gutter },
});
