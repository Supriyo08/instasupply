/**
 * Keeps a customer order in step with the delivery that fulfils it, and tells the customer.
 * Called from `onDeliveryWritten`.
 */
import {
  COLLECTIONS,
  ORDER_PROGRESS,
  firstName,
  orderStatusForDelivery,
  type NotificationType,
  type Order,
  type OrderStatus,
} from '@instasupply/shared';

import { db, FieldValue, serverTimestamp } from '../../lib/admin';
import type { DeliveryRecord } from '../deliveries/repository';
import { notifyUser } from '../notifications/notify';

const rank = (status: OrderStatus) => ORDER_PROGRESS.indexOf(status);

interface CustomerMessage {
  type: NotificationType;
  title: string;
  body: string;
}

function messageFor(
  delivery: DeliveryRecord,
  previous: DeliveryRecord | null,
  order: Order,
  next: OrderStatus,
  changed: boolean,
): CustomerMessage | null {
  const driver = firstName(delivery.driverName ?? 'Your driver');
  // "Arrived" doesn't change the order status but is worth a heads-up.
  if (delivery.status === 'arrived' && previous?.status !== 'arrived') {
    return {
      type: 'order_update',
      title: `${driver} has arrived`,
      body: `Your delivery partner is at your door with ${order.number}. Keep your hand-off code ready.`,
    };
  }
  if (!changed) return null;
  switch (next) {
    case 'confirmed':
      return {
        type: 'order_update',
        title: 'Order confirmed',
        body: `${driver} will deliver your order ${order.number}.`,
      };
    case 'packed':
      return {
        type: 'order_update',
        title: 'Order packed',
        body: `${order.number} is packed and with ${driver}.`,
      };
    case 'out_for_delivery':
      return {
        type: 'order_update',
        title: 'Out for delivery',
        body: `${driver} is on the way with ${order.number}. Tap to track live.`,
      };
    case 'delivered':
      return {
        type: 'order_delivered',
        title: 'Delivered!',
        body: `Enjoy your groceries. Tap to rate the items in ${order.number}.`,
      };
    case 'failed':
      return {
        type: 'order_update',
        title: 'Delivery attempt failed',
        body: `We couldn't deliver ${order.number}. We'll contact you to reschedule.`,
      };
    case 'cancelled':
      return {
        type: 'order_cancelled',
        title: 'Order cancelled',
        body: `${order.number} was cancelled by the store.${order.paymentStatus === 'paid' ? ' Your refund is on its way.' : ''}`,
      };
    default:
      return null;
  }
}

export async function syncOrderFromDelivery(
  eventId: string,
  before: DeliveryRecord | null,
  after: DeliveryRecord,
): Promise<void> {
  if (!after.sourceOrderId) return;
  if (before && before.status === after.status) return;

  const orderRef = db.collection(COLLECTIONS.orders).doc(after.sourceOrderId);
  const target = orderStatusForDelivery(after.status);

  const outcome = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(orderRef);
    if (!snapshot.exists) return null;
    const order = { id: snapshot.id, ...snapshot.data() } as Order;
    // The store cancelled the delivery: put the goods back on the shelf. A customer cancellation
    // marks the order cancelled and restocks in its own transaction, so this never runs twice.
    const restock = after.status === 'cancelled' && order.status !== 'cancelled' && order.items.length > 0;
    const productSnaps = restock
      ? await tx.getAll(...order.items.map((item) => db.collection(COLLECTIONS.products).doc(item.productId)))
      : [];

    // Never move backwards along the progress bar (e.g. a driver declining after the order was
    // confirmed), except when retrying after a failed attempt.
    let next = target;
    if (rank(next) >= 0 && rank(order.status) > rank(next) && order.status !== 'failed') next = order.status;
    if (order.status === 'cancelled') next = 'cancelled';

    const update: Record<string, unknown> = {};
    const changed = next !== order.status;
    if (changed) {
      update.status = next;
      update[`statusAt.${next}`] = serverTimestamp();
    }
    if (
      after.status === 'delivered' &&
      order.paymentMethod === 'cod' &&
      order.paymentStatus === 'cod_pending'
    ) {
      update.paymentStatus = 'collected';
    }
    if (after.status === 'cancelled') {
      if (order.paymentStatus === 'paid') update.paymentStatus = 'refund_pending';
      if (!order.cancelReason) update.cancelReason = 'Cancelled by the store';
    }
    if (Object.keys(update).length > 0) {
      update.updatedAt = serverTimestamp();
      tx.update(orderRef, update);
    }
    productSnaps.forEach((product, index) => {
      if (product.exists)
        tx.update(product.ref, { stock: FieldValue.increment(order.items[index]!.quantity) });
    });
    return { order, next, changed };
  });
  if (!outcome) return;

  // Customers don't need a notification about their own action.
  if (after.updatedBy && after.updatedBy === after.customerId) return;
  const message = messageFor(after, before, outcome.order, outcome.next, outcome.changed);
  if (!message) return;
  await notifyUser(outcome.order.customerId, {
    ...message,
    data: { customerOrderId: outcome.order.id, number: outcome.order.number },
    key: `${eventId}-order`,
  });
}
