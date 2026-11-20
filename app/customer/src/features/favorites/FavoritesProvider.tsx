import { queries } from '@instasupply/api-client';
import { useApiMutation, useLiveQuery } from '@instasupply/api-client/react';
import type { Favorite, WithId } from '@instasupply/shared';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

interface Favorites {
  /** Product ids, most recent first. Empty for guests. */
  ids: string[];
  /** False until the list has loaded: show a skeleton, not the empty state. True at once for guests. */
  ready: boolean;
  error: unknown;
  retry: () => void;
  isFavorite: (productId: string) => boolean;
  /** Adds or removes, optimistically (docs/CLIENTS.md §1.12). Rejects with ApiError; guests can't save. */
  toggle: (productId: string) => Promise<void>;
}

const FavoritesContext = createContext<Favorites | null>(null);

/** One query for the whole shop, so every product card can show its heart cheaply. */
export function FavoritesProvider({ uid, children }: { uid: string | null; children: ReactNode }) {
  const query = queries.favorites(uid);
  const result = useLiveQuery(query);
  const ids = useMemo(() => result.data.map((favorite) => favorite.productId), [result.data]);

  const mutation = useApiMutation<{ productId: string; on: boolean }, unknown>(
    (api, { productId, on }) => (on ? api.favorites.add(productId) : api.favorites.remove(productId)),
    {
      optimistic: (cache, { productId, on }) =>
        cache.patch<WithId<Favorite>[]>(query.key, (current) =>
          on
            ? [
                { id: productId, productId, createdAt: Date.now() },
                ...current.filter((item) => item.productId !== productId),
              ]
            : current.filter((item) => item.productId !== productId),
        ),
    },
  );
  const { run } = mutation;

  const toggle = useCallback(
    async (productId: string) => {
      if (!uid) throw new Error('Sign in to save items.');
      await run({ productId, on: !ids.includes(productId) });
    },
    [uid, ids, run],
  );

  const value = useMemo<Favorites>(
    () => ({
      ids,
      ready: !uid || !result.loading,
      error: result.error,
      retry: result.retry,
      isFavorite: (productId) => ids.includes(productId),
      toggle,
    }),
    [ids, uid, result.loading, result.error, result.retry, toggle],
  );
  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): Favorites {
  const favorites = useContext(FavoritesContext);
  if (!favorites) throw new Error('useFavorites must be used inside <FavoritesProvider>.');
  return favorites;
}
