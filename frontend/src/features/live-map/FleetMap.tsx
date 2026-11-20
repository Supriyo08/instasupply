import { formatRelativeTime, STATUS_META, type LatLng, type RoutePlan } from '@instasupply/shared';
import { useMemo } from 'react';
import { Marker, Polyline, Tooltip } from 'react-leaflet';
import { useNavigate } from 'react-router';

import { AnimatedMarker, BaseMap, FitBounds, InvalidateOnResize, toLeaflet } from '@/components/map/BaseMap';
import { driverIcon, stopIcon, storeIcon } from '@/components/map/markers';
import { statusHex } from '@/components/ui/Badge';
import { colorIndex } from '@/components/ui/Avatar';
import {
  indexById,
  presenceOf,
  type DeliveryRecord,
  type DriverRecord,
  type LocationRecord,
} from '@/lib/data';

/** Distinct marker colours per driver (stable across sessions). */
const DRIVER_COLORS = ['#4f46e5', '#059669', '#d97706', '#0284c7', '#e11d48', '#7c3aed', '#0d9488'];
export const driverColor = (driverId: string) => DRIVER_COLORS[colorIndex(driverId)]!;

export function FleetMap({
  drivers,
  locations,
  deliveries,
  now,
  selectedDriverId,
  route,
  onSelectDriver,
  showUnassigned = true,
  scrollWheelZoom = true,
  fitPaddingRight = 0,
}: {
  drivers: DriverRecord[];
  locations: LocationRecord[];
  deliveries: DeliveryRecord[];
  now: number;
  selectedDriverId?: string | null;
  route?: RoutePlan | null;
  onSelectDriver?: (driverId: string | null) => void;
  showUnassigned?: boolean;
  /** Disable for maps embedded in scrolling pages so the wheel scrolls the page. */
  scrollWheelZoom?: boolean;
  /** Keep fitted content clear of an overlay on the right. */
  fitPaddingRight?: number;
}) {
  const navigate = useNavigate();
  const driversById = useMemo(() => indexById(drivers), [drivers]);

  const visibleDrivers = locations.filter(
    (location) => driversById.has(location.id) && presenceOf(location, now) !== 'offline',
  );
  const activeRoute = selectedDriverId && route?.driverId === selectedDriverId ? route : null;
  const routeStops = activeRoute?.stops ?? [];
  const routeIds = new Set(routeStops.map((stop) => stop.deliveryId));
  // Stores with a load still waiting to be collected by one of the shown deliveries.
  const stores = new Map<string, { name: string; location: LatLng; count: number }>();
  const pins = deliveries.filter((delivery) => {
    if (routeIds.has(delivery.id)) return false;
    if (delivery.status === 'unassigned') return showUnassigned;
    return selectedDriverId ? delivery.driverId === selectedDriverId : true;
  });

  for (const delivery of pins) {
    const pickup = delivery.pickup;
    if (!pickup || pickup.collectedAt != null) continue;
    const entry = stores.get(pickup.storeId) ?? {
      name: pickup.storeName,
      location: pickup.location,
      count: 0,
    };
    entry.count += 1;
    stores.set(pickup.storeId, entry);
  }

  const fitPoints: LatLng[] = selectedDriverId
    ? [
        ...routeStops.map((stop) => stop.location),
        ...visibleDrivers.filter((location) => location.id === selectedDriverId),
      ]
    : [...visibleDrivers, ...pins.map((delivery) => delivery.location)];
  // Refit when the selection changes and again once the selected driver's route arrives.
  const fitKey = `${selectedDriverId ?? 'all'}|${activeRoute ? 'route' : 'none'}|${fitPoints.length > 0}`;

  return (
    <BaseMap scrollWheelZoom={scrollWheelZoom}>
      <InvalidateOnResize />
      <FitBounds points={fitPoints} fitKey={fitKey} paddingRight={fitPaddingRight} />

      {routeStops.length > 0 && activeRoute && activeRoute.polyline.length > 1 ? (
        <Polyline
          positions={activeRoute.polyline.map(toLeaflet)}
          pathOptions={{ color: driverColor(selectedDriverId!), weight: 5, opacity: 0.7 }}
        />
      ) : null}

      {pins.map((delivery) => (
        <Marker
          key={delivery.id}
          position={toLeaflet(delivery.location)}
          icon={stopIcon({
            label: delivery.status === 'unassigned' ? '!' : '•',
            color: statusHex(delivery.status),
          })}
          eventHandlers={{ click: () => navigate(`/deliveries/${delivery.id}`) }}
        >
          <Tooltip>
            <span className="font-semibold">{delivery.orderId}</span> · {STATUS_META[delivery.status].label}
            <br />
            {delivery.pickup ? `${delivery.pickup.storeName} → ` : ''}
            {delivery.customer.name}
          </Tooltip>
        </Marker>
      ))}

      {[...stores.entries()].map(([storeId, store]) => (
        <Marker
          key={`store-${storeId}`}
          position={toLeaflet(store.location)}
          icon={storeIcon()}
          title={store.name}
        >
          <Tooltip>
            <span className="font-semibold">{store.name}</span>
            <br />
            {store.count} load{store.count === 1 ? '' : 's'} waiting for pickup
          </Tooltip>
        </Marker>
      ))}

      {routeStops.map((stop, index) => (
        <Marker
          key={`${stop.deliveryId}-${stop.kind}`}
          position={toLeaflet(stop.location)}
          icon={
            stop.kind === 'pickup'
              ? storeIcon({ active: index === 0 })
              : stopIcon({ label: String(index + 1), color: statusHex(stop.status), active: index === 0 })
          }
          eventHandlers={{ click: () => navigate(`/deliveries/${stop.deliveryId}`) }}
        >
          <Tooltip>
            <span className="font-semibold">
              {index + 1}. {stop.kind === 'pickup' ? `Pickup at ${stop.title}` : stop.orderId}
            </span>{' '}
            · {stop.kind === 'pickup' ? stop.orderId : stop.customerName}
          </Tooltip>
        </Marker>
      ))}

      {visibleDrivers.map((location) => {
        const driver = driversById.get(location.id)!;
        const presence = presenceOf(location, now);
        const selected = location.id === selectedDriverId;
        return (
          <AnimatedMarker
            key={location.id}
            position={location}
            zIndexOffset={selected ? 2000 : 1000}
            icon={driverIcon({
              name: driver.displayName,
              color: driverColor(driver.id),
              heading: location.heading,
              stale: presence === 'stale',
              selected,
              live: presence === 'online',
            })}
            onClick={() => onSelectDriver?.(selected ? null : driver.id)}
          >
            <Tooltip>
              <span className="font-semibold">{driver.displayName}</span>
              <br />
              {presence === 'stale' ? 'No recent signal · ' : ''}seen{' '}
              {formatRelativeTime(location.updatedAt, now)}
            </Tooltip>
          </AnimatedMarker>
        );
      })}
    </BaseMap>
  );
}
