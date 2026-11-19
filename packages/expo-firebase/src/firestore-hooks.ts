import {
  onSnapshot,
  type DocumentData,
  type DocumentReference,
  type Query,
  type Unsubscribe,
} from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useState } from 'react';

export interface LiveResult<T> {
  /** The latest snapshot. While a changed query loads, this is still the previous result. */
  data: T;
  /** True until the current query has answered, starting with the render in which it changed. */
  loading: boolean;
  error: Error | null;
  /**
   * Subscribes again. A Firestore listener that fails stops for good, so wire this to the
   * "Try again" button of the error state.
   */
  retry: () => void;
}

type Listen<S, T> = (source: S, onData: (data: T) => void, onError: (error: Error) => void) => Unsubscribe;

/** What one subscription (a query key plus a retry attempt) last reported. */
interface Report<T> {
  id: string | null;
  data: T;
  loading: boolean;
  error: Error | null;
}

/**
 * State shared by the live hooks. Each report remembers the subscription it came from, so the
 * result is derived while rendering: a changed key or a retry reads as `loading` straight away,
 * instead of passing the last result off as settled until an effect catches up.
 */
function useSubscription<S, T>(source: S | null, key: string, empty: T, listen: Listen<S, T>): LiveResult<T> {
  const [attempt, setAttempt] = useState(0);
  const id = source === null ? null : `${attempt}:${key}`;
  const [report, setReport] = useState<Report<T>>({ id, data: empty, loading: id !== null, error: null });

  // Runs when `id` changes; `source` and `listen` are the ones from that render.
  useEffect(() => {
    if (source === null || id === null) {
      // Nothing to listen to. Forget the last result, so a later query doesn't start from it.
      setReport((last) => (last.id === null ? last : { id: null, data: empty, loading: false, error: null }));
      return;
    }
    let active = true;
    const unsubscribe = listen(
      source,
      (data) => {
        if (active) setReport({ id, data, loading: false, error: null });
      },
      (error) => {
        if (active) setReport({ id, data: empty, loading: false, error });
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [id]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  return useMemo(() => {
    if (id === null) return { data: empty, loading: false, error: null, retry };
    // This subscription hasn't reported yet: keep the previous data on screen, as loading.
    if (report.id !== id) return { data: report.data, loading: true, error: null, retry };
    return { data: report.data, loading: report.loading, error: report.error, retry };
  }, [id, report, empty, retry]);
}

const EMPTY: never[] = [];

function asList<Q>(value: Q | readonly Q[]): readonly Q[] {
  return Array.isArray(value) ? value : [value as Q];
}

function listenToQueries<T>(
  queries: readonly Query<DocumentData>[],
  onData: (docs: T[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const pages = new Map<number, T[]>();
  const unsubscribes: Unsubscribe[] = [];
  const stop = () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  let failed = false;
  queries.forEach((query, index) => {
    unsubscribes.push(
      onSnapshot(
        query,
        (snapshot) => {
          if (failed) return;
          pages.set(
            index,
            snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as T),
          );
          // Report once every query has answered, so the list is never partial.
          if (pages.size === queries.length) onData(queries.flatMap((_, at) => pages.get(at) ?? []));
        },
        (error) => {
          failed = true;
          stop();
          onError(error);
        },
      ),
    );
  });
  return stop;
}

function listenToDoc<T>(
  ref: DocumentReference<DocumentData>,
  onData: (doc: T | null) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    ref,
    (snapshot) => onData(snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as T) : null),
    onError,
  );
}

/**
 * Subscribe to a Firestore query. Pass `null` to wait (e.g. until the user id is known).
 * `key` must change whenever the query changes — queries aren't referentially stable.
 * Several queries are read as one list (an `in` filter split to Firestore's 30-value limit).
 */
export function useLiveQuery<T>(
  query: Query<DocumentData> | readonly Query<DocumentData>[] | null,
  key: string,
): LiveResult<T[]> {
  const queries = query === null ? EMPTY : asList(query);
  return useSubscription<readonly Query<DocumentData>[], T[]>(
    queries.length > 0 ? queries : null,
    key,
    EMPTY,
    listenToQueries,
  );
}

export function useLiveDoc<T>(
  ref: DocumentReference<DocumentData> | null,
  key: string,
): LiveResult<T | null> {
  return useSubscription<DocumentReference<DocumentData>, T | null>(ref, key, null, listenToDoc);
}
