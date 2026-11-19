import { useLocalSearchParams } from 'expo-router';

import { FEATURED_LISTING_ID, FEATURED_LISTING_LIMIT } from '@/features/catalog/components/constants';
import { ProductListingScreen } from '@/features/catalog/components/ProductListingScreen';
import { useCategory, useCategoryProducts, useFeaturedProducts } from '@/features/catalog/hooks';

/** Products of one category (or every featured product for /category/featured), with filters. */
export default function CategoryScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const categoryId = Array.isArray(id) ? id[0] : id;

  if (categoryId === FEATURED_LISTING_ID) return <FeaturedListing />;
  // Keyed by category, so another category starts with its own filters.
  return <CategoryListing key={categoryId} id={categoryId} />;
}

function CategoryListing({ id }: { id: string | undefined }) {
  const category = useCategory(id);
  const products = useCategoryProducts(id);
  const notFound = !category.loading && !category.error && !category.data;

  return (
    <ProductListingScreen
      title={category.data?.name ?? (notFound ? 'Category' : '')}
      products={products.data}
      loading={category.loading || products.loading}
      error={category.error ?? products.error}
      notFound={notFound}
      onRetry={() => {
        category.retry();
        products.retry();
      }}
    />
  );
}

function FeaturedListing() {
  const featured = useFeaturedProducts(FEATURED_LISTING_LIMIT);
  return (
    <ProductListingScreen
      title="Featured products"
      products={featured.data}
      loading={featured.loading}
      error={featured.error}
      onRetry={featured.retry}
    />
  );
}
