import { formatRelativeTime, type AppNotification } from '@instasupply/shared';
import { useNavigate } from 'react-router';

import { Popover } from '@/components/ui/Popover';
import { BellIcon, InboxIcon } from '@/components/ui/icons';
import { EmptyState } from '@/components/ui/Feedback';
import { cn } from '@/lib/cn';
import { useNow } from '@/lib/data';
import { notificationHref, type LinkAudience } from './notification-links';

interface NotificationBellProps {
  notifications: readonly AppNotification[];
  /** Which link table of CLIENTS §6.4 applies. */
  audience: LinkAudience;
  unreadCount: number;
  onMarkRead: (id: string) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  desktopAlerts: NotificationPermission | 'unsupported';
  onEnableDesktopAlerts: () => void;
}

export function NotificationBell({
  notifications,
  audience,
  unreadCount,
  onMarkRead,
  onMarkAllRead,
  desktopAlerts,
  onEnableDesktopAlerts,
}: NotificationBellProps) {
  const navigate = useNavigate();
  const now = useNow(60_000);

  return (
    <Popover
      className="w-[min(24rem,calc(100vw-2rem))]"
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
          aria-expanded={open}
          className="relative grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <BellIcon size={18} aria-hidden />
          {unreadCount > 0 ? (
            <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] leading-4 font-semibold text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          ) : null}
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={() => void onMarkAllRead()}
                className="text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                Mark all as read
              </button>
            ) : null}
          </div>
          {notifications.length === 0 ? (
            <EmptyState icon={InboxIcon} title="You're all caught up" className="py-8" />
          ) : (
            <ul className="max-h-96 overflow-y-auto py-1">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!notification.read) void onMarkRead(notification.id);
                      const link = notificationHref(notification, audience);
                      if (link) navigate(link);
                      close();
                    }}
                    className="flex w-full gap-3 px-4 py-2.5 text-left hover:bg-slate-50"
                  >
                    <span
                      className={cn(
                        'mt-1.5 size-2 shrink-0 rounded-full',
                        notification.read ? 'bg-transparent' : 'bg-brand-500',
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block text-sm',
                          notification.read ? 'text-slate-600' : 'font-semibold text-slate-900',
                        )}
                      >
                        {notification.title}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">
                        {notification.body}
                      </span>
                      <span className="mt-1 block text-[11px] text-slate-400">
                        {formatRelativeTime(notification.createdAt, now)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {desktopAlerts === 'default' ? (
            <div className="border-t border-slate-100 px-4 py-3">
              <button
                type="button"
                onClick={onEnableDesktopAlerts}
                className="text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                Enable desktop alerts for this browser
              </button>
            </div>
          ) : null}
        </div>
      )}
    </Popover>
  );
}
