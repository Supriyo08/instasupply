import { isArtKey } from '@instasupply/art';
import { LinearGradient } from 'expo-linear-gradient';
import type { ComponentProps, ReactNode } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors } from '@/theme/tokens';

import { FloatingArt } from './FloatingArt';
import { IconBadge } from './StepHeading';

type AnimatedViewStyle = ComponentProps<typeof Animated.View>['style'];

/** Scene illustrations are drawn on a 360 × 300 canvas. */
const ART_ASPECT = 300 / 360;
const MAX_ART_WIDTH = 420;
const CURVE_HEIGHT = 40;

export interface HeroPanelProps {
  artKey: string;
  width: number;
  height: number;
  /** Room kept clear at the top (status bar, wordmark, back button). */
  topInset?: number;
  /** Room kept clear at the bottom (e.g. a sheet overlapping the hero). */
  bottomInset?: number;
  /** Curve the bottom edge into the white page below (onboarding). */
  curved?: boolean;
  /** Extra animated style for the art, e.g. the onboarding parallax. */
  artStyle?: AnimatedViewStyle;
  /** Let the art float gently; off for slides that are not on screen. */
  animate?: boolean;
  /** Overlay content such as the back button or the wordmark. */
  children?: ReactNode;
}

/**
 * Soft lime panel holding a scene illustration on a white halo, with a few decorative bubbles —
 * the illustrated stand-in for the photo headers of the Big Cart design.
 */
export function HeroPanel({
  artKey,
  width,
  height,
  topInset = 0,
  bottomInset = 0,
  curved = false,
  artStyle,
  animate = true,
  children,
}: HeroPanelProps) {
  const bottomRoom = bottomInset + (curved ? CURVE_HEIGHT * 0.7 : 0);
  const room = Math.max(0, height - topInset - bottomRoom - 12);
  const artWidth = Math.max(120, Math.min(width - 48, MAX_ART_WIDTH, room / ART_ASPECT));
  const artHeight = artWidth * ART_ASPECT;
  const halo = artWidth * 0.94;

  return (
    <View style={[styles.panel, { width, height }]}>
      <LinearGradient
        colors={[colors.primarySoft, colors.primaryTint]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Bubbles width={width} height={height} />
      <View style={[styles.stage, { paddingTop: topInset, paddingBottom: bottomRoom }]}>
        <Animated.View style={[{ width: artWidth, height: artHeight }, artStyle]}>
          <View
            style={[
              styles.halo,
              {
                width: halo,
                height: halo,
                borderRadius: halo / 2,
                left: (artWidth - halo) / 2,
                top: artHeight * 0.53 - halo / 2,
              },
            ]}
          />
          {isArtKey(artKey) ? (
            <FloatingArt artKey={artKey} width={artWidth} height={artHeight} animate={animate} />
          ) : (
            // Scene missing from the art build: a brand badge rather than a blank placeholder. (Not a
            // second copy of another scene — on web, duplicate inline SVGs share gradient ids.)
            <View style={styles.missingArt}>
              <IconBadge icon="shopping-bag" size={Math.min(artHeight * 0.62, 170)} />
            </View>
          )}
        </Animated.View>
      </View>
      {curved ? <CurvedEdge width={width} /> : null}
      {children}
    </View>
  );
}

function Bubbles({ width, height }: { width: number; height: number }) {
  const big = Math.min(width, 520) * 0.62;
  const ring = big * 0.5;
  return (
    <View style={StyleSheet.absoluteFill}>
      <View
        style={[
          styles.bubble,
          { width: big, height: big, borderRadius: big / 2, top: -big * 0.4, right: -big * 0.3 },
        ]}
      />
      <View
        style={[
          styles.ring,
          { width: ring, height: ring, borderRadius: ring / 2, bottom: height * 0.14, left: -ring * 0.45 },
        ]}
      />
      <View style={[styles.dot, { top: height * 0.36, left: width * 0.07 }]} />
      <View style={[styles.dot, styles.dotSmall, { top: height * 0.24, right: width * 0.09 }]} />
      <View style={[styles.dot, styles.dotSmall, { bottom: height * 0.2, right: width * 0.16 }]} />
    </View>
  );
}

/** White dome rising into the panel, as on the Big Cart onboarding screens. */
function CurvedEdge({ width }: { width: number }) {
  const edge = CURVE_HEIGHT - 6;
  return (
    <Svg width={width} height={CURVE_HEIGHT} style={styles.curve}>
      <Path
        d={`M0 ${CURVE_HEIGHT} V${edge} Q${width / 2} ${-edge} ${width} ${edge} V${CURVE_HEIGHT} Z`}
        fill={colors.surface}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  bubble: { backgroundColor: colors.white, opacity: 0.4, position: 'absolute' },
  curve: { bottom: -1, left: 0, position: 'absolute' },
  dot: {
    backgroundColor: colors.primaryLight,
    borderRadius: 5,
    height: 10,
    opacity: 0.9,
    position: 'absolute',
    width: 10,
  },
  dotSmall: { borderRadius: 3, height: 6, width: 6 },
  halo: { backgroundColor: colors.white, opacity: 0.6, position: 'absolute' },
  missingArt: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  panel: { overflow: 'hidden' },
  ring: { borderColor: colors.white, borderWidth: 12, opacity: 0.45, position: 'absolute' },
  stage: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
