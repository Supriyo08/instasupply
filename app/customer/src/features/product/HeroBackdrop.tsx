import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors } from '@/theme/tokens';

/**
 * Backdrop of the product hero (the Big Cart product page): a pastel blob with a soft curved
 * bottom edge, drawn in two layers for depth, plus a few floating highlights. Fills its parent,
 * so render it first inside a positioned container.
 */
export function HeroBackdrop({ tint }: { tint: string }) {
  return (
    <View style={styles.fill}>
      {/* Paints the iOS over-scroll bounce above the hero in the same colour. */}
      <View style={[styles.overscroll, { backgroundColor: tint }]} />
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Path d="M0 0H100V64C100 81 79 89 50 89C21 89 0 81 0 64Z" fill={tint} fillOpacity={0.45} />
        <Path d="M0 0H100V55C100 72 81 81 50 81C19 81 0 72 0 55Z" fill={tint} />
      </Svg>
      <View style={[styles.bubble, styles.bubbleLarge]} />
      <View style={[styles.bubble, styles.bubbleMedium]} />
      <View style={[styles.bubble, styles.bubbleSmall]} />
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { backgroundColor: colors.white, opacity: 0.45, position: 'absolute' },
  bubbleLarge: { borderRadius: 70, height: 140, right: -48, top: '16%', width: 140 },
  bubbleMedium: { borderRadius: 18, height: 36, left: '8%', top: '44%', width: 36 },
  bubbleSmall: { borderRadius: 8, height: 16, left: '21%', top: '27%', width: 16 },
  fill: { bottom: 0, left: 0, pointerEvents: 'none', position: 'absolute', right: 0, top: 0 },
  overscroll: { height: 600, left: 0, position: 'absolute', right: 0, top: -600 },
});
