/**
 * Realtime Firestore hooks. Callers memoize the query/ref (useMemo) so a new render doesn't
 * resubscribe; passing `null` means "nothing to load yet".
 */
import {
  onSnapshot,
  type DocumentData,
  type DocumentReference,
  type Query,
  type SnapshotOptions,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';

export type WithId<T> = T & { id: string };

/** Pending server timestamps resolve to a local estimate instead of null. */
const SNAPSHOT_OPTIONS: SnapshotOptions = { serverTimestamps: 'estimate' };

export interface CollectionState<T> {
  data: WithId<T>[];
  loading: boolean;
  error: Error | null;
}

export interface DocumentState<T> {
  data: WithId<T> | null;
  loading: boolean;
  error: Error | null;
}

export function useCollection<T>(query: Query<DocumentData> | null): CollectionState<T> {
  const [state, setState] = useState<CollectionState<T>>({
    data: [],
    loading: query !== null,
    error: null,
  });

  useEffect(() => {
    if (!query) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    setState((current) => ({ ...current, loading: true, error: null }));
    return onSnapshot(
      query,
      (snapshot) =>
        setState({
          data: snapshot.docs.map((doc) => ({ ...(doc.data(SNAPSHOT_OPTIONS) as T), id: doc.id })),
          loading: false,
          error: null,
        }),
      (error) => setState({ data: [], loading: false, error }),
    );
  }, [query]);

  return state;
}

export function useDocument<T>(ref: DocumentReference<DocumentData> | null): DocumentState<T> {
  const [state, setState] = useState<DocumentState<T>>({ data: null, loading: ref !== null, error: null });

  useEffect(() => {
    if (!ref) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    // A different document: never show the previous document's data while loading.
    setState({ data: null, loading: true, error: null });
    return onSnapshot(
      ref,
      (snapshot) =>
        setState({
          data: snapshot.exists() ? { ...(snapshot.data(SNAPSHOT_OPTIONS) as T), id: snapshot.id } : null,
          loading: false,
          error: null,
        }),
      (error) => setState({ data: null, loading: false, error }),
    );
  }, [ref]);

  return state;
}
