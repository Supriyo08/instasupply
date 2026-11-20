import type { LatLng } from '@instasupply/shared';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppMap, fitKeyFor, type MapMarker } from '@/components/map';
import { Text } from '@/components/ui';
import { spacing } from '@/theme/tokens';

import type { StoreView } from '../hooks';

import { StoreCard } from './StoreCard';

/**
 * The map half of the Stores tab: one pin per store plus the current site. Tapping a pin shows that
 * store's card under the map.
 */
export function StoresMap({ views, site }: { views: readonly StoreView[]; site: LatLng | null }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = views.find((view) => view.store.id === selectedId) ?? null;

  const markers = useMemo<MapMarker[]>(() => {
    const list: MapMarker[] = views.map((view) => ({
      id: view.store.id,
      kind: 'store',
      position: view.store.location,
      title: view.store.name,
      tone: view.store.status === 'live' ? 'brand' : 'neutral',
      highlighted: view.store.id === selectedId,
    }));
    if (site) list.push({ id: 'site', kind: 'site', position: site, title: 'Your site', zIndex: 10 });
    return list;
  }, [views, site, selectedId]);

  const points = useMemo(
    () => [...views.map((view) => view.store.location), ...(site ? [site] : [])],
    [views, site],
  );

  return (
    <View style={styles.wrap}>
      <AppMap
        markers={markers}
        fit={points.length ? { key: fitKeyFor(points), points } : null}
        interactive
        onMarkerPress={(id) => setSelectedId(id === 'site' ? null : id)}
        style={styles.map}
        accessibilityLabel={`Map of ${views.length} stores${site ? ' and your site' : ''}`}
      />
      {selected ? (
        <StoreCard view={selected} highlighted />
      ) : (
        <Text variant="caption" color="muted" align="center">
          Tap a store on the map to see its promise.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  map: { borderRadius: 12, height: 380, overflow: 'hidden' },
  wrap: { gap: spacing.md },
});
