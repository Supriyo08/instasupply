import { COLLECTIONS } from '@instasupply/shared';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { db } from '@/lib/firebase';

interface Favorites {
  /** Most recent first. */
  ids: string[];
  /** False until the first snapshot (or error) arrives, so screens can tell "loading" from "none". */
  ready: boolean;
  isFavorite: (productId: string) => boolean;
  toggle: (productId: string) => Promise<void>;
}

const FavoritesContext = createContext<Favorites | null>(null);

/** One listener for the whole app, so every product card can show its heart cheaply. */
export function FavoritesProvider({ uid, children }: { uid: string; children: ReactNode }) {
  const [ids, setIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, COLLECTIONS.users, uid, COLLECTIONS.favorites), orderBy('createdAt', 'desc')),
        (snapshot) => {
          setIds(snapshot.docs.map((item) => item.id));
          setReady(true);
        },
        () => {
          setIds([]);
          setReady(true);
        },
      ),
    [uid],
  );

  const toggle = useCallback(
    async (productId: string) => {
      const ref = doc(db, COLLECTIONS.users, uid, COLLECTIONS.favorites, productId);
      if (ids.includes(productId)) await deleteDoc(ref);
      else await setDoc(ref, { productId, createdAt: serverTimestamp() });
    },
    [ids, uid],
  );

  const value = useMemo<Favorites>(
    () => ({ ids, ready, isFavorite: (productId) => ids.includes(productId), toggle }),
    [ids, ready, toggle],
  );
  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): Favorites {
  const favorites = useContext(FavoritesContext);
  if (!favorites) throw new Error('useFavorites must be used inside <FavoritesProvider>.');
  return favorites;
}
