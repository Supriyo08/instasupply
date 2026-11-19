import type { DeliveryPrivateMeta } from '@instasupply/shared';

import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Feedback';
import { CopyIcon, ExternalLinkIcon, KeyIcon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/Toast';
import type { DeliveryRecord } from '@/lib/data';

import { trackingUrl } from '../hooks';

export function TrackingCard({
  delivery,
  meta,
  loading,
}: {
  delivery: DeliveryRecord;
  meta: DeliveryPrivateMeta | null;
  loading: boolean;
}) {
  const toast = useToast();
  const url = meta ? trackingUrl(meta.trackingToken) : null;

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Tracking link copied');
    } catch {
      toast.error("Couldn't copy the link", url);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Customer tracking"
        description="Live map, ETA and progress, without any driver details."
      />
      <CardBody className="space-y-3">
        {loading ? (
          <Skeleton className="h-9 w-full" />
        ) : url ? (
          <>
            <div className="truncate rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600 ring-1 ring-slate-200">
              {url}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" icon={CopyIcon} onClick={() => void copy()}>
                Copy link
              </Button>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-brand-700 hover:bg-brand-50"
              >
                <ExternalLinkIcon size={14} aria-hidden /> Open
              </a>
            </div>
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
                Shown to the customer; the driver must enter it to complete.
              </p>
            </div>
            <span className="ml-auto font-mono text-lg font-bold tracking-[0.3em] text-amber-900">
              {meta.handoffCode}
            </span>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
