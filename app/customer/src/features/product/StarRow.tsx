import { StyleSheet, View } from 'react-native';

import { FilledIcon } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

/** Read-only ★★★★½ row (no numbers; see <Rating /> for the labelled version). */
export function StarRow({ value, size = 14 }: { value: number; size?: number }) {
  const spoken = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${spoken} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <FilledIcon
          key={star}
          name={value >= star ? 'star' : value >= star - 0.5 ? 'star-half' : 'star-outline'}
          size={size}
          color={colors.star}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', gap: spacing.xxs } });
