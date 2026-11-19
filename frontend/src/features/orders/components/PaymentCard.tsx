import { formatCurrency } from '@instasupply/shared';

import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/Card';
import { Callout } from '@/components/ui/Feedback';
import { CashIcon, ReceiptIcon } from '@/components/ui/icons';
import type { OrderRecord } from '@/lib/data';

import { cardLabel, cashToCollect, paymentStatusMeta } from '../order-format';

export function PaymentCard({ order }: { order: OrderRecord }) {
  const status = paymentStatusMeta(order);
  const cash = cashToCollect(order);

  return (
    <Card>
      <CardHeader
        title="Payment"
        action={
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
        }
      />
      <CardBody className="space-y-3">
        <dl className="divide-y divide-slate-100">
          <DetailRow label="Method">{order.paymentMethod === 'cod' ? 'Cash on delivery' : 'Card'}</DetailRow>
          {order.card ? <DetailRow label="Card">{cardLabel(order.card)}</DetailRow> : null}
          <DetailRow label="Amount">{formatCurrency(order.total)}</DetailRow>
          {order.paymentRef ? (
            <DetailRow label="Reference">
              <span className="font-mono text-xs break-all">{order.paymentRef}</span>
            </DetailRow>
          ) : null}
        </dl>
        {cash != null ? (
          <Callout tone="warning" icon={CashIcon} title={`Collect ${formatCurrency(cash)} in cash`}>
            The driver collects this from the shopper on delivery.
          </Callout>
        ) : null}
        {order.paymentStatus === 'refund_pending' ? (
          <Callout tone="warning" icon={ReceiptIcon} title="Refund pending">
            {formatCurrency(order.total)} goes back to {order.card ? cardLabel(order.card) : 'the card'}.
          </Callout>
        ) : null}
        {order.paymentStatus === 'refunded' ? (
          <Callout tone="success" icon={ReceiptIcon} title="Refunded">
            {formatCurrency(order.total)} was returned to {order.card ? cardLabel(order.card) : 'the card'}.
          </Callout>
        ) : null}
      </CardBody>
    </Card>
  );
}
