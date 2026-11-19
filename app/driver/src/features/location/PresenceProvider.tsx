/**
 * Online/offline state and live location streaming for the signed-in driver.
 *
 * Online drivers stream their position to `driverLocations/{uid}`; the cadence tightens while a
 * delivery is in transit so customers see smooth live tracking.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';

import {
  requestBackgroundPermission,
  startBackgroundUpdates,
  stopBackgroundUpdates,
} from './background-task';
import {
  publishFix,
  resetPublisher,
  toFix,
  TRACKING_PROFILES,
  type Fix,
  type TrackingMode,
} from './publisher';

const ONLINE_KEY = 'instasupply.online';

export type PermissionState = 'unknown' | 'granted' | 'denied';

interface Presence {
  online: boolean;
  /** Toggling is in progress (permissions, first fix). */
  busy: boolean;
  permission: PermissionState;
  backgroundEnabled: boolean;
  lastFix: Fix | null;
  error: string | null;
  setOnline: (online: boolean) => Promise<void>;
  /** Current position for status updates; may be null when unknown. */
  currentPosition: () => Promise<Fix | null>;
}

const PresenceContext = createContext<Presence | null>(null);

export function PresenceProvider({
  uid,
  mode,
  children,
}: {
  uid: string;
  mode: TrackingMode;
  children: ReactNode;
}) {
  const [online, setOnlineState] = useState(false);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [backgroundEnabled, setBackgroundEnabled] = useState(false);
  const [lastFix, setLastFix] = useState<Fix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watcher = useRef<Location.LocationSubscription | null>(null);
  const lastFixRef = useRef<Fix | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const handleFix = useCallback(
    async (fix: Fix, force = false) => {
      lastFixRef.current = fix;
      setLastFix(fix);
      try {
        await publishFix(uid, fix, { online: true, mode: modeRef.current, force });
        setError(null);
      } catch {
        setError("Couldn't share your location. Check your connection.");
      }
    },
    [uid],
  );

  const stopWatching = useCallback(async () => {
    watcher.current?.remove();
    watcher.current = null;
    await stopBackgroundUpdates();
  }, []);

  const startWatching = useCallback(
    async (trackingMode: TrackingMode) => {
      await stopWatching();
      const profile = TRACKING_PROFILES[trackingMode];
      watcher.current = await Location.watchPositionAsync(
        {
          accuracy: trackingMode === 'live' ? Location.Accuracy.BestForNavigation : Location.Accuracy.High,
          timeInterval: profile.watchIntervalMs,
          distanceInterval: profile.watchDistanceM,
        },
        (location) => void handleFix(toFix(location)),
      );
      setBackgroundEnabled(await startBackgroundUpdates(trackingMode));
    },
    [handleFix, stopWatching],
  );

  const goOnline = useCallback(async () => {
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (!foreground.granted) {
      setPermission('denied');
      throw new Error('Location permission is needed to go online.');
    }
    setPermission('granted');
    if (Platform.OS !== 'web') await requestBackgroundPermission();
    const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    await handleFix(toFix(current), true);
    // Streaming starts from the effect below once `online` flips to true.
  }, [handleFix]);

  const setOnline = useCallback(
    async (next: boolean) => {
      setBusy(true);
      setError(null);
      try {
        if (next) {
          await goOnline();
        } else {
          await stopWatching();
          const fix = lastFixRef.current;
          if (fix) await publishFix(uid, fix, { online: false, mode: modeRef.current, force: true });
          resetPublisher();
        }
        setOnlineState(next);
        await AsyncStorage.setItem(ONLINE_KEY, next ? '1' : '0');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not change your status.');
        setOnlineState(false);
      } finally {
        setBusy(false);
      }
    },
    [goOnline, stopWatching, uid],
  );

  // Restore the previous online state when the app starts.
  useEffect(() => {
    void AsyncStorage.getItem(ONLINE_KEY).then((value) => {
      if (value === '1') void setOnline(true);
    });
    return () => {
      void stopWatching();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // Start streaming when online, and switch cadence when a trip starts or ends.
  useEffect(() => {
    if (online) {
      startWatching(mode).catch(() => setError("Couldn't start location updates."));
    }
  }, [mode, online, startWatching]);

  // Send a fresh heartbeat whenever the app returns to the foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && online && lastFixRef.current) {
        void Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
          .then((location) => handleFix(toFix(location), true))
          .catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [online, handleFix]);

  const currentPosition = useCallback(async () => {
    if (lastFixRef.current && Date.now() - lastFixRef.current.at < 60_000) return lastFixRef.current;
    try {
      const permissionState = await Location.getForegroundPermissionsAsync();
      if (!permissionState.granted) return lastFixRef.current;
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      return toFix(location);
    } catch {
      return lastFixRef.current;
    }
  }, []);

  const value = useMemo<Presence>(
    () => ({ online, busy, permission, backgroundEnabled, lastFix, error, setOnline, currentPosition }),
    [online, busy, permission, backgroundEnabled, lastFix, error, setOnline, currentPosition],
  );
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export function usePresence(): Presence {
  const presence = useContext(PresenceContext);
  if (!presence) throw new Error('usePresence must be used inside <PresenceProvider>.');
  return presence;
}
