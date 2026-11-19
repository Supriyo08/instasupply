import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Network from 'expo-network';
import * as SecureStore from 'expo-secure-store';
import { AppState, type AppStateStatus } from 'react-native';

import type { KeyValueStorage, Lifecycle, LifecycleEvent, PlatformBindings, SecretStorage } from '../platform';

/**
 * AFTER_FIRST_UNLOCK: the driver's background location task must read the session while the phone is
 * locked (V2). The stored session is about 250 bytes, far below the old iOS value limit.
 */
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

function secureStorage(): SecretStorage {
  return {
    getItem: (key) => SecureStore.getItemAsync(key, SECURE_OPTIONS),
    setItem: (key, value) => SecureStore.setItemAsync(key, value, SECURE_OPTIONS),
    removeItem: (key) => SecureStore.deleteItemAsync(key, SECURE_OPTIONS),
  };
}

const asyncStorage: KeyValueStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

function nativeLifecycle(): Lifecycle {
  // `currentState` is typed as a plain string; its values are those of AppStateStatus.
  let appState = (AppState.currentState ?? 'active') as AppStateStatus;
  // Unknown until expo-network answers; "online" until then, because only a sure "no" stops requests.
  let connected: boolean | null = null;
  const listeners = new Set<(event: LifecycleEvent) => void>();
  const emit = (event: LifecycleEvent): void => {
    for (const listener of [...listeners]) listener(event);
  };
  AppState.addEventListener('change', (next) => {
    const wasActive = appState === 'active';
    appState = next;
    if (next === 'active' && !wasActive) emit('foreground');
    else if (next !== 'active' && wasActive) emit('background');
  });
  const apply = (isConnected: boolean | undefined): void => {
    const next = isConnected === false ? false : true;
    const before = connected;
    connected = next;
    if (before === null) return;
    if (before && !next) emit('offline');
    else if (!before && next) emit('online');
  };
  Network.getNetworkStateAsync()
    .then((state) => apply(state.isConnected))
    .catch(() => undefined);
  Network.addNetworkStateListener((state) => apply(state.isConnected));
  return {
    isForeground: () => appState === 'active',
    isOnline: () => connected !== false,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Android and iOS: SecureStore, AsyncStorage, AppState, expo-network, expo-crypto. */
export function createNativePlatform(): PlatformBindings {
  return {
    secretStorage: secureStorage(),
    cacheStorage: asyncStorage,
    lifecycle: nativeLifecycle(),
    randomUUID: () => Crypto.randomUUID(),
  };
}
