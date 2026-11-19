/** Auth, Functions and Storage clients for the signed-in back office. */
import { browserLocalPersistence, connectAuthEmulator, initializeAuth } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

import { emulatorHost, env } from '../env';
import { app } from './app';

export const auth = initializeAuth(app, { persistence: browserLocalPersistence });
export const functions = getFunctions(app, env.functionsRegion);
export const storage = getStorage(app);

if (env.useEmulators) {
  connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
  connectFunctionsEmulator(functions, emulatorHost, 5001);
  connectStorageEmulator(storage, emulatorHost, 9199);
}
