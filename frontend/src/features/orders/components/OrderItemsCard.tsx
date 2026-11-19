import { formatCurrency, pluralize } from '@instasupply/shared';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { DiscountIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import type { OrderRecord } from '@/lib/data';

import { ItemThumb } from './ItemThumb';

function TotalRow({ label, children, strong }: { label: ReactNode; children: ReactNode; strong?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4',
        strong
          ? 'mt-1 border-t border-slate-200 pt-3 text-base font-semibold text-slate-900'
          : 'text-slate-600',
      )}
    >
      <dt className="flex flex-wrap items-center gap-2">{label}</dt>
      <dd className={cn('tabular-nums', !strong && 'font-medium text-slate-900')}>{children}</dd>
    </div>
  );
}

export function OrderItemsCard({ order }: { order: OrderRecord }) {
  return (
    <Card>
      <CardHeader
        title="Items"
        description={`${pluralize(order.itemCount, 'item')} · ${pluralize(order.items.length, 'product')}`}
      />
      <ul className="divide-y divide-slate-100">
        {order.items.map((item, index) => (
          <li key={`${item.productId}-${index}`} className="flex items-center gap-3 px-5 py-3">
            <ItemThumb item={item} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">{item.name}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {item.unit} · {item.quantity} × {formatCurrency(item.price)}
              </p>
            </div>
            <p className="text-sm font-medium text-slate-900 tabular-nums">
              {formatCurrency(item.lineTotal)}
            </p>
          </li>
        ))}
      </ul>
      <dl className="space-y-2 rounded-b-2xl border-t border-slate-100 bg-slate-50/60 px-5 py-4 text-sm">
        <TotalRow label="Subtotal">{formatCurrency(order.subtotal)}</TotalRow>
        <TotalRow label="Delivery fee">
          {order.deliveryFee > 0 ? (
            formatCurrency(order.deliveryFee)
          ) : (
            <span className="text-emerald-700">Free</span>
          )}
        </TotalRow>
        {order.discount > 0 ? (
          <TotalRow
            label={
              <>
                Discount
                {order.promoCode ? (
                  <Badge tone="success">
                    <DiscountIcon size={12} aria-hidden />
                    {order.promoCode}
                  </Badge>
                ) : null}
              </>
            }
          >
            <span className="text-emerald-700">−{formatCurrency(order.discount)}</span>
          </TotalRow>
        ) : null}
        <TotalRow label="Total" strong>
          {formatCurrency(order.total)}
        </TotalRow>
      </dl>
    </Card>
  );
}
