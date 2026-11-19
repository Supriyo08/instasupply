import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/theme/tokens';

const DOT = 7;
const ACTIVE_WIDTH = 22;

/** Brand-green page indicator; the active dot stretches into a pill. Tapping a dot jumps to it. */
export function PageDots({
  count,
  index,
  onSelect,
}: {
  count: number;
  index: number;
  onSelect: (page: number) => void;
}) {
  return (
    <View style={styles.row}>
      {Array.from({ length: count }, (_, page) => (
        <Dot
          key={page}
          active={page === index}
          label={`Slide ${page + 1} of ${count}`}
          onPress={() => onSelect(page)}
        />
      ))}
    </View>
  );
}

function Dot({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  const progress = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    // Width and colour are layout/colour props, which the native driver cannot animate.
    Animated.timing(progress, { toValue: active ? 1 : 0, duration: 240, useNativeDriver: false }).start();
  }, [active, progress]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hitSlop={{ top: 12, bottom: 12, left: 4, right: 4 }}
      onPress={onPress}
    >
      <Animated.View
        style={[
          styles.dot,
          {
            width: progress.interpolate({ inputRange: [0, 1], outputRange: [DOT, ACTIVE_WIDTH] }),
            backgroundColor: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [colors.textSubtle, colors.primary],
            }),
          },
        ]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dot: { borderRadius: DOT / 2, height: DOT },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' },
});
