import {
  COLLECTIONS,
  MAX_DELIVERIES_PER_IMPORT,
  validateDeliveryInput,
  type CreateDeliveriesRequest,
  type CreateDeliveriesResponse,
  type DeliveryInput,
  type LatLng,
  type UserProfile,
} from '@instasupply/shared';

import { db } from '../../lib/admin';
import { invalidArgument } from '../../lib/errors';
import { callable } from '../../lib/functions';
import { requireStaff } from '../../lib/guards';
import { reserveOrderIds } from '../../lib/ids';
import { geocodeFirst } from '../geocoding/geocoder';
import { stageNewDelivery } from './delivery-writer';
import { eventActor } from './repository';

/** Each delivery writes 4–5 documents; stay well under the 500-write batch limit. */
const DELIVERIES_PER_BATCH = 80;

const firstError = (errors: Record<string, string | undefined>) =>
  Object.values(errors).find(Boolean) ?? 'Invalid delivery.';

export const createDeliveries = callable<CreateDeliveriesRequest, CreateDeliveriesResponse>(
  'createDeliveries',
  async (request) => {
    const actor = requireStaff(request);
    const items = request.data?.deliveries;
    if (!Array.isArray(items) || items.length === 0) invalidArgument('Add at least one delivery.');
    if (items.length > MAX_DELIVERIES_PER_IMPORT) {
      invalidArgument(`You can import up to ${MAX_DELIVERIES_PER_IMPORT} deliveries at a time.`);
    }

    const errors: CreateDeliveriesResponse['errors'] = [];
    const valid: { index: number; input: DeliveryInput; location: LatLng }[] = [];

    // 1. Validate, and geocode rows that came without coordinates.
    let lastLocation: LatLng | null = null;
    for (const [index, raw] of items.entries()) {
      const result = validateDeliveryInput(raw);
      if (!result.ok) {
        errors.push({ index, message: firstError(result.errors) });
        continue;
      }
      const location: LatLng | null =
        result.value.location ?? (await geocodeFirst(result.value.address, lastLocation));
      if (!location) {
        errors.push({ index, message: "We couldn't find this address. Drop a pin on the map instead." });
        continue;
      }
      lastLocation = location;
      valid.push({ index, input: result.value, location });
    }

    // 2. Check every referenced driver is an approved driver.
    const driverIds = [...new Set(valid.map((item) => item.input.driverId).filter(Boolean))] as string[];
    const drivers = new Map<string, UserProfile>();
    const driverSnaps = await Promise.all(
      driverIds.map((id) => db.collection(COLLECTIONS.users).doc(id).get()),
    );
    for (const snapshot of driverSnaps) {
      const profile = snapshot.data() as UserProfile | undefined;
      if (profile?.role === 'driver' && profile.status === 'active') drivers.set(snapshot.id, profile);
    }
    const ready = valid.filter((item) => {
      if (item.input.driverId && !drivers.has(item.input.driverId)) {
        errors.push({ index: item.index, message: 'The selected driver is not available.' });
        return false;
      }
      return true;
    });

    if (ready.length === 0) return { created: [], errors };

    // 3. Write deliveries with their private metadata, tracking page and audit events.
    const orderIds = await reserveOrderIds(ready.length);
    const created: CreateDeliveriesResponse['created'] = [];
    const actorRef = { ...eventActor(actor), id: actor.uid };

    for (let start = 0; start < ready.length; start += DELIVERIES_PER_BATCH) {
      const batch = db.batch();
      for (const [offset, item] of ready.slice(start, start + DELIVERIES_PER_BATCH).entries()) {
        const orderId = orderIds[start + offset]!;
        const profile = item.input.driverId ? drivers.get(item.input.driverId)! : null;
        const { id, trackingToken } = stageNewDelivery(batch, {
          input: item.input,
          location: item.location,
          orderId,
          driver: profile ? { id: item.input.driverId!, name: profile.displayName } : null,
          actor: actorRef,
        });
        created.push({ index: item.index, id, orderId, trackingToken });
      }
      await batch.commit();
    }

    return { created, errors: errors.sort((a, b) => a.index - b.index) };
  },
  { timeoutSeconds: 300 },
);
