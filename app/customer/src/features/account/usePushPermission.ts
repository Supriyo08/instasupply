import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';

import { pushAvailability } from '@/features/notifications/push-availability';
import { registerForPush } from '@/features/notifications/push';

/** `ask`: never answered (or may ask again); `blocked`: denied in system settings; `unsupported`: no push in this build. */
export type PushPermission = 'checking' | 'granted' | 'ask' | 'blocked' | 'unsupported';

/**
 * This device's notification permission, re-checked when the app returns from Settings. Without push
 * (web, Expo Go, a build without push credentials) it is `unsupported`: Settings then says
 * "Push alerts aren't set up in this build. Updates appear in your inbox." (docs/CLIENTS.md §6.7).
 */
export function usePushPermission() {
  const supported = pushAvailability().available;
  const [status, setStatus] = useState<PushPermission>(supported ? 'checking' : 'unsupported');

  const refresh = useCallback(async () => {
    if (!supported) return;
    try {
      const current = await Notifications.getPermissionsAsync();
      setStatus(current.granted ? 'granted' : current.canAskAgain ? 'ask' : 'blocked');
    } catch {
      setStatus('unsupported');
    }
  }, [supported]);

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  /** Ask for permission and register this device, or open Settings when it was denied. */
  const enable = useCallback(async () => {
    if (status === 'blocked') {
      await Linking.openSettings().catch(() => undefined);
      return;
    }
    try {
      await registerForPush({ prompt: true });
    } finally {
      await refresh();
    }
  }, [refresh, status]);

  return { status, enable };
}
