/**
 * Drives a seeded driver along their optimized route in the emulators, so live tracking can be
 * watched in the back office (Live map) and on the customer tracking page without a phone.
 *
 *   npm run simulate -- --driver ravi@instasupply.test --speed 60
 *
 * Options:
 *   --driver <email>     driver account (default ravi@instasupply.test)
 *   --speed <km/h>       simulated speed (default 45; raise it to make demos faster)
 *   --interval <sec>     seconds between position updates (default 2)
 *   --keep-running       wait for new assignments instead of exiting when the route is done
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type DocumentReference } from 'firebase-admin/firestore';

import {
  bearingDegrees,
  haversineMeters,
  moveTowards,
  type DeliveryStatus,
  type LatLng,
  type RoutePlan,
} from '@instasupply/shared';

import { callFunction, PROJECT_ID, signIn, sleep, assertEmulatorsRunning } from './lib/emulator';
import { SEED_PASSWORD } from './seed-constants';

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1]! : fallback;
};

const email = option('driver', 'ravi@instasupply.test');
const speedKmh = Number(option('speed', '45'));
const intervalSeconds = Number(option('interval', '2'));
const keepRunning = args.includes('--keep-running');
const ARRIVAL_RADIUS_M = 30;

const app = initializeApp({ projectId: PROJECT_ID });
const db = getFirestore(app);

async function main() {
  await assertEmulatorsRunning();
  const user = await getAuth(app).getUserByEmail(email);
  let token = await signIn(email, SEED_PASSWORD);
  let tokenAt = Date.now();
  const callAsDriver = async <T>(name: string, data: unknown) => {
    if (Date.now() - tokenAt > 45 * 60_000) {
      token = await signIn(email, SEED_PASSWORD);
      tokenAt = Date.now();
    }
    return callFunction<T>(name, token, data);
  };

  const locationRef = db.doc(`driverLocations/${user.uid}`);
  const existing = (await locationRef.get()).data() as LatLng | undefined;
  let position: LatLng = existing ? { lat: existing.lat, lng: existing.lng } : { lat: 12.9716, lng: 77.5946 };
  const stepMeters = (speedKmh * 1000 * intervalSeconds) / 3600;
  console.log(
    `Simulating ${user.displayName} at ${speedKmh} km/h (${Math.round(stepMeters)} m every ${intervalSeconds}s)…`,
  );

  // Ask for a fresh plan from the current position before starting.
  await callAsDriver('optimizeRoute', { origin: position });

  for (;;) {
    const route = (await db.doc(`routes/${user.uid}`).get()).data() as RoutePlan | undefined;
    const target = route?.stops[0];
    if (!target) {
      await publish(locationRef, position, null, 0);
      if (!keepRunning) {
        console.log('Route complete. Done!');
        return;
      }
      await sleep(intervalSeconds * 1000);
      continue;
    }

    // Advance the delivery to "on the way" before driving to it.
    const flow: Partial<Record<DeliveryStatus, DeliveryStatus>> = {
      assigned: 'accepted',
      accepted: 'picked_up',
      picked_up: 'in_transit',
    };
    const next = flow[target.status];
    if (next) {
      await callAsDriver('updateDeliveryStatus', {
        deliveryId: target.deliveryId,
        status: next,
        location: position,
      });
      console.log(`  ${target.orderId}: ${target.status} → ${next}`);
      await sleep(1500);
      continue;
    }

    const distance = haversineMeters(position, target.location);
    if (distance > ARRIVAL_RADIUS_M && target.status === 'in_transit') {
      const heading = bearingDegrees(position, target.location);
      position = moveTowards(position, target.location, stepMeters);
      await publish(locationRef, position, heading, (speedKmh * 1000) / 3600);
      process.stdout.write(
        `\r  → ${target.orderId} ${target.customerName}: ${Math.round(distance)} m left   `,
      );
      await sleep(intervalSeconds * 1000);
      continue;
    }

    process.stdout.write('\n');
    if (target.status === 'in_transit') {
      await callAsDriver('updateDeliveryStatus', {
        deliveryId: target.deliveryId,
        status: 'arrived',
        location: position,
      });
      console.log(`  ${target.orderId}: arrived`);
      await sleep(4000);
      continue;
    }

    // Arrived: hand over with whatever proof the delivery needs.
    const deliverySnap = await db.doc(`deliveries/${target.deliveryId}`).get();
    const meta = (await deliverySnap.ref.collection('private').doc('meta').get()).data();
    await callAsDriver('completeDelivery', {
      deliveryId: target.deliveryId,
      recipientName: target.customerName,
      handoffCode: deliverySnap.get('requireCode') ? meta?.handoffCode : null,
      codCollected: deliverySnap.get('codAmount') ?? null,
      location: position,
    });
    console.log(`  ${target.orderId}: delivered ✓`);
    await sleep(3000);
  }
}

async function publish(ref: DocumentReference, position: LatLng, heading: number | null, speed: number) {
  await ref.set(
    {
      lat: position.lat,
      lng: position.lng,
      heading,
      speed,
      accuracy: 5,
      online: true,
      battery: 0.76,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
