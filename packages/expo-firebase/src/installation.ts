import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'instasupply.installationId';
let cached: string | null = null;

/** Stable per-install id, used as the push-device document id. */
export async function getInstallationId(): Promise<string> {
  if (cached) return cached;
  const existing = await AsyncStorage.getItem(KEY);
  if (existing) return (cached = existing);
  const created = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  await AsyncStorage.setItem(KEY, created);
  return (cached = created);
}
