import { useCallback, useState } from 'react';

import { signOut } from '@/features/auth/auth-service';
import { usePresence } from '@/features/location/PresenceProvider';
import { unregisterDevice } from '@/features/notifications/push';

/** Go offline and stop pushes to this device before ending the session. */
export function useSignOut(uid: string) {
  const { online, setOnline } = usePresence();
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    try {
      if (online) await setOnline(false);
      await unregisterDevice(uid);
    } finally {
      await signOut();
    }
  }, [online, setOnline, uid]);

  return { signOut: run, busy };
}
