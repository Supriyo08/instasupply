/**
 * Was onDeliveryWritten (docs/PLATFORM.md §9.4): everything that follows a change of a delivery, in the
 * transaction that made it. Every writer of a delivery calls `applyDeliveryEffects(tx, graph, before, after)`
 * after it saved the row (before = null for a new delivery):
 *
 * - `projectDriverOntoStoreOrder` (store-orders), which also refreshes the order summary and tells the
 *   store who is coming;
 * - `recordDeliveryLedger` (payouts) and `syncTracking` (tracking);
 * - the driver and staff notifications of the legacy `notifyChange`, with the keys of §10.2; the
 *   customer's heads-up at `arrived`;
 * - the tracking link by SMS at `in_transit` (once, `meta.trackingLinkSentAt`, plus a `customer_notified`
 *   event) and `route.plan` for every driver whose stops changed.
 */
import {
  failureReasonLabel,
  firstName,
  isActiveStatus,
  isTerminalStatus,
  type Delivery,
} from '@instasupply/shared';
import type { LockedGraph } from '../../platform/db/locks';
import type { Tx } from '../../platform/db/tx';
import { enqueue } from '../../platform/outbox/outbox';
import { notify, notifyStaff, type NotificationInput } from '../notifications';
import { recordDeliveryLedger } from '../payouts';
import { projectDriverOntoStoreOrder } from '../store-orders';
import { syncTracking } from '../tracking';
import { SYSTEM_ACTOR } from './delivery-writer';
import { insertEvent, metaOf, patchMeta } from './repository';

/** The console origin the tracking link points at; set once by the module's register(). */
let webUrl = 'http://localhost:5173';
export function configureDeliveryEffects(config: { WEB_URL: string }): void {
  webUrl = config.WEB_URL.replace(/\/+$/, '');
}

const shortAddress = (address: string): string => address.split(',').slice(0, 2).join(',').trim();

function linkData(delivery: Delivery): Record<string, string> {
  const data: Record<string, string> = { deliveryId: delivery.id };
  if (delivery.storeOrderId) data.storeOrderId = delivery.storeOrderId;
  return data;
}

function planningInputsChanged(before: Delivery | null, after: Delivery): boolean {
  if (!before) return true;
  return (
    before.location.lat !== after.location.lat ||
    before.location.lng !== after.location.lng ||
    before.priority !== after.priority ||
    before.windowStart !== after.windowStart ||
    before.windowEnd !== after.windowEnd ||
    (before.pickup?.collectedAt ?? null) !== (after.pickup?.collectedAt ?? null) ||
    (before.pickup?.readyBy ?? null) !== (after.pickup?.readyBy ?? null)
  );
}

async function notifyChange(tx: Tx, before: Delivery | null, after: Delivery): Promise<void> {
  const data = linkData(after);
  const summary = `${after.orderId} · ${after.customer.name} · ${shortAddress(after.address)}`;
  const actorId = after.updatedBy;
  const driverChanged = (before?.driverId ?? null) !== after.driverId;
  const at = after.updatedAt;
  const dl = (type: string) => `dl-${type}-${after.id}-${at}`;
  const dlStaff = (type: string) => `dl-${type}-${after.id}-${after.attempts}-${at}`;
  const toDriver = (uid: string, input: NotificationInput) => notify(tx, uid, input);

  if (driverChanged) {
    if (after.driverId && actorId !== after.driverId) {
      await toDriver(after.driverId, {
        type: 'delivery_assigned',
        title: after.priority === 'urgent' ? 'Urgent delivery assigned' : 'New delivery assigned',
        body: summary,
        data,
        key: dl('delivery_assigned'),
      });
    }
    if (before?.driverId) {
      if (actorId === before.driverId) {
        const released = before.status === 'accepted';
        await notifyStaff(tx, {
          type: 'delivery_declined',
          title: `${before.driverName ?? 'A driver'} ${released ? 'released' : 'declined'} ${after.orderId}`,
          body:
            after.kind === 'marketplace'
              ? 'The job is back on the job board.'
              : 'The delivery is back in the unassigned queue.',
          data,
          key: dlStaff('delivery_declined'),
        });
      } else if (!isTerminalStatus(after.status)) {
        await toDriver(before.driverId, {
          type: 'delivery_unassigned',
          title: 'Delivery removed from your route',
          body: `${after.orderId} for ${after.customer.name} was reassigned by dispatch.`,
          data,
          key: dl('delivery_unassigned'),
        });
      }
    }
  }

  if (before && before.status !== after.status && !driverChanged) {
    const byDriver = !!after.driverId && actorId === after.driverId;
    if (after.status === 'cancelled' && after.driverId) {
      if (after.kind === 'marketplace') {
        await toDriver(after.driverId, {
          type: 'job_update',
          title: `${after.orderId} was cancelled`,
          body: `The store order was cancelled. You don't need to collect or deliver it.`,
          data,
          key: `job-cancelled-${after.id}`,
        });
      } else {
        await toDriver(after.driverId, {
          type: 'delivery_cancelled',
          title: 'Delivery cancelled',
          body: `${after.orderId} for ${after.customer.name} was cancelled. You don't need to deliver it.`,
          data,
          key: dl('delivery_cancelled'),
        });
      }
    } else if (after.status === 'failed' && byDriver) {
      await notifyStaff(tx, {
        type: 'delivery_failed',
        title: `${after.orderId} could not be delivered`,
        body: `${after.driverName ?? 'Driver'}: ${failureReasonLabel(after.failure?.reason)}`,
        data,
        key: dlStaff('delivery_failed'),
      });
    } else if (after.status === 'delivered' && byDriver) {
      await notifyStaff(tx, {
        type: 'delivery_delivered',
        title: `${after.orderId} delivered`,
        body: `${after.driverName ?? 'The driver'} completed the delivery to ${after.customer.name}.`,
        data,
        silent: true,
        key: dlStaff('delivery_delivered'),
      });
    } else if (!byDriver && after.driverId && isTerminalStatus(after.status) && actorId !== null) {
      await toDriver(after.driverId, {
        type: 'delivery_updated',
        title: `${after.orderId} was updated by dispatch`,
        body: `The delivery is now marked as ${after.status}.`,
        data,
        key: dl('delivery_updated'),
      });
    }
  }

  const editedByStaff =
    before !== null &&
    !driverChanged &&
    after.driverId !== null &&
    isActiveStatus(after.status) &&
    actorId !== after.driverId &&
    (before.address !== after.address ||
      before.addressNotes !== after.addressNotes ||
      before.notes !== after.notes ||
      before.customer.phone !== after.customer.phone);
  if (editedByStaff && after.driverId) {
    await toDriver(after.driverId, {
      type: 'delivery_updated',
      title: `${after.orderId} details changed`,
      body: 'Dispatch updated this delivery. Check the latest address and notes.',
      data,
      key: dl('edited'),
    });
  }

  // The customer's heads-up when the driver reaches the site (MARKETPLACE §5.6).
  if (before && before.status !== 'arrived' && after.status === 'arrived' && after.customerId) {
    const who = firstName(after.driverName) || 'Your driver';
    await notify(tx, after.customerId, {
      type: 'order_update',
      title: `${who} is at your site`,
      body:
        after.receiving === 'attended'
          ? `${who} is at your site — have the hand-off code ready.`
          : `${who} is at your site.`,
      data: {
        ...data,
        ...(after.sourceOrderId ? { customerOrderId: after.sourceOrderId } : {}),
      },
      key: `dl-arrived-${after.id}-${after.attempts}`,
    });
  }
}

/** The tracking link by SMS to the site contact, once, when the trip to the site starts. */
async function sendTrackingLinkOnce(tx: Tx, graph: LockedGraph, delivery: Delivery): Promise<void> {
  const phone = delivery.customer.phone;
  const row = graph.deliveries.get(delivery.id);
  if (!phone || !row) return;
  const meta = metaOf(row);
  if (meta.trackingLinkSentAt !== null || !meta.trackingToken) return;
  await patchMeta(tx, delivery.id, { trackingLinkSentAt: tx.now });
  graph.deliveries.set(delivery.id, { ...row, meta: { ...row.meta, trackingLinkSentAt: tx.now } });
  const body =
    `InstaSupply: Hi ${firstName(delivery.customer.name)}, your order ${delivery.orderId} is on the way with ` +
    `${firstName(delivery.driverName) || 'your driver'}. Track it live: ${webUrl}/track/${meta.trackingToken}`;
  await enqueue(tx, 'sms.send', { to: phone, body, purpose: 'tracking_link' });
  await insertEvent(tx, delivery, SYSTEM_ACTOR, {
    type: 'customer_notified',
    message: 'Tracking link sent to the customer by SMS',
  });
}

export async function applyDeliveryEffects(
  tx: Tx,
  graph: LockedGraph,
  before: Delivery | null,
  after: Delivery,
): Promise<void> {
  const driverChanged = (before?.driverId ?? null) !== after.driverId;
  const statusChanged = before?.status !== after.status;

  // 1. The supplier's view of the driver; it also refreshes the order summary and tells the store when
  //    the projected driver changed (store-orders, §9.2.13).
  if (after.storeOrderId && graph.storeOrders.has(after.storeOrderId)) {
    await projectDriverOntoStoreOrder(tx, graph, after);
  }

  // 2. Ledger and the public tracking page.
  await recordDeliveryLedger(tx, before, after);
  await syncTracking(tx, after);

  // 3. Messages.
  await notifyChange(tx, before, after);
  if (statusChanged && after.status === 'in_transit') await sendTrackingLinkOnce(tx, graph, after);

  // 4. Route plans of every driver whose stops changed.
  const drivers = new Set<string>();
  if (driverChanged) {
    if (before?.driverId) drivers.add(before.driverId);
    if (after.driverId) drivers.add(after.driverId);
  } else if (after.driverId && (statusChanged || planningInputsChanged(before, after))) {
    drivers.add(after.driverId);
  }
  for (const driverId of drivers) {
    await enqueue(tx, 'route.plan', { driverId }, { dedupeKey: `route.plan:${driverId}` });
  }
}
