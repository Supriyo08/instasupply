import {
  COLLECTIONS,
  canCustomerCancel,
  cleanText,
  type CancelOrderRequest,
  type OkResponse,
  type Order,
} from '@instasupply/shared';

import { db, FieldValue, serverTimestamp } from '../../lib/admin';
import { failedPrecondition, notFound } from '../../lib/errors';
import { callable } from '../../lib/functions';
import { requireCustomer, requireString } from '../../lib/guards';
import { deliveryRef, getDeliveryInTx, writeEvent } from '../deliveries/repository';

/** Delivery states in which the package has not left the store yet. */
const CANCELLABLE_DELIVERY = new Set(['unassigned', 'assigned', 'accepted']);

/** Customers can cancel until the driver picks the order up. Stock is returned to the shelf. */
export const cancelOrder = callable<CancelOrderRequest, OkResponse>('cancelOrder', async (request) => {
  const actor = requireCustomer(request);
  const orderId = requireString(request.data?.orderId, 'Order');
  const reason = cleanText(request.data?.reason, 200);
  const orderRef = db.collection(COLLECTIONS.orders).doc(orderId);

  await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    const order = orderSnap.data() as Order | undefined;
    if (!order || order.customerId !== actor.uid) notFound('Order not found.');
    if (order.status === 'cancelled') return;

    const delivery = await getDeliveryInTx(tx, order.deliveryId);
    const productSnaps = await tx.getAll(
      ...order.items.map((item) => db.collection(COLLECTIONS.products).doc(item.productId)),
    );
    if (!canCustomerCancel(order.status) || !CANCELLABLE_DELIVERY.has(delivery.status)) {
      failedPrecondition('Your order has already left the store and can no longer be cancelled.');
    }

    tx.update(orderRef, {
      status: 'cancelled',
      'statusAt.cancelled': serverTimestamp(),
      cancelReason: reason ?? 'Cancelled by you',
      paymentStatus: order.paymentStatus === 'paid' ? 'refund_pending' : order.paymentStatus,
      updatedAt: serverTimestamp(),
    });
    tx.update(deliveryRef(delivery.id), {
      status: 'cancelled',
      cancelledAt: serverTimestamp(),
      updatedBy: actor.uid,
      updatedAt: serverTimestamp(),
    });
    order.items.forEach((item, index) => {
      if (productSnaps[index]?.exists) {
        tx.update(productSnaps[index]!.ref, { stock: FieldValue.increment(item.quantity) });
      }
    });
    writeEvent(tx, delivery, { id: actor.uid, name: order.customerName, role: 'customer' }, {
      type: 'status',
      status: 'cancelled',
      fromStatus: delivery.status,
      message: `Cancelled by the customer${reason ? ` — ${reason}` : ''}`,
    });
  });

  return { ok: true };
});
