import type { KeyValueStorage, Lifecycle, LifecycleEvent, PlatformBindings, RefreshLock, SecretStorage } from '../platform';

/** The lock name every tab of the console shares (CLIENTS §1.4). */
const REFRESH_LOCK = 'instasupply.session.refresh';

/** Storage that may be missing or throw (private mode, blocked site data): reads give null, writes are dropped. */
function webStorage(pick: () => Storage | undefined): SecretStorage {
  const area = (): Storage | undefined => {
    try {
      return pick();
    } catch {
      return undefined;
    }
  };
  return {
    getItem: async (key) => {
      try {
        return area()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem: async (key, value) => {
      try {
        area()?.setItem(key, value);
      } catch {
        // Quota or blocked storage: the session then lasts as long as this tab.
      }
    },
    removeItem: async (key) => {
      try {
        area()?.removeItem(key);
      } catch {
        // See setItem.
      }
    },
    onExternalChange: (listener) => {
      if (typeof window === 'undefined') return () => undefined;
      // The `storage` event fires only in the other tabs of the same origin, never in the writer.
      const onStorage = (event: StorageEvent): void => {
        if (event.key === null) return;
        if (event.storageArea !== area()) return;
        listener(event.key, event.newValue);
      };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    },
  };
}

function webLifecycle(): Lifecycle {
  return {
    // A hidden console tab must keep its socket: the portal chime and desktop notifications need it.
    isForeground: () => true,
    isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    subscribe: (listener: (event: LifecycleEvent) => void) => {
      if (typeof window === 'undefined') return () => undefined;
      const online = (): void => listener('online');
      const offline = (): void => listener('offline');
      window.addEventListener('online', online);
      window.addEventListener('offline', offline);
      return () => {
        window.removeEventListener('online', online);
        window.removeEventListener('offline', offline);
      };
    },
  };
}

interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

function webRefreshLock(): RefreshLock | undefined {
  const locks = typeof navigator === 'undefined' ? undefined : (navigator as { locks?: LockManagerLike }).locks;
  if (!locks) return undefined;
  return { run: (task) => locks.request(REFRESH_LOCK, task) };
}

function webRandomUUID(): string {
  return globalThis.crypto.randomUUID();
}

/** Browser bindings: localStorage (or sessionStorage), Web Locks, `storage` events, online/offline events. */
export function createWebPlatform(options?: { persist?: 'local' | 'session' }): PlatformBindings {
  const secretStorage = webStorage(() =>
    options?.persist === 'session' ? globalThis.sessionStorage : globalThis.localStorage,
  );
  const cacheStorage: KeyValueStorage = webStorage(() => globalThis.localStorage);
  const refreshLock = webRefreshLock();
  return {
    secretStorage,
    cacheStorage,
    lifecycle: webLifecycle(),
    randomUUID: webRandomUUID,
    ...(refreshLock ? { refreshLock } : {}),
  };
}
