/**
 * Plans a driver's route: loads their active stops and live position, builds a travel matrix,
 * runs the shared optimizer and stores the plan in `routes/{driverId}`.
 */
import { createHash } from 'node:crypto';

import {
  ACTIVE_STATUSES,
  COLLECTIONS,
  VEHICLE_META,
  centerOf,
  optimizeStops,
  simplifyPath,
  toMillis,
  type DriverLocation,
  type LatLng,
  type OptimizeRouteResponse,
  type RoutePlan,
  type RouteStop,
  type UserProfile,
} from '@instasupply/shared';
import * as logger from 'firebase-functions/logger';

import { db, serverTimestamp, Timestamp } from '../../lib/admin';
import { deliveriesCol, isCompleteDelivery, type DeliveryRecord } from '../deliveries/repository';
import { getRoutePolyline, getTravelMatrix } from './providers';

const LEASE_MS = 60_000;

export const routeRef = (driverId: string) => db.collection(COLLECTIONS.routes).doc(driverId);

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

function planSignature(deliveries: DeliveryRecord[], origin: LatLng | null): string {
  const stops = deliveries
    .map((delivery) => [
      delivery.id,
      delivery.status,
      round(delivery.location.lat, 5),
      round(delivery.location.lng, 5),
      delivery.priority,
      toMillis(delivery.windowStart),
      toMillis(delivery.windowEnd),
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  // ~100 m of GPS movement doesn't warrant a new plan from an automatic trigger.
  const roundedOrigin = origin ? [round(origin.lat, 3), round(origin.lng, 3)] : null;
  return createHash('sha1').update(JSON.stringify({ stops, roundedOrigin })).digest('hex');
}

function summarize(plan: Partial<RoutePlan> | undefined): OptimizeRouteResponse {
  return {
    stops: plan?.stops?.length ?? 0,
    totalSeconds: plan?.totalSeconds ?? 0,
    totalMeters: plan?.totalMeters ?? 0,
    provider: plan?.provider ?? 'estimate',
  };
}

export interface PlanOptions {
  origin?: LatLng | null;
  /** Recompute even if an identical plan was produced recently. */
  force?: boolean;
}

export async function planRoute(driverId: string, options: PlanOptions = {}): Promise<OptimizeRouteResponse> {
  const [deliveriesSnap, locationSnap, profileSnap] = await Promise.all([
    deliveriesCol().where('driverId', '==', driverId).where('status', 'in', ACTIVE_STATUSES).get(),
    db.collection(COLLECTIONS.driverLocations).doc(driverId).get(),
    db.collection(COLLECTIONS.users).doc(driverId).get(),
  ]);

  const deliveries = deliveriesSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as DeliveryRecord)
    .filter(isCompleteDelivery);
  const live = locationSnap.exists ? (locationSnap.data() as DriverLocation) : null;
  const origin = options.origin ?? (live ? { lat: live.lat, lng: live.lng } : null);
  const ref = routeRef(driverId);
  const signature = planSignature(deliveries, origin);

  if (!options.force) {
    // Several triggers can fire at once (e.g. a bulk import). Only one computes the same plan.
    const skip = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const lease = snapshot.get('lease') as { signature: string; at: Timestamp } | undefined;
      if (lease?.signature === signature && Date.now() - lease.at.toMillis() < LEASE_MS) return true;
      tx.set(ref, { lease: { signature, at: Timestamp.now() } }, { merge: true });
      return false;
    });
    if (skip) return summarize((await ref.get()).data() as Partial<RoutePlan> | undefined);
  }

  if (deliveries.length === 0) {
    await ref.set({
      driverId,
      origin,
      stops: [],
      totalSeconds: 0,
      totalMeters: 0,
      polyline: [],
      provider: 'estimate',
      computedAt: serverTimestamp(),
      lease: { signature, at: Timestamp.now() },
    });
    return summarize(undefined);
  }

  const profile = profileSnap.exists ? (profileSnap.data() as UserProfile) : null;
  const speedKmh = profile?.vehicle ? VEHICLE_META[profile.vehicle.type]?.speedKmh : undefined;
  const start = origin ?? centerOf(deliveries.map((delivery) => delivery.location))!;
  const points = [start, ...deliveries.map((delivery) => delivery.location)];

  const { matrix, provider } = await getTravelMatrix(points, speedKmh);
  const locked = deliveries.find(
    (delivery) => delivery.status === 'in_transit' || delivery.status === 'arrived',
  );
  const optimized = optimizeStops(
    deliveries.map((delivery) => ({
      id: delivery.id,
      location: delivery.location,
      priority: delivery.priority,
      windowStart: toMillis(delivery.windowStart),
      windowEnd: toMillis(delivery.windowEnd),
    })),
    matrix,
    { lockedFirstId: locked?.id ?? null },
  );

  const ordered = optimized.legs.map((leg) => ({ leg, delivery: deliveries[leg.stopIndex]! }));
  const stops: RouteStop[] = ordered.map(({ leg, delivery }) => ({
    deliveryId: delivery.id,
    orderId: delivery.orderId,
    customerName: delivery.customer.name,
    address: delivery.address,
    location: delivery.location,
    status: delivery.status,
    priority: delivery.priority,
    legSeconds: Math.round(leg.legSeconds),
    legMeters: Math.round(leg.legMeters),
    arrivalOffsetSeconds: Math.round(leg.arrivalOffsetSeconds),
  }));

  const path = [start, ...stops.map((stop) => stop.location)];
  const geometry = (await getRoutePolyline(path, provider)) ?? path;

  await ref.set({
    driverId,
    origin,
    stops,
    totalSeconds: Math.round(optimized.totalSeconds),
    totalMeters: Math.round(optimized.totalMeters),
    polyline: simplifyPath(geometry, 600),
    provider,
    computedAt: serverTimestamp(),
    lease: { signature, at: Timestamp.now() },
  });

  logger.info('Route planned', { driverId, stops: stops.length, provider });
  return {
    stops: stops.length,
    totalSeconds: Math.round(optimized.totalSeconds),
    totalMeters: Math.round(optimized.totalMeters),
    provider,
  };
}

/** Trigger-safe variant: never throws. */
export async function planRouteSafely(driverId: string): Promise<void> {
  try {
    await planRoute(driverId);
  } catch (error) {
    logger.error('Route planning failed', {
      driverId,
      error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
    });
  }
}
