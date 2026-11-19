import type { CardBrand } from '@instasupply/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Platform, StyleSheet, View, type ViewStyle } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/theme/tokens';

import { CardBrandMark } from './CardBrandMark';

// The web has no native animation driver (Animated warns and falls back to JS).
const useNativeDriver = Platform.OS !== 'web';

const CARD_GRADIENT = [colors.primary, colors.primaryLight] as const;

export interface CardFrontProps {
  brand: CardBrand;
  /** Display string, e.g. "••••  ••••  ••••  4242". */
  number: string;
  holder: string;
  expiry: string;
  /** Pill in the top-right corner (Default / Expired). */
  badge?: ReactNode;
}

/** The Big Cart card art: darker green circles and two small diamonds on the right. */
function Decorations() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[styles.circle, styles.circleTop]} />
      <View style={[styles.circle, styles.circleCorner]} />
      <View style={[styles.circle, styles.circleMiddle]} />
      <View style={[styles.circle, styles.circleBottom]} />
      <View style={[styles.diamond, styles.diamondRed]} />
      <View style={[styles.diamond, styles.diamondAmber]} />
    </View>
  );
}

function Front({ brand, number, holder, expiry, badge }: CardFrontProps) {
  return (
    <>
      <View style={[styles.row, styles.top]}>
        <CardBrandMark brand={brand} />
        {badge}
      </View>
      <Text style={styles.number} numberOfLines={1} adjustsFontSizeToFit>
        {number}
      </Text>
      <View style={styles.row}>
        <View style={styles.holder}>
          <Text style={styles.caption}>CARD HOLDER</Text>
          <Text style={[styles.value, styles.upper]} numberOfLines={1}>
            {holder}
          </Text>
        </View>
        <View style={styles.expiry}>
          <Text style={styles.caption}>EXPIRES</Text>
          <Text style={styles.value}>{expiry}</Text>
        </View>
      </View>
    </>
  );
}

function Back({ cvvLength }: { cvvLength: number }) {
  return (
    <>
      <View style={styles.strip} />
      <View style={styles.signatureRow}>
        <View style={styles.signature} />
        <View style={styles.cvvBox}>
          <Text style={styles.cvv}>{cvvLength > 0 ? '•'.repeat(cvvLength) : 'CVV'}</Text>
        </View>
      </View>
      <View style={styles.backNote}>
        <Icon name="lock" size={12} color={colors.white} />
        <Text style={styles.caption}>YOUR CVV IS NEVER STORED</Text>
      </View>
    </>
  );
}

/**
 * Green gradient credit card (front, or back while the CVV is typed). Flipping animates with a
 * horizontal squeeze, which works the same on iOS, Android and the web.
 */
export function CardVisual({
  side = 'front',
  cvvLength = 0,
  dimmed = false,
  accessibilityLabel,
  style,
  ...front
}: CardFrontProps & {
  side?: 'front' | 'back';
  cvvLength?: number;
  dimmed?: boolean;
  accessibilityLabel: string;
  style?: ViewStyle;
}) {
  const squeeze = useRef(new Animated.Value(1)).current;
  const [shown, setShown] = useState(side);

  useEffect(() => {
    if (side === shown) return;
    Animated.timing(squeeze, { toValue: 0, duration: 120, useNativeDriver }).start(() => {
      setShown(side);
      Animated.timing(squeeze, { toValue: 1, duration: 160, useNativeDriver }).start();
    });
  }, [shown, side, squeeze]);

  return (
    <Animated.View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.card,
        shadows.brand,
        dimmed ? styles.dimmed : null,
        { transform: [{ scaleX: squeeze }] },
        style,
      ]}
    >
      <View style={styles.clip}>
        <LinearGradient
          colors={CARD_GRADIENT}
          start={{ x: 0.05, y: 0.95 }}
          end={{ x: 0.95, y: 0.05 }}
          style={StyleSheet.absoluteFill}
        />
        <Decorations />
        <View style={styles.content}>
          {shown === 'front' ? <Front {...front} /> : <Back cvvLength={cvvLength} />}
        </View>
      </View>
    </Animated.View>
  );
}

const textShadow = {
  textShadowColor: colors.primaryDark,
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 2,
} as const;

const styles = StyleSheet.create({
  backNote: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  caption: {
    ...textShadow,
    color: colors.white,
    fontFamily: fonts.medium,
    fontSize: 9,
    letterSpacing: 0.8,
    lineHeight: 13,
  },
  card: {
    alignSelf: 'center',
    aspectRatio: 1.8,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    maxWidth: 420,
    width: '100%',
  },
  circle: { backgroundColor: colors.primary, borderRadius: 999, position: 'absolute' },
  circleBottom: { bottom: -22, height: 50, right: -8, width: 50 },
  circleCorner: { height: 86, right: -30, top: -28, width: 86 },
  circleMiddle: { height: 80, right: -42, top: '38%', width: 80 },
  circleTop: { height: 64, right: 46, top: -20, width: 64 },
  clip: { borderRadius: radius.lg, flex: 1, overflow: 'hidden' },
  content: { flex: 1, justifyContent: 'space-between', padding: 20 },
  cvv: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14, letterSpacing: 2 },
  cvvBox: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    height: 34,
    justifyContent: 'center',
    minWidth: 64,
    paddingHorizontal: 12,
  },
  diamond: { position: 'absolute', transform: [{ rotate: '45deg' }] },
  diamondAmber: { backgroundColor: colors.star, bottom: '30%', height: 10, right: 20, width: 10 },
  diamondRed: { backgroundColor: colors.danger, height: 13, right: 70, top: '27%', width: 13 },
  dimmed: { opacity: 0.6 },
  expiry: { alignItems: 'flex-end', marginRight: 26 },
  holder: { flex: 1, marginRight: 12 },
  number: { ...textShadow, color: colors.white, fontFamily: fonts.medium, fontSize: 18, letterSpacing: 1.5 },
  row: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between' },
  signature: { backgroundColor: colors.white, borderRadius: radius.sm, flex: 1, height: 34, opacity: 0.75 },
  signatureRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  strip: { backgroundColor: colors.text, height: 38, marginHorizontal: -20, opacity: 0.8 },
  top: { alignItems: 'center', minHeight: 28 },
  upper: { textTransform: 'uppercase' },
  value: { ...textShadow, color: colors.white, fontFamily: fonts.semibold, fontSize: 13, letterSpacing: 0.5 },
});
