import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';

import { registerForPush } from '@/features/notifications/push';

/** `ask`: never answered (or may ask again); `blocked`: denied in system settings. */
export type PushPermission = 'checking' | 'granted' | 'ask' | 'blocked' | 'unsupported';

/** This device's notification permission, re-checked when the app returns from Settings. */
export function usePushPermission(uid: string) {
  const [status, setStatus] = useState<PushPermission>(Platform.OS === 'web' ? 'unsupported' : 'checking');

  const refresh = useCallback(async () => {
    if (Platform.OS === 'web') return;
    try {
      const current = await Notifications.getPermissionsAsync();
      setStatus(current.granted ? 'granted' : current.canAskAgain ? 'ask' : 'blocked');
    } catch {
      setStatus('unsupported');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  /** Ask for permission (and register this device), or open Settings when it was denied. */
  const enable = useCallback(async () => {
    if (status === 'blocked') {
      await Linking.openSettings().catch(() => undefined);
      return;
    }
    try {
      const result = await Notifications.requestPermissionsAsync();
      if (result.granted) await registerForPush(uid);
    } finally {
      await refresh();
    }
  }, [refresh, status, uid]);

  return { status, enable };
}
