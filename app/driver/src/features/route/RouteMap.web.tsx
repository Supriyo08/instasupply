/** Web map built on Leaflet + OpenStreetMap tiles (no API key needed). */
import 'leaflet/dist/leaflet.css';

import { boundsOf } from '@instasupply/shared';
import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

import { DEFAULT_CENTER, type RouteMapProps } from './map-types';

function stopIcon(label: string, highlighted: boolean, primary: string, surface: string) {
  const background = highlighted ? primary : surface;
  const foreground = highlighted ? surface : primary;
  return L.divIcon({
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `<div style="width:30px;height:30px;border-radius:15px;border:2.5px solid ${highlighted ? surface : primary};background:${background};color:${foreground};display:flex;align-items:center;justify-content:center;font:700 12px system-ui;box-shadow:0 2px 6px rgba(0,0,0,.25);transform:scale(${highlighted ? 1.15 : 1})">${label}</div>`,
  });
}

function driverIcon(heading: number | null | undefined, color: string, border: string) {
  return L.divIcon({
    className: '',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    html: `<div style="width:36px;height:36px;border-radius:18px;background:${color};border:3px solid ${border};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.3)"><div style="transform:rotate(${heading ?? 0}deg);color:${border};font-size:16px;line-height:16px">▲</div></div>`,
  });
}

function FitBounds({ points }: { points: { lat: number; lng: number }[] }) {
  const map = useMap();
  const key = points.map((point) => `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`).join('|');
  useEffect(() => {
    const bounds = boundsOf(points);
    if (!bounds) return;
    map.fitBounds(
      [
        [bounds.south, bounds.west],
        [bounds.north, bounds.east],
      ],
      { padding: [40, 40], maxZoom: 15 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

export function RouteMap({ driver, stops, path, onStopPress, style, interactive = true }: RouteMapProps) {
  const { colors } = useTheme();
  const points = useMemo(
    () => [...(driver ? [driver] : []), ...stops.map((stop) => stop.location)],
    [driver, stops],
  );
  const center = points[0] ?? DEFAULT_CENTER;

  return (
    <View style={[styles.container, style]}>
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={13}
        style={{ height: '100%', width: '100%' }}
        zoomControl={interactive}
        dragging={interactive}
        scrollWheelZoom={interactive}
        attributionControl
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        <FitBounds points={points} />
        {path.length > 1 ? (
          <Polyline
            positions={path.map((point) => [point.lat, point.lng])}
            pathOptions={{ color: colors.map.route, weight: 5, opacity: 0.85 }}
          />
        ) : null}
        {stops.map((stop) => (
          <Marker
            key={stop.id}
            position={[stop.location.lat, stop.location.lng]}
            icon={stopIcon(stop.label, !!stop.highlighted, colors.primary, colors.surface)}
            eventHandlers={{ click: () => onStopPress?.(stop.id) }}
          >
            <Tooltip direction="top" offset={[0, -14]}>
              {stop.title}
            </Tooltip>
          </Marker>
        ))}
        {driver ? (
          <Marker
            position={[driver.lat, driver.lng]}
            icon={driverIcon(driver.heading, colors.map.driver, colors.surface)}
            zIndexOffset={1000}
          />
        ) : null}
      </MapContainer>
    </View>
  );
}

const styles = StyleSheet.create({ container: { overflow: 'hidden' } });
