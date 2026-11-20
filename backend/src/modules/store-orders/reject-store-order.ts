/**
 * `rejectStoreOrder` (MARKETPLACE §2.1, §5.4 → docs/PLATFORM.md §9.2.2). From `new` the store rejects; from
 * `accepted`, `preparing` or `ready` it cancels (`cancelledBy: 'store'`, or `'staff'` for staff). Either way
 * nothing is charged, the stock is released (clamped for `out_of_stock`), the delivery is cancelled and its
 * offer deleted.
 */
import {
  canStoreOrderTransition,
  type RejectStoreOrderRequest,
  type StoreOrderActionResponse,
} from '@instasupply/shared';
import type { Deps } from '../../container';
import type { Actor } from '../../platform/auth/actor';
import { withTransaction } from '../../platform/db/tx';
import { failedPrecondition } from '../../platform/http/errors';
import { orderActorFrom } from './access';
import { checkVersion, keysForAction, lockStoreOrder } from './command-support';
import { stageStoreOrderVoid } from './store-order-void';
import { resolveActor } from './transitions';

export async function rejectStoreOrder(
  deps: Deps,
  actor: Actor,
  req: RejectStoreOrderRequest,
): Promise<StoreOrderActionResponse> {
  const keys = await keysForAction(deps, actor, req.storeOrderId);
  const who = orderActorFrom(actor);
  return withTransaction(deps, async (tx) => {
    const { graph, so } = await lockStoreOrder(tx, keys);
    checkVersion(so, req.expectedVersion);
    const to = so.status === 'new' ? 'rejected' : 'cancelled';
    if (!canStoreOrderTransition(so.status, to, resolveActor(who).kind, { fulfilment: so.fulfilment })) {
      failedPrecondition(`${so.number} is ${so.status} and can't be cancelled from the store any more.`, {
        status: so.status,
      });
    }
    const after = await stageStoreOrderVoid(tx, graph, so, who, {
      to,
      reason: req.reason,
      note: req.note ?? null,
      cancelReason: req.note ?? undefined,
    });
    return { status: after.status, version: after.version };
  });
}
