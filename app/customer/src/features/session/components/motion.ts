import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/** The native animation driver is not available on web. */
export const USE_NATIVE_DRIVER = Platform.OS !== 'web';

/** True when the user asked the OS to reduce motion; decorative animations are skipped then. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active) setReduced(value);
      })
      .catch(() => undefined);
    // react-native-web returns nothing when matchMedia is unavailable, hence the optional call below.
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      active = false;
      subscription?.remove();
    };
  }, []);

  return reduced;
}

/**
 * Whole seconds left until a deadline (epoch ms). `restart(endsAt)` starts a new countdown, e.g.
 * after a new code was sent.
 */
export function useCountdown(initialEndsAt: number) {
  const [clock, setClock] = useState(() => ({ endsAt: initialEndsAt, now: Date.now() }));
  const remaining = Math.max(0, Math.ceil((clock.endsAt - clock.now) / 1000));
  const running = remaining > 0;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setClock((current) => ({ ...current, now: Date.now() })), 500);
    return () => clearInterval(timer);
  }, [running]);

  const restart = useCallback((endsAt: number) => setClock({ endsAt, now: Date.now() }), []);
  return { remaining, restart };
}

/** 83 → "1:23". */
export function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
