import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, EmptyState, ErrorState, Header, Screen, Skeleton } from '@/components/ui';
import { useProductsByIds } from '@/features/catalog/hooks';
import { useListings } from '@/features/catalog/useListings';
import { useFavorites } from '@/features/favorites/FavoritesProvider';
import { MissingSavedRow, SavedRow } from '@/features/favorites/SavedRow';
import { RequireAccount } from '@/features/session/RequireAccount';
import { describeError } from '@/lib/api';
import { notify } from '@/lib/notify';
import { spacing } from '@/theme/tokens';

const TITLE = 'Saved Materials';

/** 🔒 Saved materials (MARKETPLACE §7.3), most recently saved first. */
export default function SavedScreen() {
  return (
    <RequireAccount title={TITLE} message="Sign in to save materials and order them again in a tap.">
      <SavedList />
    </RequireAccount>
  );
}

function SavedList() {
  const favorites = useFavorites();
  const products = useProductsByIds(favorites.ids);
  const { listings } = useListings(products.data);
  const byId = useMemo(() => new Map(listings.map((listing) => [listing.product.id, listing])), [listings]);
  const remove = (productId: string) => {
    favorites.toggle(productId).catch((error: unknown) => notify("Couldn't remove it", describeError(error)));
  };

  let body;
  if (!favorites.ready || (products.loading && products.data.length === 0 && favorites.ids.length > 0)) {
    body = (
      <View style={styles.list}>
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} style={styles.skeleton} />
        ))}
      </View>
    );
  } else if (favorites.error) {
    body = <ErrorState title="Couldn't load saved items" error={favorites.error} onRetry={favorites.retry} />;
  } else if (products.error && products.data.length === 0) {
    body = <ErrorState title="Couldn't load saved items" error={products.error} onRetry={products.retry} />;
  } else if (favorites.ids.length === 0) {
    body = (
      <EmptyState
        art="scene-empty-cart"
        title="Nothing saved yet"
        message="Tap the heart on a product to keep it here for your next order."
        action={<Button label="Browse categories" onPress={() => router.push('/categories')} />}
      />
    );
  } else {
    body = (
      <View style={styles.list}>
        {favorites.ids.map((productId) => {
          const listing = byId.get(productId);
          if (listing) return <SavedRow key={productId} listing={listing} onRemove={remove} />;
          // Only call it gone once the products have answered.
          return products.loading ? null : (
            <MissingSavedRow key={productId} productId={productId} onRemove={remove} />
          );
        })}
      </View>
    );
  }

  return (
    <Screen header={<Header title={TITLE} />} refreshing={products.refreshing} onRefresh={products.retry}>
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  skeleton: { height: 100 },
});
