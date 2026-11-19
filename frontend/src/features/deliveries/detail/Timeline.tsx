import { formatDateTime, formatRelativeTime, STATUS_META, type DeliveryEvent } from '@instasupply/shared';

import { TONE_CLASSES } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import type { WithId } from '@/lib/firebase/hooks';

const toneOf = (event: DeliveryEvent) => {
  if (event.type === 'customer_notified') return 'info' as const;
  if (event.status) return STATUS_META[event.status].tone;
  return 'neutral' as const;
};

const ACTOR_LABEL = {
  admin: 'Dispatch',
  dispatcher: 'Dispatch',
  driver: 'Driver',
  system: 'System',
  customer: 'Customer',
};

export function Timeline({ events, now }: { events: WithId<DeliveryEvent>[]; now: number }) {
  if (events.length === 0) return <p className="text-sm text-slate-500">No activity yet.</p>;

  return (
    <ol className="relative space-y-4">
      {events.map((event, index) => (
        <li key={event.id} className="relative flex gap-3">
          {index < events.length - 1 ? (
            <span className="absolute top-4 bottom-[-1rem] left-[5px] w-px bg-slate-200" aria-hidden />
          ) : null}
          <span
            className={cn(
              'relative mt-1.5 size-[11px] shrink-0 rounded-full ring-4 ring-white',
              TONE_CLASSES[toneOf(event)].dot,
            )}
          />
          <div className="min-w-0">
            <p className="text-sm text-slate-800">{event.message}</p>
            <p className="mt-0.5 text-xs text-slate-500" title={formatDateTime(event.at)}>
              {event.actorName ?? ACTOR_LABEL[event.actorRole]} · {formatRelativeTime(event.at, now)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
