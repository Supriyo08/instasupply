/**
 * The current push permission, checked again whenever the app comes back to the foreground (the driver
 * may have changed it in settings). `enable` prompts and, once granted, registers the device (CLIENTS §6.2).
 * Used by the profile screen and the onboarding pending step (code review R59: "You're approved" needs a
 * device row before approval).
 */
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { pushPermission, registerForPush } from './push';
import { pushAvailability } from './push-availability';

export type PushPermissionStatus = 'granted' | 'ask' | 'blocked' | 'unavailable' | 'checking';

export function usePushPermission(): { status: PushPermissionStatus; enable: () => Promise<void> } {
  const [status, setStatus] = useState<PushPermissionStatus>(() =>
    pushAvailability().available ? 'checking' : 'unavailable',
  );

  const check = useCallback(async () => {
    try {
      setStatus(await pushPermission());
    } catch {
      setStatus('unavailable');
    }
  }, []);

  useEffect(() => {
    void check();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => subscription.remove();
  }, [check]);

  const enable = useCallback(async () => {
    try {
      const result = await registerForPush({ prompt: true });
      if (result.status === 'denied' && !result.canAskAgain) {
        setStatus('blocked');
        return;
      }
    } catch {
      // Granted but the device row failed (offline): PushRegistrar retries at the next start.
    }
    await check();
  }, [check]);

  return { status, enable };
}
