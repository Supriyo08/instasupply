import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet } from 'react-native';

/**
 * Expanding, fading ring drawn behind a dot or circle to signal "live". Sits absolutely inside a
 * centred parent of the same size; respects the system "reduce motion" setting.
 */
export function Pulse({ size, color, scaleTo = 1.6 }: { size: number; color: string; scaleTo?: number }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (cancelled || reduce) return;
        loop = Animated.loop(
          Animated.timing(progress, {
            toValue: 1,
            duration: 1600,
            easing: Easing.out(Easing.quad),
            useNativeDriver: Platform.OS !== 'web',
          }),
        );
        loop.start();
      });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [progress]);

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [1, scaleTo] });
  const opacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.ring,
        {
          backgroundColor: color,
          borderRadius: size / 2,
          height: size,
          opacity,
          transform: [{ scale }],
          width: size,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({ ring: { pointerEvents: 'none', position: 'absolute' } });
