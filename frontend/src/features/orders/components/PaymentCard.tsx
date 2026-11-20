import { formatDateTimeET, formatMoney, type Order } from '@instasupply/shared';

import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/Card';
import { CardIcon } from '@/components/ui/icons';

import { PAYMENT_EVENT_LABELS, cardLabel } from '../order-format';
import { PaymentBadge } from './OrderBadges';

/**
 * The order's money (MARKETPLACE §3.8): the checkout receipt, what the customer will really pay, and
 * every payment event (authorize, capture, release, refunds) with the gateway reference.
 */
export function PaymentCard({ order }: { order: Order }) {
  const { payment, placed, current } = order;
  const events = [...payment.events].sort((a, b) => b.at - a.at);
  const storeNumbers = new Map(order.storeOrders.map((so) => [so.storeOrderId, so.number]));

  return (
    <Card>
      <CardHeader
        title="Payment"
        description={cardLabel(payment)}
        action={<PaymentBadge status={payment.status} />}
      />
      <CardBody className="space-y-4">
        <dl className="divide-y divide-slate-100">
          <DetailRow label="Items">{formatMoney(current.itemsCents)}</DetailRow>
          {current.discountCents > 0 ? (
            <DetailRow label={placed.discounts[0]?.label ?? 'Discount'}>
              −{formatMoney(current.discountCents)}
            </DetailRow>
          ) : null}
          <DetailRow label="Delivery">
            {formatMoney(current.deliveryFeeCents)}
            {placed.freeDelivery ? (
              <span className="block text-xs font-normal text-slate-500">
                {placed.freeDelivery === 'first_order' ? 'Free: first order' : 'Free: over $500'}
              </span>
            ) : null}
          </DetailRow>
          {current.unloadFeeCents > 0 ? (
            <DetailRow label="Labourer">{formatMoney(current.unloadFeeCents)}</DetailRow>
          ) : null}
          <DetailRow label="HST (13 %)">{formatMoney(current.taxCents)}</DetailRow>
          <DetailRow label="To pay">
            <span className="text-base font-semibold">{formatMoney(current.totalCents)}</span>
            {current.totalCents !== placed.totalCents ? (
              <span className="block text-xs font-normal text-slate-500">
                checkout total <s>{formatMoney(placed.totalCents)}</s>
              </span>
            ) : null}
          </DetailRow>
          {payment.method === 'card' ? (
            <>
              <DetailRow label="Authorized">{formatMoney(payment.authorizedCents)}</DetailRow>
              <DetailRow label="Captured">{formatMoney(payment.capturedCents)}</DetailRow>
              {payment.refundedCents > 0 ? (
                <DetailRow label="Refunded">{formatMoney(payment.refundedCents)}</DetailRow>
              ) : null}
              {payment.captureDeadlineAt && !payment.capturedAt ? (
                <DetailRow label="Capture by">{formatDateTimeET(payment.captureDeadlineAt)}</DetailRow>
              ) : null}
            </>
          ) : null}
          {order.placed.promoCode ? <DetailRow label="Promo code">{order.placed.promoCode}</DetailRow> : null}
          {order.hstNumber ? <DetailRow label="HST number">{order.hstNumber}</DetailRow> : null}
        </dl>

        <section aria-label="Payment events">
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Payment events
          </h3>
          {events.length === 0 ? (
            <p className="text-sm text-slate-500">No payment events yet.</p>
          ) : (
            <ol className="space-y-2.5 text-sm">
              {events.map((event) => (
                <li key={event.idempotencyKey} className="flex items-start gap-3">
                  <CardIcon size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="flex justify-between gap-3">
                      <span
                        className={
                          event.type === 'capture_failed'
                            ? 'font-medium text-rose-700'
                            : 'font-medium text-slate-900'
                        }
                      >
                        {PAYMENT_EVENT_LABELS[event.type]}
                        {event.storeOrderId && storeNumbers.get(event.storeOrderId)
                          ? ` · ${storeNumbers.get(event.storeOrderId)}`
                          : ''}
                      </span>
                      <span className="shrink-0 tabular-nums">{formatMoney(event.amountCents)}</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDateTimeET(event.at)} · <span className="font-mono">{event.ref}</span>
                    </p>
                    {event.reason ? <p className="text-xs text-slate-500">{event.reason}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </CardBody>
    </Card>
  );
}
