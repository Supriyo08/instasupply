import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme/tokens';

import { FilledIcon } from './Icon';
import { Text } from './Text';

/** ★★★★☆ 4.5 (89 reviews) */
export function Rating({ value, count, size = 14 }: { value: number; count?: number; size?: number }) {
  const stars = [1, 2, 3, 4, 5].map((star) => {
    const name = value >= star ? 'star' : value >= star - 0.5 ? 'star-half' : 'star-outline';
    return <FilledIcon key={star} name={name} size={size} color={colors.star} />;
  });
  return (
    <View
      style={styles.row}
      accessibilityLabel={`Rated ${value} out of 5${count != null ? `, ${count} reviews` : ''}`}
    >
      {value > 0 ? (
        <Text variant="captionMedium" style={styles.value}>
          {value.toFixed(1)}
        </Text>
      ) : null}
      <View style={styles.stars}>{stars}</View>
      {count != null ? (
        <Text variant="caption" color="muted">
          ({count} {count === 1 ? 'review' : 'reviews'})
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  stars: { flexDirection: 'row', gap: 1 },
  value: { marginRight: -2 },
});
