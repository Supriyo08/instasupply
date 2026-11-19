import type { RoutePlan } from '@instasupply/shared';
import { Marker, Polyline, Tooltip } from 'react-leaflet';

import { AnimatedMarker, BaseMap, FitBounds, InvalidateOnResize, toLeaflet } from '@/components/map/BaseMap';
import { destinationIcon, driverIcon, stopIcon } from '@/components/map/markers';
import { statusHex } from '@/components/ui/Badge';
import type { DeliveryRecord, LocationRecord, Presence } from '@/lib/data';

/** Destination, the assigned driver's live position and their planned route. */
export function DeliveryMap({
  delivery,
  driverLocation,
  presence,
  route,
}: {
  delivery: DeliveryRecord;
  driverLocation: LocationRecord | null;
  presence: Presence;
  route: RoutePlan | null;
}) {
  const stops = route?.stops ?? [];
  const showDriver = !!driverLocation && presence !== 'offline';
  const points = [delivery.location, ...(showDriver ? [driverLocation] : [])];

  return (
    <div className="h-72 overflow-hidden rounded-2xl ring-1 ring-slate-200 sm:h-80">
      <BaseMap center={delivery.location} zoom={14}>
        <InvalidateOnResize />
        <FitBounds points={points} fitKey={`${delivery.id}|${showDriver}`} />
        {route && route.polyline.length > 1 ? (
          <Polyline
            positions={route.polyline.map(toLeaflet)}
            pathOptions={{ color: '#6366f1', weight: 4, opacity: 0.55 }}
          />
        ) : null}
        {stops
          .filter((stop) => stop.deliveryId !== delivery.id)
          .map((stop) => (
            <Marker
              key={stop.deliveryId}
              position={toLeaflet(stop.location)}
              icon={stopIcon({ label: String(stops.indexOf(stop) + 1), color: '#94a3b8' })}
            >
              <Tooltip>{`${stop.orderId} · ${stop.customerName}`}</Tooltip>
            </Marker>
          ))}
        <Marker position={toLeaflet(delivery.location)} icon={destinationIcon()} zIndexOffset={500}>
          <Tooltip permanent direction="top" offset={[0, -18]}>
            {delivery.orderId}
          </Tooltip>
        </Marker>
        {showDriver && driverLocation ? (
          <AnimatedMarker
            position={driverLocation}
            icon={driverIcon({
              name: delivery.driverName ?? 'Driver',
              color: statusHex(delivery.status),
              heading: driverLocation.heading,
              stale: presence === 'stale',
              live: true,
            })}
            zIndexOffset={1000}
          >
            <Tooltip>{delivery.driverName}</Tooltip>
          </AnimatedMarker>
        ) : null}
      </BaseMap>
    </div>
  );
}
