import { router, useLocalSearchParams } from 'expo-router';

import { Button, EmptyState, ErrorState, Header, Screen } from '@/components/ui';
import { useProduct } from '@/features/catalog/hooks';
import { ProductDetail } from '@/features/product/ProductDetail';
import { ProductDetailSkeleton } from '@/features/product/ProductDetailSkeleton';

/** One store's listing (MARKETPLACE §7.3 product row), live: price and stock update in place. */
export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const product = useProduct(id);

  if (product.data) return <ProductDetail key={product.data.id} product={product.data} />;
  if (product.loading) return <ProductDetailSkeleton />;
  return (
    <Screen header={<Header title="Product" />}>
      {product.error ? (
        <ErrorState title="Couldn't load this product" error={product.error} onRetry={product.retry} />
      ) : (
        <EmptyState
          art="scene-local-suppliers"
          title="No longer listed"
          message="This store has taken it off InstaSupply. Search for it at other stores near you."
          action={
            <Button label="Search products" variant="secondary" onPress={() => router.replace('/search')} />
          }
        />
      )}
    </Screen>
  );
}
