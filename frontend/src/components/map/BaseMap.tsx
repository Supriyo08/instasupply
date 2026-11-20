import 'leaflet/dist/leaflet.css';

import { DEFAULT_MAP_TILES } from '@instasupply/api-client';
import { useConfig } from '@instasupply/api-client/react';
import { boundsOf, type LatLng } from '@instasupply/shared';
import L from 'leaflet';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';

import { cn } from '@/lib/cn';

/** Toronto city hall (MARKETPLACE §9). */
export const DEFAULT_CENTER: LatLng = { lat: 43.6532, lng: -79.3832 };

export const toLeaflet = (point: LatLng): L.LatLngTuple => [point.lat, point.lng];

export function BaseMap({
  center = DEFAULT_CENTER,
  zoom = 12,
  className,
  children,
  scrollWheelZoom = true,
}: {
  center?: LatLng;
  zoom?: number;
  className?: string;
  children?: ReactNode;
  scrollWheelZoom?: boolean;
}) {
  // Tiles come from the server's public config (CLIENTS §7.5); the OpenStreetMap default until it loads.
  const tiles = useConfig()?.map ?? DEFAULT_MAP_TILES;
  return (
    <MapContainer
      center={toLeaflet(center)}
      zoom={zoom}
      scrollWheelZoom={scrollWheelZoom}
      className={cn('h-full w-full', className)}
      attributionControl
      zoomControl
    >
      <TileLayer url={tiles.tileUrl} attribution={tiles.attribution} maxZoom={tiles.maxZoom} />
      {children}
    </MapContainer>
  );
}

/**
 * Fits the map to `points` when the set of points meaningfully changes (identified by `fitKey`),
 * so live updates don't fight the user's panning.
 */
export function FitBounds({
  points,
  fitKey,
  padding = 48,
  paddingRight = 0,
  maxZoom = 15,
}: {
  points: LatLng[];
  fitKey: string;
  padding?: number;
  /** Extra space on the right, e.g. for a floating panel. Ignored on narrow maps. */
  paddingRight?: number;
  maxZoom?: number;
}) {
  const map = useMap();
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (fitKey === lastKey.current || points.length === 0) return;
    lastKey.current = fitKey;
    if (points.length === 1) {
      map.setView(toLeaflet(points[0]!), Math.min(maxZoom, Math.max(map.getZoom(), 14)), { animate: true });
      return;
    }
    const bounds = boundsOf(points)!;
    const right = map.getSize().x > paddingRight * 2.5 ? paddingRight : 0;
    map.fitBounds(
      [
        [bounds.south, bounds.west],
        [bounds.north, bounds.east],
      ],
      {
        paddingTopLeft: [padding, padding],
        paddingBottomRight: [padding + right, padding],
        maxZoom,
        animate: true,
      },
    );
  }, [fitKey, map, maxZoom, padding, paddingRight, points]);

  return null;
}

/** Fly to a point whenever `target` changes. */
export function FlyTo({ target, zoom = 15 }: { target: LatLng | null; zoom?: number }) {
  const map = useMap();
  const key = target ? `${target.lat.toFixed(5)},${target.lng.toFixed(5)}` : null;
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (!target || key === lastKey.current) return;
    lastKey.current = key;
    map.flyTo(toLeaflet(target), Math.max(map.getZoom(), zoom), { duration: 0.8 });
  }, [key, map, target, zoom]);
  return null;
}

/** Invalidate size after layout changes (e.g. the map lives in a resizable panel). */
export function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);
  return null;
}

/** Calls `onPick` when the user clicks the map. */
export function ClickToPick({ onPick }: { onPick: (point: LatLng) => void }) {
  useMapEvents({
    click(event) {
      onPick({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

/**
 * Marker that glides to new positions instead of jumping, so live drivers move smoothly between
 * location updates.
 */
export function AnimatedMarker({
  position,
  icon,
  duration = 1200,
  zIndexOffset,
  onClick,
  children,
}: {
  position: LatLng;
  icon: L.DivIcon;
  duration?: number;
  zIndexOffset?: number;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const markerRef = useRef<L.Marker | null>(null);
  const [initial] = useState(() => toLeaflet(position));

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;
    const from = marker.getLatLng();
    const to = L.latLng(position.lat, position.lng);
    if (from.equals(to)) return;
    // Teleport instead of animating across the map (e.g. first fix after a long gap).
    if (from.distanceTo(to) > 5000) {
      marker.setLatLng(to);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      marker.setLatLng([from.lat + (to.lat - from.lat) * eased, from.lng + (to.lng - from.lng) * eased]);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [duration, position.lat, position.lng]);

  return (
    <Marker
      ref={markerRef}
      position={initial}
      icon={icon}
      zIndexOffset={zIndexOffset}
      eventHandlers={onClick ? { click: onClick } : undefined}
    >
      {children}
    </Marker>
  );
}
