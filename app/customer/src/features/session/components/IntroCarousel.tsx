import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/ui';
import { colors, radius, shadows, spacing } from '@/theme/tokens';

import { INTRO_SLIDES, IntroSlide } from './IntroSlide';
import { USE_NATIVE_DRIVER } from './motion';
import { PageDots } from './PageDots';

const LAST = INTRO_SLIDES.length - 1;
/** Height kept for the copy, the dots and the button below the hero. */
const BELOW_HERO = 310;

/** Swipeable onboarding pages with page dots, "Next"/"Get started" and "Skip". */
export function IntroCarousel({ onFinish }: { onFinish: () => Promise<void> }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const pageRef = useRef(0);

  const heroHeight = Math.round(Math.min(Math.max(Math.min(height * 0.56, height - BELOW_HERO), 250), 540));

  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
        useNativeDriver: USE_NATIVE_DRIVER,
        listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
          const page = Math.min(LAST, Math.max(0, Math.round(event.nativeEvent.contentOffset.x / width)));
          pageRef.current = page;
          setIndex(page);
        },
      }),
    [scrollX, width],
  );

  // Keep the current page in view when the window is resized (web, foldables).
  useEffect(() => {
    scrollRef.current?.scrollTo({ x: pageRef.current * width, animated: false });
  }, [width]);

  const goTo = (page: number) => scrollRef.current?.scrollTo({ x: page * width, animated: true });

  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      await onFinish();
      // The router leaves onboarding as soon as the session status changes.
    } catch {
      setFinishing(false);
    }
  };

  return (
    <View style={styles.root}>
      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
        style={styles.slides}
      >
        {INTRO_SLIDES.map((slide, page) => (
          <IntroSlide
            key={slide.art}
            slide={slide}
            index={page}
            width={width}
            heroHeight={heroHeight}
            topInset={insets.top + spacing.xxl}
            scrollX={scrollX}
            active={page === index}
          />
        ))}
      </Animated.ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.xl }]}>
        <PageDots count={INTRO_SLIDES.length} index={index} onSelect={goTo} />
        <Button
          label={index < LAST ? 'Next' : 'Get started'}
          loading={finishing}
          onPress={() => (index < LAST ? goTo(index + 1) : void finish())}
        />
      </View>

      {index < LAST ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Skip introduction"
          disabled={finishing}
          hitSlop={8}
          onPress={() => void finish()}
          style={({ pressed }) => [styles.skip, { top: insets.top + spacing.md, opacity: pressed ? 0.7 : 1 }]}
        >
          <Text variant="captionMedium">Skip</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    alignSelf: 'center',
    gap: spacing.xxl,
    maxWidth: 480,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.sm,
    width: '100%',
  },
  root: { backgroundColor: colors.surface, flex: 1 },
  skip: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 6,
    position: 'absolute',
    right: spacing.gutter,
    ...shadows.soft,
  },
  slides: { flex: 1 },
});
