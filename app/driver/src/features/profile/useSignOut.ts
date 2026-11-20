import { useCallback, useState } from 'react';

import { signOut } from '@/features/auth/auth-service';
import { usePresence } from '@/features/location/PresenceProvider';

/**
 * Sign-out inside `(app)` (docs/CLIENTS.md §2.5): go offline first (bounded, a failure is ignored), then
 * the common sign-out, which stops the background task, forgets the switch and calls
 * `api.session.signOut()`. That never rejects and never hangs without signal (R70, R71), and the server
 * removes this install's push device with the session.
 */
export function useSignOut() {
  const { online, setOnline } = usePresence();
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    try {
      if (online) await setOnline(false).catch(() => undefined);
    } finally {
      await signOut();
    }
  }, [online, setOnline]);

  return { signOut: run, busy };
}
