import { describeError } from '@instasupply/expo-firebase';
import type { Product } from '@instasupply/shared';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useProductsByIds } from '@/features/catalog/hooks';
import { useFavorites } from '@/features/favorites/FavoritesProvider';
import { useToast } from '@/features/notifications/ToastProvider';
import { notify } from '@/lib/notify';

/** The shopper's favourite products, live, most recently saved first. */
export function useFavoriteProducts() {
  const { ids, ready } = useFavorites();
  const { data, loading, error, retry } = useProductsByIds(ids);
  const items = useMemo(() => {
    const byId = new Map(data.map((product) => [product.id, product]));
    return ids.flatMap((id) => {
      const product = byId.get(id);
      return product ? [product] : [];
    });
  }, [data, ids]);
  // Re-subscribing after a change keeps the old rows on screen, so only the first load "loads".
  // Until the favourites list itself arrives (cold start, web refresh) it is loading, not empty.
  return { items, loading: !ready || (loading && items.length === 0), error, retry };
}

/** Remove a favourite right away and offer "Tap to undo" in a toast. */
export function useRemoveFavorite() {
  const favorites = useFavorites();
  const toast = useToast();
  // The undo runs after the list has changed, so it must read the latest favourites.
  const latest = useRef(favorites);
  useEffect(() => {
    latest.current = favorites;
  }, [favorites]);

  return useCallback(
    (product: Product) => {
      if (!latest.current.isFavorite(product.id)) return;
      latest.current
        .toggle(product.id)
        .catch((error: unknown) => notify("Couldn't remove favorite", describeError(error)));
      toast({
        title: 'Removed from favorites',
        body: `${product.name} · Tap to undo`,
        icon: 'heart',
        onPress: () => {
          if (latest.current.isFavorite(product.id)) return;
          latest.current.toggle(product.id).catch(() => undefined);
        },
      });
    },
    [toast],
  );
}
