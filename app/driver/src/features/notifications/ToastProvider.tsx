import type { StatusTone } from '@instasupply/shared';
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
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { toneColors } from '@/theme/tokens';

interface Toast {
  title: string;
  body?: string;
  tone?: StatusTone;
  onPress?: () => void;
}

const ToastContext = createContext<(toast: Toast) => void>(() => undefined);

/** Lightweight in-app banner, used for live alerts even where push isn't available. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const translate = useRef(new Animated.Value(-160)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const { colors, radius } = useTheme();

  const hide = useCallback(() => {
    Animated.timing(translate, { toValue: -160, duration: 220, useNativeDriver: true }).start(() =>
      setToast(null),
    );
  }, [translate]);

  const show = useCallback(
    (next: Toast) => {
      if (timer.current) clearTimeout(timer.current);
      setToast(next);
      Animated.spring(translate, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
      timer.current = setTimeout(hide, 5000);
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
  const { fg, bg } = toneColors(colors, toast?.tone ?? 'brand');

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="box-none"
          style={[styles.container, { top: insets.top + 8, transform: [{ translateY: translate }] }]}
        >
          <Pressable
            accessibilityRole="alert"
            onPress={() => {
              hide();
              toast.onPress?.();
            }}
            style={[
              styles.toast,
              { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.lg },
            ]}
          >
            <View style={[styles.icon, { backgroundColor: bg }]}>
              <Icon name="notifications" size={18} color={fg} />
            </View>
            <View style={styles.text}>
              <Text variant="bodyStrong" numberOfLines={1}>
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
  container: { left: 12, position: 'absolute', right: 12, zIndex: 100 },
  icon: { alignItems: 'center', borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  text: { flex: 1, gap: 2 },
  toast: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 6,
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
  },
});
