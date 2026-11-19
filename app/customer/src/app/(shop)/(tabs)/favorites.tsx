import { pluralize } from '@instasupply/shared';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';

import { Button, EmptyState, ErrorState, Header, Screen, Text } from '@/components/ui';
import { AddAllToCart } from '@/features/product/AddAllToCart';
import { FavoriteRow, FavoriteRowSkeleton } from '@/features/product/FavoriteRow';
import { useFavoriteProducts, useRemoveFavorite } from '@/features/product/useFavoriteProducts';
import { spacing } from '@/theme/tokens';

/** Favourites tab (Big Cart "Favorites"): saved products with quick cart controls. */
export default function FavoritesScreen() {
  const { items, loading, error, retry } = useFavoriteProducts();
  const remove = useRemoveFavorite();

  let content: ReactNode;
  if (loading) {
    content = (
      <View style={styles.list} accessible accessibilityLabel="Loading favorites">
        {[0, 1, 2, 3].map((key) => (
          <FavoriteRowSkeleton key={key} />
        ))}
      </View>
    );
  } else if (items.length === 0) {
    content = (
      <ScrollView contentContainerStyle={styles.center}>
        {error ? (
          <ErrorState title="Couldn't load favorites" error={error} onRetry={retry} />
        ) : (
          <EmptyState
            art="scene-empty-cart"
            title="No favorites yet"
            message="Tap the heart on any product to save it here for quick re-ordering."
            action={
              <Button
                label="Start shopping"
                trailingIcon="arrow-right"
                onPress={() => router.navigate('/')}
              />
            }
          />
        )}
      </ScrollView>
    );
  } else {
    content = (
      <>
        <FlatList
          data={items}
          keyExtractor={(product) => product.id}
          renderItem={({ item }) => <FavoriteRow product={item} onRemove={remove} />}
          ItemSeparatorComponent={Separator}
          ListHeaderComponent={
            <Text variant="caption" color="muted">
              {pluralize(items.length, 'saved item')}
            </Text>
          }
          ListHeaderComponentStyle={styles.listHeader}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
        <View style={styles.footer}>
          <AddAllToCart products={items} />
        </View>
      </>
    );
  }

  return (
    <Screen scroll={false} header={<Header title="Favorites" back={false} />} contentStyle={styles.body}>
      {content}
    </Screen>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  body: { paddingTop: 0 },
  center: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.gutter },
  // Leaves room for the tab bar's floating cart button, which overlaps the screen's bottom edge.
  footer: { paddingBottom: spacing.xxxl, paddingHorizontal: spacing.gutter, paddingTop: spacing.md },
  list: { gap: spacing.md, padding: spacing.gutter },
  listContent: { padding: spacing.gutter },
  listHeader: { marginBottom: spacing.md },
  separator: { height: spacing.md },
});
