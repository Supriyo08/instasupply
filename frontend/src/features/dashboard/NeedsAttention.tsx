import { formatRelativeTime, pluralize } from '@instasupply/shared';
import { Link } from 'react-router';

import { Avatar } from '@/components/ui/Avatar';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/Feedback';
import {
  ChevronRightIcon,
  FailedIcon,
  SparklesIcon,
  UrgentIcon,
  WarningIcon,
  type IconComponent,
} from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { presenceOf, type DeliveryRecord, type DriverRecord } from '@/lib/data';

import type { DriverRow } from '../live-map/DriverList';

interface Item {
  key: string;
  to: string;
  icon?: IconComponent;
  avatar?: string;
  tone: 'danger' | 'warning' | 'info';
  title: string;
  detail: string;
}

const TONE = {
  danger: 'bg-rose-50 text-rose-600',
  warning: 'bg-amber-50 text-amber-600',
  info: 'bg-brand-50 text-brand-600',
};

export function buildAttentionItems(input: {
  open: DeliveryRecord[];
  failedToday: DeliveryRecord[];
  pendingDrivers: DriverRecord[];
  fleet: DriverRow[];
  now: number;
}): Item[] {
  const items: Item[] = [];
  for (const delivery of input.failedToday.slice(0, 3)) {
    items.push({
      key: `failed-${delivery.id}`,
      to: `/deliveries/${delivery.id}`,
      icon: FailedIcon,
      tone: 'danger',
      title: `${delivery.orderId} failed`,
      detail: `${delivery.customer.name} · reassign to retry`,
    });
  }
  for (const delivery of input.open
    .filter((item) => item.status === 'unassigned' && item.declinedBy?.length)
    .slice(0, 3)) {
    items.push({
      key: `declined-${delivery.id}`,
      to: `/deliveries/${delivery.id}`,
      icon: WarningIcon,
      tone: 'warning',
      title: `${delivery.orderId} was declined`,
      detail: `Declined ${delivery.declinedBy!.length}× · needs a new driver`,
    });
  }
  const urgent = input.open.filter(
    (item) => item.priority === 'urgent' && ['unassigned', 'assigned'].includes(item.status),
  );
  for (const delivery of urgent.slice(0, 3)) {
    items.push({
      key: `urgent-${delivery.id}`,
      to: `/deliveries/${delivery.id}`,
      icon: UrgentIcon,
      tone: 'danger',
      title: `Urgent ${delivery.orderId} not started`,
      detail: delivery.driverName ? `Waiting for ${delivery.driverName} to accept` : 'No driver assigned',
    });
  }
  for (const row of input.fleet) {
    const live = row.active.some((delivery) =>
      ['picked_up', 'in_transit', 'arrived'].includes(delivery.status),
    );
    if (live && presenceOf(row.location, input.now) !== 'online') {
      items.push({
        key: `stale-${row.driver.id}`,
        to: `/drivers/${row.driver.id}`,
        avatar: row.driver.displayName,
        tone: 'warning',
        title: `${row.driver.displayName} lost signal`,
        detail: `Carrying ${pluralize(row.active.length, 'stop')} · last seen ${formatRelativeTime(row.location?.updatedAt, input.now)}`,
      });
    }
  }
  for (const driver of input.pendingDrivers.slice(0, 3)) {
    items.push({
      key: `pending-${driver.id}`,
      to: `/drivers/${driver.id}`,
      avatar: driver.displayName,
      tone: 'info',
      title: `${driver.displayName} is waiting for approval`,
      detail: driver.vehicle ? `${driver.vehicle.type} · ${driver.vehicle.plate}` : 'New driver sign-up',
    });
  }
  const unassigned = input.open.filter((item) => item.status === 'unassigned').length;
  if (unassigned > 0) {
    items.push({
      key: 'unassigned',
      to: '/deliveries?tab=unassigned',
      icon: WarningIcon,
      tone: 'warning',
      title: `${unassigned} deliver${unassigned === 1 ? 'y' : 'ies'} unassigned`,
      detail: 'Assign them to available drivers',
    });
  }
  return items;
}

export function NeedsAttention({ items }: { items: Item[] }) {
  return (
    <Card className="flex flex-col">
      <CardHeader title="Needs attention" description="Exceptions that need a dispatcher." />
      {items.length === 0 ? (
        <EmptyState
          icon={SparklesIcon}
          title="All clear"
          description="No exceptions right now."
          className="flex-1 py-10"
        />
      ) : (
        <ul className="divide-y divide-slate-100 overflow-y-auto">
          {items.map((item) => (
            <li key={item.key}>
              <Link to={item.to} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                {item.avatar ? (
                  <Avatar name={item.avatar} size="sm" />
                ) : item.icon ? (
                  <span className={cn('grid size-7 shrink-0 place-items-center rounded-lg', TONE[item.tone])}>
                    <item.icon size={15} aria-hidden />
                  </span>
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">{item.title}</span>
                  <span className="block truncate text-xs text-slate-500">{item.detail}</span>
                </span>
                <ChevronRightIcon size={16} className="shrink-0 text-slate-300" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
