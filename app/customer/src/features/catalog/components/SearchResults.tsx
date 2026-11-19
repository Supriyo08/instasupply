import { pluralize } from '@instasupply/shared';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ProductGrid } from '@/components/catalog/ProductGrid';
import { Button, EmptyState, ErrorState, Text } from '@/components/ui';
import { useProductSearch } from '@/features/catalog/hooks';
import { spacing } from '@/theme/tokens';

import { ProductGridSkeleton } from './ProductGridSkeleton';

/**
 * Live results for the (debounced) search term. The parent remounts this per search key, so a
 * new search starts from the skeleton instead of briefly showing the previous key's results.
 */
export function SearchResults({
  term,
  pending,
  onRemember,
}: {
  term: string;
  /** The shopper is still typing (the debounced term is behind the input). */
  pending: boolean;
  /** Save the term to recent searches once the shopper engages with the results. */
  onRemember: () => void;
}) {
  const { data, loading, error, retry } = useProductSearch(term);

  if (loading) return <ProductGridSkeleton count={4} />;
  if (error) return <ErrorState title="Search is unavailable" error={error} onRetry={retry} />;
  if (data.length === 0) {
    if (pending) return <ProductGridSkeleton count={4} />;
    return (
      <EmptyState
        art="scene-empty-cart"
        title="No results found"
        message={`We couldn't find anything for “${term}”. Check the spelling or try a more general word.`}
        action={
          <Button label="Browse categories" variant="secondary" onPress={() => router.push('/categories')} />
        }
      />
    );
  }

  return (
    <View
      style={styles.results}
      // Runs on any touch inside the results (tap or scroll) without taking the touch over.
      onStartShouldSetResponderCapture={() => {
        onRemember();
        return false;
      }}
    >
      <Text variant="captionMedium" color="muted" accessibilityLiveRegion="polite">
        {pending ? 'Searching…' : `${pluralize(data.length, 'result')} for “${term}”`}
      </Text>
      <ProductGrid products={data} />
    </View>
  );
}

const styles = StyleSheet.create({
  results: { gap: spacing.md },
});
