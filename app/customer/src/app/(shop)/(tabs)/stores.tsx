import { STORE_SPECIALTY_LABELS, type StoreSpecialty } from '@instasupply/shared';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  Screen,
  SegmentedControl,
  Skeleton,
  Text,
} from '@/components/ui';
import { StoreCard } from '@/features/stores/components/StoreCard';
import { StoresMap } from '@/features/stores/components/StoresMap';
import {
  filterStores,
  NO_STORE_FILTERS,
  sortStores,
  STORE_SORTS,
  type StoreFilters,
  type StoreSort,
} from '@/features/stores/filters';
import { useStoreViews } from '@/features/stores/hooks';
import { useSite } from '@/features/site/SiteProvider';
import { spacing } from '@/theme/tokens';

type Mode = 'list' | 'map';

const MODES = [
  { value: 'list', label: 'List' },
  { value: 'map', label: 'Map' },
] as const;

/** "Stores near you" (MARKETPLACE §7.3): list ⇄ map, chips, sort, store cards with their promise. */
export default function StoresTab() {
  const { views, loading, error, retry, refreshing } = useStoreViews();
  const { site } = useSite();
  const [mode, setMode] = useState<Mode>('list');
  const [filters, setFilters] = useState<StoreFilters>(NO_STORE_FILTERS);
  const [sort, setSort] = useState<StoreSort>('fastest');

  const specialties = useMemo(() => {
    const present = new Set(views.map((view) => view.store.specialty));
    return (Object.keys(STORE_SPECIALTY_LABELS) as StoreSpecialty[]).filter((key) => present.has(key));
  }, [views]);
  const shown = useMemo(() => sortStores(filterStores(views, filters), sort), [views, filters, sort]);
  const toggle = (key: 'deliveryToday' | 'pickup' | 'openNow') =>
    setFilters((current) => ({ ...current, [key]: !current[key] }));

  return (
    <Screen
      header={<Header title="Stores near you" back={false} />}
      contentStyle={styles.content}
      refreshing={refreshing}
      onRefresh={retry}
    >
      <SegmentedControl options={MODES} value={mode} onChange={setMode} />
      {site ? null : (
        <Text variant="caption" color="muted">
          Choose a jobsite to see distances and delivery times.{' '}
          <Text variant="captionMedium" color="primary" onPress={() => router.push('/site')}>
            Choose jobsite
          </Text>
        </Text>
      )}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.bleed}
        contentContainerStyle={styles.chips}
      >
        <Chip
          icon="truck"
          label="Delivery today"
          selected={filters.deliveryToday}
          onPress={() => toggle('deliveryToday')}
        />
        <Chip icon="shopping-bag" label="Pickup" selected={filters.pickup} onPress={() => toggle('pickup')} />
        <Chip icon="clock" label="Open now" selected={filters.openNow} onPress={() => toggle('openNow')} />
        {specialties.map((specialty) => (
          <Chip
            key={specialty}
            label={STORE_SPECIALTY_LABELS[specialty]}
            selected={filters.specialty === specialty}
            onPress={() =>
              setFilters((current) => ({
                ...current,
                specialty: current.specialty === specialty ? null : specialty,
              }))
            }
          />
        ))}
      </ScrollView>
      <View style={styles.sortRow} accessibilityRole="radiogroup" accessibilityLabel="Sort stores">
        <Text variant="captionMedium" color="muted">
          Sort
        </Text>
        {STORE_SORTS.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            selected={sort === option.value}
            onPress={() => setSort(option.value)}
          />
        ))}
      </View>

      {loading && views.length === 0 ? (
        <View style={styles.list}>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} style={styles.skeleton} />
          ))}
        </View>
      ) : error && views.length === 0 ? (
        <ErrorState title="Couldn't load stores" error={error} onRetry={retry} />
      ) : shown.length === 0 ? (
        <EmptyState
          art="scene-local-suppliers"
          title={views.length ? 'No store matches' : 'No stores yet'}
          message={
            views.length
              ? 'Try fewer filters.'
              : "We're signing up suppliers across the GTA. Know one? Suggest a store."
          }
          action={
            views.length ? (
              <Button
                label="Clear filters"
                variant="secondary"
                onPress={() => setFilters(NO_STORE_FILTERS)}
              />
            ) : (
              <Button
                label="Suggest a store"
                variant="secondary"
                onPress={() => router.push('/suggest-store')}
              />
            )
          }
        />
      ) : mode === 'map' ? (
        <StoresMap views={shown} site={site?.location ?? null} />
      ) : (
        <View style={styles.list}>
          {shown.map((view) => (
            <StoreCard key={view.store.id} view={view} />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  bleed: { marginHorizontal: -spacing.gutter },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.gutter },
  // Room under the last card for the floating cart button of the tab bar.
  content: { gap: spacing.md, paddingBottom: 96 },
  list: { gap: spacing.md },
  skeleton: { height: 112 },
  sortRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
