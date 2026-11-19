import { COLLECTIONS } from '@instasupply/shared';
import type { DocumentReference } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { db } from '../../lib/admin';
import { baseOptions } from '../../lib/functions';

/** The account that owns a `users/{uid}/devices/{deviceId}` registration. */
function accountOf(ref: DocumentReference): string | null {
  const user = ref.parent.parent;
  return user?.parent.id === COLLECTIONS.users ? user.id : null;
}

/**
 * A push token belongs to one app install, so to whichever account signed in there last. Signing
 * out deletes the registration, but an offline or interrupted sign-out leaves it behind and the
 * next person on that phone would get the previous account's pushes. Whenever a device registers
 * a token, every other account's registration of that token is removed.
 */
export const onDeviceWritten = onDocumentWritten(
  { ...baseOptions, document: `${COLLECTIONS.users}/{uid}/${COLLECTIONS.devices}/{deviceId}` },
  async (event) => {
    const after = event.data?.after;
    const token: unknown = after?.get('token');
    if (typeof token !== 'string' || !token) return; // deleted, or not a registration
    // Apps refresh `lastSeenAt` on every launch; only a new or changed token is a new claim.
    if (event.data?.before.get('token') === token) return;

    const holders = await db.collectionGroup(COLLECTIONS.devices).where('token', '==', token).get();
    // Triggers can arrive late or twice, so judge by what is stored now: the most recent
    // registration (this one, unless someone registered since) marks the device's current account.
    let owner = event.params.uid;
    let latest = after?.updateTime?.valueOf() ?? '';
    for (const doc of holders.docs) {
      const account = accountOf(doc.ref);
      if (account && doc.updateTime.valueOf() > latest) {
        owner = account;
        latest = doc.updateTime.valueOf();
      }
    }
    const stale = holders.docs.filter((doc) => {
      const account = accountOf(doc.ref);
      return account !== null && account !== owner;
    });
    if (stale.length === 0) return;

    const batch = db.batch();
    stale.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    logger.info('Removed a push token from its previous accounts', { userId: owner, count: stale.length });
  },
);
