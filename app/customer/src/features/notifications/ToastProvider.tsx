import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CONTENT_MAX_WIDTH, Icon, Text, type IconName } from '@/components/ui';
import { colors, radius, shadows } from '@/theme/tokens';

// The web has no native animation driver (Animated warns and falls back to JS).
const useNativeDriver = Platform.OS !== 'web';

/** Gap between the toast and the edges of the screen. */
const EDGE = 14;
// In a desktop browser the toast keeps to the content column (with the same gap) instead of
// spanning the window: capped in width, the auto margins centre it between `left` and `right`.
const webColumnToast =
  Platform.OS === 'web'
    ? ({ marginHorizontal: 'auto', maxWidth: CONTENT_MAX_WIDTH - 2 * EDGE } as const)
    : null;

interface Toast {
  title: string;
  body?: string;
  icon?: IconName;
  onPress?: () => void;
}

const ToastContext = createContext<(toast: Toast) => void>(() => undefined);

/** In-app banner for live order updates and quick confirmations ("Added to cart"). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const translate = useRef(new Animated.Value(-160)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();

  const hide = useCallback(() => {
    Animated.timing(translate, { toValue: -160, duration: 200, useNativeDriver }).start(({ finished }) => {
      // A toast shown while this one slides out interrupts the exit; that toast must stay up.
      if (finished) setToast(null);
    });
  }, [translate]);

  const show = useCallback(
    (next: Toast) => {
      if (timer.current) clearTimeout(timer.current);
      setToast(next);
      Animated.spring(translate, { toValue: 0, useNativeDriver, friction: 8 }).start();
      timer.current = setTimeout(hide, next.body ? 4500 : 2200);
    },
    [hide, translate],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.container,
            webColumnToast,
            { top: insets.top + 8, transform: [{ translateY: translate }] },
          ]}
        >
          <Pressable
            accessibilityRole="alert"
            onPress={() => {
              hide();
              toast.onPress?.();
            }}
            style={[styles.toast, shadows.soft]}
          >
            <View style={styles.icon}>
              <Icon name={toast.icon ?? 'bell'} size={18} color={colors.primary} />
            </View>
            <View style={styles.text}>
              <Text variant="bodyMedium" numberOfLines={1}>
                {toast.title}
              </Text>
              {toast.body ? (
                <Text variant="caption" color="muted" numberOfLines={2}>
                  {toast.body}
                </Text>
              ) : null}
            </View>
          </Pressable>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

const styles = StyleSheet.create({
  container: { left: EDGE, position: 'absolute', right: EDGE, zIndex: 100 },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  text: { flex: 1, gap: 1 },
  toast: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: 12,
    padding: 12,
  },
});
