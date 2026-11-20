import { EmptyState, ErrorState, Header, Screen } from '@/components/ui';
import { CategoryGrid, CategoryGridSkeleton } from '@/features/catalog/components/CategoryGrid';
import { useCategories } from '@/features/catalog/hooks';

/** All 25 category tiles (MARKETPLACE §7.3); each opens the category across nearby stores. */
export default function CategoriesScreen() {
  const { data, loading, error, retry, refreshing } = useCategories();
  return (
    <Screen header={<Header title="Categories" />} refreshing={refreshing} onRefresh={retry}>
      {loading && data.length === 0 ? (
        <CategoryGridSkeleton rows={5} />
      ) : error && data.length === 0 ? (
        <ErrorState title="Couldn't load categories" error={error} onRetry={retry} />
      ) : data.length === 0 ? (
        <EmptyState
          art="scene-local-suppliers"
          title="No categories yet"
          message="Local suppliers are stocking up. Check back soon."
        />
      ) : (
        <CategoryGrid categories={data} />
      )}
    </Screen>
  );
}
