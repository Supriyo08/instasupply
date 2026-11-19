/**
 * Maintains `tracking/{token}` — the sanitized document behind the public customer tracking page.
 * It never contains the driver's other stops, phone number or full name.
 */
import {
  COLLECTIONS,
  LIVE_TRACKING_STATUSES,
  PROGRESS_STEPS,
  STATUS_TIMESTAMP_FIELD,
  VEHICLE_META,
  estimateDriveSeconds,
  estimateRoadMeters,
  firstName,
  haversineMeters,
  toMillis,
  type DriverLocation,
  type LatLng,
  type RoutePlan,
  type TimestampLike,
  type UserProfile,
} from '@instasupply/shared';

import { db, serverTimestamp, Timestamp } from '../../lib/admin';
import { vehicleLabel } from '../../lib/users';
import {
  deliveriesCol,
  getPrivateMeta,
  isCompleteDelivery,
  trackingRef,
  type DeliveryRecord,
} from '../deliveries/repository';
import { getLiveDriveSeconds } from '../routing/providers';

/** Traffic-aware live ETAs cost money, so refresh them at most once a minute per delivery. */
const LIVE_ETA_REFRESH_MS = 60_000;

function timelineOf(delivery: DeliveryRecord): { status: DeliveryRecord['status']; at: TimestampLike }[] {
  const steps = ['unassigned', ...PROGRESS_STEPS, 'failed', 'cancelled'] as const;
  const timeline: { status: DeliveryRecord['status']; at: TimestampLike }[] = [
    { status: 'unassigned', at: delivery.createdAt },
  ];
  for (const status of steps) {
    const field = STATUS_TIMESTAMP_FIELD[status];
    const at = field
      ? (delivery as unknown as Record<string, TimestampLike | null | undefined>)[field]
      : null;
    if (at) timeline.push({ status, at });
  }
  return timeline.sort((a, b) => (toMillis(a.at) ?? 0) - (toMillis(b.at) ?? 0));
}

function estimateEta(from: LatLng, to: LatLng, profile: UserProfile | null) {
  const meters = estimateRoadMeters(haversineMeters(from, to));
  const speed = profile?.vehicle ? VEHICLE_META[profile.vehicle.type]?.speedKmh : undefined;
  return { seconds: Math.round(estimateDriveSeconds(meters, speed)), meters: Math.round(meters) };
}

interface SyncContext {
  profile?: UserProfile | null;
  location?: DriverLocation | null;
  route?: Partial<RoutePlan> | null;
}

/** Rebuild the tracking document for one delivery from current state. */
export async function syncTracking(delivery: DeliveryRecord, context: SyncContext = {}): Promise<void> {
  const meta = await getPrivateMeta(delivery.id);
  if (!meta) return;
  const ref = trackingRef(meta.trackingToken);

  const driverId = delivery.driverId;
  const [profile, location, route, existing] = await Promise.all([
    context.profile !== undefined || !driverId
      ? (context.profile ?? null)
      : db
          .collection(COLLECTIONS.users)
          .doc(driverId)
          .get()
          .then((s) => (s.exists ? (s.data() as UserProfile) : null)),
    context.location !== undefined || !driverId
      ? (context.location ?? null)
      : db
          .collection(COLLECTIONS.driverLocations)
          .doc(driverId)
          .get()
          .then((s) => (s.exists ? (s.data() as DriverLocation) : null)),
    context.route !== undefined || !driverId
      ? (context.route ?? null)
      : db
          .collection(COLLECTIONS.routes)
          .doc(driverId)
          .get()
          .then((s) => (s.exists ? (s.data() as Partial<RoutePlan>) : null)),
    ref.get(),
  ]);

  const live = LIVE_TRACKING_STATUSES.includes(delivery.status) && !!location;
  const stopIndex = route?.stops?.findIndex((stop) => stop.deliveryId === delivery.id) ?? -1;

  let etaSeconds: number | null = null;
  let distanceMeters: number | null = null;
  let etaComputedAt = existing.get('etaComputedAt') as Timestamp | undefined;

  if (live && location) {
    const previousEta = existing.get('etaSeconds') as number | null | undefined;
    const fresh = etaComputedAt && Date.now() - etaComputedAt.toMillis() < LIVE_ETA_REFRESH_MS;
    const google = fresh ? null : await getLiveDriveSeconds(location, delivery.location);
    if (google) {
      etaSeconds = Math.round(google.seconds);
      distanceMeters = Math.round(google.meters);
      etaComputedAt = Timestamp.now();
    } else {
      const estimate = estimateEta(location, delivery.location, profile);
      // Keep a recent traffic-aware ETA if we have one; otherwise use the estimate.
      etaSeconds = fresh && typeof previousEta === 'number' ? previousEta : estimate.seconds;
      distanceMeters = estimate.meters;
    }
    if (delivery.status === 'arrived') etaSeconds = 0;
  } else if (stopIndex >= 0 && route?.stops) {
    const elapsed = (Date.now() - (toMillis(route.computedAt) ?? Date.now())) / 1000;
    etaSeconds = Math.max(0, Math.round(route.stops[stopIndex]!.arrivalOffsetSeconds - elapsed));
  }

  await ref.set({
    deliveryId: delivery.id,
    orderId: delivery.orderId,
    status: delivery.status,
    customerFirstName: firstName(delivery.customer.name),
    address: delivery.address,
    destination: delivery.location,
    driver: driverId
      ? {
          firstName: firstName(profile?.displayName ?? delivery.driverName),
          vehicle: vehicleLabel(profile),
          location: live && location ? { lat: location.lat, lng: location.lng } : null,
          heading: live && location ? location.heading : null,
          updatedAt: live && location ? location.updatedAt : null,
        }
      : null,
    etaSeconds,
    distanceMeters,
    etaComputedAt: etaComputedAt ?? null,
    stopsBefore: stopIndex >= 0 ? stopIndex : null,
    handoffCode: delivery.requireCode ? meta.handoffCode : null,
    timeline: timelineOf(delivery),
    updatedAt: serverTimestamp(),
  });
}

/** Push a driver's new position into the tracking pages of the stops they're driving to. */
export async function syncTrackingForDriver(driverId: string, location: DriverLocation): Promise<void> {
  const snapshot = await deliveriesCol()
    .where('driverId', '==', driverId)
    .where('status', 'in', LIVE_TRACKING_STATUSES)
    .get();
  if (snapshot.empty) return;

  const [profileSnap, routeSnap] = await Promise.all([
    db.collection(COLLECTIONS.users).doc(driverId).get(),
    db.collection(COLLECTIONS.routes).doc(driverId).get(),
  ]);
  const profile = profileSnap.exists ? (profileSnap.data() as UserProfile) : null;
  const route = routeSnap.exists ? (routeSnap.data() as Partial<RoutePlan>) : null;
  const deliveries = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as DeliveryRecord)
    .filter(isCompleteDelivery);
  await Promise.all(deliveries.map((delivery) => syncTracking(delivery, { profile, location, route })));
}

export async function deleteTrackingForDelivery(deliveryId: string): Promise<void> {
  const snapshot = await db.collection(COLLECTIONS.tracking).where('deliveryId', '==', deliveryId).get();
  await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
}
