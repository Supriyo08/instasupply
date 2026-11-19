import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FirebaseApp } from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';
import type { Auth, Persistence } from 'firebase/auth';

interface ReactNativeStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// `getReactNativePersistence` only exists in Firebase's React Native build, which Metro resolves
// on iOS/Android. Its public typings omit it, hence the narrow cast.
const { getReactNativePersistence } = FirebaseAuth as unknown as {
  getReactNativePersistence: (storage: ReactNativeStorage) => Persistence;
};

/** Auth that survives app restarts by persisting the session in AsyncStorage. */
export function createAuth(app: FirebaseApp): Auth {
  try {
    return FirebaseAuth.initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
  } catch {
    // Already initialized (fast refresh).
    return FirebaseAuth.getAuth(app);
  }
}
