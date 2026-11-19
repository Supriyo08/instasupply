import { router, useLocalSearchParams } from 'expo-router';

import { Button, EmptyState, ErrorState, Header, Screen } from '@/components/ui';
import { useProduct } from '@/features/catalog/hooks';
import { ProductDetail } from '@/features/product/ProductDetail';
import { ProductDetailSkeleton } from '@/features/product/ProductDetailSkeleton';

/** Product detail (Big Cart "Organic Lemons"). */
export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: product, loading, error, retry } = useProduct(id);

  // Keyed so the chosen quantity and scroll position reset if the route's product changes.
  if (product) return <ProductDetail key={product.id} product={product} />;
  if (loading) return <ProductDetailSkeleton />;

  return (
    <Screen header={<Header title="Product" />}>
      {error ? (
        <ErrorState title="We couldn't load this product" error={error} onRetry={retry} />
      ) : (
        <EmptyState
          art="scene-local-suppliers"
          title="Product not found"
          message="It may have been removed from the store. Have a look at what else is fresh today."
          action={<Button label="Browse products" onPress={() => router.replace('/')} />}
        />
      )}
    </Screen>
  );
}
