import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** The API origin for this bundle (docs/CLIENTS.md §8.2). */
function resolveApiUrl(): string {
  // EXPO_PUBLIC_* are inlined at build time and must be read with literal names.
  const explicit = (process.env.EXPO_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  if (!__DEV__) throw new Error('EXPO_PUBLIC_API_URL is empty in a release bundle (docs/CLIENTS.md §8.2).');
  const port = process.env.EXPO_PUBLIC_API_PORT || '4000';
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return `http://localhost:${port}`;
    return `${window.location.protocol}//${window.location.hostname || 'localhost'}:${port}`;
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
