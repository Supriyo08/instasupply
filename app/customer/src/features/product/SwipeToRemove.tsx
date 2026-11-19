import { useMemo, useRef, type ReactNode } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui';
import { colors, radius } from '@/theme/tokens';

const ACTION_WIDTH = 80;
const OPEN = -ACTION_WIDTH;

/**
 * Swipe a row left to reveal the red delete tile from the Big Cart favourites screen. It is a
 * touch shortcut only: rows keep a visible remove button, which is the accessible path.
 */
export function SwipeToRemove({ children, onRemove }: { children: ReactNode; onRemove: () => void }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const offset = useRef(0);
  const grantDx = useRef(0);

  const { panHandlers, close } = useMemo(() => {
    // JS-driven on purpose: the drag itself sets the value from JS on every move.
    const settle = (to: number) => {
      offset.current = to;
      Animated.spring(translateX, { toValue: to, useNativeDriver: false, speed: 18, bounciness: 0 }).start();
    };
    const responder = PanResponder.create({
      // Only clearly horizontal drags; vertical ones keep scrolling the list.
      onMoveShouldSetPanResponder: (_event, gesture) =>
        Math.abs(gesture.dx) > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderGrant: (_event, gesture) => {
        grantDx.current = gesture.dx;
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_event, gesture) => {
        const next = offset.current + gesture.dx - grantDx.current;
        translateX.setValue(Math.min(0, Math.max(OPEN * 1.4, next)));
      },
      onPanResponderRelease: (_event, gesture) => {
        const end = offset.current + gesture.dx - grantDx.current;
        settle(gesture.vx < -0.5 || (gesture.vx < 0.5 && end < OPEN / 2) ? OPEN : 0);
      },
      onPanResponderTerminate: () => settle(0),
    });
    return { panHandlers: responder.panHandlers, close: () => settle(0) };
  }, [translateX]);

  const actionOpacity = useMemo(
    () =>
      translateX.interpolate({ inputRange: [OPEN, -12, 0], outputRange: [1, 0, 0], extrapolate: 'clamp' }),
    [translateX],
  );

  return (
    <View>
      <Animated.View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.action, { opacity: actionOpacity }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove"
          onPress={() => {
            close();
            onRemove();
          }}
          style={({ pressed }) => [styles.actionButton, pressed ? styles.pressed : null]}
        >
          <Icon name="trash-2" size={22} color={colors.white} />
        </Pressable>
      </Animated.View>
      <Animated.View style={{ transform: [{ translateX }] }} {...panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  action: { bottom: 0, position: 'absolute', right: 0, top: 0, width: ACTION_WIDTH - 10 },
  actionButton: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderRadius: radius.sm,
    flex: 1,
    justifyContent: 'center',
  },
  pressed: { opacity: 0.8 },
});
