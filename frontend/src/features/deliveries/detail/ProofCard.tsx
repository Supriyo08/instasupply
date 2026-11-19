import { failureReasonLabel, formatCurrency, formatDateTime } from '@instasupply/shared';
import { getDownloadURL, ref } from 'firebase/storage';
import { useEffect, useState } from 'react';

import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Feedback';
import { FailedIcon, ImageIcon, SuccessIcon } from '@/components/ui/icons';
import type { DeliveryRecord } from '@/lib/data';
import { storage } from '@/lib/firebase/services';

function ProofPhoto({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDownloadURL(ref(storage, path))
      .then((value) => !cancelled && setUrl(value))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (failed) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
        <ImageIcon size={14} aria-hidden /> Photo unavailable
      </div>
    );
  }
  if (!url) return <Skeleton className="aspect-[4/3] w-full rounded-xl" />;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="block overflow-hidden rounded-xl ring-1 ring-slate-200"
    >
      <img src={url} alt="Proof of delivery" className="aspect-[4/3] w-full object-cover" />
    </a>
  );
}

/** Proof of delivery for delivered orders, or the failure reason for failed ones. */
export function OutcomeCard({ delivery }: { delivery: DeliveryRecord }) {
  if (delivery.status === 'delivered' && delivery.proof) {
    const { proof } = delivery;
    return (
      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <SuccessIcon size={16} className="text-emerald-500" aria-hidden /> Proof of delivery
            </span>
          }
          description={formatDateTime(delivery.deliveredAt)}
        />
        <CardBody className="space-y-3">
          {proof.photoPath ? <ProofPhoto path={proof.photoPath} /> : null}
          <dl className="divide-y divide-slate-100">
            <DetailRow label="Received by">{proof.recipientName ?? '—'}</DetailRow>
            <DetailRow label="Hand-off code">
              {delivery.requireCode ? (proof.codeVerified ? 'Verified' : 'Not verified') : 'Not required'}
            </DetailRow>
            {delivery.codAmount ? (
              <DetailRow label="Cash collected">
                {proof.codCollected != null ? formatCurrency(proof.codCollected) : '—'}
                <span className="ml-1 text-xs font-normal text-slate-500">
                  of {formatCurrency(delivery.codAmount)}
                </span>
              </DetailRow>
            ) : null}
            {proof.note ? <DetailRow label="Note">{proof.note}</DetailRow> : null}
          </dl>
        </CardBody>
      </Card>
    );
  }

  if (delivery.status === 'failed' && delivery.failure) {
    return (
      <Card className="border-rose-200">
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2 text-rose-700">
              <FailedIcon size={16} aria-hidden /> Delivery attempt failed
            </span>
          }
          description={formatDateTime(delivery.failedAt)}
        />
        <CardBody>
          <p className="text-sm font-medium text-slate-900">{failureReasonLabel(delivery.failure.reason)}</p>
          {delivery.failure.note ? (
            <p className="mt-1 text-sm text-slate-600">{delivery.failure.note}</p>
          ) : null}
          <p className="mt-3 text-xs text-slate-500">Reassign it to retry the delivery, or cancel it.</p>
        </CardBody>
      </Card>
    );
  }

  return null;
}
