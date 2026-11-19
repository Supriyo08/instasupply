import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import { Animated, Easing } from 'react-native';

import { ArtImage } from '@/components/ui';

import { USE_NATIVE_DRIVER, useReducedMotion } from './motion';

const LIFT = 7;
const HALF_CYCLE_MS = 2400;

/**
 * Scene illustration with a slow "breathing" float while its screen is focused. Skipped when the
 * user prefers reduced motion or `animate` is off (e.g. off-screen onboarding slides).
 */
export function FloatingArt({
  artKey,
  width,
  height,
  animate = true,
}: {
  artKey: string;
  width: number;
  height: number;
  animate?: boolean;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();
  const enabled = animate && !reduceMotion;

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      const step = (toValue: number) =>
        Animated.timing(progress, {
          toValue,
          duration: HALF_CYCLE_MS,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: USE_NATIVE_DRIVER,
        });
      const loop = Animated.loop(Animated.sequence([step(1), step(0)]));
      loop.start();
      return () => loop.stop();
    }, [enabled, progress]),
  );

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, -LIFT] });
  return (
    <Animated.View style={{ transform: [{ translateY }] }}>
      <ArtImage artKey={artKey} width={width} height={height} />
    </Animated.View>
  );
}
