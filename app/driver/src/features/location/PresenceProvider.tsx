/**
 * The online switch and live location for the signed-in driver (docs/CLIENTS.md §5.4).
 *
 * Sources: the background task when the OS allows it (it is then the only source, also in the
 * foreground), else a foreground watcher. Both hand fixes to the shared `publisher`, which throttles,
 * queues and sends them (`POST /me/location`). `distanceInterval` is 0 everywhere, so a parked truck
 * keeps its heartbeat (code review R57, R63, R64).
 *
 * Every start and stop runs through one promise queue, and a generation counter that `setOnline` bumps
 * synchronously cancels work a newer intent overtook, so a quick on-off never leaves a watcher or the
 * foreground service running (R68, R69). Unmounting removes only the foreground watcher: the background
 * task outlives the screen tree and stops itself when the session ends or the switch is off (R62).
 */
import { formatRelativeTime } from '@instasupply/shared';
import type { ApiError } from '@instasupply/api-client';
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

import { describeError, errorStatusOf, isApiError, isNetworkError } from '@/lib/api';

import {
  requestBackgroundPermission,
  startBackgroundUpdates,
  stopBackgroundUpdates,
} from './background-task';
import {
  MODE_KEY,
  ONLINE_KEY,
  publisher,
  toFix,
  TRACKING_PROFILES,
  type Fix,
  type TrackingMode,
} from './publisher';

export type PermissionState = 'unknown' | 'granted' | 'denied';

export interface Presence {
  online: boolean;
  /** Going online or offline is in progress (permissions, first fix, the request). */
  busy: boolean;
  permission: PermissionState;
  /** True when the background task is the location source (a development or release build, "Allow all the time"). */
  backgroundEnabled: boolean;
  /** The last fix the publisher accepted; the driver's own position never comes from the server (§5.7). */
  lastFix: Fix | null;
  error: string | null;
  setOnline: (online: boolean) => Promise<void>;
  /** Current position for status updates (check-in, arrived, complete); null when unknown. */
  currentPosition: () => Promise<Fix | null>;
}

const PresenceContext = createContext<Presence | null>(null);

/** Going offline must never hang without signal (R70, R71): the server marks a silent driver offline anyway. */
const OFFLINE_REQUEST_TIMEOUT_MS = 5_000;
const FIX_TIMEOUT_MS = 15_000;
const NOT_ALLOWED = "Your account can't go online right now. Contact dispatch.";

/** Resolves with null after `ms`; a rejection passes through. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function accuracyFor(mode: TrackingMode): Location.Accuracy {
  return TRACKING_PROFILES[mode].accuracy === 'navigation'
    ? Location.Accuracy.BestForNavigation
    : Location.Accuracy.Balanced;
}

/** A fresh position from the OS, or null (no permission, no signal, timeout). Never a cached one. */
async function freshFix(mode: TrackingMode): Promise<Fix | null> {
  try {
    const location = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: accuracyFor(mode) }),
      FIX_TIMEOUT_MS,
    );
    return location ? toFix(location) : null;
  } catch {
    return null;
  }
}

function publishError(error: ApiError | null): string | null {
  if (!error) return null;
  if (isNetworkError(error)) return "Couldn't share your location. Check your connection.";
  return describeError(error, "Couldn't share your location.");
}

function messageOf(cause: unknown): string {
  if (isApiError(cause)) {
    return errorStatusOf(cause) === 'permission-denied' ? NOT_ALLOWED : describeError(cause);
  }
  return cause instanceof Error ? cause.message : 'Could not change your status.';
}

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
  const [lastFix, setLastFix] = useState<Fix | null>(() => publisher.getState().lastAccepted);
  const [publisherError, setPublisherError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** What the driver wants, set synchronously before any await. */
  const wantOnline = useRef(false);
  /** Bumped by every new intent; work that sees another value stops and cleans up after itself. */
  const generation = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const watcher = useRef<Location.LocationSubscription | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  /** The mode the running source was started with; a change is applied only while active (§5.4). */
  const appliedMode = useRef<TrackingMode | null>(null);

  /** Runs `work` after everything queued before it, so the last intent wins. */
  const enqueue = useCallback((work: () => Promise<void>): Promise<void> => {
    const next = queue.current.then(work, work);
    queue.current = next.catch(() => undefined);
    return next;
  }, []);

  const removeWatcher = useCallback(() => {
    watcher.current?.remove();
    watcher.current = null;
  }, []);

  /** Starts, or re-registers with new options, the location source for `trackingMode`. Call inside the queue. */
  const startSources = useCallback(
    async (trackingMode: TrackingMode, gen: number) => {
      const current = () => generation.current === gen && wantOnline.current;
      if (!current()) return;
      const background = await startBackgroundUpdates(trackingMode);
      if (!current()) {
        // Overtaken while the OS started the service: undo it unless the driver still wants to be online.
        if (background && !wantOnline.current) await stopBackgroundUpdates();
        return;
      }
      setBackgroundEnabled(background);
      appliedMode.current = trackingMode;
      if (background) {
        // expo-location hands fixes to the task in the foreground too: one source only.
        removeWatcher();
        return;
      }
      const profile = TRACKING_PROFILES[trackingMode];
      const subscription = await Location.watchPositionAsync(
        { accuracy: accuracyFor(trackingMode), timeInterval: profile.watchIntervalMs, distanceInterval: 0 },
        (location) => {
          if (generation.current !== gen || !wantOnline.current) return;
          void publisher.ingest([toFix(location)], { mode: modeRef.current });
        },
      );
      if (!current()) {
        subscription.remove();
        return;
      }
      // Replace the previous watcher only once the new one runs (mode change).
      removeWatcher();
      watcher.current = subscription;
    },
    [removeWatcher],
  );

  /** Stops every source. `report`: tell the server (`online: false`), bounded by a short timeout. */
  const goOffline = useCallback(
    async (report: boolean) => {
      removeWatcher();
      // The key goes first: a task run racing this sees it and stops itself.
      await AsyncStorage.removeItem(ONLINE_KEY).catch(() => undefined);
      await stopBackgroundUpdates();
      appliedMode.current = null;
      setBackgroundEnabled(false);
      if (report) {
        const last = publisher.getState().lastAccepted;
        // A failure or a dead zone is ignored: the server marks a silent driver offline (§2.5).
        await withTimeout(
          publisher.setOnline(false, last, modeRef.current),
          OFFLINE_REQUEST_TIMEOUT_MS,
        ).catch(() => undefined);
      }
      publisher.reset();
    },
    [removeWatcher],
  );

  const setOnline = useCallback(
    (next: boolean): Promise<void> => {
      wantOnline.current = next;
      const gen = ++generation.current;
      setBusy(true);
      setError(null);
      return enqueue(async () => {
        try {
          if (!next) {
            await goOffline(true);
            setOnlineState(false);
            return;
          }
          const foreground = await Location.requestForegroundPermissionsAsync();
          if (!foreground.granted) {
            setPermission('denied');
            throw new Error('Location access is needed to go online.');
          }
          setPermission('granted');
          if (Platform.OS !== 'web') await requestBackgroundPermission();
          if (generation.current !== gen) return;
          const trackingMode = modeRef.current;
          // Written before the task starts, so the task's self-guard sees it (R62).
          await AsyncStorage.multiSet([
            [ONLINE_KEY, uid],
            [MODE_KEY, trackingMode],
          ]);
          const first = await freshFix(trackingMode);
          if (generation.current !== gen) return;
          await publisher.setOnline(true, first, trackingMode);
          if (publisher.getState().stopped) throw new Error(NOT_ALLOWED);
          if (generation.current !== gen) return;
          setOnlineState(true);
          await startSources(trackingMode, gen);
        } catch (cause) {
          if (generation.current === gen) {
            wantOnline.current = false;
            await goOffline(false);
            setOnlineState(false);
            setError(messageOf(cause));
          }
        } finally {
          if (generation.current === gen) setBusy(false);
        }
      });
    },
    [enqueue, goOffline, startSources, uid],
  );

  // Restore the switch for this driver only; heal an OS task orphaned by a crash or another account.
  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(ONLINE_KEY)
      .catch(() => null)
      .then(async (stored) => {
        if (cancelled) return;
        if (stored === uid) {
          void setOnline(true);
          return;
        }
        if (stored !== null) await AsyncStorage.removeItem(ONLINE_KEY).catch(() => undefined);
        await stopBackgroundUpdates();
      });
    return () => {
      cancelled = true;
      // Unmount (activity destroyed, session left 'ready'): only the foreground watcher goes (R62).
      generation.current += 1;
      removeWatcher();
    };
  }, [uid, setOnline, removeWatcher]);

  // The publisher stopped (the session ended, or the account may not be online): turn the switch off.
  useEffect(
    () =>
      publisher.subscribe((state) => {
        setLastFix(state.lastAccepted);
        setPublisherError(state.stopped ? null : publishError(state.lastError));
        if (!state.stopped || !wantOnline.current) return;
        wantOnline.current = false;
        generation.current += 1;
        const reason = state.stopped;
        void enqueue(async () => {
          await goOffline(false);
          setOnlineState(false);
          setError(reason === 'forbidden' ? NOT_ALLOWED : 'Your session has ended. Please sign in again.');
        });
      }),
    [enqueue, goOffline],
  );

  // normal ↔ live: the task reads the stored mode at once; the source is re-registered only while
  // the app is active, because Android refuses to start a foreground service from the background (§5.4).
  useEffect(() => {
    if (!online) return;
    void AsyncStorage.setItem(MODE_KEY, mode).catch(() => undefined);
    if (appliedMode.current === mode || AppState.currentState !== 'active') return;
    const gen = generation.current;
    void enqueue(() => startSources(mode, gen));
  }, [mode, online, enqueue, startSources]);

  // Back in the foreground: a mode change seen in the background, and one fresh fix (heartbeat).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !wantOnline.current) return;
      const trackingMode = modeRef.current;
      const gen = generation.current;
      if (appliedMode.current !== trackingMode) void enqueue(() => startSources(trackingMode, gen));
      void freshFix(trackingMode).then((fix) => {
        if (fix && wantOnline.current) void publisher.ingest([fix], { mode: trackingMode, force: true });
      });
    });
    return () => subscription.remove();
  }, [enqueue, startSources]);

  // Watcher fallback (Expo Go, web, background permission refused): iOS and browsers deliver nothing
  // without movement, so ask for a fresh position about twice per heartbeat while the app is open.
  // Fresh only: re-sending an old position would hide a real loss of signal (R63).
  useEffect(() => {
    if (!online || backgroundEnabled) return;
    const timer = setInterval(() => {
      if (!wantOnline.current || AppState.currentState !== 'active') return;
      const trackingMode = modeRef.current;
      void freshFix(trackingMode).then((fix) => {
        if (fix && wantOnline.current) void publisher.ingest([fix], { mode: trackingMode });
      });
    }, TRACKING_PROFILES[mode].heartbeatMs / 2);
    return () => clearInterval(timer);
  }, [online, backgroundEnabled, mode]);

  const currentPosition = useCallback(async () => {
    const last = publisher.getState().lastAccepted;
    if (last && Date.now() - last.at < 60_000) return last;
    try {
      const permissionState = await Location.getForegroundPermissionsAsync();
      if (!permissionState.granted) return last;
      return (await freshFix('normal')) ?? last;
    } catch {
      return last;
    }
  }, []);

  const shownError = error ?? (online ? publisherError : null);
  const value = useMemo<Presence>(
    () => ({
      online,
      busy,
      permission,
      backgroundEnabled,
      lastFix,
      error: shownError,
      setOnline,
      currentPosition,
    }),
    [online, busy, permission, backgroundEnabled, lastFix, shownError, setOnline, currentPosition],
  );
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export function usePresence(): Presence {
  const presence = useContext(PresenceContext);
  if (!presence) throw new Error('usePresence must be used inside <PresenceProvider>.');
  return presence;
}

/** "Sharing live location · updated 2 min ago", for the online card and the Jobs banner. */
export function presenceSubtitle(presence: Pick<Presence, 'online' | 'lastFix'>, now: number): string {
  if (!presence.online) return 'Go online to see jobs near you and share your location with dispatch.';
  if (!presence.lastFix) return 'Getting your location…';
  return `Sharing live location · updated ${formatRelativeTime(presence.lastFix.at, now)}`;
}
