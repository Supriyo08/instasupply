import {
  COLLECTIONS,
  cleanText,
  type AuthClaims,
  type OkResponse,
  type SetDriverStatusRequest,
  type UserProfile,
} from '@instasupply/shared';

import { auth, db, serverTimestamp } from '../../lib/admin';
import { failedPrecondition, invalidArgument, notFound } from '../../lib/errors';
import { callable } from '../../lib/functions';
import { requireAdmin, requireString } from '../../lib/guards';
import { userRef } from '../../lib/users';
import { notifyUser } from '../notifications/notify';

/**
 * Approve or suspend a driver. Suspension disables the Auth account and revokes refresh tokens,
 * so the driver is signed out of every device within the hour (immediately on next token refresh).
 */
export const setDriverStatus = callable<SetDriverStatusRequest, OkResponse>(
  'setDriverStatus',
  async (request) => {
    const actor = requireAdmin(request);
    const uid = requireString(request.data?.uid, 'Driver');
    const status = request.data?.status;
    if (status !== 'active' && status !== 'suspended') invalidArgument('Status must be active or suspended.');
    const reason = cleanText(request.data?.reason, 300);

    const snapshot = await userRef(uid).get();
    if (!snapshot.exists) notFound('Driver not found.');
    const profile = snapshot.data() as UserProfile;
    if (profile.role !== 'driver')
      failedPrecondition('Only driver accounts can be approved or suspended here.');
    if (profile.status === status) return { ok: true };

    const record = await auth.getUser(uid);
    const claims: AuthClaims = { role: 'driver', active: status === 'active' };
    await auth.setCustomUserClaims(uid, { ...(record.customClaims ?? {}), ...claims });
    await auth.updateUser(uid, { disabled: status === 'suspended' });

    await userRef(uid).update({
      status,
      updatedAt: serverTimestamp(),
      ...(status === 'active'
        ? { approvedBy: actor.uid, approvedAt: serverTimestamp(), suspendedReason: null }
        : { suspendedReason: reason }),
    });

    if (status === 'suspended') {
      await auth.revokeRefreshTokens(uid);
      await db.collection(COLLECTIONS.driverLocations).doc(uid).set({ online: false }, { merge: true });
    } else {
      await notifyUser(uid, {
        type: 'account_approved',
        title: "You're approved!",
        body: 'Your driver account is active. Go online to start receiving deliveries.',
      });
    }
    return { ok: true };
  },
);
