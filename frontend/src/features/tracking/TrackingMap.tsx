import type { LatLng } from '@instasupply/shared';
import { Marker, Polyline } from 'react-leaflet';

import { AnimatedMarker, BaseMap, FitBounds, InvalidateOnResize, toLeaflet } from '@/components/map/BaseMap';
import { destinationIcon, driverIcon } from '@/components/map/markers';

export function TrackingMap({
  destination,
  driver,
}: {
  destination: LatLng;
  driver: { location: LatLng; heading: number | null; firstName: string } | null;
}) {
  const points = driver ? [destination, driver.location] : [destination];
  return (
    <BaseMap center={destination} zoom={15} scrollWheelZoom={false}>
      <InvalidateOnResize />
      <FitBounds points={points} fitKey={driver ? 'with-driver' : 'destination'} padding={64} maxZoom={16} />
      {driver ? (
        <Polyline
          positions={[toLeaflet(driver.location), toLeaflet(destination)]}
          pathOptions={{ color: '#4f46e5', weight: 3, opacity: 0.6, dashArray: '6 8' }}
        />
      ) : null}
      <Marker position={toLeaflet(destination)} icon={destinationIcon()} />
      {driver ? (
        <AnimatedMarker
          position={driver.location}
          icon={driverIcon({ name: driver.firstName, heading: driver.heading, live: true })}
          zIndexOffset={1000}
          duration={2000}
        />
      ) : null}
    </BaseMap>
  );
}
