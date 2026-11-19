/** Native map (Apple Maps on iOS, Google Maps on Android). The web version is RouteMap.web.tsx. */
import { boundsOf, type LatLng } from '@instasupply/shared';
import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';

import { Icon, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { DEFAULT_CENTER, type RouteMapProps } from './map-types';

const toCoordinate = (point: LatLng) => ({ latitude: point.lat, longitude: point.lng });

export function RouteMap({ driver, stops, path, onStopPress, style, interactive = true }: RouteMapProps) {
  const { colors } = useTheme();
  const mapRef = useRef<MapView>(null);

  const focusPoints = useMemo(
    () => [...(driver ? [driver] : []), ...stops.map((stop) => stop.location)],
    [driver, stops],
  );
  const focusKey = focusPoints.map((point) => `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`).join('|');

  const initial = useMemo(() => {
    const bounds = boundsOf(focusPoints);
    if (!bounds)
      return {
        latitude: DEFAULT_CENTER.lat,
        longitude: DEFAULT_CENTER.lng,
        latitudeDelta: 0.2,
        longitudeDelta: 0.2,
      };
    return {
      latitude: (bounds.north + bounds.south) / 2,
      longitude: (bounds.east + bounds.west) / 2,
      latitudeDelta: Math.max(0.02, (bounds.north - bounds.south) * 1.6),
      longitudeDelta: Math.max(0.02, (bounds.east - bounds.west) * 1.6),
    };
    // Only for the first render; later changes animate via fitToCoordinates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (focusPoints.length < 2) return;
    mapRef.current?.fitToCoordinates(focusPoints.map(toCoordinate), {
      edgePadding: { top: 60, right: 50, bottom: 60, left: 50 },
      animated: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  return (
    <View style={[styles.container, style]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={initial}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
      >
        {path.length > 1 ? (
          <Polyline coordinates={path.map(toCoordinate)} strokeColor={colors.map.route} strokeWidth={5} />
        ) : null}
        {stops.map((stop) => (
          <Marker
            key={stop.id}
            coordinate={toCoordinate(stop.location)}
            title={stop.title}
            description={stop.subtitle}
            onCalloutPress={() => onStopPress?.(stop.id)}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View
              style={[
                styles.stop,
                {
                  backgroundColor: stop.highlighted ? colors.primary : colors.surface,
                  borderColor: stop.highlighted ? colors.surface : colors.primary,
                  transform: [{ scale: stop.highlighted ? 1.15 : 1 }],
                },
              ]}
            >
              <Text variant="micro" style={{ color: stop.highlighted ? colors.onPrimary : colors.primary }}>
                {stop.label}
              </Text>
            </View>
          </Marker>
        ))}
        {driver ? (
          <Marker
            coordinate={toCoordinate(driver)}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            rotation={driver.heading ?? 0}
          >
            <View
              style={[styles.driver, { backgroundColor: colors.map.driver, borderColor: colors.surface }]}
            >
              <Icon name="navigate" size={16} color={colors.surface} />
            </View>
          </Marker>
        ) : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  driver: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 3,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  stop: {
    alignItems: 'center',
    borderRadius: 15,
    borderWidth: 2.5,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
});
