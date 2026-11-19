import { ScrollView, StyleSheet, View } from 'react-native';

import { CategoryCircle } from '@/components/catalog/CategoryCircle';
import { Notice, Skeleton, Text } from '@/components/ui';
import { useCategories } from '@/features/catalog/hooks';
import { radius, spacing } from '@/theme/tokens';

const CIRCLE = 52;
/** CategoryCircle is 20px wider than its circle; inset so the first circle lines up with the gutter. */
const ROW_INSET = spacing.gutter - 10;
const PLACEHOLDERS = [0, 1, 2, 3, 4, 5];

/** Home screen: horizontally scrolling pastel category circles that bleed to the screen edge. */
export function CategoryRow() {
  const { data, loading, error, retry } = useCategories();

  if (error) {
    return (
      <Notice tone="danger" message="Couldn't load categories." actionLabel="Try again" onAction={retry} />
    );
  }

  if (!loading && data.length === 0) {
    return (
      <Text variant="caption" color="muted">
        Categories will appear here soon.
      </Text>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.bleed}
      contentContainerStyle={styles.row}
    >
      {loading
        ? PLACEHOLDERS.map((key) => (
            <View
              key={key}
              style={styles.placeholder}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              <Skeleton style={styles.circle} />
              <Skeleton style={styles.label} />
            </View>
          ))
        : data.map((category) => <CategoryCircle key={category.id} category={category} size={CIRCLE} />)}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bleed: { marginHorizontal: -spacing.gutter },
  circle: { borderRadius: radius.pill, height: CIRCLE, width: CIRCLE },
  label: { height: 8, width: 44 },
  placeholder: { alignItems: 'center', gap: 8, width: CIRCLE + 20 },
  row: { gap: spacing.xs, paddingHorizontal: ROW_INSET },
});
