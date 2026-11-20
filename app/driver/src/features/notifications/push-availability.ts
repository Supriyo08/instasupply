import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export type PushAvailability =
  { available: true } | { available: false; reason: 'web' | 'expo_go' | 'not_configured' };

/**
 * Whether this build can receive system push at all, decided without calling any push API (some throw
 * in Expo Go or in a build without FCM). `app.config.ts` writes `extra.push` (docs/CLIENTS.md §6.1).
 */
export function pushAvailability(): PushAvailability {
  if (Platform.OS === 'web') return { available: false, reason: 'web' };
  if (isRunningInExpoGo()) return { available: false, reason: 'expo_go' };
  const push = Constants.expoConfig?.extra?.push as { android?: boolean; ios?: boolean } | undefined;
  const configured = Platform.OS === 'android' ? push?.android === true : push?.ios === true;
  return configured ? { available: true } : { available: false, reason: 'not_configured' };
}

/** Settings copy for a build without system push (docs/CLIENTS.md §6.7). */
export const PUSH_UNAVAILABLE_TEXT = "Push alerts aren't set up in this build. Updates appear in your inbox.";
