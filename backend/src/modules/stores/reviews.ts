/**
 * Store reviews (MARKETPLACE D12, §6.3 isValidStoreReview) and the old `onStoreReviewWritten` (docs/PLATFORM.md
 * §9.4): one review per completed store order, written by its customer. The same transaction recomputes the
 * store's rating columns from `store_reviews` and sets the store order's `rated` flag.
 *
 * Locks (§9.2.13): users(customer) → orders → store_orders (lockGraph) → stores. Two customers rating one
 * store at the same moment are serialized on the store row, and the recomputation runs after the lock, so
 * it always counts both.
 */
import type { StoreReview, WithId } from '@instasupply/shared';
import type { Deps } from '../../container';
import type { Actor } from '../../platform/auth/actor';
import { lockGraph, type StoreOrderRow } from '../../platform/db/locks';
import { withTransaction, type Tx } from '../../platform/db/tx';
import { failedPrecondition, notFound, permissionDenied } from '../../platform/http/errors';
import {
  deleteReview as deleteReviewRow,
  findReview,
  setStoreOrderRated,
  toReview,
  upsertReview,
} from './reviews.repository';
import { lockStore, recomputeStoreRating } from './stores.repository';

const COMPLETED = new Set(['delivered', 'picked_up']);

/** "Dana W.": the first name and the initial of the last name, at most 40 characters. */
export function authorNameFor(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? '';
  if (!first) return 'InstaSupply customer';
  const last = words.length > 1 ? words[words.length - 1]! : '';
  const initial = last ? ` ${last.charAt(0).toUpperCase()}.` : '';
  return `${first.slice(0, 40 - initial.length)}${initial}`;
}

/** The store order under its customer's lock; not-found when it does not exist. */
async function lockStoreOrder(
  tx: Tx,
  storeOrderId: string,
): Promise<{
  storeOrder: StoreOrderRow;
  customerName: string;
}> {
  const graph = await lockGraph(tx, { storeOrderIds: [storeOrderId] });
  const storeOrder = graph.storeOrders.get(storeOrderId);
  if (!storeOrder) notFound('That order does not exist.');
  const customer = graph.users.get(storeOrder.customer_id);
  return { storeOrder, customerName: customer?.display_name ?? '' };
}

export async function saveReview(
  deps: Deps,
  actor: Actor,
  input: { storeId: string; storeOrderId: string; rating: number; text: string },
): Promise<WithId<StoreReview>> {
  return withTransaction(deps, async (tx) => {
    const { storeOrder, customerName } = await lockStoreOrder(tx, input.storeOrderId);
    if (storeOrder.customer_id !== actor.uid) permissionDenied();
    if (storeOrder.store_id !== input.storeId) permissionDenied('That order is not from this store.');
    if (!COMPLETED.has(storeOrder.status)) {
      failedPrecondition('You can rate the store once the order is delivered or picked up.', {
        status: storeOrder.status,
      });
    }
    const store = await lockStore(tx, input.storeId);
    if (!store) notFound('That store does not exist.');
    const row = await upsertReview(tx, {
      storeOrderId: input.storeOrderId,
      storeId: input.storeId,
      customerId: actor.uid,
      authorName: authorNameFor(customerName || actor.name),
      rating: input.rating,
      text: input.text,
    });
    await recomputeStoreRating(tx, input.storeId);
    await setStoreOrderRated(tx, storeOrder, true);
    return toReview(row);
  });
}

/** The author or staff. Seed reviews (no store order) are removed by staff only, or by their author. */
export async function removeReview(
  deps: Deps,
  actor: Actor,
  input: { storeId: string; storeOrderId: string },
): Promise<void> {
  const existing = await findReview(deps.pool, input.storeId, input.storeOrderId);
  if (!existing) notFound('That review does not exist.');
  if (!actor.isStaff && existing.customer_id !== actor.uid) permissionDenied();
  await withTransaction(deps, async (tx) => {
    const storeOrder = existing.store_order_id
      ? (await lockStoreOrder(tx, existing.store_order_id)).storeOrder
      : null;
    const store = await lockStore(tx, input.storeId);
    if (!store) notFound('That store does not exist.');
    const row = await findReview(tx, input.storeId, input.storeOrderId);
    if (!row) return; // removed meanwhile: the delete is idempotent
    await deleteReviewRow(tx, row.id);
    await recomputeStoreRating(tx, input.storeId);
    if (storeOrder) await setStoreOrderRated(tx, storeOrder, false);
  });
}
