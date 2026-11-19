import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ArtImage, Skeleton, Text } from '@/components/ui';
import { useCategories } from '@/features/catalog/hooks';
import { colors, radius, spacing } from '@/theme/tokens';

const PLACEHOLDER_WIDTHS = [104, 82, 112, 92, 98, 86];

/** Category chips shown on the search screen before the shopper types anything. */
export function PopularCategories() {
  const { data, loading, error } = useCategories();
  // Nice to have: stay out of the way if the catalogue can't be reached.
  if (error || (!loading && data.length === 0)) return null;

  return (
    <View style={styles.section}>
      <Text variant="heading">Popular categories</Text>
      <View style={styles.chips}>
        {loading
          ? PLACEHOLDER_WIDTHS.map((width) => (
              <Skeleton key={width} style={{ ...styles.placeholder, width }} />
            ))
          : data.map((category) => (
              <Pressable
                key={category.id}
                accessibilityRole="button"
                accessibilityLabel={`Browse ${category.name}`}
                onPress={() => router.push(`/category/${category.id}`)}
                style={({ pressed }) => [styles.chip, pressed ? styles.pressed : null]}
              >
                <View style={[styles.icon, { backgroundColor: category.tint }]}>
                  <ArtImage artKey={category.iconKey} size={18} />
                </View>
                <Text variant="captionMedium">{category.name}</Text>
              </Pressable>
            ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingLeft: 4,
    paddingRight: 14,
    paddingVertical: 4,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  icon: { alignItems: 'center', borderRadius: radius.pill, height: 28, justifyContent: 'center', width: 28 },
  placeholder: { borderRadius: radius.pill, height: 36 },
  pressed: { opacity: 0.7 },
  section: { gap: spacing.md },
});
