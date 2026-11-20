import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** Where the API is (docs/CLIENTS.md §8.2): `EXPO_PUBLIC_API_URL`, or in development the dev machine. */
function resolveApiUrl(): string {
  // EXPO_PUBLIC_* are inlined at build time and must be read with literal names.
  const explicit = (process.env.EXPO_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  if (!__DEV__) {
    throw new Error('EXPO_PUBLIC_API_URL is empty in a release bundle (docs/CLIENTS.md §8.2).');
  }
  const port = process.env.EXPO_PUBLIC_API_PORT || '4000';
  if (Platform.OS === 'web') {
    const host = typeof window === 'undefined' ? 'localhost' : window.location.hostname || 'localhost';
    const protocol = typeof window === 'undefined' ? 'http:' : window.location.protocol;
    return `${protocol}//${host}:${port}`;
  }
  // On a phone the API runs on the computer that runs `expo start`: reuse the dev server's host.
  const host = (Constants.expoConfig?.hostUri ?? '').split(':')[0];
  if (host) return `http://${host}:${port}`;
  return Platform.OS === 'android' ? `http://10.0.2.2:${port}` : `http://127.0.0.1:${port}`;
}

export const env = {
  apiUrl: resolveApiUrl(),
  variant: (Constants.expoConfig?.extra?.variant as string | undefined) ?? 'production',
};

export const appVersion = Constants.expoConfig?.version ?? '1.0.0';

export const easProjectId: string | undefined =
  (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ??
  Constants.easConfig?.projectId;
