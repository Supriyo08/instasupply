import { DEFAULT_MAP_TILES } from '@instasupply/api-client';
import { useConfig, useLiveStatus } from '@instasupply/api-client/react';
import type { LatLng } from '@instasupply/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { appVersion } from '@/lib/env';
import { colors, radius, spacing } from '@/theme/tokens';

import LeafletCanvas from './LeafletCanvas';
import { mapsUrlFor, TORONTO, type AppMapProps, type MapPalette } from './map-types';

/** Without `onReady` after this long, the map gives way to a text card with "Open in Maps". */
const READY_TIMEOUT_MS = 8_000;

const PALETTE: MapPalette = {
  brand: colors.primary,
  neutral: colors.textMuted,
  success: colors.primaryDark,
  warning: colors.warning,
  danger: colors.danger,
  surface: colors.surface,
  text: colors.text,
};

/**
 * The one map component screens import (docs/CLIENTS.md §7): Leaflet with the server's tiles in an
 * Expo DOM component, a skeleton until it is ready, an offline note when tiles fail, and a fallback
 * card if it never loads. One per screen. Give it a height through `style`.
 */
export function AppMap({
  markers = [],
  polylines = [],
  circles = [],
  fit = null,
  initialCenter = TORONTO,
  initialZoom = 11,
  interactive = false,
  pick,
  onPick,
  onMarkerPress,
  style,
  accessibilityLabel,
}: AppMapProps) {
  const tiles = useConfig()?.map ?? DEFAULT_MAP_TILES;
  const { online } = useLiveStatus();
  const [ready, setReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [tilesFailing, setTilesFailing] = useState(false);

  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setTimedOut(true), READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  // Callbacks cross the DOM bridge as async functions (docs/CLIENTS.md §7.2).
  const handleReady = useCallback(async () => setReady(true), []);
  const handleTiles = useCallback(
    async (state: 'ok' | 'failing') => setTilesFailing(state === 'failing'),
    [],
  );
  const handlePick = useCallback(async (point: LatLng) => onPick?.(point), [onPick]);
  const handleMarker = useCallback(async (id: string) => onMarkerPress?.(id), [onMarkerPress]);

  const mapsUrl = useMemo(() => {
    const target =
      pick?.position ??
      markers.find((marker) => marker.kind === 'site' || marker.kind === 'pin')?.position ??
      markers[0]?.position ??
      null;
    const origin = markers.find((marker) => marker.kind === 'driver')?.position ?? null;
    return target ? mapsUrlFor(target, origin) : null;
  }, [markers, pick?.position]);

  if (timedOut && !ready) {
    return (
      <View style={[styles.frame, styles.fallback, style]} accessibilityRole="summary">
        <Icon name="map" size={22} color={colors.textMuted} />
        <Text variant="caption" color="muted" align="center">
          {accessibilityLabel}
        </Text>
        {mapsUrl ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Open in Maps"
            hitSlop={8}
            onPress={() => void Linking.openURL(mapsUrl).catch(() => undefined)}
          >
            <Text variant="captionMedium" color="primaryDark">
              Open in Maps
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={[styles.frame, style]}
      pointerEvents={interactive || pick ? 'auto' : 'none'}
      accessible={!interactive}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      <LeafletCanvas
        tiles={tiles}
        palette={PALETTE}
        markers={markers}
        polylines={polylines}
        circles={circles}
        fit={fit}
        initialCenter={initialCenter}
        initialZoom={initialZoom}
        interactive={interactive}
        pick={pick ?? null}
        online={online}
        onPick={handlePick}
        onMarkerPress={handleMarker}
        onReady={handleReady}
        onTiles={handleTiles}
        dom={{
          useExpoDOMWebView: false,
          applicationNameForUserAgent: `InstaSupplyCustomer/${appVersion}`,
          style: { flex: 1 },
          containerStyle: { flex: 1 },
          scrollEnabled: false,
          nestedScrollEnabled: true,
          overScrollMode: 'never',
          setBuiltInZoomControls: false,
        }}
      />
      {!ready ? <Skeleton style={StyleSheet.absoluteFill} /> : null}
      {ready && tilesFailing ? (
        <View style={styles.offline} pointerEvents="none">
          <Text variant="micro" color="muted">
            Map tiles can&apos;t load right now. Pins are still in the right place.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// zIndex 0 keeps Leaflet's high z-index panes inside this frame, under headers and sheets.
const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  frame: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    overflow: 'hidden',
    zIndex: 0,
  },
  offline: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    left: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
  },
});
