import { useMemo } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { spacing } from '@/theme/tokens';

import { HeroPanel } from './HeroPanel';

export interface IntroSlideContent {
  art: string;
  title: string;
  subtitle: string;
}

export const INTRO_SLIDES: readonly IntroSlideContent[] = [
  {
    art: 'scene-jobsite-delivery',
    title: 'Building supplies\non your jobsite',
    subtitle: 'Lumber, drywall, fasteners and more from local suppliers, brought to where you are working.',
  },
  {
    art: 'scene-local-suppliers',
    title: 'One search across\nlocal suppliers',
    subtitle: 'Compare prices and live stock at stores near your site, and buy from several in one order.',
  },
  {
    art: 'scene-live-tracking',
    title: 'Delivered or ready\nfor pickup',
    subtitle:
      'Same-day delivery to your site or pickup nearby. Track every step from the store to the drop-off.',
  },
];

/** One onboarding page: the hero art drifts with a slight parallax and the copy fades while swiping. */
export function IntroSlide({
  slide,
  index,
  width,
  heroHeight,
  topInset,
  scrollX,
  active,
}: {
  slide: IntroSlideContent;
  index: number;
  width: number;
  heroHeight: number;
  topInset: number;
  scrollX: Animated.Value;
  active: boolean;
}) {
  const { artStyle, copyStyle } = useMemo(() => {
    const inputRange = [(index - 1) * width, index * width, (index + 1) * width];
    const along = (outputRange: number[]) =>
      scrollX.interpolate({ inputRange, outputRange, extrapolate: 'clamp' });
    return {
      artStyle: {
        opacity: along([0.4, 1, 0.4]),
        transform: [
          { translateX: along([-width * 0.35, 0, width * 0.35]) },
          { scale: along([0.82, 1, 0.82]) },
        ],
      },
      copyStyle: { opacity: along([0, 1, 0]), transform: [{ translateY: along([14, 0, 14]) }] },
    };
  }, [index, scrollX, width]);

  return (
    <View style={{ width }}>
      <HeroPanel
        artKey={slide.art}
        width={width}
        height={heroHeight}
        topInset={topInset}
        curved
        artStyle={artStyle}
        animate={active}
      />
      <Animated.View style={[styles.copy, copyStyle]}>
        <Text variant="display" align="center" accessibilityRole="header">
          {slide.title}
        </Text>
        <Text color="muted" align="center">
          {slide.subtitle}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  copy: {
    alignSelf: 'center',
    gap: spacing.md,
    maxWidth: 440,
    paddingHorizontal: spacing.xxxl,
    paddingTop: spacing.sm,
    width: '100%',
  },
});
