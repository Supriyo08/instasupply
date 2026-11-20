import { useEffect } from 'react';

import { useToast } from '@/features/notifications/ToastProvider';
import { notify } from '@/lib/notify';

import { useSession } from './SessionProvider';

/** Tells the customer why the session ended, once (docs/CLIENTS.md §2.4). Renders nothing. */
export function SessionEndNotice() {
  const { endReason, acknowledgeEnd } = useSession();
  const toast = useToast();
  useEffect(() => {
    if (!endReason) return;
    if (endReason === 'expired' || endReason === 'revoked') {
      toast({ title: 'Your session has ended', body: 'Please sign in again.', icon: 'log-out' });
    } else if (endReason === 'suspended') {
      notify('Account suspended', 'Your account is suspended. Contact InstaSupply support.');
    }
    acknowledgeEnd();
  }, [endReason, acknowledgeEnd, toast]);
  return null;
}
