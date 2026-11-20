import type { DeliveryPrivateMeta } from '@instasupply/shared';

import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { CopyField } from '@/components/ui/CopyField';
import { Skeleton } from '@/components/ui/Feedback';
import { ExternalLinkIcon, KeyIcon } from '@/components/ui/icons';
import type { DeliveryRecord } from '@/lib/data';

import { useTrackingUrl } from '../hooks';

/** The customer's live tracking link (the one their text message carries) and the hand-off code. */
export function TrackingCard({
  delivery,
  meta,
  loading,
}: {
  delivery: DeliveryRecord;
  meta: DeliveryPrivateMeta | null;
  loading: boolean;
}) {
  const trackingUrl = useTrackingUrl();
  const url = meta ? trackingUrl(meta.trackingToken) : null;

  return (
    <Card>
      <CardHeader
        title="Customer tracking"
        description="Live map, arrival time and progress. Shows only the driver's first name and vehicle."
      />
      <CardBody className="space-y-3">
        {loading ? (
          <Skeleton className="h-9 w-full" />
        ) : url ? (
          <>
            <CopyField value={url} label={`Tracking link for ${delivery.orderId}`} />
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-brand-700 hover:bg-brand-50"
            >
              <ExternalLinkIcon size={14} aria-hidden /> Open the tracking page
            </a>
          </>
        ) : (
          <p className="text-sm text-slate-500">No tracking link for this delivery.</p>
        )}
        {delivery.requireCode && meta ? (
          <div className="flex items-center gap-3 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
            <KeyIcon size={18} className="shrink-0 text-amber-600" aria-hidden />
            <div className="text-sm">
              <p className="font-medium text-amber-900">Hand-off code</p>
              <p className="text-xs text-amber-800">
                Shown to the site contact; the driver enters it to complete.
              </p>
            </div>
            <span
              className="ml-auto font-mono text-lg font-bold tracking-[0.3em] text-amber-900"
              aria-label={`Hand-off code ${meta.handoffCode.split('').join(' ')}`}
            >
              {meta.handoffCode}
            </span>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
