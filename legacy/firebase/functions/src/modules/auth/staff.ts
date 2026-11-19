import {
  cleanText,
  isValidEmail,
  type AuthClaims,
  type CreateStaffUserRequest,
  type CreateStaffUserResponse,
} from '@instasupply/shared';

import { auth, serverTimestamp } from '../../lib/admin';
import { errorCode, fail, invalidArgument } from '../../lib/errors';
import { callable } from '../../lib/functions';
import { requireAdmin } from '../../lib/guards';
import { newTemporaryPassword } from '../../lib/ids';
import { userRef } from '../../lib/users';

/** Admins invite dispatchers (or other admins). The invitee sets a password via the returned link. */
export const createStaffUser = callable<CreateStaffUserRequest, CreateStaffUserResponse>(
  'createStaffUser',
  async (request) => {
    requireAdmin(request);
    const email = typeof request.data?.email === 'string' ? request.data.email.trim().toLowerCase() : '';
    if (!isValidEmail(email)) invalidArgument('Enter a valid email address.');
    const displayName = cleanText(request.data?.displayName, 80);
    if (!displayName) invalidArgument('Enter a name.');
    const role = request.data?.role;
    if (role !== 'admin' && role !== 'dispatcher') invalidArgument('Role must be admin or dispatcher.');

    let uid: string;
    try {
      const user = await auth.createUser({ email, displayName, password: newTemporaryPassword() });
      uid = user.uid;
    } catch (error) {
      if (errorCode(error) === 'auth/email-already-exists') {
        fail('already-exists', 'Someone with this email already has an account.');
      }
      throw error;
    }

    const claims: AuthClaims = { role, active: true };
    await auth.setCustomUserClaims(uid, claims);
    await userRef(uid).set({
      uid,
      role,
      status: 'active',
      displayName,
      email,
      phoneNumber: null,
      phoneVerified: false,
      preferences: { chatPush: true, deliveryPush: true },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const passwordSetupLink = await auth.generatePasswordResetLink(email);
    return { uid, passwordSetupLink };
  },
);
