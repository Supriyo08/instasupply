import { formatRelativeTime } from '@instasupply/shared';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';

import { Avatar } from '@/components/ui/Avatar';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { BackIcon, MessagesIcon, SearchIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { indexById, presenceOf, useDriverLocations, useDrivers, useNow, useThreads } from '@/lib/data';

import { Conversation } from './Conversation';

export default function MessagesPage() {
  const { driverId } = useParams();
  const now = useNow();
  const threads = useThreads();
  const drivers = useDrivers();
  const locations = useDriverLocations();
  const [search, setSearch] = useState('');

  const driverById = useMemo(() => indexById(drivers.data), [drivers.data]);
  const locationById = useMemo(() => indexById(locations.data), [locations.data]);

  // Threads first (most recent activity), then approved drivers you haven't talked to yet.
  const entries = useMemo(() => {
    const withThread = new Set(threads.data.map((thread) => thread.id));
    const list = [
      ...threads.data.map((thread) => ({ id: thread.id, name: thread.driverName, thread })),
      ...drivers.data
        .filter((driver) => driver.status === 'active' && !withThread.has(driver.id))
        .map((driver) => ({ id: driver.id, name: driver.displayName, thread: null })),
    ];
    const term = search.trim().toLowerCase();
    return term ? list.filter((entry) => entry.name.toLowerCase().includes(term)) : list;
  }, [drivers.data, search, threads.data]);

  const selectedDriver = driverId ? (driverById.get(driverId) ?? null) : null;

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-4rem)] sm:-mx-6 lg:-mx-8">
      <aside
        className={cn(
          'flex w-full flex-col border-r border-slate-200 bg-white md:w-80',
          driverId ? 'hidden md:flex' : 'flex',
        )}
      >
        <div className="space-y-3 border-b border-slate-100 p-4">
          <h1 className="text-base font-semibold text-slate-900">Messages</h1>
          <div className="relative">
            <SearchIcon
              size={15}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              aria-label="Search conversations"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search drivers"
              className="h-9 w-full rounded-lg border-0 bg-slate-100 pr-3 pl-9 text-sm placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-brand-500 focus:outline-none"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {threads.loading && entries.length === 0 ? (
            <div className="p-6">
              <Spinner label="Loading conversations" />
            </div>
          ) : entries.length === 0 ? (
            <EmptyState icon={MessagesIcon} title="No conversations" className="py-10" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {entries.map(({ id, name, thread }) => {
                const unread = thread?.unreadByStaff ?? 0;
                return (
                  <li key={id}>
                    <Link
                      to={`/messages/${id}`}
                      className={cn(
                        'flex items-start gap-3 px-4 py-3 transition-colors',
                        id === driverId ? 'bg-brand-50' : 'hover:bg-slate-50',
                      )}
                    >
                      <Avatar name={name} presence={presenceOf(locationById.get(id), now)} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span
                            className={cn(
                              'truncate text-sm',
                              unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-800',
                            )}
                          >
                            {name}
                          </span>
                          {thread?.lastMessage ? (
                            <span className="shrink-0 text-[11px] text-slate-400">
                              {formatRelativeTime(thread.lastMessage.at, now)}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 flex items-center justify-between gap-2">
                          <span
                            className={cn('truncate text-xs', unread ? 'text-slate-700' : 'text-slate-500')}
                          >
                            {thread?.lastMessage
                              ? `${thread.lastMessage.senderRole === 'staff' ? 'You: ' : ''}${thread.lastMessage.text}`
                              : 'No messages yet'}
                          </span>
                          {unread ? (
                            <span className="grid min-w-5 shrink-0 place-items-center rounded-full bg-brand-600 px-1.5 text-[10px] leading-5 font-semibold text-white">
                              {unread}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      <section className={cn('min-w-0 flex-1 flex-col', driverId ? 'flex' : 'hidden md:flex')}>
        {driverId && selectedDriver ? (
          <>
            <Link
              to="/messages"
              className="flex items-center gap-1 border-b border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-500 md:hidden"
            >
              <BackIcon size={14} aria-hidden /> All conversations
            </Link>
            <Conversation key={selectedDriver.id} driver={selectedDriver} />
          </>
        ) : driverId && drivers.loading ? (
          <div className="p-6">
            <Spinner label="Loading conversation" />
          </div>
        ) : (
          <EmptyState
            icon={MessagesIcon}
            title={driverId ? 'Driver not found' : 'Select a conversation'}
            description="Chat with drivers in real time. They're notified on their phone."
            className="flex-1"
          />
        )}
      </section>
    </div>
  );
}
