/**
 * Registers this device for push for every driver status, not only `ready` (code review R59): a pending
 * driver must receive "You're approved". It never prompts (`(app)` and the pending screen ask), and it is
 * never mounted for staff, shopper or supplier accounts, whose pushes must not land in the driver app.
 * Re-registers when the platform rotates the token.
 */
import { useEffect } from 'react';

import { onPushTokenChange, registerForPush } from './push';

export function PushRegistrar({ uid }: { uid: string }) {
  useEffect(() => {
    const register = () => void registerForPush({ prompt: false }).catch(() => undefined);
    register();
    return onPushTokenChange(register);
  }, [uid]);
  return null;
}
