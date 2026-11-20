import { useCallback, useState } from 'react';

import { useCart } from '@/features/cart/CartProvider';
import { resetCheckoutDraft } from '@/features/checkout/checkout-draft';
import { signOut } from '@/features/session/auth-service';
import { confirmAction } from '@/lib/notify';

/**
 * Confirm, end the session, empty the cart and the checkout draft (docs/CLIENTS.md §2.5). `api.session.signOut()` never
 * rejects and also removes this install's push device, so nothing else is needed. The root layout
 * shows the shop as a guest afterwards.
 */
export function useSignOut() {
  const cart = useCart();
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    const confirmed = await confirmAction(
      'Sign out?',
      'Your cart on this device will be emptied. Sign in again any time to keep ordering.',
      'Sign out',
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      await signOut();
      cart.clear();
      resetCheckoutDraft();
    } finally {
      setBusy(false);
    }
  }, [cart]);

  return { signOut: run, busy };
}
