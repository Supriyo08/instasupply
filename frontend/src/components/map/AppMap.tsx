import type { LatLng } from '@instasupply/shared';
import type L from 'leaflet';
import { useMemo } from 'react';
import { Circle, Marker, Polyline, Tooltip } from 'react-leaflet';

import { cn } from '@/lib/cn';

import {
  AnimatedMarker,
  BaseMap,
  ClickToPick,
  DEFAULT_CENTER,
  FitBounds,
  InvalidateOnResize,
} from './BaseMap';
import {
  TONE_HEX,
  type MapCircle,
  type MapFit,
  type MapMarker,
  type MapPick,
  type MapPolyline,
} from './map-types';
import { destinationIcon, driverIcon, stopIcon, storeIcon } from './markers';

export interface AppMapProps {
  markers?: MapMarker[];
  polylines?: MapPolyline[];
  circles?: MapCircle[];
  fit?: MapFit | null;
  /** Used until the first fit. Default: Toronto, zoom 11. */
  initialCenter?: LatLng;
  initialZoom?: number;
  /** Default true on the console (a mouse does not fight page scrolling the way a finger does). */
  interactive?: boolean;
  pick?: MapPick;
  onPick?: (point: LatLng) => void;
  onMarkerPress?: (id: string) => void;
  /** Give the frame a height (`h-80`, `h-full` in a sized parent). */
  className?: string;
  /** The map is a picture to a screen reader: say what it shows. */
  accessibilityLabel: string;
}

function iconFor(marker: MapMarker): L.DivIcon {
  const color = TONE_HEX[marker.tone ?? (marker.kind === 'store' ? 'warning' : 'brand')];
  switch (marker.kind) {
    case 'driver':
      return driverIcon({
        name: marker.label ?? marker.title ?? '',
        color,
        heading: marker.heading ?? null,
        stale: marker.stale,
        selected: marker.highlighted,
        live: !marker.stale,
      });
    case 'stop':
      return stopIcon({ label: (marker.label ?? '').slice(0, 3), color, active: marker.highlighted });
    case 'store':
      return storeIcon({ color, active: marker.highlighted });
    case 'site':
      return destinationIcon();
    case 'pin':
      return stopIcon({ label: '', color, active: true });
  }
}

/**
 * The console's declarative map (CLIENTS §7.2 props on react-leaflet, §7.5): markers keyed by id,
 * polylines, circles, a fit that runs only when its key changes, and an optional controlled pin.
 * Tiles and attribution come from `useConfig()` through `BaseMap`.
 */
export function AppMap({
  markers = [],
  polylines = [],
  circles = [],
  fit = null,
  initialCenter = DEFAULT_CENTER,
  initialZoom = 11,
  interactive = true,
  pick,
  onPick,
  onMarkerPress,
  className,
  accessibilityLabel,
}: AppMapProps) {
  const pinIcon = useMemo(() => stopIcon({ label: '', color: TONE_HEX.brand, active: true }), []);
  return (
    <div
      role="img"
      aria-label={accessibilityLabel}
      className={cn('relative isolate z-0 overflow-hidden rounded-xl bg-slate-200', className)}
    >
      <BaseMap center={initialCenter} zoom={initialZoom} scrollWheelZoom={interactive}>
        <InvalidateOnResize />
        {fit ? (
          <FitBounds points={fit.points} fitKey={fit.key} padding={fit.padding} maxZoom={fit.maxZoom} />
        ) : null}
        {circles.map((circle) => (
          <Circle
            key={circle.id}
            center={[circle.center.lat, circle.center.lng]}
            radius={circle.radiusM}
            pathOptions={{ color: TONE_HEX[circle.tone ?? 'brand'], weight: 2, fillOpacity: 0.08 }}
          />
        ))}
        {polylines.map((line) =>
          line.points.length > 1 ? (
            <Polyline
              key={line.id}
              positions={line.points.map((point) => [point.lat, point.lng] as L.LatLngTuple)}
              pathOptions={{
                color: TONE_HEX[line.tone ?? 'brand'],
                weight: line.weight ?? 4,
                dashArray: line.dashed ? '6 8' : undefined,
              }}
            />
          ) : null,
        )}
        {markers.map((marker) => {
          const icon = iconFor(marker);
          const press = onMarkerPress ? () => onMarkerPress(marker.id) : undefined;
          const tooltip = marker.title ? <Tooltip direction="right">{marker.title}</Tooltip> : null;
          return marker.glide ? (
            <AnimatedMarker
              key={marker.id}
              position={marker.position}
              icon={icon}
              zIndexOffset={marker.zIndex}
              onClick={press}
            >
              {tooltip}
            </AnimatedMarker>
          ) : (
            <Marker
              key={marker.id}
              position={[marker.position.lat, marker.position.lng]}
              icon={icon}
              title={marker.title}
              zIndexOffset={marker.zIndex}
              eventHandlers={press ? { click: press } : undefined}
            >
              {tooltip}
            </Marker>
          );
        })}
        {pick && onPick && pick.tapToPlace !== false ? <ClickToPick onPick={onPick} /> : null}
        {pick?.position ? (
          <Marker
            position={[pick.position.lat, pick.position.lng]}
            icon={pinIcon}
            draggable={pick.draggable !== false && !!onPick}
            zIndexOffset={1000}
            eventHandlers={
              onPick
                ? {
                    dragend: (event) => {
                      const point = (event.target as L.Marker).getLatLng();
                      onPick({ lat: point.lat, lng: point.lng });
                    },
                  }
                : undefined
            }
          />
        ) : null}
      </BaseMap>
    </div>
  );
}
