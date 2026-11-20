import type { LatLng, RoutePlan } from '@instasupply/shared';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';

import { AppMap } from '@/components/map/AppMap';
import { fitKeyFor, type MapMarker } from '@/components/map/map-types';
import type { DeliveryRecord, LocationRecord, Presence } from '@/lib/data';

import { awaitingPickup } from '../delivery-format';

/** The jobsite, the store while the load is not collected, the driver's live position and their route. */
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
  const navigate = useNavigate();
  const showDriver = !!driverLocation && presence !== 'offline';
  const toStore = !!delivery.pickup && awaitingPickup(delivery);

  const markers = useMemo(() => {
    const list: MapMarker[] = [];
    (route?.stops ?? []).forEach((stop, index) => {
      if (stop.deliveryId === delivery.id) return;
      list.push({
        id: `stop:${stop.deliveryId}:${stop.kind}`,
        position: stop.location,
        kind: 'stop',
        label: String(index + 1),
        tone: 'neutral',
        title: `${index + 1}. ${stop.kind === 'pickup' ? `Pickup at ${stop.title}` : stop.customerName} · ${stop.orderId}`,
      });
    });
    if (delivery.pickup) {
      list.push({
        id: 'store',
        position: delivery.pickup.location,
        kind: 'store',
        tone: toStore ? 'warning' : 'neutral',
        title: `Pickup: ${delivery.pickup.storeName}`,
        zIndex: 400,
      });
    }
    list.push({
      id: 'site',
      position: delivery.location,
      kind: 'site',
      title: `Drop-off: ${delivery.address}`,
      zIndex: 500,
    });
    if (showDriver && driverLocation) {
      list.push({
        id: 'driver',
        position: driverLocation,
        kind: 'driver',
        label: delivery.driverName ?? 'Driver',
        title: delivery.driverName ?? 'Driver',
        heading: driverLocation.heading,
        stale: presence === 'stale',
        glide: true,
        zIndex: 1000,
      });
    }
    return list;
  }, [delivery, driverLocation, presence, route, showDriver, toStore]);

  const fitPoints: LatLng[] = [
    delivery.location,
    ...(delivery.pickup && toStore ? [delivery.pickup.location] : []),
    ...(showDriver && driverLocation ? [driverLocation] : []),
  ];

  return (
    <AppMap
      className="h-72 rounded-2xl ring-1 ring-slate-200 sm:h-80"
      markers={markers}
      polylines={
        route && route.polyline.length > 1 ? [{ id: 'route', points: route.polyline, tone: 'brand' }] : []
      }
      fit={{
        key: `${delivery.id}|${fitKeyFor(fitPoints.slice(0, 2))}|${showDriver}`,
        points: fitPoints,
        padding: 48,
      }}
      initialCenter={delivery.location}
      initialZoom={13}
      interactive={false}
      onMarkerPress={(id) => {
        const stopId = id.startsWith('stop:') ? id.split(':')[1] : null;
        if (stopId) navigate(`/deliveries/${stopId}`);
      }}
      accessibilityLabel={`Map of ${delivery.orderId}: ${toStore && delivery.pickup ? `pickup at ${delivery.pickup.storeName}, then ` : ''}drop-off at ${delivery.address}${showDriver ? `, ${delivery.driverName ?? 'the driver'}'s live position` : ''}.`}
    />
  );
}
