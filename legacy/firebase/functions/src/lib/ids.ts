import { randomBytes, randomInt } from 'node:crypto';

import { COLLECTIONS, ORDER_ID_PREFIX, randomToken } from '@instasupply/shared';
import type { Transaction } from 'firebase-admin/firestore';

import { db } from './admin';

/** Unguessable token for the public tracking URL (~140 bits of entropy). */
export const newTrackingToken = (): string => randomToken(24, (size) => randomBytes(size));

/** 4-digit code the customer gives the driver at hand-off. */
export const newHandoffCode = (): string => String(randomInt(0, 10_000)).padStart(4, '0');

/** Strong random password for accounts that will set their own via a reset link. */
export const newTemporaryPassword = (): string => `${randomToken(20, (size) => randomBytes(size))}!9a`;

const FIRST_ORDER_NUMBER = 10_001;

const counterRef = () => db.collection(COLLECTIONS.counters).doc('deliveries');

/**
 * Read the next order id inside a transaction (during its read phase). Call `stage()` once the
 * transaction starts writing to claim the id.
 */
export async function peekOrderIdInTx(tx: Transaction): Promise<{ orderId: string; stage: () => void }> {
  const snapshot = await tx.get(counterRef());
  const next = (snapshot.get('next') as number | undefined) ?? FIRST_ORDER_NUMBER;
  return {
    orderId: `${ORDER_ID_PREFIX}-${next}`,
    stage: () => tx.set(counterRef(), { next: next + 1 }, { merge: true }),
  };
}

/** Reserve `count` sequential human-friendly order ids, e.g. IS-10001. */
export async function reserveOrderIds(count: number): Promise<string[]> {
  if (count <= 0) return [];
  const ref = counterRef();
  const start = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const next = (snapshot.get('next') as number | undefined) ?? FIRST_ORDER_NUMBER;
    tx.set(ref, { next: next + count }, { merge: true });
    return next;
  });
  return Array.from({ length: count }, (_, index) => `${ORDER_ID_PREFIX}-${start + index}`);
}
