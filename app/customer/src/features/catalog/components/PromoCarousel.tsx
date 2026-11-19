import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';

import { ArtImage, Icon, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

import type { PromoBanner } from './usePromoBanners';

const AUTO_ADVANCE_MS = 4000;
const BANNER_HEIGHT = 172;
/** Scene illustrations are drawn on a 360x300 canvas. */
const ART_WIDTH = 168;
const ART_HEIGHT = 140;

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active) setReduce(value);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduce;
}

/**
 * Swipeable promo banners with paging dots. Advances every 4 s; pauses while the shopper drags,
 * while the screen is not focused and when the system asks to reduce motion.
 */
export function PromoCarousel({ banners }: { banners: PromoBanner[] }) {
  const scroller = useRef<ScrollViewInstance>(null);
  const indexRef = useRef(0);
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const [dragging, setDragging] = useState(false);
  const focused = useIsFocused();
  const reduceMotion = useReduceMotion();
  const count = banners.length;

  // Keep the current banner in view when the width changes (rotation, resized browser window).
  useEffect(() => {
    if (width) scroller.current?.scrollTo({ x: indexRef.current * width, animated: false });
  }, [width]);

  // Re-armed whenever the page changes, so a manual swipe also restarts the countdown.
  useEffect(() => {
    if (!width || count < 2 || dragging || !focused || reduceMotion) return;
    const timer = setTimeout(() => {
      scroller.current?.scrollTo({ x: ((index + 1) % count) * width, animated: true });
    }, AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [count, dragging, focused, index, reduceMotion, width]);

  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setWidth((current) => (current === next ? current : next));
  };

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    const next = Math.min(count - 1, Math.max(0, Math.round(event.nativeEvent.contentOffset.x / width)));
    indexRef.current = next;
    setIndex(next);
  };

  return (
    <View style={styles.container}>
      <View style={styles.bleed} onLayout={onLayout}>
        {width > 0 ? (
          <ScrollView
            ref={scroller}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={onScroll}
            onScrollBeginDrag={() => setDragging(true)}
            onScrollEndDrag={() => setDragging(false)}
          >
            {banners.map((banner) => (
              <View key={banner.key} style={[styles.page, { width }]}>
                <BannerSlide banner={banner} />
              </View>
            ))}
          </ScrollView>
        ) : (
          <View style={styles.placeholder} />
        )}
      </View>
      {count > 1 ? (
        <View style={styles.dots}>
          {banners.map((banner, dot) => (
            <Pressable
              key={banner.key}
              accessibilityRole="button"
              accessibilityLabel={`Show offer ${dot + 1} of ${count}`}
              accessibilityState={{ selected: dot === index }}
              hitSlop={8}
              onPress={() => scroller.current?.scrollTo({ x: dot * width, animated: true })}
              style={[styles.dot, dot === index ? styles.dotActive : null]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function BannerSlide({ banner }: { banner: PromoBanner }) {
  const onBrand = banner.tone === 'brand';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${banner.title}. ${banner.subtitle}`}
      accessibilityHint={banner.cta}
      onPress={banner.onPress}
      style={({ pressed }) => [styles.slide, pressed ? styles.pressed : null]}
    >
      <LinearGradient
        colors={banner.colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <View style={[styles.bubble, styles.bubbleLarge]} />
        <View style={[styles.bubble, styles.bubbleSmall]} />
        <ArtImage artKey={banner.art} width={ART_WIDTH} height={ART_HEIGHT} style={styles.art} />
        <View style={styles.copy}>
          <Text variant="micro" color={onBrand ? 'white' : 'primary'} style={styles.eyebrow}>
            {banner.eyebrow}
          </Text>
          <Text variant="title" color={onBrand ? 'white' : 'default'} numberOfLines={2}>
            {banner.title}
          </Text>
          <Text variant="caption" color={onBrand ? 'white' : 'muted'} numberOfLines={1}>
            {banner.subtitle}
          </Text>
          <View style={[styles.cta, onBrand ? styles.ctaOnBrand : styles.ctaOnLight]}>
            <Text variant="captionMedium" color={onBrand ? 'primary' : 'white'}>
              {banner.cta}
            </Text>
            <Icon name="arrow-right" size={14} color={onBrand ? colors.primary : colors.white} />
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  art: { bottom: 14, position: 'absolute', right: -4 },
  bleed: { marginHorizontal: -spacing.gutter },
  bubble: { backgroundColor: colors.white, borderRadius: radius.pill, opacity: 0.22, position: 'absolute' },
  bubbleLarge: { height: 190, right: -56, top: -72, width: 190 },
  bubbleSmall: { bottom: -48, height: 110, right: 92, width: 110 },
  container: { gap: spacing.md },
  copy: { gap: 3, maxWidth: '58%' },
  cta: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: 6,
    marginTop: spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  ctaOnBrand: { backgroundColor: colors.white },
  ctaOnLight: { backgroundColor: colors.primary },
  dot: { backgroundColor: colors.textSubtle, borderRadius: radius.pill, height: 6, width: 6 },
  dotActive: { backgroundColor: colors.primary, width: 18 },
  dots: { alignSelf: 'center', flexDirection: 'row', gap: 6 },
  eyebrow: { letterSpacing: 0.8, textTransform: 'uppercase' },
  gradient: { flex: 1, justifyContent: 'center', paddingHorizontal: 18 },
  page: { paddingHorizontal: spacing.gutter },
  placeholder: { height: BANNER_HEIGHT },
  pressed: { opacity: 0.92 },
  slide: { borderRadius: radius.md, height: BANNER_HEIGHT, overflow: 'hidden' },
});
