import { resolveEmulatorHost } from '@instasupply/expo-firebase';
import { DEFAULT_FUNCTIONS_REGION } from '@instasupply/shared';
import Constants from 'expo-constants';

// EXPO_PUBLIC_* variables are inlined at build time, so they must be read with literal names.
export const env = {
  useEmulators: process.env.EXPO_PUBLIC_USE_EMULATORS === 'true',
  emulatorHost: resolveEmulatorHost(process.env.EXPO_PUBLIC_EMULATOR_HOST || null),
  functionsRegion: process.env.EXPO_PUBLIC_FUNCTIONS_REGION || DEFAULT_FUNCTIONS_REGION,
  supportPhone: process.env.EXPO_PUBLIC_SUPPORT_PHONE || null,
  firebase: {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || 'demo-key',
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || 'demo-instasupply.firebaseapp.com',
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'demo-instasupply',
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || 'demo-instasupply.appspot.com',
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || undefined,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || undefined,
  },
};

export const appVersion = Constants.expoConfig?.version ?? '1.0.0';
export const easProjectId: string | undefined =
  (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ??
  Constants.easConfig?.projectId;
