/** Live delivery map on the web: Leaflet + OpenStreetMap tiles (no API key). TrackingMap.tsx is the native version. */
import 'leaflet/dist/leaflet.css';

import { boundsOf, type LatLng } from '@instasupply/shared';
import L from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme/tokens';

import { fitKeyFor, roundedHeading, type TrackingMapProps } from './TrackingMap.types';

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const STYLE_ID = 'instasupply-tracking-map';
const MAP_STYLE = { background: colors.background, height: '100%', width: '100%' } as const;

// Feather glyphs (MIT) inlined for Leaflet's HTML markers.
const HOME_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';
const ARROW_SVG =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><polygon points="12 2 19 21 12 17 5 21 12 2"/></svg>';
const TRUCK_SVG =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>';

const toTuple = (point: LatLng): L.LatLngTuple => [point.lat, point.lng];

function ensurePulseStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent =
    '@keyframes isTrackPulse{0%{transform:scale(.55);opacity:.5}100%{transform:scale(1.35);opacity:0}}' +
    '.is-track-pulse{animation:isTrackPulse 1.8s ease-out infinite}' +
    '@media (prefers-reduced-motion: reduce){.is-track-pulse{animation:none;opacity:0}}';
  document.head.appendChild(style);
}

function homeIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    html: `<div style="width:38px;height:38px;border-radius:19px;background:${colors.white};box-shadow:0 2px 8px ${colors.overlay};display:flex;align-items:center;justify-content:center"><div style="width:28px;height:28px;border-radius:14px;background:${colors.primaryDark};color:${colors.white};display:flex;align-items:center;justify-content:center">${HOME_SVG}</div></div>`,
  });
}

function driverIcon(heading: number | null): L.DivIcon {
  const glyph =
    heading == null
      ? TRUCK_SVG
      : `<div style="display:flex;transform:rotate(${heading}deg)">${ARROW_SVG}</div>`;
  return L.divIcon({
    className: '',
    iconSize: [56, 56],
    iconAnchor: [28, 28],
    html: `<div style="position:relative;width:56px;height:56px;display:flex;align-items:center;justify-content:center"><span class="is-track-pulse" style="position:absolute;inset:0;border-radius:28px;background:${colors.primary}"></span><span style="position:relative;box-sizing:border-box;width:36px;height:36px;border-radius:18px;background:${colors.primary};border:3px solid ${colors.white};box-shadow:0 3px 10px ${colors.overlay};color:${colors.white};display:flex;align-items:center;justify-content:center">${glyph}</span></div>`,
  });
}

/** Keeps both points in view (only when they move meaningfully) and tracks container resizes. */
function FitToPoints({ points }: { points: LatLng[] }) {
  const map = useMap();
  const key = fitKeyFor(points);
  useEffect(() => {
    const bounds = boundsOf(points);
    if (!bounds) return;
    if (points.length === 1) {
      map.setView([bounds.north, bounds.east], 15, { animate: true });
      return;
    }
    map.fitBounds(
      [
        [bounds.south, bounds.west],
        [bounds.north, bounds.east],
      ],
      { padding: [44, 44], maxZoom: 16, animate: true },
    );
    // Re-fit only when a point moves meaningfully (key), not on every snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

/** Driver marker that glides between location updates instead of jumping. */
function GlidingMarker({ position, icon }: { position: LatLng; icon: L.DivIcon }) {
  const markerRef = useRef<L.Marker | null>(null);
  const [initial] = useState(() => toTuple(position));
  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;
    const from = marker.getLatLng();
    const to = L.latLng(position.lat, position.lng);
    if (from.equals(to)) return;
    if (from.distanceTo(to) > 3000) {
      marker.setLatLng(to);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 1200);
      const eased = 1 - (1 - t) ** 3;
      marker.setLatLng([from.lat + (to.lat - from.lat) * eased, from.lng + (to.lng - from.lng) * eased]);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [position.lat, position.lng]);
  return (
    <Marker
      ref={markerRef}
      position={initial}
      icon={icon}
      zIndexOffset={1000}
      interactive={false}
      keyboard={false}
    />
  );
}

/** Non-interactive so the page keeps scrolling; the view follows the driver instead. */
export function TrackingMap({ destination, driver, style, accessibilityLabel }: TrackingMapProps) {
  const heading = roundedHeading(driver?.heading);
  const driverMarker = useMemo(() => driverIcon(heading), [heading]);
  const homeMarker = useMemo(homeIcon, []);
  const points = useMemo(
    () => (driver ? [driver.location, destination] : [destination]),
    [driver, destination],
  );
  useEffect(ensurePulseStyle, []);

  return (
    <View
      style={[styles.container, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      <MapContainer
        center={toTuple(destination)}
        zoom={15}
        style={MAP_STYLE}
        zoomControl={false}
        dragging={false}
        touchZoom={false}
        doubleClickZoom={false}
        scrollWheelZoom={false}
        boxZoom={false}
        keyboard={false}
        attributionControl
      >
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} maxZoom={19} />
        <FitToPoints points={points} />
        {driver ? (
          <Polyline
            positions={[toTuple(driver.location), toTuple(destination)]}
            pathOptions={{
              color: colors.primary,
              dashArray: '6 8',
              interactive: false,
              opacity: 0.9,
              weight: 3,
            }}
          />
        ) : null}
        <Marker position={toTuple(destination)} icon={homeMarker} interactive={false} keyboard={false} />
        {driver ? <GlidingMarker position={driver.location} icon={driverMarker} /> : null}
      </MapContainer>
    </View>
  );
}

// zIndex 0 keeps Leaflet's high z-index panes inside this box (below headers and sheets).
const styles = StyleSheet.create({
  container: { backgroundColor: colors.background, overflow: 'hidden', zIndex: 0 },
});
