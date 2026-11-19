import { PRIORITY_META, formatCurrency, formatDateTime, toMillis } from '@instasupply/shared';

import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/Card';
import { MailIcon, PhoneIcon, PinIcon } from '@/components/ui/icons';
import type { DeliveryRecord } from '@/lib/data';

export function DeliverySummary({ delivery }: { delivery: DeliveryRecord }) {
  const windowStart = toMillis(delivery.windowStart);
  const windowEnd = toMillis(delivery.windowEnd);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader title="Customer & drop-off" />
        <CardBody className="space-y-3 text-sm">
          <div>
            <p className="font-semibold text-slate-900">{delivery.customer.name}</p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-slate-600">
              {delivery.customer.phone ? (
                <a
                  href={`tel:${delivery.customer.phone}`}
                  className="inline-flex items-center gap-1.5 hover:text-brand-700"
                >
                  <PhoneIcon size={14} aria-hidden /> {delivery.customer.phone}
                </a>
              ) : null}
              {delivery.customer.email ? (
                <a
                  href={`mailto:${delivery.customer.email}`}
                  className="inline-flex items-center gap-1.5 hover:text-brand-700"
                >
                  <MailIcon size={14} aria-hidden /> {delivery.customer.email}
                </a>
              ) : null}
            </div>
          </div>
          <div className="flex gap-2 text-slate-700">
            <PinIcon size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden />
            <div>
              <p>{delivery.address}</p>
              {delivery.addressNotes ? (
                <p className="mt-0.5 text-xs text-slate-500">{delivery.addressNotes}</p>
              ) : null}
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${delivery.location.lat},${delivery.location.lng}`}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                Open in Google Maps
              </a>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Package" />
        <CardBody>
          <dl className="divide-y divide-slate-100">
            <DetailRow label="Packages">{delivery.packageCount}</DetailRow>
            <DetailRow label="Priority">{PRIORITY_META[delivery.priority].label}</DetailRow>
            <DetailRow label="Cash on delivery">
              {delivery.codAmount ? formatCurrency(delivery.codAmount) : 'Prepaid'}
            </DetailRow>
            <DetailRow label="Hand-off code">{delivery.requireCode ? 'Required' : 'Not required'}</DetailRow>
            {windowStart || windowEnd ? (
              <DetailRow label="Delivery window">
                {windowStart ? formatDateTime(windowStart) : 'Any time'} →{' '}
                {windowEnd ? formatDateTime(windowEnd) : 'open'}
              </DetailRow>
            ) : null}
            <DetailRow label="Attempts">{delivery.attempts + 1}</DetailRow>
          </dl>
          {delivery.notes ? (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
              {delivery.notes}
            </p>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
