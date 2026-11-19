import { onSnapshot, type DocumentData, type DocumentReference, type Query } from 'firebase/firestore';
import { useEffect, useState } from 'react';

export interface LiveResult<T> {
  data: T;
  loading: boolean;
  error: Error | null;
}

/**
 * Subscribe to a Firestore query. Pass `null` to wait (e.g. until the user id is known).
 * `key` must change whenever the query changes — queries aren't referentially stable.
 */
export function useLiveQuery<T>(query: Query<DocumentData> | null, key: string): LiveResult<T[]> {
  const [state, setState] = useState<LiveResult<T[]>>({ data: [], loading: !!query, error: null });

  useEffect(() => {
    if (!query) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    setState((current) => ({ ...current, loading: true }));
    return onSnapshot(
      query,
      (snapshot) =>
        setState({
          data: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as T),
          loading: false,
          error: null,
        }),
      (error) => setState({ data: [], loading: false, error }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

export function useLiveDoc<T>(
  ref: DocumentReference<DocumentData> | null,
  key: string,
): LiveResult<T | null> {
  const [state, setState] = useState<LiveResult<T | null>>({ data: null, loading: !!ref, error: null });

  useEffect(() => {
    if (!ref) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    setState((current) => ({ ...current, loading: true }));
    return onSnapshot(
      ref,
      (snapshot) =>
        setState({
          data: snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as T) : null,
          loading: false,
          error: null,
        }),
      (error) => setState({ data: null, loading: false, error }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
