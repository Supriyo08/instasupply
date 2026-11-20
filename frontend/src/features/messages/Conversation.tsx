import { formatClock, formatDayET, localDateOf, type ChatMessage } from '@instasupply/shared';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { MessagesIcon, PackageIcon, SendIcon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import type { DriverRecord } from '@/lib/data';
import { errorMessage } from '@/lib/api';
import type { WithId } from '@/lib/data';

import { markThreadRead, newMessageId, sendStaffMessage, useMessages, useThread } from './hooks';

function DayDivider({ millis }: { millis: number }) {
  return (
    <div className="my-3 flex items-center gap-3 text-[11px] font-medium text-slate-400" role="separator">
      <span className="h-px flex-1 bg-slate-200" />
      {formatDayET(millis, Date.now())}
      <span className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

function Bubble({ message, mine }: { message: WithId<ChatMessage>; mine: boolean }) {
  return (
    <div className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm',
          mine
            ? 'rounded-br-md bg-brand-600 text-white'
            : 'rounded-bl-md bg-white text-slate-800 ring-1 ring-slate-200',
        )}
      >
        {!mine ? (
          <p className="mb-0.5 text-[11px] font-semibold text-brand-700">{message.senderName}</p>
        ) : null}
        <p className="break-words whitespace-pre-wrap">{message.text}</p>
        <p
          className={cn(
            'mt-1 flex items-center gap-2 text-[10px]',
            mine ? 'text-brand-100' : 'text-slate-400',
          )}
        >
          {message.senderRole === 'staff' && mine ? `${message.senderName} · ` : ''}
          <time dateTime={new Date(message.createdAt).toISOString()}>{formatClock(message.createdAt)}</time>
          {message.deliveryId ? (
            <Link
              to={`/deliveries/${message.deliveryId}`}
              className={cn(
                'inline-flex items-center gap-1 underline-offset-2 hover:underline',
                mine ? 'text-white' : 'text-brand-600',
              )}
            >
              <PackageIcon size={10} aria-hidden /> delivery
            </Link>
          ) : null}
        </p>
      </div>
    </div>
  );
}

export function Conversation({ driver }: { driver: DriverRecord }) {
  const toast = useToast();
  const thread = useThread(driver.id);
  const messages = useMessages(driver.id);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // One id per message written: a retry after a lost answer sends the same id, so it is stored once.
  const messageId = useRef(newMessageId());
  const endRef = useRef<HTMLDivElement>(null);

  // Reset our unread counter whenever new driver messages arrive while the thread is open.
  const unread = thread.data?.unreadByStaff ?? 0;
  useEffect(() => {
    if (thread.data && unread > 0) void markThreadRead(driver.id).catch(() => undefined);
  }, [driver.id, thread.data, unread]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.data.length]);

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    setFailed(null);
    try {
      await sendStaffMessage({ id: messageId.current, driverId: driver.id, text });
      setText('');
      messageId.current = newMessageId();
    } catch (error) {
      setFailed(errorMessage(error));
      toast.error('Message not sent', 'Press Send again: it is sent only once.');
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  let lastDay: string | null = null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <Avatar name={driver.displayName} />
        <div className="min-w-0 flex-1">
          <Link
            to={`/drivers/${driver.id}`}
            className="block truncate text-sm font-semibold text-slate-900 hover:text-brand-700"
          >
            {driver.displayName}
          </Link>
          <p className="truncate text-xs text-slate-500">{driver.phoneNumber ?? driver.email}</p>
        </div>
      </div>

      <div
        className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-slate-50 px-5 py-4"
        role="log"
        aria-live="polite"
        aria-label={`Messages with ${driver.displayName}`}
      >
        {messages.error && messages.data.length === 0 ? (
          <ErrorState error={messages.error} onRetry={messages.retry} />
        ) : messages.loading && messages.data.length === 0 ? (
          <PageSpinner label="Loading messages" />
        ) : messages.data.length === 0 ? (
          <EmptyState
            icon={MessagesIcon}
            title={`Start a conversation with ${driver.displayName.split(' ')[0]}`}
            description="They get a notification on their phone in the InstaSupply Driver app."
          />
        ) : (
          messages.data.map((message) => {
            const millis = message.createdAt;
            const day = localDateOf(millis);
            const divider = day !== lastDay ? <DayDivider millis={millis} /> : null;
            lastDay = day;
            return (
              <div key={message.id}>
                {divider}
                <Bubble message={message} mine={message.senderRole === 'staff'} />
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {failed ? (
        <p className="border-t border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700" role="alert">
          Not sent: {failed}
        </p>
      ) : null}
      <form
        className="flex items-end gap-2 border-t border-slate-200 bg-white p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label={`Message ${driver.displayName}`}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (failed) {
              // Different text is a new message; the same text sent again keeps its id.
              setFailed(null);
              messageId.current = newMessageId();
            }
          }}
          onKeyDown={onKeyDown}
          rows={1}
          maxLength={1000}
          placeholder={`Message ${driver.displayName.split(' ')[0]}…`}
          title="Enter to send · Shift+Enter for a new line"
          className="max-h-32 min-h-9 flex-1 resize-none rounded-xl border-0 bg-slate-100 px-3.5 py-2 text-sm placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-brand-500 focus:outline-none"
        />
        <Button type="submit" icon={SendIcon} loading={sending} disabled={!text.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
