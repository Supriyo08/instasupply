/** Live delivery map on iOS (Apple Maps) and Android (Google Maps). TrackingMap.web.tsx is the web version. */
import {
  boundsOf,
  estimateRoadMeters,
  formatDistance,
  haversineMeters,
  type LatLng,
} from '@instasupply/shared';
import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, PixelRatio, Platform, StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, type MapStyleElement, type Region } from 'react-native-maps';

import { Button, Icon, Text } from '@/components/ui';
import { notify } from '@/lib/notify';
import { colors, spacing } from '@/theme/tokens';

import { fitKeyFor, mapsUrlFor, roundedHeading, type TrackingMapProps } from './TrackingMap.types';

const toCoordinate = (point: LatLng) => ({ latitude: point.lat, longitude: point.lng });

// Android measures edge padding in physical pixels, iOS in points.
const PAD = Platform.OS === 'android' ? PixelRatio.getPixelSizeForLayoutSize(56) : 56;
const EDGE_PADDING = { top: PAD, right: PAD, bottom: PAD, left: PAD };

/** Quieter Google basemap (Android) so the driver and the destination stand out. */
const QUIET_MAP: MapStyleElement[] = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

/**
 * Android draws this map with the Google Maps SDK, which crashes the app when the build has no API
 * key, and app.config.ts only adds one when GOOGLE_MAPS_ANDROID_API_KEY is set. The key
 * (`android.config`) can only be read back in development: Expo leaves it out of the config that
 * release builds embed, so those have to state it with `extra.googleMapsEnabled` (set from the same
 * variable in app.config.ts). When nothing says there is a key, assume there is none.
 */
function hasGoogleMapsKey(): boolean {
  if (isRunningInExpoGo()) return true; // Expo Go brings its own key.
  const config = Constants.expoConfig;
  const enabled: unknown = config?.extra?.googleMapsEnabled;
  if (typeof enabled === 'boolean') return enabled;
  return Boolean(config?.android?.config?.googleMaps?.apiKey);
}

const MAP_AVAILABLE = Platform.OS !== 'android' || hasGoogleMapsKey();

function regionAround(points: readonly LatLng[], fallback: LatLng): Region {
  const bounds = boundsOf(points) ?? {
    south: fallback.lat,
    north: fallback.lat,
    west: fallback.lng,
    east: fallback.lng,
  };
  return {
    latitude: (bounds.north + bounds.south) / 2,
    longitude: (bounds.east + bounds.west) / 2,
    latitudeDelta: Math.max(0.01, (bounds.north - bounds.south) * 1.8),
    longitudeDelta: Math.max(0.01, (bounds.east - bounds.west) * 1.8),
  };
}

/** The live map, or a short text card with a maps link on a build that can't draw it. */
export function TrackingMap(props: TrackingMapProps) {
  return MAP_AVAILABLE ? <LiveMap {...props} /> : <MapUnavailable {...props} />;
}

/** Non-interactive so the page keeps scrolling; the camera follows the driver instead. */
function LiveMap({ destination, driver, style, accessibilityLabel }: TrackingMapProps) {
  const mapRef = useRef<MapView>(null);
  const [ready, setReady] = useState(false);
  const points = useMemo(
    () => (driver ? [driver.location, destination] : [destination]),
    [driver, destination],
  );
  const [initialRegion] = useState(() => regionAround(points, destination));
  const fitKey = fitKeyFor(points);
  const heading = roundedHeading(driver?.heading);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (points.length > 1)
      map.fitToCoordinates(points.map(toCoordinate), { edgePadding: EDGE_PADDING, animated: true });
    else map.animateToRegion(regionAround(points, destination), 400);
    // Re-fit only when a point moves meaningfully (fitKey), not on every snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, ready]);

  return (
    <View
      style={[styles.container, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        onMapReady={() => setReady(true)}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        showsCompass={false}
        showsPointsOfInterests={false}
        customMapStyle={QUIET_MAP}
        loadingEnabled
        loadingBackgroundColor={colors.background}
        loadingIndicatorColor={colors.primary}
      >
        {driver ? (
          <Polyline
            coordinates={[toCoordinate(driver.location), toCoordinate(destination)]}
            strokeColor={colors.primary}
            strokeWidth={3}
            lineDashPattern={[8, 8]}
          />
        ) : null}
        <Marker coordinate={toCoordinate(destination)} anchor={{ x: 0.5, y: 0.5 }} title="Your address">
          <View style={styles.home}>
            <View style={styles.homeInner}>
              <Icon name="home" size={14} color={colors.white} />
            </View>
          </View>
        </Marker>
        {driver ? (
          <Marker
            coordinate={toCoordinate(driver.location)}
            anchor={{ x: 0.5, y: 0.5 }}
            title="Your driver"
            zIndex={2}
          >
            <View style={styles.driverHalo}>
              <View style={styles.driver}>
                {heading == null ? (
                  <Icon name="truck" size={15} color={colors.white} />
                ) : (
                  <View style={{ transform: [{ rotate: `${heading}deg` }] }}>
                    <Icon name="navigation-2" size={15} color={colors.white} />
                  </View>
                )}
              </View>
            </View>
          </Marker>
        ) : null}
      </MapView>
    </View>
  );
}

/** In place of the map when it can't be drawn: where the driver is, in words, and a maps link. */
function MapUnavailable({ destination, driver, style }: TrackingMapProps) {
  const from = driver?.location ?? null;
  // The same road-distance estimate the server falls back to, so the numbers agree.
  const meters = from ? estimateRoadMeters(haversineMeters(from, destination)) : null;
  const headline =
    meters == null
      ? "Waiting for your driver's location"
      : meters < 100
        ? 'Your driver is very close'
        : `Your driver is about ${formatDistance(meters)} away`;
  const openMaps = () =>
    void Linking.openURL(mapsUrlFor(destination, from)).catch(() =>
      notify("Couldn't open Maps", 'No app on this device can show map links.'),
    );
  // The caller's height becomes a minimum, so large text grows the card instead of being cut off.
  const { height, ...frame } = StyleSheet.flatten(style) ?? {};

  return (
    <View style={[styles.fallback, frame, height != null ? { minHeight: height } : null]}>
      <View style={styles.summary}>
        <View style={styles.pin}>
          <Icon name="map-pin" size={18} color={colors.primaryDark} />
        </View>
        <View style={styles.copy}>
          <Text variant="bodyMedium">{headline}</Text>
          <Text variant="caption" color="muted">
            The live map isn&apos;t available on this device.
          </Text>
        </View>
      </View>
      <Button variant="secondary" size="md" icon="navigation" label="Open in Maps" onPress={openMaps} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, overflow: 'hidden', pointerEvents: 'none' },
  copy: { flex: 1, gap: spacing.xxs },
  driver: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderColor: colors.white,
    borderRadius: 18,
    borderWidth: 3,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  driverHalo: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 26,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  fallback: {
    backgroundColor: colors.primaryTint,
    gap: spacing.md,
    justifyContent: 'center',
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    // Clears a status chip the caller may lay over the top-left corner, as it does on the map.
    paddingTop: 48,
  },
  home: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 19,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  homeInner: {
    alignItems: 'center',
    backgroundColor: colors.primaryDark,
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  pin: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  summary: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
});
