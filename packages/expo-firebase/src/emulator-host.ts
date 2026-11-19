import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Where the emulators run. On a phone they live on the computer running `expo start`, so reuse
 * the Metro dev server's host; on web it is the page's host.
 */
export function resolveEmulatorHost(explicit?: string | null): string {
  if (explicit) return explicit;
  if (Platform.OS === 'web') return typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  const host = (Constants.expoConfig?.hostUri ?? '').split(':')[0];
  if (host) return host;
  return Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
}
