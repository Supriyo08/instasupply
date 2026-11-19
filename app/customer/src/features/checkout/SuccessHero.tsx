import { isArtKey } from '@instasupply/art';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, type ViewStyle } from 'react-native';

import { ArtImage, Icon } from '@/components/ui';
import { colors } from '@/theme/tokens';

const ART_KEY = 'scene-order-confirmed';
const SIZE = 220;
const useNativeDriver = Platform.OS !== 'web';

/** Confetti dots around the hero, in the brand and category pastel accents. */
const DOTS: { at: ViewStyle; size: number; color: string }[] = [
  { at: { top: 18, left: 26 }, size: 10, color: colors.primaryLight },
  { at: { top: 6, right: 44 }, size: 7, color: colors.star },
  { at: { top: 92, right: 2 }, size: 9, color: colors.info },
  { at: { bottom: 22, right: 30 }, size: 6, color: colors.danger },
  { at: { bottom: 8, left: 52 }, size: 8, color: colors.warning },
  { at: { top: 112, left: 0 }, size: 6, color: colors.primary },
];

/** Celebratory illustration for the order-success screen, popping in with a soft spring. */
export function SuccessHero() {
  const scale = useRef(new Animated.Value(0.8)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 6, tension: 80, useNativeDriver }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 320,
        easing: Easing.out(Easing.quad),
        useNativeDriver,
      }),
    ]).start();
  }, [opacity, scale]);

  const hasArt = isArtKey(ART_KEY);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.wrap, { opacity, transform: [{ scale }] }]}
    >
      <View style={styles.halo}>
        <View style={styles.core}>
          {hasArt ? (
            <ArtImage artKey={ART_KEY} size={150} />
          ) : (
            <Icon name="shopping-bag" size={76} color={colors.primary} />
          )}
        </View>
      </View>
      {hasArt ? null : (
        <View style={styles.check}>
          <Icon name="check" size={20} color={colors.white} />
        </View>
      )}
      {DOTS.map((dot, index) => (
        <View
          key={index}
          style={[
            styles.dot,
            dot.at,
            { width: dot.size, height: dot.size, borderRadius: dot.size / 2, backgroundColor: dot.color },
          ]}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  check: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderColor: colors.surface,
    borderRadius: 20,
    borderWidth: 3,
    bottom: 46,
    height: 40,
    justifyContent: 'center',
    position: 'absolute',
    right: 46,
    width: 40,
  },
  core: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 80,
    height: 160,
    justifyContent: 'center',
    width: 160,
  },
  dot: { position: 'absolute' },
  halo: {
    alignItems: 'center',
    backgroundColor: colors.primaryTint,
    borderRadius: 100,
    height: 200,
    justifyContent: 'center',
    opacity: 0.9,
    width: 200,
  },
  wrap: { alignItems: 'center', alignSelf: 'center', height: SIZE, justifyContent: 'center', width: SIZE },
});
