import { router } from 'expo-router';

import { ProductGrid } from '@/components/catalog/ProductGrid';
import { Button, EmptyState, ErrorState } from '@/components/ui';
import { useFeaturedProducts } from '@/features/catalog/hooks';

import { HOME_FEATURED_LIMIT } from './constants';
import { ProductGridSkeleton } from './ProductGridSkeleton';

/** Home screen "Featured products" grid with loading, error and empty states. */
export function FeaturedProducts() {
  const { data, loading, error, retry } = useFeaturedProducts(HOME_FEATURED_LIMIT);

  if (loading) return <ProductGridSkeleton count={4} />;
  if (error) return <ErrorState title="Couldn't load products" error={error} onRetry={retry} />;
  if (data.length === 0) {
    return (
      <EmptyState
        art="scene-local-suppliers"
        title="Fresh picks are on the way"
        message="Our featured shelf is being restocked. Browse the aisles in the meantime."
        action={
          <Button label="Browse categories" variant="secondary" onPress={() => router.push('/categories')} />
        }
      />
    );
  }
  return <ProductGrid products={data} />;
}
