'use dom';

/**
 * The map itself (docs/CLIENTS.md §7.1 to §7.3): react-leaflet in an Expo DOM component. On Android and
 * iOS it runs inside a WebView (react-native-webview); on the web it renders as plain DOM. The only file
 * that imports leaflet. Every prop is JSON; callbacks are asynchronous. Screens use `AppMap`, never this.
 */
import type { LatLng } from '@instasupply/shared';
import type { DOMProps } from 'expo/dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';

import { MAP_CSS, markerIcon, type MapPalette } from './map-icons';
import type { MapCircle, MapFit, MapMarker, MapPick, MapPolyline } from './map-types';

export interface LeafletCanvasProps {
  tiles: { tileUrl: string; attribution: string; maxZoom: number };
  /** Hex colours from the app's theme tokens, by tone, plus surface and text. */
  palette: MapPalette;
  markers: MapMarker[];
  polylines: MapPolyline[];
  circles: MapCircle[];
  fit: MapFit | null;
  initialCenter: LatLng;
  initialZoom: number;
  interactive: boolean;
  pick: MapPick | null;
  online: boolean;
  onPick: (point: LatLng) => Promise<void>;
  onMarkerPress: (id: string) => Promise<void>;
  onReady: () => Promise<void>;
  onTiles: (state: 'ok' | 'failing') => Promise<void>;
  dom?: DOMProps;
}

const GLIDE_MS = 1_200;
const GLIDE_MAX_METERS = 5_000;
const TILE_ERRORS_BEFORE_FAILING = 4;

function FitCamera({ fit }: { fit: MapFit | null }) {
  const map = useMap();
  const key = fit?.key ?? null;
  const latest = useRef(fit);
  latest.current = fit;
  useEffect(() => {
    const current = latest.current;
    if (!current || current.points.length === 0) return;
    const maxZoom = current.maxZoom ?? 16;
    const [first] = current.points;
    if (current.points.length === 1 && first) {
      map.setView([first.lat, first.lng], Math.min(maxZoom, 15));
      return;
    }
    const bounds = L.latLngBounds(current.points.map((point) => [point.lat, point.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [current.padding ?? 48, current.padding ?? 48], maxZoom });
  }, [key, map]);
  return null;
}

function PickEvents({ pick, onPick }: { pick: MapPick | null; onPick: (point: LatLng) => Promise<void> }) {
  useMapEvents({
    click(event) {
      if (!pick || pick.tapToPlace === false) return;
      void onPick({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

/** A marker that glides between positions instead of jumping (live driver updates every 4 to 10 s). */
function AppMarker({
  marker,
  palette,
  draggable,
  onPress,
  onDragEnd,
}: {
  marker: MapMarker;
  palette: MapPalette;
  draggable: boolean;
  onPress: () => void;
  onDragEnd?: (point: LatLng) => void;
}) {
  const ref = useRef<L.Marker | null>(null);
  const [initial] = useState<[number, number]>([marker.position.lat, marker.position.lng]);
  const { html, size, anchor } = markerIcon(marker, palette);
  const icon = useMemo(
    () => L.divIcon({ html, className: 'is-marker', iconSize: size, iconAnchor: anchor }),
    // The tuple values, not their identity, decide whether the icon changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [html, size[0], size[1], anchor[0], anchor[1]],
  );
  const { lat, lng } = marker.position;
  const glide = marker.glide === true;
  useEffect(() => {
    const leafletMarker = ref.current;
    if (!leafletMarker) return;
    const from = leafletMarker.getLatLng();
    const to = L.latLng(lat, lng);
    if (!glide || from.distanceTo(to) > GLIDE_MAX_METERS || typeof requestAnimationFrame === 'undefined') {
      leafletMarker.setLatLng(to);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (time: number) => {
      const t = Math.min(1, (time - start) / GLIDE_MS);
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      leafletMarker.setLatLng([
        from.lat + (to.lat - from.lat) * eased,
        from.lng + (to.lng - from.lng) * eased,
      ]);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [lat, lng, glide]);
  return (
    <Marker
      ref={ref}
      position={initial}
      icon={icon}
      draggable={draggable}
      zIndexOffset={marker.zIndex ?? (marker.kind === 'driver' ? 1000 : 0)}
      keyboard={false}
      title={marker.title}
      eventHandlers={{
        click: onPress,
        dragend: (event) => {
          const point = (event.target as L.Marker).getLatLng();
          onDragEnd?.({ lat: point.lat, lng: point.lng });
        },
      }}
    />
  );
}

export default function LeafletCanvas(props: LeafletCanvasProps) {
  const {
    tiles,
    palette,
    markers,
    polylines,
    circles,
    fit,
    initialCenter,
    initialZoom,
    interactive,
    pick,
    online,
    onPick,
    onMarkerPress,
    onReady,
    onTiles,
  } = props;
  const errors = useRef(0);
  const reported = useRef<'ok' | 'failing'>('ok');
  // A new key redraws the tile layer when the network returns.
  const [tileGeneration, setTileGeneration] = useState(0);

  const report = (state: 'ok' | 'failing') => {
    if (reported.current === state) return;
    reported.current = state;
    void onTiles(state);
  };

  useEffect(() => {
    if (!online) {
      report('failing');
      return;
    }
    errors.current = 0;
    setTileGeneration((value) => value + 1);
    report('ok');
    // `report` only reads refs and a stable callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const toneColor = (tone: MapPolyline['tone']) => palette[tone ?? 'brand'];

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <style>{MAP_CSS}</style>
      <MapContainer
        center={[initialCenter.lat, initialCenter.lng]}
        zoom={initialZoom}
        style={{ height: '100%', width: '100%' }}
        dragging={interactive}
        touchZoom={interactive}
        doubleClickZoom={interactive}
        scrollWheelZoom={interactive}
        boxZoom={interactive}
        keyboard={interactive}
        zoomControl={interactive}
        attributionControl
        whenReady={() => void onReady()}
      >
        <TileLayer
          key={tileGeneration}
          url={tiles.tileUrl}
          attribution={tiles.attribution}
          maxZoom={tiles.maxZoom}
          eventHandlers={{
            tileload: () => {
              errors.current = 0;
              if (online) report('ok');
            },
            tileerror: () => {
              errors.current += 1;
              if (errors.current >= TILE_ERRORS_BEFORE_FAILING) report('failing');
            },
          }}
        />
        {circles.map((circle) => (
          <Circle
            key={circle.id}
            center={[circle.center.lat, circle.center.lng]}
            radius={circle.radiusM}
            pathOptions={{
              color: toneColor(circle.tone),
              fillColor: toneColor(circle.tone),
              fillOpacity: 0.15,
              weight: 2,
            }}
          />
        ))}
        {polylines.map((line) => (
          <Polyline
            key={line.id}
            positions={line.points.map((point) => [point.lat, point.lng] as [number, number])}
            pathOptions={{
              color: toneColor(line.tone),
              weight: line.weight ?? 4,
              opacity: 0.85,
              dashArray: line.dashed ? '8 8' : undefined,
            }}
          />
        ))}
        {markers.map((marker) => (
          <AppMarker
            key={marker.id}
            marker={marker}
            palette={palette}
            draggable={false}
            onPress={() => void onMarkerPress(marker.id)}
          />
        ))}
        {pick?.position ? (
          <AppMarker
            key="__pick"
            marker={{ id: '__pick', kind: 'pin', position: pick.position, tone: 'brand', zIndex: 2000 }}
            palette={palette}
            draggable={pick.draggable !== false}
            onPress={() => undefined}
            onDragEnd={(point) => void onPick(point)}
          />
        ) : null}
        <FitCamera fit={fit} />
        <PickEvents pick={pick} onPick={onPick} />
      </MapContainer>
    </div>
  );
}
