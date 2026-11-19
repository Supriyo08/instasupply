import { useEffect, useRef } from 'react';
import { Animated, Platform, type ViewStyle } from 'react-native';

import { colors, radius } from '@/theme/tokens';

// The web has no native animation driver (Animated warns and falls back to JS).
const useNativeDriver = Platform.OS !== 'web';

/** Pulsing placeholder while data loads. */
export function Skeleton({ style }: { style?: ViewStyle }) {
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View style={[{ backgroundColor: colors.border, borderRadius: radius.sm, opacity }, style]} />
  );
}
