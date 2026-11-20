/**
 * Was `onStoreOrderWritten` (MARKETPLACE §5.6, docs/PLATFORM.md §9.4): called by every transaction that inserts
 * or changes a store order, after the write. Inbox rows and outbox events are written in the caller's
 * transaction; the keys of §10.2 make a repeated call harmless. The caller runs `projectOrderAggregate` next.
 *
 * - create → store members `store_order_new`, and the SMS to the store's `alertPhone` (once, `meta.alertSmsSentAt`);
 * - status change → the customer's message, and the store's when the customer cancelled;
 * - a driver on the way → store members `store_order_update`.
 */
import {
  firstName,
  formatClockET,
  formatDateTimeET,
  formatMoney,
  pluralize,
  shortStoreName,
  type StoreOrder,
  type StoreRejectReason,
} from '@instasupply/shared';
import type { LockedGraph } from '../../platform/db/locks';
import type { Tx } from '../../platform/db/tx';
import { enqueue } from '../../platform/outbox/outbox';
import { notify, notifyStaff, notifyStoreMembers, type NotificationInput } from '../notifications/notify';
import {
  deliveryDriverId,
  orderStoreOrderStatuses,
  patchMeta,
  readMeta,
  readStoreInfo,
} from './store-orders.repository';

export const REJECT_REASON_TEXT: Record<StoreRejectReason, string> = {
  out_of_stock: 'out of stock',
  cannot_meet_time: "can't make the time",
  store_closed: 'store closed',
  pricing_error: 'pricing error',
  cannot_deliver_to_site: "can't deliver to the site",
  no_response: 'no response from the store',
  other: 'other',
};

const itemsText = (so: StoreOrder): string => pluralize(so.itemCount, 'item');

function whenText(so: StoreOrder): string {
  if (so.fulfilment === 'pickup') return `Pickup ready by ${formatClockET(so.timing.readyBy)}`;
  const by = so.timing.deliverBy ?? so.window?.endAt ?? so.timing.readyBy;
  return `Delivery by ${formatClockET(by)}`;
}

const dataOf = (so: StoreOrder): Record<string, string> => ({
  customerOrderId: so.orderId,
  storeOrderId: so.id,
});

/** Was onStoreOrderWritten. */
export async function applyStoreOrderEffects(
  tx: Tx,
  graph: LockedGraph,
  before: StoreOrder | null,
  after: StoreOrder,
): Promise<void> {
  if (!before) {
    await onCreated(tx, after);
    return;
  }
  if (before.status !== after.status) await onStatusChanged(tx, graph, before, after);
  if (driverIsNew(before, after)) await onDriverHeading(tx, after);
}

async function onCreated(tx: Tx, so: StoreOrder): Promise<void> {
  await notifyStoreMembers(tx, so.storeId, {
    type: 'store_order_new',
    title: `New order ${so.number}`,
    body: `${itemsText(so)} · ${whenText(so)}`,
    data: { storeOrderId: so.id },
    key: `so-new-${so.id}`,
  });
  const [info, meta] = await Promise.all([readStoreInfo(tx, so.storeId), readMeta(tx, so.id)]);
  if (info.alertPhone && meta && meta.alertSmsSentAt === null) {
    // The marker is written in the transaction that enqueues, so the SMS exists once (§9.3).
    await patchMeta(tx, so.id, { alertSmsSentAt: tx.now });
    await enqueue(tx, 'sms.send', {
      to: info.alertPhone,
      body: `InstaSupply: new order ${so.number} · ${itemsText(so)} · ${whenText(so)}. Accept or reject in InstaSupply.`,
      purpose: 'store_alert',
      sensitive: false,
    });
  }
}

function shortageText(so: StoreOrder): string | null {
  const short = so.lines.filter((line) => line.fulfilledQty < line.quantity);
  if (short.length === 0) return null;
  const parts = short.map(
    (line) =>
      `${line.fulfilledQty} of ${line.quantity} ${line.name} in stock — you won't be charged for ${line.quantity - line.fulfilledQty}`,
  );
  return `${parts.join('; ')}.`;
}

function customerMessage(
  before: StoreOrder,
  after: StoreOrder,
  wholeOrderVoid: boolean,
): NotificationInput | null {
  const store = after.storeName;
  const short = shortStoreName(store);
  const key = `so-${after.id}-${after.status}-v${after.version}`;
  const base = { data: dataOf(after), key };
  switch (after.status) {
    case 'accepted': {
      const shortage = shortageText(after);
      return {
        ...base,
        type: 'order_store_update',
        title: `${short} confirmed ${after.number}`,
        body: shortage
          ? `${short} confirmed your items. ${shortage}`
          : `${store} confirmed your order ${after.number}.`,
      };
    }
    case 'preparing':
      // "Not ready after all" is the store's business; the customer already heard it is being prepared.
      if (before.status === 'ready') return null;
      return {
        ...base,
        type: 'order_store_update',
        title: `${after.number} is being prepared`,
        body: `${store} is preparing your order.`,
      };
    case 'ready':
      // Delivery: the customer hears from the driver; pickup: the PIN (sent with the meta, see below).
      return null;
    case 'out_for_delivery': {
      const driver = after.driver?.firstName ?? 'Your driver';
      const by = after.timing.deliverBy ?? after.window?.endAt ?? null;
      return {
        ...base,
        type: 'order_store_update',
        title: `${after.number} is on the way`,
        body: `${driver} is on the way from ${store}${by ? ` · by ${formatClockET(by)}` : ''}`,
      };
    }
    case 'delivered':
      return {
        ...base,
        type: 'order_delivered',
        title: `${after.number} delivered`,
        body: `Delivered to ${after.jobsite?.label ?? 'your site'} — see the drop-off photo`,
      };
    case 'picked_up':
      return {
        ...base,
        type: 'order_store_update',
        title: `${after.number} picked up`,
        body: `Picked up at ${store}. Thanks for ordering with InstaSupply.`,
      };
    case 'failed':
      return {
        ...base,
        type: 'order_store_update',
        title: `Delivery issue on ${after.number}`,
        body: `We couldn't complete the ${short} delivery — we're on it.`,
      };
    case 'rejected':
    case 'cancelled': {
      if (after.cancelledBy === 'customer') return null;
      const amount = formatMoney(before.current.totalCents);
      const type = wholeOrderVoid ? 'order_cancelled' : 'order_store_update';
      if (after.cancelledBy === 'system' && after.fulfilment === 'pickup' && before.status === 'ready') {
        const held = before.pickup.holdUntil;
        return {
          ...base,
          type,
          title: `${after.number} was not collected`,
          body: `Your pickup at ${store} wasn't collected${held ? ` by ${formatDateTimeET(held)}` : ''}, so it was cancelled. You won't be charged ${amount}.`,
        };
      }
      const reason = after.rejectReason ? ` (${REJECT_REASON_TEXT[after.rejectReason]})` : '';
      return {
        ...base,
        type,
        title: `${short} can't fill ${after.number}`,
        body: `${short} can't fill your order${reason}. You won't be charged ${amount}.`,
      };
    }
    case 'new':
      return null;
  }
}

async function onStatusChanged(
  tx: Tx,
  _graph: LockedGraph,
  before: StoreOrder,
  after: StoreOrder,
): Promise<void> {
  const voided = after.status === 'rejected' || after.status === 'cancelled';
  const statuses = voided ? await orderStoreOrderStatuses(tx, after.orderId) : [];
  const wholeOrderVoid =
    voided && statuses.every((status) => status === 'rejected' || status === 'cancelled');

  const message = customerMessage(before, after, wholeOrderVoid);
  if (message) await notify(tx, after.customerId, message);

  if (after.status === 'ready' && after.fulfilment === 'pickup') {
    const meta = await readMeta(tx, after.id);
    const held = after.pickup.holdUntil;
    await notify(tx, after.customerId, {
      type: 'pickup_ready',
      title: `Ready for pickup · ${after.number}`,
      body: `Ready at ${after.storeName} · show PIN ${meta?.pickupCode ?? '—'} at the counter${
        held ? ` · held until ${formatDateTimeET(held, tx.now)}` : ''
      }`,
      data: dataOf(after),
      key: `so-ready-${after.id}-v${after.version}`,
    });
  }

  if (voided && after.cancelledBy === 'customer') {
    await notifyStoreMembers(tx, after.storeId, {
      type: 'store_order_update',
      title: `${after.number} cancelled`,
      body: `The customer cancelled ${after.number}. Put the items back on the shelf.`,
      data: { storeOrderId: after.id },
      key: `so-cancelled-${after.id}`,
    });
  }

  if (voided && after.cancelledBy !== 'customer') {
    // The store (or the schedule) backed out: ops follow up with the customer (MARKETPLACE §5.4).
    const last = after.history[after.history.length - 1];
    const reason = after.rejectReason
      ? REJECT_REASON_TEXT[after.rejectReason]
      : (after.cancelReason ?? 'no reason');
    await notifyStaff(
      tx,
      {
        type: 'system',
        title: `${after.number} ${after.status} (${shortStoreName(after.storeName)})`,
        body: `${after.storeName} ${after.status === 'rejected' ? 'rejected' : 'cancelled'} ${after.number}: ${reason}.`,
        data: { customerOrderId: after.orderId, storeOrderId: after.id },
        key: `so-void-staff-${after.id}`,
      },
      { exclude: last?.actorId ?? null },
    );
  }
}

/** A driver appeared on the store order, or another driver replaced the one shown. */
function driverIsNew(before: StoreOrder, after: StoreOrder): boolean {
  const next = after.driver;
  if (!next || (next.phase !== 'assigned' && next.phase !== 'to_store')) return false;
  const prev = before.driver;
  return !prev || prev.firstName !== next.firstName || prev.plate !== next.plate;
}

async function onDriverHeading(tx: Tx, so: StoreOrder): Promise<void> {
  if (!so.driver || !so.deliveryId) return;
  const driverId = await deliveryDriverId(tx, so.deliveryId);
  if (!driverId) return;
  const vehicle = [so.driver.vehicleLabel, so.driver.plate].filter((part) => part !== '').join(' · ');
  await notifyStoreMembers(tx, so.storeId, {
    type: 'store_order_update',
    title: `${so.number}: driver on the way`,
    body: `${firstName(so.driver.firstName)}${vehicle ? ` (${vehicle})` : ''} is heading to you`,
    data: { storeOrderId: so.id },
    key: `so-driver-${so.id}-${driverId}`,
  });
}
