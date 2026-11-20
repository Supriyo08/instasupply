import { StyleSheet, View } from 'react-native';

import { FilledIcon, Text } from '@/components/ui';
import { colors } from '@/theme/tokens';

/** "★4.9 (50)"; "No reviews yet" before the first review. */
export function StoreRating({ rating, count }: { rating: number; count: number }) {
  if (count <= 0) {
    return (
      <Text variant="caption" color="muted">
        No reviews yet
      </Text>
    );
  }
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`Rated ${rating.toFixed(1)} out of 5, ${count} reviews`}
    >
      <FilledIcon name="star" size={13} color={colors.star} />
      <Text variant="captionMedium">{rating.toFixed(1)}</Text>
      <Text variant="caption" color="muted">
        ({count})
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({ row: { alignItems: 'center', flexDirection: 'row', gap: 3 } });
