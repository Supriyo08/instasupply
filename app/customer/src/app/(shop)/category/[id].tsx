import { router, useLocalSearchParams } from 'expo-router';

import { Button, EmptyState, ErrorState, Header, IconButton, Screen, Skeleton } from '@/components/ui';
import { ProductListing } from '@/features/catalog/components/ProductListing';
import { useCategory } from '@/features/catalog/hooks';

/** One category across nearby stores, with the search filters (MARKETPLACE §7.3). */
export default function CategoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const category = useCategory(id);
  const header = (
    <Header
      title={category.data?.name ?? 'Category'}
      right={<IconButton icon="search" label="Search products" onPress={() => router.push('/search')} />}
    />
  );

  if (!category.data) {
    return (
      <Screen header={header}>
        {category.loading ? (
          <Skeleton style={{ height: 120 }} />
        ) : category.error ? (
          <ErrorState title="Couldn't load this category" error={category.error} onRetry={category.retry} />
        ) : (
          <EmptyState
            art="scene-local-suppliers"
            title="Category not found"
            message="It may have been renamed. Browse every category instead."
            action={
              <Button
                label="All categories"
                variant="secondary"
                onPress={() => router.replace('/categories')}
              />
            }
          />
        )}
      </Screen>
    );
  }

  return (
    <Screen header={header}>
      <ProductListing
        key={category.data.id}
        categoryId={category.data.id}
        initialSort="distance"
        empty={
          <EmptyState
            art="scene-material-list"
            title="Nothing nearby yet"
            message="No nearby store carries this yet. Send us your list."
            action={<Button label="Send us your list" onPress={() => router.push('/quotes/new')} />}
          />
        }
      />
    </Screen>
  );
}
