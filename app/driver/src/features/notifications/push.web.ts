/** Web: no system push (docs/CLIENTS.md §6.7). Same exports as push.ts, no expo-notifications. */
export type PushRegistration =
  | { status: 'registered' }
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'unavailable'; reason: 'web' | 'expo_go' | 'not_configured' | 'token_failed' };

export async function ensureChannels(): Promise<void> {}

export async function registerForPush(_options: { prompt: boolean }): Promise<PushRegistration> {
  return { status: 'unavailable', reason: 'web' };
}

export function onPushTokenChange(_listener: () => void): () => void {
  return () => undefined;
}

export async function unregisterDevice(): Promise<void> {}

export async function pushPermission(): Promise<'granted' | 'ask' | 'blocked' | 'unavailable'> {
  return 'unavailable';
}
