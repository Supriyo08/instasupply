import type { Order, PaymentStatus } from '@instasupply/shared';

/** The payment part of an order card: "Card held" until capture, then "Paid" (MARKETPLACE §7.3 Home). */
export const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  authorized: 'Card held',
  capture_pending: 'Card held',
  captured: 'Paid',
  capture_failed: 'Payment issue',
  partially_refunded: 'Partly refunded',
  refunded: 'Refunded',
  voided: 'Hold released',
  not_required: 'No charge',
};

/** The first store order on its way to the site, for the one mini map Home may show (CLIENTS §7.4). */
export function outForDelivery(order: Pick<Order, 'storeOrders'>) {
  return (
    order.storeOrders.find(
      (storeOrder) =>
        storeOrder.status === 'out_for_delivery' &&
        storeOrder.fulfilment === 'delivery' &&
        storeOrder.trackingToken,
    ) ?? null
  );
}
