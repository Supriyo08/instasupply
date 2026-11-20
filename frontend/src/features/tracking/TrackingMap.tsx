import type { LatLng } from '@instasupply/shared';
import { Marker, Polyline, Tooltip } from 'react-leaflet';

import { AnimatedMarker, BaseMap, FitBounds, InvalidateOnResize, toLeaflet } from '@/components/map/BaseMap';
import { destinationIcon, driverIcon, storeIcon } from '@/components/map/markers';

/**
 * The public tracking map: the site, the store while the driver is still collecting the load, and the
 * driver's last position. A position older than the stale limit is drawn grey, without the live pulse.
 */
export function TrackingMap({
  destination,
  store,
  driver,
}: {
  destination: LatLng;
  store: { name: string; location: LatLng } | null;
  driver: { location: LatLng; heading: number | null; firstName: string; stale: boolean } | null;
}) {
  const points = [destination, ...(store ? [store.location] : []), ...(driver ? [driver.location] : [])];
  const target = store ?? { location: destination };
  return (
    <BaseMap center={destination} zoom={14} scrollWheelZoom={false}>
      <InvalidateOnResize />
      <FitBounds
        points={points}
        fitKey={`${store ? 'store' : 'site'}|${driver ? 'driver' : 'none'}`}
        padding={64}
        maxZoom={16}
      />
      {driver ? (
        <Polyline
          positions={[toLeaflet(driver.location), toLeaflet(target.location)]}
          pathOptions={{
            color: driver.stale ? '#94a3b8' : '#4f46e5',
            weight: 3,
            opacity: 0.6,
            dashArray: '6 8',
          }}
        />
      ) : null}
      {store ? (
        <Marker position={toLeaflet(store.location)} icon={storeIcon({ active: true })} title={store.name}>
          <Tooltip direction="top" offset={[0, -16]}>
            {store.name}
          </Tooltip>
        </Marker>
      ) : null}
      <Marker position={toLeaflet(destination)} icon={destinationIcon()} title="Your site" />
      {driver ? (
        <AnimatedMarker
          position={driver.location}
          icon={driverIcon({
            name: driver.firstName,
            heading: driver.heading,
            stale: driver.stale,
            live: !driver.stale,
          })}
          zIndexOffset={1000}
          duration={2000}
        />
      ) : null}
    </BaseMap>
  );
}
