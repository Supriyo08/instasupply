/**
 * The only map component screens import (docs/CLIENTS.md §7.2, §7.3): the frame, the loading skeleton,
 * the offline note, accessibility and the fallback card around `LeafletCanvas`. Tiles come from
 * `GET /config` (`useConfig().map`), so no client holds a map key.
 */
import { DEFAULT_MAP_TILES } from '@instasupply/api-client';
import { useConfig, useLiveStatus } from '@instasupply/api-client/react';
import type { LatLng } from '@instasupply/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { appVersion } from '@/lib/env';
import { mapsUrlFor } from '@/lib/links';
import { useTheme } from '@/theme/ThemeProvider';

import LeafletCanvas from './LeafletCanvas';
import type { MapPalette } from './map-icons';
import { DEFAULT_ZOOM, TORONTO, type AppMapProps } from './map-types';

/** Without `onReady` after this long, the map is replaced by a text summary with "Open in Maps". */
const READY_TIMEOUT_MS = 8_000;

export function AppMap({
  markers = [],
  polylines = [],
  circles = [],
  fit = null,
  initialCenter = TORONTO,
  initialZoom = DEFAULT_ZOOM,
  interactive = false,
  pick,
  onPick,
  onMarkerPress,
  style,
  accessibilityLabel,
}: AppMapProps) {
  const { colors, radius } = useTheme();
  const config = useConfig();
  const tiles = config?.map ?? DEFAULT_MAP_TILES;
  const { online } = useLiveStatus();
  const [ready, setReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [tilesFailing, setTilesFailing] = useState(false);

  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setTimedOut(true), READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  const palette = useMemo<MapPalette>(
    () => ({
      brand: colors.primary,
      neutral: colors.textSubtle,
      success: colors.success,
      warning: colors.warning,
      danger: colors.danger,
      surface: colors.surface,
      text: colors.text,
    }),
    [colors],
  );

  const handlePick = useCallback(async (point: LatLng) => onPick?.(point), [onPick]);
  const handleMarkerPress = useCallback(async (id: string) => onMarkerPress?.(id), [onMarkerPress]);
  const handleReady = useCallback(async () => setReady(true), []);
  const handleTiles = useCallback(
    async (state: 'ok' | 'failing') => setTilesFailing(state === 'failing'),
    [],
  );

  const focus: LatLng | null = fit?.points[0] ?? markers[0]?.position ?? pick?.position ?? null;

  if (timedOut && !ready) {
    return (
      <View
        style={[
          styles.frame,
          styles.fallback,
          { backgroundColor: colors.surfaceMuted, borderRadius: radius.lg },
          style,
        ]}
        accessible
        accessibilityLabel={accessibilityLabel}
      >
        <Text color="muted" align="center">
          {accessibilityLabel}
        </Text>
        {focus ? (
          <Button
            label="Open in Maps"
            icon="navigate-outline"
            variant="secondary"
            fullWidth={false}
            onPress={() => void Linking.openURL(mapsUrlFor(focus))}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={[styles.frame, { backgroundColor: colors.surfaceMuted, borderRadius: radius.lg }, style]}
      pointerEvents={interactive || pick ? 'auto' : 'none'}
      accessible={!interactive}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      <LeafletCanvas
        tiles={tiles}
        palette={palette}
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
        onMarkerPress={handleMarkerPress}
        onReady={handleReady}
        onTiles={handleTiles}
        dom={{
          useExpoDOMWebView: false,
          applicationNameForUserAgent: `InstaSupplyDriver/${appVersion}`,
          style: { flex: 1 },
          containerStyle: { flex: 1 },
          scrollEnabled: false,
          nestedScrollEnabled: true,
          overScrollMode: 'never',
          setBuiltInZoomControls: false,
        }}
      />
      {!ready ? <Skeleton width="100%" height="100%" radius={0} style={StyleSheet.absoluteFill} /> : null}
      {ready && tilesFailing ? (
        <View style={[styles.note, { backgroundColor: colors.surface, borderRadius: radius.md }]}>
          <Text variant="caption" color="muted">
            Map tiles can&apos;t load right now. Pins are still in the right place.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', gap: 12, justifyContent: 'center', padding: 16 },
  // zIndex 0 keeps Leaflet's high z-index panes under headers and sheets on the web.
  frame: { minHeight: 120, overflow: 'hidden', zIndex: 0 },
  // Top left: Leaflet's attribution sits bottom right and nothing may cover it (§7.3).
  note: { left: 8, paddingHorizontal: 10, paddingVertical: 6, position: 'absolute', right: 8, top: 8 },
});
