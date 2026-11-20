import AsyncStorage from '@react-native-async-storage/async-storage';

import { stopBackgroundUpdates } from './background-task';
import { MODE_KEY, ONLINE_KEY, publisher } from './publisher';

/**
 * Local clean-up when a session ends for any reason (sign-out from any screen, expiry, revocation,
 * suspension): stop the OS location updates, forget the online switch and the mode, and drop the
 * publisher's queue. Best effort and never rejects (docs/CLIENTS.md §2.5 step 3, code review R67).
 * The server sets the driver offline itself when the session ends.
 */
export async function cleanUpLocationAfterSessionEnd(): Promise<void> {
  await stopBackgroundUpdates();
  await AsyncStorage.multiRemove([ONLINE_KEY, MODE_KEY]).catch(() => undefined);
  publisher.reset();
}
