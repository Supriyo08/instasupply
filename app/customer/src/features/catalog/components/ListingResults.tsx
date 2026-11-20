import { StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';

import { ErrorState, Skeleton } from '@/components/ui';
import { spacing } from '@/theme/tokens';

import type { ResultItem } from '../listings';

import { FamilyCard, ListingRow } from './ListingRow';

/** Ranked results: family cards and single listings, with loading, error and empty states. */
export function ListingResults({
  items,
  loading,
  error,
  onRetry,
  empty,
}: {
  items: readonly ResultItem[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  empty: ReactNode;
}) {
  if (loading && items.length === 0) {
    return (
      <View style={styles.list} accessibilityLabel="Loading results">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} style={styles.skeleton} />
        ))}
      </View>
    );
  }
  if (error && items.length === 0) {
    return <ErrorState title="Couldn't load products" error={error} onRetry={onRetry} />;
  }
  if (items.length === 0) return <>{empty}</>;
  return (
    <View style={styles.list}>
      {items.map((item) =>
        item.kind === 'family' ? (
          <FamilyCard key={`family:${item.group.key}`} group={item.group} />
        ) : (
          <ListingRow key={item.listing.product.id} listing={item.listing} />
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  skeleton: { height: 112 },
});
