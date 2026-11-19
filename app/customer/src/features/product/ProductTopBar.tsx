import { router } from 'expo-router';
import { useMemo } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { Header, IconButton } from '@/components/ui';
import { useCart } from '@/features/cart/CartProvider';
import { colors, shadows } from '@/theme/tokens';

/**
 * Floating header over the product hero: transparent at the top, fading into the white Big Cart
 * header (with the product name) once the hero has scrolled away. Includes a cart shortcut.
 */
export function ProductTopBar({
  scrollY,
  solidAt,
  solid,
  title,
}: {
  scrollY: Animated.Value;
  /** Scroll offset at which the bar is fully white. */
  solidAt: number;
  /** Past `solidAt`: show the title. */
  solid: boolean;
  title: string;
}) {
  const cart = useCart();
  const backdropOpacity = useMemo(
    () =>
      scrollY.interpolate({
        inputRange: [Math.max(0, solidAt - 64), Math.max(1, solidAt)],
        outputRange: [0, 1],
        extrapolate: 'clamp',
      }),
    [scrollY, solidAt],
  );

  return (
    <View style={styles.bar}>
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} />
      <Header
        transparent
        title={solid ? title : undefined}
        right={
          <IconButton
            icon="shopping-bag"
            label={cart.count > 0 ? `Cart, ${cart.count} items` : 'Cart'}
            badge={cart.count}
            onPress={() => router.push('/cart')}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // `overlay` is the shadow without Android elevation, which would lift the backdrop above the buttons.
  backdrop: {
    ...shadows.overlay,
    backgroundColor: colors.surface,
    bottom: 0,
    left: 0,
    pointerEvents: 'none',
    position: 'absolute',
    right: 0,
    top: 0,
  },
  bar: { left: 0, position: 'absolute', right: 0, top: 0 },
});
