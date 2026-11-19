import {
  cleanText,
  isVehicleType,
  type AuthClaims,
  type RegisterDriverRequest,
  type RegisterDriverResponse,
  type UserProfile,
} from '@instasupply/shared';

import { auth, db, serverTimestamp } from '../../lib/admin';
import { failedPrecondition, invalidArgument } from '../../lib/errors';
import { callable } from '../../lib/functions';
import { requireAuth } from '../../lib/guards';
import { userRef } from '../../lib/users';
import { notifyStaff } from '../notifications/notify';

/**
 * Called by the driver app right after email sign-up (and again if the driver edits their
 * onboarding details). Creates the profile in `pending` state and sets the driver claim.
 */
export const registerDriver = callable<RegisterDriverRequest, RegisterDriverResponse>(
  'registerDriver',
  async (request) => {
    const actor = requireAuth(request);
    if (actor.isStaff) failedPrecondition('Staff accounts cannot register as drivers.');

    const displayName = cleanText(request.data?.displayName, 80);
    if (!displayName) invalidArgument('Enter your full name.');
    if (!isVehicleType(request.data?.vehicleType)) invalidArgument('Choose your vehicle type.');
    const plate = cleanText(request.data?.vehiclePlate, 20)?.toUpperCase();
    if (!plate) invalidArgument('Enter your vehicle registration number.');
    const vehicle = {
      type: request.data.vehicleType,
      plate,
      model: cleanText(request.data?.vehicleModel, 60),
    };

    const record = await auth.getUser(actor.uid);
    const ref = userRef(actor.uid);

    const { status, created } = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (snapshot.exists) {
        const current = snapshot.data() as UserProfile;
        tx.update(ref, { displayName, vehicle, updatedAt: serverTimestamp() });
        return { status: current.status, created: false };
      }
      tx.set(ref, {
        uid: actor.uid,
        role: 'driver',
        status: 'pending',
        displayName,
        email: record.email ?? null,
        phoneNumber: record.phoneNumber ?? null,
        phoneVerified: !!record.phoneNumber,
        vehicle,
        photoURL: record.photoURL ?? null,
        preferences: { chatPush: true, deliveryPush: true },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return { status: 'pending' as const, created: true };
    });

    await auth.updateUser(actor.uid, { displayName });
    if (created) {
      const claims: AuthClaims = { role: 'driver', active: false };
      await auth.setCustomUserClaims(actor.uid, { ...(record.customClaims ?? {}), ...claims });
      await notifyStaff(
        {
          type: 'driver_signup',
          title: 'New driver waiting for approval',
          body: `${displayName} signed up (${vehicle.plate}). Review and approve them in Drivers.`,
          data: { driverId: actor.uid },
          key: `signup-${actor.uid}`,
        },
        { adminsOnly: true },
      );
    }
    return { status };
  },
);
