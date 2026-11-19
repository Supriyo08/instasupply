import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import { connectAuthEmulator, type Auth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  type Firestore,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';

import { createAuth } from './auth-persistence';

export interface FirebaseClientConfig {
  firebase: FirebaseOptions;
  functionsRegion: string;
  /** Connect to the local Emulator Suite instead of a real project. */
  useEmulators: boolean;
  /** Host running the emulators (see resolveEmulatorHost). */
  emulatorHost: string;
}

export interface FirebaseClient {
  auth: Auth;
  db: Firestore;
  functions: Functions;
  storage: FirebaseStorage;
}

/**
 * Initialise Firebase once per app. Config is passed in by the app (not read from env here)
 * because Expo only inlines EXPO_PUBLIC_* variables in the app's own source files.
 */
export function createFirebaseClient(config: FirebaseClientConfig): FirebaseClient {
  const isFirstInit = getApps().length === 0;
  const app = isFirstInit ? initializeApp(config.firebase) : getApp();
  const auth = createAuth(app);
  // Long-polling auto-detection keeps Firestore streaming reliable on mobile networks and proxies.
  const db = isFirstInit ? initializeFirestore(app, { experimentalAutoDetectLongPolling: true }) : getFirestore(app);
  const functions = getFunctions(app, config.functionsRegion);
  const storage = getStorage(app);

  if (config.useEmulators && isFirstInit) {
    const host = config.emulatorHost;
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, host, 8080);
    connectFunctionsEmulator(functions, host, 5001);
    connectStorageEmulator(storage, host, 9199);
  }
  return { auth, db, functions, storage };
}
