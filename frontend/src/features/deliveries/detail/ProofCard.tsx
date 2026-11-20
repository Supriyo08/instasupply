import { failureReasonLabel, formatDateTimeET, isSiteCausedFailure } from '@instasupply/shared';

import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/Card';
import { FailedIcon, SuccessIcon } from '@/components/ui/icons';
import { SignedImage } from '@/features/files/SignedImage';
import type { DeliveryRecord } from '@/lib/data';

/** Proof of delivery for delivered trips, or the failure reason for failed ones. */
export function OutcomeCard({ delivery, now }: { delivery: DeliveryRecord; now: number }) {
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
          description={formatDateTimeET(delivery.deliveredAt, now)}
        />
        <CardBody className="space-y-3">
          {proof.photoPath ? (
            <SignedImage
              path={proof.photoPath}
              alt={`Drop-off photo for ${delivery.orderId} at ${delivery.address}`}
              className="aspect-[4/3] w-full rounded-xl object-cover ring-1 ring-slate-200"
            />
          ) : delivery.requirePhoto ? (
            <p className="text-sm text-slate-500">No photo: completed by dispatch.</p>
          ) : null}
          <dl className="divide-y divide-slate-100">
            <DetailRow label="Received by">{proof.recipientName ?? '—'}</DetailRow>
            <DetailRow label="Hand-off code">
              {delivery.requireCode ? (proof.codeVerified ? 'Verified' : 'Not verified') : 'Not required'}
            </DetailRow>
            {proof.note ? <DetailRow label="Note">{proof.note}</DetailRow> : null}
          </dl>
        </CardBody>
      </Card>
    );
  }

  if (delivery.status === 'failed' && delivery.failure) {
    const siteCaused = isSiteCausedFailure(delivery.failure.reason);
    return (
      <Card className="border-rose-200">
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2 text-rose-700">
              <FailedIcon size={16} aria-hidden /> Delivery attempt failed
            </span>
          }
          description={formatDateTimeET(delivery.failedAt, now)}
        />
        <CardBody>
          <p className="text-sm font-medium text-slate-900">{failureReasonLabel(delivery.failure.reason)}</p>
          {delivery.failure.note ? (
            <p className="mt-1 text-sm text-slate-600">{delivery.failure.note}</p>
          ) : null}
          <p className="mt-3 text-xs text-slate-500">
            {siteCaused ? 'The site caused it: the driver is still paid. ' : ''}
            {delivery.kind === 'marketplace'
              ? 'Use Actions to re-attempt the delivery or return the load to the store.'
              : 'Reassign it to retry the delivery, or cancel it.'}
          </p>
        </CardBody>
      </Card>
    );
  }

  return null;
}
