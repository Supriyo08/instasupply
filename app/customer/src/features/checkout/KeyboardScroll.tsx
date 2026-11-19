import { useCallback, useEffect, useRef, type ReactNode, type Ref } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  type LayoutChangeEvent,
  type ScrollViewInstance,
} from 'react-native';

import { spacing } from '@/theme/tokens';

/**
 * Scroll body for checkout screens with a text field (promo code, delivery notes). Use it inside
 * `<Screen scroll={false} contentStyle={scrollBodyContainer}>`; it matches Screen's own spacing.
 */
export function ScrollBody({ children, ref }: { children: ReactNode; ref: Ref<ScrollViewInstance> }) {
  return (
    <ScrollView ref={ref} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {children}
    </ScrollView>
  );
}

/** `contentStyle` for the Screen that hosts a ScrollBody (the body pads itself). */
export const scrollBodyContainer = { paddingTop: 0 } as const;

/**
 * On iOS, Screen's KeyboardAvoidingView shrinks the scroll area but nothing scrolls the focused
 * field back into view, so a field near the bottom ends up hidden. `track(key)` records where a
 * section sits; `reveal(key)` (call it from the field's onFocus) scrolls it to the top once the
 * keyboard is up. Android and the web already do this on their own.
 */
export function useKeyboardReveal() {
  const scrollRef = useRef<ScrollViewInstance>(null);
  const offsets = useRef(new Map<string, number>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const track = useCallback(
    (key: string) => (event: LayoutChangeEvent) => {
      offsets.current.set(key, event.nativeEvent.layout.y);
    },
    [],
  );

  const reveal = useCallback((key: string) => {
    if (Platform.OS !== 'ios') return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const y = offsets.current.get(key);
      if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.md), animated: true });
    }, 320);
  }, []);

  return { scrollRef, track, reveal };
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    paddingBottom: 40,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.lg,
  },
});
