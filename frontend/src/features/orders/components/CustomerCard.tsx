import { formatAddress } from '@instasupply/shared';

import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { NoteIcon, PhoneIcon, PinIcon, UserIcon } from '@/components/ui/icons';
import type { OrderRecord } from '@/lib/data';

export function CustomerCard({ order }: { order: OrderRecord }) {
  const { address } = order;
  const recipientDiffers = address.name.trim().toLowerCase() !== order.customerName.trim().toLowerCase();

  return (
    <Card>
      <CardHeader title="Customer" action={address.label ? <Badge>{address.label}</Badge> : null} />
      <CardBody className="space-y-3 text-sm">
        <div>
          <p className="font-semibold text-slate-900">{order.customerName}</p>
          {recipientDiffers ? (
            <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-slate-500">
              <UserIcon size={12} aria-hidden /> Deliver to {address.name}
            </p>
          ) : null}
          <a
            href={`tel:${address.phone}`}
            className="mt-1 flex w-fit items-center gap-1.5 text-slate-600 hover:text-brand-700"
          >
            <PhoneIcon size={14} aria-hidden /> {address.phone}
          </a>
        </div>
        <div className="flex gap-2 text-slate-700">
          <PinIcon size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden />
          <div className="min-w-0">
            <p>{formatAddress(address)}</p>
            {address.landmark ? (
              <p className="mt-0.5 text-xs text-slate-500">Landmark: {address.landmark}</p>
            ) : null}
            {address.location ? (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${address.location.lat},${address.location.lng}`}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                Open in Google Maps
              </a>
            ) : null}
          </div>
        </div>
        {order.notes ? (
          <div className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-900 ring-1 ring-amber-200">
            <NoteIcon size={16} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
            <p className="min-w-0 break-words">
              <span className="sr-only">Delivery notes: </span>
              {order.notes}
            </p>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
