/**
 * The pickup PIN (MARKETPLACE §5.5.2, D8). Each store order owns its own PIN, kept in the private `meta`
 * column: the store that types it never sees it. A new PIN resets the attempts, and `pickupCodeIssuedTo`
 * records who may use it, so a released driver's PIN stops working (`completePickup` checks it).
 */
import type { Tx } from '../../platform/db/tx';
import { newPickupCode } from '../../platform/ids';
import { patchMeta } from './store-orders.repository';

/** Wrong PINs before the counter locks (only staff can then complete, with an override). */
export const MAX_PICKUP_CODE_ATTEMPTS = 5;

/** New 4-digit PIN, attempts reset. */
export async function stagePickupCode(
  tx: Tx,
  storeOrderId: string,
  issuedTo: 'customer' | string,
): Promise<string> {
  const pickupCode = newPickupCode();
  await patchMeta(tx, storeOrderId, { pickupCode, pickupCodeIssuedTo: issuedTo, codeAttempts: 0 });
  return pickupCode;
}
