import { Pressable, StyleSheet, View } from 'react-native';

import { FilledIcon, Text } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

const LABELS = ['Terrible', 'Not great', 'Okay', 'Good', 'Excellent'] as const;

/** Five large tappable stars ("Write Reviews" in the Big Cart design) with a word for the score. */
export function StarPicker({
  value,
  onChange,
  size = 42,
}: {
  value: number;
  onChange: (rating: number) => void;
  size?: number;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {[1, 2, 3, 4, 5].map((star) => {
          const filled = value >= star;
          return (
            <Pressable
              key={star}
              accessibilityRole="button"
              accessibilityLabel={`${star} ${star === 1 ? 'star' : 'stars'}, ${LABELS[star - 1]}`}
              accessibilityState={{ selected: value === star }}
              hitSlop={4}
              onPress={() => onChange(star)}
              style={({ pressed }) => [styles.star, pressed ? styles.pressed : null]}
            >
              <FilledIcon
                name={filled ? 'star' : 'star-outline'}
                size={size}
                color={filled ? colors.star : colors.textSubtle}
              />
            </Pressable>
          );
        })}
      </View>
      <Text variant="captionMedium" color={value > 0 ? 'warning' : 'muted'}>
        {value > 0 ? LABELS[value - 1] : 'Tap a star to rate'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6, transform: [{ scale: 0.92 }] },
  row: { flexDirection: 'row', gap: spacing.sm },
  star: { padding: 2 },
  wrap: { alignItems: 'center', gap: spacing.sm },
});
