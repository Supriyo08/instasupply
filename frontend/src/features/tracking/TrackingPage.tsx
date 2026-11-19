import {
  APP_NAME,
  formatClock,
  formatDistance,
  formatRelativeTime,
  initials,
  STATUS_META,
  toMillis,
  type PublicTracking,
} from '@instasupply/shared';
import { useEffect } from 'react';
import { useParams } from 'react-router';

import { Spinner } from '@/components/ui/Feedback';
import { FailedIcon, KeyIcon, PinIcon, SuccessIcon, CancelIcon } from '@/components/ui/icons';
import { BrandMark } from '@/features/auth/BrandMark';
import { cn } from '@/lib/cn';
import { useNow } from '@/lib/data';

import { ProgressSteps } from './ProgressSteps';
import { TrackingMap } from './TrackingMap';
import { useTracking } from './useTracking';

/** Remaining seconds, adjusted for time passed since the server computed the ETA. */
function remainingSeconds(tracking: PublicTracking, now: number): number | null {
  if (tracking.etaSeconds == null) return null;
  const computedAt = toMillis(tracking.updatedAt) ?? now;
  return Math.max(0, tracking.etaSeconds - (now - computedAt) / 1000);
}

function headline(tracking: PublicTracking, now: number): { title: string; subtitle: string } {
  const remaining = remainingSeconds(tracking, now);
  const minutes = remaining != null ? Math.max(1, Math.round(remaining / 60)) : null;
  const driverName = tracking.driver?.firstName ?? 'Your driver';
  switch (tracking.status) {
    case 'in_transit':
      return {
        title: minutes != null ? `Arriving in ${minutes} min` : 'On the way',
        subtitle:
          minutes != null
            ? `${driverName} is heading to you · expected by ${formatClock(now + (remaining ?? 0) * 1000)}`
            : `${driverName} is heading to you`,
      };
    case 'arrived':
      return {
        title: `${driverName} has arrived`,
        subtitle: 'Please meet your driver at the drop-off point.',
      };
    case 'delivered':
      return { title: 'Delivered', subtitle: 'Your order has been delivered. Thank you!' };
    case 'failed':
      return {
        title: "We couldn't deliver your order",
        subtitle: "We'll contact you to arrange another attempt.",
      };
    case 'cancelled':
      return {
        title: 'Order cancelled',
        subtitle: 'This delivery was cancelled. Contact the sender if this is unexpected.',
      };
    case 'unassigned':
      return { title: 'Order received', subtitle: "We're finding a driver for your delivery." };
    default: {
      const ahead = tracking.stopsBefore ?? 0;
      return {
        title: STATUS_META[tracking.status].customerLabel,
        subtitle:
          ahead > 0
            ? `${driverName} has ${ahead} stop${ahead === 1 ? '' : 's'} before yours${minutes != null ? ` · around ${formatClock(now + (remaining ?? 0) * 1000)}` : ''}`
            : `${driverName} will be on the way soon`,
      };
    }
  }
}

const END_STATE = {
  delivered: { icon: SuccessIcon, className: 'bg-emerald-50 text-emerald-600' },
  failed: { icon: FailedIcon, className: 'bg-rose-50 text-rose-600' },
  cancelled: { icon: CancelIcon, className: 'bg-slate-100 text-slate-500' },
} as const;

function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 p-6 text-center">
      <div className="max-w-sm">
        <BrandMark className="mx-auto size-12" />
        <h1 className="mt-5 text-lg font-semibold text-slate-900">Tracking link not found</h1>
        <p className="mt-1 text-sm text-slate-500">
          This link is invalid or has expired. Check the latest message from the sender.
        </p>
      </div>
    </div>
  );
}

export default function TrackingPage() {
  const { token } = useParams();
  const tracking = useTracking(token);
  const now = useNow(10_000);
  const data = tracking.data;

  useEffect(() => {
    document.title = data ? `Track ${data.orderId} · ${APP_NAME}` : `Track your delivery · ${APP_NAME}`;
  }, [data]);

  if (tracking.invalidToken || (!tracking.loading && !data) || tracking.error) return <NotFound />;
  if (!data) {
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-50">
        <Spinner label="Finding your delivery" />
      </div>
    );
  }

  const { title, subtitle } = headline(data, now);
  const endState = data.status in END_STATE ? END_STATE[data.status as keyof typeof END_STATE] : null;
  const liveDriver = data.driver?.location
    ? { location: data.driver.location, heading: data.driver.heading, firstName: data.driver.firstName }
    : null;
  const showCode = !!data.handoffCode && !endState;

  return (
    <div className="min-h-dvh bg-slate-100">
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col bg-white shadow-xl shadow-slate-900/5">
        <header className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <BrandMark className="size-8" />
            <span className="text-sm font-semibold text-slate-900">{APP_NAME}</span>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 font-mono text-xs font-semibold text-slate-700">
            {data.orderId}
          </span>
        </header>

        {data.destination && !endState ? (
          <div className="relative h-[42vh] min-h-64">
            <TrackingMap destination={data.destination} driver={liveDriver} />
          </div>
        ) : null}

        <main
          className={cn(
            'relative z-[1000] flex-1 space-y-5 rounded-t-3xl bg-white px-5 pt-6 pb-8',
            !endState && '-mt-6',
          )}
        >
          <section className={cn(endState && 'pt-6 text-center')}>
            {endState ? (
              <span
                className={cn(
                  'mx-auto mb-4 grid size-16 place-items-center rounded-full',
                  endState.className,
                )}
              >
                <endState.icon size={32} aria-hidden />
              </span>
            ) : null}
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
            <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
            {data.status === 'in_transit' && data.distanceMeters != null ? (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-brand-500" />
                </span>
                Live · {formatDistance(data.distanceMeters)} away
              </p>
            ) : null}
          </section>

          {showCode ? (
            <section className="flex items-center gap-4 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
                <KeyIcon size={20} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-amber-900">Your hand-off code</p>
                <p className="text-xs text-amber-800">
                  Share it with the driver only when you receive your order.
                </p>
              </div>
              <span className="font-mono text-2xl font-bold tracking-[0.25em] text-amber-900">
                {data.handoffCode}
              </span>
            </section>
          ) : null}

          {data.driver ? (
            <section className="flex items-center gap-3 rounded-2xl bg-slate-50 p-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                {initials(data.driver.firstName)}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">
                  {data.driver.firstName} is your delivery partner
                </p>
                {data.driver.vehicle ? (
                  <p className="truncate text-xs text-slate-500">{data.driver.vehicle}</p>
                ) : null}
              </div>
            </section>
          ) : null}

          {data.status !== 'cancelled' && data.status !== 'failed' ? (
            <section className="rounded-2xl p-1">
              <ProgressSteps tracking={data} />
            </section>
          ) : null}

          <section className="flex gap-3 rounded-2xl border border-slate-200 p-4">
            <PinIcon size={18} className="mt-0.5 shrink-0 text-slate-400" aria-hidden />
            <div className="min-w-0">
              <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                Delivering to {data.customerFirstName}
              </p>
              <p className="mt-0.5 text-sm text-slate-800">{data.address}</p>
            </div>
          </section>

          <p className="text-center text-xs text-slate-400">
            Updated {formatRelativeTime(data.updatedAt, now)} · This page refreshes automatically
          </p>
        </main>
      </div>
    </div>
  );
}
