import type { Category } from '@instasupply/shared';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Sheet, Text, type IconName } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

import { CheckMark } from './FilterControls';

export type CategorySort = 'recommended' | 'name';

const OPTIONS: readonly { value: CategorySort; label: string; hint: string; icon: IconName }[] = [
  { value: 'recommended', label: 'Recommended', hint: 'Our aisle order', icon: 'star' },
  { value: 'name', label: 'Name (A–Z)', hint: 'Alphabetical', icon: 'type' },
];

export function sortCategories(categories: readonly Category[], sort: CategorySort): Category[] {
  // The live query already returns the store's own order (sortOrder).
  if (sort === 'recommended') return [...categories];
  return [...categories].sort((a, b) => a.name.localeCompare(b.name));
}

/** Bottom sheet behind the sliders icon on the categories screen. */
export function CategorySortSheet({
  visible,
  value,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: CategorySort;
  onChange: (value: CategorySort) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Sort categories">
      <View accessibilityRole="radiogroup" style={styles.list}>
        {OPTIONS.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked: selected }}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
            >
              <View style={styles.icon}>
                <Icon name={option.icon} size={18} color={selected ? colors.primary : colors.textMuted} />
              </View>
              <View style={styles.text}>
                <Text variant="bodyMedium">{option.label}</Text>
                <Text variant="caption" color="muted">
                  {option.hint}
                </Text>
              </View>
              <CheckMark checked={selected} />
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  icon: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  list: { gap: spacing.xs, paddingBottom: spacing.sm },
  pressed: { opacity: 0.7 },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.sm },
  text: { flex: 1 },
});
