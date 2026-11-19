import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { DEFAULT_FUNCTIONS_REGION } from '@instasupply/shared';

// EXPO_PUBLIC_* variables are inlined at build time, so they must be read with literal names.
export const env = {
  useEmulators: process.env.EXPO_PUBLIC_USE_EMULATORS === 'true',
  emulatorHost: process.env.EXPO_PUBLIC_EMULATOR_HOST || null,
  functionsRegion: process.env.EXPO_PUBLIC_FUNCTIONS_REGION || DEFAULT_FUNCTIONS_REGION,
  dispatchPhone: process.env.EXPO_PUBLIC_DISPATCH_PHONE || null,
  firebase: {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || 'demo-key',
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || 'demo-instasupply.firebaseapp.com',
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'demo-instasupply',
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || 'demo-instasupply.appspot.com',
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || undefined,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || undefined,
  },
};

/**
 * Where the emulators run. On a phone the emulators live on the computer running `expo start`,
 * so we reuse the host of the Metro dev server; on web it's the page's host.
 */
export function resolveEmulatorHost(): string {
  if (env.emulatorHost) return env.emulatorHost;
  if (Platform.OS === 'web') return typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  const hostUri = Constants.expoConfig?.hostUri ?? '';
  const host = hostUri.split(':')[0];
  if (host) return host;
  return Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
}

export const appVersion = Constants.expoConfig?.version ?? '1.0.0';
export const easProjectId: string | undefined =
  (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ??
  Constants.easConfig?.projectId;
