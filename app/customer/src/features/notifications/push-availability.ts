import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export type PushAvailability =
  { available: true } | { available: false; reason: 'web' | 'expo_go' | 'not_configured' };

/**
 * Whether this build can receive system notifications, decided without calling any push API
 * (docs/CLIENTS.md §6.1). Without push the inbox, live banners and badges still work.
 */
export function pushAvailability(): PushAvailability {
  if (Platform.OS === 'web') return { available: false, reason: 'web' };
  if (isRunningInExpoGo()) return { available: false, reason: 'expo_go' };
  const push = Constants.expoConfig?.extra?.push as { android?: boolean; ios?: boolean } | undefined;
  const configured = Platform.OS === 'android' ? push?.android === true : push?.ios === true;
  return configured ? { available: true } : { available: false, reason: 'not_configured' };
}
