import { createFirebaseClient } from '@instasupply/expo-firebase';

import { env } from './env';

export const { auth, db, functions, storage } = createFirebaseClient({
  firebase: env.firebase,
  functionsRegion: env.functionsRegion,
  useEmulators: env.useEmulators,
  emulatorHost: env.emulatorHost,
});
