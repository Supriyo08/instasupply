/**
 * `registerDriver` (docs/PLATFORM.md §6.3.3), port of legacy/…/auth/register-driver.ts. A role-less account
 * becomes a `pending` driver with its declared vehicle (class derived by the server) and the attestation
 * times; admins get `driver_signup`. While pending, a repeat overwrites name, city and vehicle; afterwards
 * it only updates the name (vehicle changes go through `updateDriverVehicle`).
 */
import {
  capacityClassFor,
  localDateOf,
  validateDriverVehicle,
  type DriverVehicle,
  type DriverVehicleInput,
  type RegisterDriverRequest,
  type RegisterDriverResponse,
} from '@instasupply/shared';
import type { Actor } from '../../platform/auth/actor';
import { withTransaction } from '../../platform/db/tx';
import type { RequestContext } from '../../platform/http/context';
import { failedPrecondition, invalidArgument, notFound } from '../../platform/http/errors';
import { notifyStaff } from '../notifications';
import { lockUserRow, updateUser } from './repository';

/** The shared validator's verdict, or invalid-argument with its field messages. */
export function checkedVehicle(raw: unknown, now: number): DriverVehicle {
  const result = validateDriverVehicle(raw, localDateOf(now));
  if (!result.ok) {
    const fields: Record<string, string> = {};
    for (const [key, message] of Object.entries(result.errors)) {
      if (typeof message === 'string') fields[`vehicle.${key}`] = message;
    }
    invalidArgument(Object.values(fields)[0] ?? 'Check the vehicle details.', { fields });
  }
  const vehicle: DriverVehicleInput = result.value;
  return { ...vehicle, capacityClass: capacityClassFor(vehicle) };
}

export async function registerDriver(
  ctx: RequestContext,
  actor: Actor,
  req: Pick<RegisterDriverRequest, 'displayName' | 'cityId'> & { vehicle: unknown },
): Promise<RegisterDriverResponse> {
  return withTransaction(ctx.deps, async (tx) => {
    const row = await lockUserRow(tx, actor.uid);
    if (!row) notFound('That account does not exist.');
    if (row.role !== null && row.role !== 'driver') {
      failedPrecondition(
        'This email belongs to a staff, customer or supplier account. Use another email to drive with InstaSupply.',
      );
    }
    if (row.role === 'driver' && row.status !== 'pending') {
      await updateUser(tx, actor.uid, { displayName: req.displayName });
      return { status: row.status as RegisterDriverResponse['status'] };
    }
    const vehicle = checkedVehicle(req.vehicle, tx.now);
    if (row.role === 'driver') {
      await updateUser(tx, actor.uid, { displayName: req.displayName, cityId: req.cityId, doc: { vehicle } });
      return { status: 'pending' };
    }
    await updateUser(tx, actor.uid, {
      role: 'driver',
      status: 'pending',
      displayName: req.displayName,
      cityId: req.cityId,
      doc: {
        vehicle,
        vehicleDraft: null,
        vehicleReviewRequired: false,
        compliance: {
          licenceAttestedAt: tx.now,
          insuranceAttestedAt: tx.now,
          termsAcceptedAt: tx.now,
          licenceVerified: false,
          insuranceVerified: false,
          verifiedBy: null,
          verifiedAt: null,
        },
        preferences: { chatPush: true, deliveryPush: true, jobPush: true },
        driverStats: { deliveries: 0, earnedCents: 0 },
      },
    });
    await notifyStaff(
      tx,
      {
        type: 'driver_signup',
        title: 'New driver waiting for approval',
        body: `${req.displayName} signed up (${vehicle.make} ${vehicle.model} · ${vehicle.plate}). Review and approve them in Drivers.`,
        data: { driverId: actor.uid },
        key: `signup-${actor.uid}`,
      },
      { adminsOnly: true },
    );
    return { status: 'pending' };
  });
}
