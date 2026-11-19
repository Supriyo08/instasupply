import { describeError } from '@instasupply/expo-firebase';
import { useCallback, useState } from 'react';

import { useCart } from '@/features/cart/CartProvider';
import { unregisterDevice } from '@/features/notifications/push';
import { signOut } from '@/features/session/auth-service';
import { confirmAction, notify } from '@/lib/notify';

/** How long sign-out waits for this device's push registration to be removed. */
const UNREGISTER_TIMEOUT_MS = 3_000;

/** Resolves when `task` settles or after `ms`, whichever comes first. Never rejects. */
function settleWithin(task: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    task.then(done, done);
  });
}

/**
 * Confirm, stop pushes to this device (needs the signed-in user, so it runs first, but only for a
 * few seconds), empty the cart, then end the session. The root layout routes to the welcome screen
 * on its own.
 */
export function useSignOut(uid: string) {
  const cart = useCart();
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    const confirmed = await confirmAction(
      'Sign out?',
      'Your cart on this device will be emptied. Sign in again any time to keep shopping.',
      'Sign out',
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      // Best effort: Firestore only confirms the delete once the server answers, which never
      // happens offline. Signing out must not wait for that.
      await settleWithin(unregisterDevice(uid), UNREGISTER_TIMEOUT_MS);
      cart.clear();
      await signOut();
    } catch (error) {
      setBusy(false);
      notify("Couldn't sign out", describeError(error));
    }
  }, [cart, uid]);

  return { signOut: run, busy };
}
