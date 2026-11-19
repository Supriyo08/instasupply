import {
  cleanText,
  type AuthClaims,
  type RegisterCustomerRequest,
  type RegisterCustomerResponse,
  type UserProfile,
} from '@instasupply/shared';

import { auth, db, serverTimestamp } from '../../lib/admin';
import { failedPrecondition, invalidArgument } from '../../lib/errors';
import { callable } from '../../lib/functions';
import { requireAuth } from '../../lib/guards';
import { userRef } from '../../lib/users';

const OTHER_ACCOUNT = 'This email belongs to a staff or driver account. Use another email for shopping.';

/** A role that is set to something other than `customer`. */
const isOtherRole = (role: unknown) => role != null && role !== 'customer';

/**
 * Called by the customer app right after email sign-up. Shopping accounts are active immediately
 * (no approval step); phone verification happens next in the app.
 *
 * Safe to call again: it creates the profile only once, and it puts back the `customer` claims of
 * an active shopper whenever they are missing (for example when an earlier call saved the profile
 * but stopped before the claims were set). It never turns a driver or staff account into a shopper.
 */
export const registerCustomer = callable<RegisterCustomerRequest, RegisterCustomerResponse>(
  'registerCustomer',
  async (request) => {
    const actor = requireAuth(request);
    if (isOtherRole(actor.role)) failedPrecondition(OTHER_ACCOUNT);
    const displayName = cleanText(request.data?.displayName, 80);
    if (!displayName) invalidArgument('Enter your name.');

    const record = await auth.getUser(actor.uid);
    // The Auth record is the source of truth: the caller's token can be up to an hour old.
    const claims: Record<string, unknown> = record.customClaims ?? {};
    if (isOtherRole(claims.role)) failedPrecondition(OTHER_ACCOUNT);

    const ref = userRef(actor.uid);
    const status = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) {
        tx.set(ref, {
          uid: actor.uid,
          role: 'customer',
          status: 'active',
          displayName,
          email: record.email ?? null,
          phoneNumber: record.phoneNumber ?? null,
          phoneVerified: !!record.phoneNumber,
          photoURL: record.photoURL ?? null,
          preferences: { orderPush: true, promoPush: true, chatPush: true },
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return 'active' as const;
      }
      const profile = snapshot.data() as UserProfile;
      if (profile.role !== 'customer') failedPrecondition(OTHER_ACCOUNT);
      if (profile.displayName !== displayName) {
        tx.update(ref, { displayName, updatedAt: serverTimestamp() });
      }
      return profile.status;
    });

    // Claims first: without them the app can't open, while the Auth display name is cosmetic.
    if (status === 'active' && (claims.role !== 'customer' || claims.active !== true)) {
      const customer: AuthClaims = { role: 'customer', active: true };
      await auth.setCustomUserClaims(actor.uid, { ...claims, ...customer });
    }
    if (record.displayName !== displayName) await auth.updateUser(actor.uid, { displayName });
    return { status };
  },
);
