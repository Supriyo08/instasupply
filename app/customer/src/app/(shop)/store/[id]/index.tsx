import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import {
  Button,
  CONTENT_MAX_WIDTH,
  EmptyState,
  ErrorState,
  Header,
  IconButton,
  Screen,
  Skeleton,
} from '@/components/ui';
import { useCart } from '@/features/cart/CartProvider';
import { StoreArt } from '@/features/stores/components/StoreArt';
import { StoreDetails } from '@/features/stores/components/StoreDetails';
import { StoreProducts } from '@/features/stores/components/StoreProducts';
import { storeView, useStore } from '@/features/stores/hooks';
import { useSite } from '@/features/site/SiteProvider';
import { useNow } from '@/hooks/useNow';
import { spacing } from '@/theme/tokens';

/**
 * One store (MARKETPLACE §7.3): hero, rating, hours, address and directions, delivery promise and
 * pickup time, fulfilment, free-delivery note, category chips, in-store search and its products.
 * A store that is not live (or has paused orders) is browse-only.
 */
export default function StoreScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore(id);
  const { site } = useSite();
  const now = useNow(30_000);
  const cart = useCart();
  const { width } = useWindowDimensions();
  const heroWidth = Math.min(width, CONTENT_MAX_WIDTH) - 2 * spacing.gutter;
  const view = useMemo(
    () => (store.data ? storeView(store.data, site?.location ?? null, now) : null),
    [store.data, site?.location, now],
  );

  const header = (
    <Header
      title={store.data?.name ?? 'Store'}
      right={
        <IconButton
          icon="shopping-bag"
          label={cart.count > 0 ? `Cart, ${cart.count} items` : 'Cart'}
          badge={cart.count}
          onPress={() => router.push('/cart')}
        />
      }
    />
  );

  if (!view) {
    return (
      <Screen header={header}>
        {store.loading ? (
          <View style={styles.wrap}>
            <Skeleton style={{ height: heroWidth * 0.5 }} />
            <Skeleton style={styles.lineSkeleton} />
            <Skeleton style={styles.cardSkeleton} />
          </View>
        ) : store.error ? (
          <ErrorState title="Couldn't load this store" error={store.error} onRetry={store.retry} />
        ) : (
          <EmptyState
            art="scene-local-suppliers"
            title="Store not found"
            message="It may have left InstaSupply. Find another store near your site."
            action={
              <Button label="Stores near you" variant="secondary" onPress={() => router.replace('/stores')} />
            }
          />
        )}
      </Screen>
    );
  }

  return (
    <Screen header={header} refreshing={store.refreshing} onRefresh={store.retry}>
      <StoreArt store={view.store} width={heroWidth} height={Math.round(heroWidth * 0.5)} />
      <StoreDetails view={view} site={site} now={now} />
      <StoreProducts
        storeId={view.store.id}
        storeName={view.store.name}
        categoryIds={view.store.categoryIds}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardSkeleton: { height: 180 },
  lineSkeleton: { height: 28, width: '60%' },
  wrap: { gap: spacing.lg },
});
