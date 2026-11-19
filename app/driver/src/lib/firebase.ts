import { getApp, getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, initializeFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

import { env, resolveEmulatorHost } from './env';
import { createAuth } from './firebase-auth';

const isFirstInit = getApps().length === 0;
export const app = isFirstInit ? initializeApp(env.firebase) : getApp();

export const auth = createAuth(app);

// Long-polling auto-detection keeps Firestore streaming reliable on mobile networks and proxies.
export const db = isFirstInit
  ? initializeFirestore(app, { experimentalAutoDetectLongPolling: true })
  : getFirestore(app);

export const functions = getFunctions(app, env.functionsRegion);
export const storage = getStorage(app);

if (env.useEmulators && isFirstInit) {
  const host = resolveEmulatorHost();
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectFunctionsEmulator(functions, host, 5001);
  connectStorageEmulator(storage, host, 9199);
}
