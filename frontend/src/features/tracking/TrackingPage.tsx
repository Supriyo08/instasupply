import { useConfig } from '@instasupply/api-client/react';
import {
  APP_NAME,
  formatClockET,
  formatDayET,
  formatDistance,
  formatPhone,
  formatRelativeTime,
  initials,
  LOCATION_STALE_MS,
  type PublicTracking,
} from '@instasupply/shared';
import { useEffect, type ReactNode } from 'react';
import { useParams } from 'react-router';

import { Button } from '@/components/ui/Button';
import { useServerNow } from '@/components/ui/Countdown';
import { Spinner } from '@/components/ui/Feedback';
import { KeyIcon, OfflineIcon, PhoneIcon, PinIcon, StoreIcon, WindowIcon } from '@/components/ui/icons';
import { BrandMark } from '@/features/auth/BrandMark';
import { SceneArt } from '@/features/deliveries/components/SceneArt';
import { describeError } from '@/lib/api';
import { cn } from '@/lib/cn';

import { ProgressSteps } from './ProgressSteps';
import { TrackingMap } from './TrackingMap';
import { useTracking } from './useTracking';

interface Eta {
  /** Seconds left, counted down from the location fix the estimate was made from (R53); null: none. */
  remaining: number | null;
  /** The driver's last position is older than the stale limit (R46). */
  stale: boolean;
  /** When the driver's position was last updated. */
  seenAt: number | null;
}

function etaOf(tracking: PublicTracking, now: number): Eta {
  const seenAt = tracking.driver?.updatedAt ?? null;
  const live = !!tracking.driver?.location;
  const stale = live && (seenAt == null || now - seenAt > LOCATION_STALE_MS);
  if (tracking.etaSeconds == null) return { remaining: null, stale, seenAt };
  const base = seenAt ?? tracking.updatedAt;
  return { remaining: tracking.etaSeconds - (now - base) / 1000, stale, seenAt };
}

function headline(tracking: PublicTracking, eta: Eta, now: number): { title: string; subtitle: string } {
  const driver = tracking.driver?.firstName ?? 'Your driver';
  const store = tracking.pickup?.storeName ?? null;
  const ahead = tracking.stopsBefore ?? 0;
  const stopsText = ahead > 0 ? `${driver} has ${ahead} stop${ahead === 1 ? '' : 's'} before yours.` : null;
  switch (tracking.phase) {
    case 'finding_driver':
      return {
        title: store ? `${store} is preparing your order` : 'Order received',
        subtitle: "We're finding a driver with the right vehicle for your load.",
      };
    case 'driver_assigned':
      return {
        title: `${driver} is your driver`,
        subtitle: store
          ? `${driver} will head to ${store} to collect your order.`
          : (stopsText ?? `${driver} will be on the way soon.`),
      };
    case 'to_store':
      return {
        title: `Heading to ${store ?? 'the store'}`,
        subtitle: `${driver} is on the way to collect your order.`,
      };
    case 'at_store':
      return { title: `At ${store ?? 'the store'}`, subtitle: `${driver} is loading your materials.` };
    case 'loaded':
      return {
        title: `Loaded at ${store ?? 'the store'}`,
        subtitle: stopsText ?? `${driver} is about to head to your site.`,
      };
    case 'to_site': {
      if (eta.stale) {
        return {
          title: 'Waiting for an update from your driver',
          subtitle: `${driver} is on the way to your site. Last update ${formatRelativeTime(eta.seenAt, now)}.`,
        };
      }
      if (eta.remaining == null) {
        return { title: 'On the way to your site', subtitle: stopsText ?? `${driver} is heading to you.` };
      }
      if (eta.remaining <= 30) {
        return { title: 'Arriving any minute', subtitle: `${driver} is almost at your site.` };
      }
      const minutes = Math.max(1, Math.round(eta.remaining / 60));
      return {
        title: `Arriving in about ${minutes} min`,
        subtitle: `${driver} is on the way to your site · expected around ${formatClockET(now + eta.remaining * 1000)}`,
      };
    }
    case 'at_site':
      return {
        title: `${driver} is at your site`,
        subtitle:
          tracking.receiving === 'attended'
            ? 'Please meet them where the load goes, with your hand-off code.'
            : 'They will leave the load as instructed and take a photo.',
      };
    case 'delivered':
      return {
        title: 'Delivered',
        subtitle: 'Your materials are on site. Thanks for ordering with InstaSupply!',
      };
    case 'problem':
      return {
        title: "We couldn't complete the delivery",
        subtitle: 'Our team will contact you to arrange another attempt.',
      };
    case 'cancelled':
      return {
        title: 'Delivery cancelled',
        subtitle: 'This delivery was cancelled. Contact InstaSupply if this is unexpected.',
      };
  }
}

const END_ART: Partial<Record<PublicTracking['phase'], string>> = {
  delivered: 'scene-order-confirmed',
  problem: 'scene-report-issue',
  cancelled: 'scene-support',
};

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 p-6 text-center">
      <div className="max-w-sm">
        <BrandMark className="mx-auto size-12" />
        {children}
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <Frame>
      <h1 className="mt-5 text-lg font-semibold text-slate-900">Tracking link not found</h1>
      <p className="mt-1 text-sm text-slate-500">
        This link is wrong or has expired. Check the latest text message from InstaSupply.
      </p>
    </Frame>
  );
}

/** The public page of `/track/:token` (MARKETPLACE §7 and §9): live, signed out, Canadian copy. */
export default function TrackingPage() {
  const { token } = useParams();
  const tracking = useTracking(token);
  const now = useServerNow(10_000);
  const config = useConfig();
  const data = tracking.data;

  useEffect(() => {
    document.title = data
      ? `Track ${data.storeOrderNumber ?? data.orderId} · ${APP_NAME}`
      : `Track your delivery · ${APP_NAME}`;
  }, [data]);

  if (tracking.invalidToken || tracking.notFound) return <NotFound />;
  if (!data) {
    if (tracking.error && !tracking.connecting) {
      return (
        <Frame>
          <h1 className="mt-5 text-lg font-semibold text-slate-900">Couldn't load your delivery</h1>
          <p className="mt-1 text-sm text-slate-500">{describeError(tracking.error)}</p>
          <Button className="mt-4" onClick={tracking.retry}>
            Try again
          </Button>
        </Frame>
      );
    }
    return (
      <Frame>
        <div className="mt-6">
          <Spinner label={tracking.error ? 'Reconnecting' : 'Finding your delivery'} />
        </div>
        {tracking.error ? (
          <>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-sm text-slate-500">
              <OfflineIcon size={14} aria-hidden /> Check your connection; we keep trying.
            </p>
            <Button variant="secondary" className="mt-3" onClick={tracking.retry}>
              Try again now
            </Button>
          </>
        ) : null}
      </Frame>
    );
  }

  const eta = etaOf(data, now);
  const { title, subtitle } = headline(data, eta, now);
  const endArt = END_ART[data.phase] ?? null;
  const ended = endArt !== null;
  const storeLeg = ['finding_driver', 'driver_assigned', 'to_store', 'at_store'].includes(data.phase);
  const driverOnMap = data.driver?.location
    ? {
        location: data.driver.location,
        heading: data.driver.heading,
        firstName: data.driver.firstName,
        stale: eta.stale,
      }
    : null;
  const showCode = !!data.handoffCode && !ended;
  const live = data.phase === 'to_site' && !!driverOnMap && !eta.stale;
  const deliverBy =
    data.windowLabel ??
    (data.deliverBy ? `By ${formatClockET(data.deliverBy)}, ${formatDayET(data.deliverBy, now)}` : null);

  return (
    <div className="min-h-dvh bg-slate-100">
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col bg-white shadow-xl shadow-slate-900/5">
        <header className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <BrandMark className="size-8" />
            <span className="text-sm font-semibold text-slate-900">{APP_NAME}</span>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 font-mono text-xs font-semibold text-slate-700">
            {data.storeOrderNumber ?? data.orderId}
          </span>
        </header>

        {!ended ? (
          <div
            className="relative h-[42vh] min-h-64"
            role="img"
            aria-label={`Map: your site${storeLeg && data.pickup ? `, ${data.pickup.storeName}` : ''}${driverOnMap ? `, and ${data.driver?.firstName ?? 'the driver'}'s ${eta.stale ? 'last known' : 'live'} position` : ''}.`}
          >
            <TrackingMap
              destination={data.destination}
              store={
                storeLeg && data.pickup
                  ? { name: data.pickup.storeName, location: data.pickup.location }
                  : null
              }
              driver={driverOnMap}
            />
          </div>
        ) : null}

        <main
          className={cn(
            'relative z-[1000] flex-1 space-y-5 rounded-t-3xl bg-white px-5 pt-6 pb-8',
            !ended && '-mt-6',
          )}
        >
          <section className={cn(ended && 'pt-4 text-center')} aria-live="polite">
            {endArt ? <SceneArt artKey={endArt} className="mx-auto mb-4 h-32 w-44" /> : null}
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
            <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
            {live && data.distanceMeters != null ? (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
                <span className="relative flex size-2" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-brand-500" />
                </span>
                Live · {formatDistance(data.distanceMeters)} away
              </p>
            ) : null}
          </section>

          {showCode ? (
            <section
              className="flex items-center gap-4 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200"
              aria-label="Hand-off code"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
                <KeyIcon size={20} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-amber-900">Your hand-off code</p>
                <p className="text-xs text-amber-800">Give it to the driver only once the load is on site.</p>
              </div>
              <span
                className="font-mono text-2xl font-bold tracking-[0.25em] text-amber-900"
                aria-label={data.handoffCode!.split('').join(' ')}
              >
                {data.handoffCode}
              </span>
            </section>
          ) : null}

          {data.driver ? (
            <section className="flex items-center gap-3 rounded-2xl bg-slate-50 p-4">
              <span
                className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white"
                aria-hidden
              >
                {initials(data.driver.firstName)}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">
                  {data.driver.firstName} is delivering your order
                </p>
                {data.driver.vehicle ? (
                  <p className="truncate text-xs text-slate-500">{data.driver.vehicle}</p>
                ) : null}
              </div>
            </section>
          ) : null}

          {data.phase !== 'cancelled' && data.phase !== 'problem' ? (
            <section className="rounded-2xl p-1">
              <ProgressSteps tracking={data} />
            </section>
          ) : null}

          <section className="space-y-3 rounded-2xl border border-slate-200 p-4 text-sm">
            {data.pickup ? (
              <p className="flex gap-3">
                <StoreIcon size={18} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
                <span>
                  <span className="block text-xs font-medium tracking-wide text-slate-500 uppercase">
                    From
                  </span>
                  {data.pickup.storeName}
                </span>
              </p>
            ) : null}
            <p className="flex gap-3">
              <PinIcon size={18} className="mt-0.5 shrink-0 text-slate-400" aria-hidden />
              <span>
                <span className="block text-xs font-medium tracking-wide text-slate-500 uppercase">
                  Delivering to {data.customerFirstName}
                </span>
                {data.address}
              </span>
            </p>
            {deliverBy ? (
              <p className="flex gap-3">
                <WindowIcon size={18} className="mt-0.5 shrink-0 text-slate-400" aria-hidden />
                <span>
                  <span className="block text-xs font-medium tracking-wide text-slate-500 uppercase">
                    Delivery
                  </span>
                  {deliverBy}
                </span>
              </p>
            ) : null}
            {data.unloadNote ? (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-700">{data.unloadNote}</p>
            ) : null}
          </section>

          {config?.supportPhone ? (
            <a
              href={`tel:${config.supportPhone}`}
              className="flex items-center justify-center gap-2 text-sm font-medium text-brand-700"
            >
              <PhoneIcon size={16} aria-hidden /> Questions? Call InstaSupply at{' '}
              {formatPhone(config.supportPhone)}
            </a>
          ) : null}

          <p className="text-center text-xs text-slate-400">
            Updated {formatRelativeTime(data.updatedAt, now)} · This page refreshes by itself · Times are
            Toronto time
          </p>
        </main>
      </div>
    </div>
  );
}
