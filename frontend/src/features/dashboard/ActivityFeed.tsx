import { formatRelativeTime, STATUS_META, type DeliveryEvent } from '@instasupply/shared';
import { Link } from 'react-router';

import { TONE_CLASSES } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { ActivityIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import type { CollectionState } from '@/lib/firebase/hooks';

export function ActivityFeed({ activity, now }: { activity: CollectionState<DeliveryEvent>; now: number }) {
  return (
    <Card>
      <CardHeader title="Live activity" description="Latest changes across all deliveries." />
      {activity.error ? (
        <ErrorState error={activity.error} className="m-5" />
      ) : activity.loading && activity.data.length === 0 ? (
        <div className="space-y-3 p-5">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-9 w-full" />
          ))}
        </div>
      ) : activity.data.length === 0 ? (
        <EmptyState icon={ActivityIcon} title="No activity yet" className="py-10" />
      ) : (
        <ul className="divide-y divide-slate-100">
          {activity.data.map((event) => {
            const tone = event.status
              ? STATUS_META[event.status].tone
              : event.type === 'customer_notified'
                ? 'info'
                : 'neutral';
            return (
              <li key={`${event.deliveryId}-${event.id}`}>
                <Link
                  to={`/deliveries/${event.deliveryId}`}
                  className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50"
                >
                  <span
                    className={cn('mt-1.5 size-2 shrink-0 rounded-full', TONE_CLASSES[tone].dot)}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-slate-800">
                      <span className="font-mono text-xs font-semibold text-slate-900">{event.orderId}</span>{' '}
                      {event.message}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {event.actorName ?? 'System'} · {formatRelativeTime(event.at, now)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
