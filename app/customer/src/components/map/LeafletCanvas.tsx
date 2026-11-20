'use dom';

import 'leaflet/dist/leaflet.css';

import type { LatLng } from '@instasupply/shared';
import L from 'leaflet';
import type { DOMProps } from 'expo/dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';

import { iconFor, MAP_CSS, WEBVIEW_CSS } from './map-icons';
import type { MapCircle, MapFit, MapMarker, MapPalette, MapPick, MapPolyline } from './map-types';

/**
 * The only file that imports Leaflet (docs/CLIENTS.md §7.2). An Expo DOM component: inside a
 * react-native-webview on Android and iOS, plain DOM on the web. Every prop is JSON; callbacks are
 * async functions across the bridge. Screens use `AppMap`, never this file.
 */
export interface LeafletCanvasProps {
  tiles: { tileUrl: string; attribution: string; maxZoom: number };
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

const STYLE_ID = 'instasupply-map-css';
const GLIDE_MS = 1200;
const GLIDE_MAX_M = 5000;
const FAILING_AFTER = 4;

const tuple = (point: LatLng): L.LatLngTuple => [point.lat, point.lng];

function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const inWebView = typeof window !== 'undefined' && 'ReactNativeWebView' in window;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = MAP_CSS + (inWebView ? WEBVIEW_CSS : '');
  document.head.appendChild(style);
}

/** Fits the camera when `fit.key` changes, keeps the size right and reports readiness. */
function Camera({ fit, onReady }: { fit: MapFit | null; onReady: () => Promise<void> }) {
  const map = useMap();
  const key = fit?.key ?? null;
  const latest = useRef(fit);
  latest.current = fit;
  useEffect(() => {
    const current = latest.current;
    if (!current || current.points.length === 0) return;
    const maxZoom = current.maxZoom ?? 16;
    if (current.points.length === 1) {
      const only = current.points[0] as LatLng;
      map.setView(tuple(only), Math.min(maxZoom, 15), { animate: true });
      return;
    }
    const padding = current.padding ?? 48;
    map.fitBounds(L.latLngBounds(current.points.map(tuple)), {
      padding: [padding, padding],
      maxZoom,
      animate: true,
    });
  }, [key, map]);
  useEffect(() => {
    map.whenReady(() => void onReady());
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map, onReady]);
  return null;
}

/** Turns gestures on and off after creation (MapContainer options are read once). */
function Gestures({ interactive }: { interactive: boolean }) {
  const map = useMap();
  useEffect(() => {
    const handlers = [
      map.dragging,
      map.touchZoom,
      map.doubleClickZoom,
      map.scrollWheelZoom,
      map.boxZoom,
      map.keyboard,
    ];
    for (const handler of handlers) {
      if (interactive) handler.enable();
      else handler.disable();
    }
    if (interactive) map.zoomControl?.addTo(map);
    else map.zoomControl?.remove();
  }, [interactive, map]);
  return null;
}

/** Map taps move the pick pin. */
function TapToPlace({ pick, onPick }: { pick: MapPick | null; onPick: (point: LatLng) => Promise<void> }) {
  useMapEvents({
    click(event) {
      if (!pick || pick.tapToPlace === false) return;
      void onPick({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

function LiveMarker({
  marker,
  palette,
  onMarkerPress,
}: {
  marker: MapMarker;
  palette: MapPalette;
  onMarkerPress: (id: string) => Promise<void>;
}) {
  const ref = useRef<L.Marker | null>(null);
  const [initial] = useState(() => tuple(marker.position));
  const spec = iconFor(marker, palette);
  const icon = useMemo(
    () => L.divIcon({ className: '', html: spec.html, iconSize: spec.size, iconAnchor: spec.anchor }),
    [spec.html, spec.size, spec.anchor],
  );
  const { lat, lng } = marker.position;
  const glide = marker.glide === true;
  useEffect(() => {
    const leaflet = ref.current;
    if (!leaflet) return;
    const from = leaflet.getLatLng();
    const to = L.latLng(lat, lng);
    if (from.equals(to)) return;
    if (!glide || from.distanceTo(to) > GLIDE_MAX_M) {
      leaflet.setLatLng(to);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / GLIDE_MS);
      const eased = 1 - (1 - t) ** 3;
      leaflet.setLatLng([from.lat + (to.lat - from.lat) * eased, from.lng + (to.lng - from.lng) * eased]);
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
      title={marker.title}
      alt={marker.title}
      zIndexOffset={marker.zIndex ?? (marker.kind === 'driver' ? 1000 : 0)}
      keyboard={false}
      eventHandlers={{ click: () => void onMarkerPress(marker.id) }}
    />
  );
}

function PickPin({
  pick,
  palette,
  onPick,
}: {
  pick: MapPick;
  palette: MapPalette;
  onPick: (point: LatLng) => Promise<void>;
}) {
  const spec = iconFor({ id: 'pick', kind: 'pin', position: pick.position ?? { lat: 0, lng: 0 } }, palette);
  const icon = useMemo(
    () => L.divIcon({ className: '', html: spec.html, iconSize: spec.size, iconAnchor: spec.anchor }),
    [spec.html, spec.size, spec.anchor],
  );
  if (!pick.position) return null;
  return (
    <Marker
      position={tuple(pick.position)}
      icon={icon}
      draggable={pick.draggable !== false}
      zIndexOffset={2000}
      eventHandlers={{
        dragend: (event) => {
          const point = (event.target as L.Marker).getLatLng();
          void onPick({ lat: point.lat, lng: point.lng });
        },
      }}
    />
  );
}

/** Counts tile errors; 4 in a row without a load, or `online` false, is "failing". */
function TileWatch({
  online,
  onTiles,
}: {
  online: boolean;
  onTiles: (state: 'ok' | 'failing') => Promise<void>;
}) {
  const errors = useRef(0);
  const state = useRef<'ok' | 'failing'>('ok');
  const map = useMap();
  const report = (next: 'ok' | 'failing') => {
    if (state.current === next) return;
    state.current = next;
    void onTiles(next);
  };
  useEffect(() => {
    if (!online) report('failing');
    else {
      errors.current = 0;
      // Redraw the tiles that failed while offline.
      map.eachLayer((layer) => {
        if (layer instanceof L.TileLayer) layer.redraw();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, map]);
  useEffect(() => {
    const onError = () => {
      errors.current += 1;
      if (errors.current >= FAILING_AFTER) report('failing');
    };
    const onLoad = () => {
      errors.current = 0;
      if (online) report('ok');
    };
    map.eachLayer((layer) => {
      if (layer instanceof L.TileLayer) {
        layer.on('tileerror', onError);
        layer.on('tileload', onLoad);
      }
    });
    return () => {
      map.eachLayer((layer) => {
        if (layer instanceof L.TileLayer) {
          layer.off('tileerror', onError);
          layer.off('tileload', onLoad);
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, online]);
  return null;
}

export default function LeafletCanvas(props: LeafletCanvasProps) {
  const { palette, interactive, pick } = props;
  useEffect(ensureStyles, []);
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#E9ECEF' }}>
      <MapContainer
        center={tuple(props.initialCenter)}
        zoom={props.initialZoom}
        style={{ height: '100%', width: '100%', background: '#E9ECEF' }}
        zoomControl={interactive}
        dragging={interactive}
        touchZoom={interactive}
        doubleClickZoom={interactive}
        scrollWheelZoom={interactive}
        boxZoom={interactive}
        keyboard={interactive}
        attributionControl
      >
        <TileLayer
          url={props.tiles.tileUrl}
          attribution={props.tiles.attribution}
          maxZoom={props.tiles.maxZoom}
        />
        <Camera fit={props.fit} onReady={props.onReady} />
        <Gestures interactive={interactive} />
        <TileWatch online={props.online} onTiles={props.onTiles} />
        <TapToPlace pick={pick} onPick={props.onPick} />
        {props.circles.map((circle) => (
          <Circle
            key={circle.id}
            center={tuple(circle.center)}
            radius={circle.radiusM}
            pathOptions={{
              color: palette[circle.tone ?? 'brand'],
              weight: 2,
              fillOpacity: 0.12,
              interactive: false,
            }}
          />
        ))}
        {props.polylines.map((line) => (
          <Polyline
            key={line.id}
            positions={line.points.map(tuple)}
            pathOptions={{
              color: palette[line.tone ?? 'brand'],
              weight: line.weight ?? 4,
              dashArray: line.dashed ? '6 8' : undefined,
              opacity: 0.9,
              interactive: false,
            }}
          />
        ))}
        {props.markers.map((marker) => (
          <LiveMarker key={marker.id} marker={marker} palette={palette} onMarkerPress={props.onMarkerPress} />
        ))}
        {pick ? <PickPin pick={pick} palette={palette} onPick={props.onPick} /> : null}
      </MapContainer>
    </div>
  );
}
