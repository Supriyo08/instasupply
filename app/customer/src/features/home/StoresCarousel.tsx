import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ErrorState, SectionHeader, Skeleton } from '@/components/ui';
import { StoreCard } from '@/features/stores/components/StoreCard';
import { useStoreViews } from '@/features/stores/hooks';
import { spacing } from '@/theme/tokens';

const CARD_WIDTH = 236;
const MAX_STORES = 10;

/** "Stores near you": the nearest stores with their promise; the chevron opens the Stores tab. */
export function StoresCarousel() {
  const { views, loading, error, retry } = useStoreViews();
  const shown = views.slice(0, MAX_STORES);
  if (error && shown.length === 0) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Stores near you" />
        <ErrorState title="Couldn't load stores" error={error} onRetry={retry} />
      </View>
    );
  }
  if (!loading && shown.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHeader title="Stores near you" onSeeAll={() => router.push('/stores')} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.bleed}
        contentContainerStyle={styles.row}
      >
        {loading && shown.length === 0
          ? [0, 1].map((key) => <Skeleton key={key} style={styles.skeleton} />)
          : shown.map((view) => <StoreCard key={view.store.id} view={view} compact width={CARD_WIDTH} />)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bleed: { marginHorizontal: -spacing.gutter },
  row: { gap: spacing.md, paddingHorizontal: spacing.gutter },
  section: { gap: spacing.md },
  skeleton: { height: 232, width: CARD_WIDTH },
});
