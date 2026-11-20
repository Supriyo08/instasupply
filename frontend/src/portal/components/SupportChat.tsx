import type { WithId } from '@instasupply/api-client';
import { useApi, useApiMutation, useConfig, useLiveQuery } from '@instasupply/api-client/react';
import {
  MAX_CHAT_MESSAGE_LENGTH,
  SUPPORT_HOURS,
  formatClockTime,
  supportThreadId,
  formatDateTimeET,
  formatPhone,
  type SupportContext,
  type SupportMessage,
  type SupportThread,
} from '@instasupply/shared';
import { useEffect, useRef, useState } from 'react';

import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useServerNow } from '@/components/ui/Countdown';
import { Callout, ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { TextArea } from '@/components/ui/Form';
import { CloseIcon, ErrorIcon, SendIcon } from '@/components/ui/icons';
import { describeError, queries } from '@/lib/api';
import { cn } from '@/lib/cn';

import { SceneEmpty } from './SceneArt';

/** "Mon–Fri 7:00 am–6:00 pm, Sat 8:00 am–2:00 pm", from the support hours in shared. */
function supportHoursText(): string {
  const weekday = SUPPORT_HOURS.mon;
  const saturday = SUPPORT_HOURS.sat;
  const parts: string[] = [];
  if (weekday) parts.push(`Mon–Fri ${formatClockTime(weekday.open)}–${formatClockTime(weekday.close)}`);
  if (saturday) parts.push(`Sat ${formatClockTime(saturday.open)}–${formatClockTime(saturday.close)}`);
  return parts.join(', ');
}

interface Sender {
  uid: string;
  name: string;
}

/**
 * The store's chat with InstaSupply (`supportThreads/store_{storeId}`, MARKETPLACE §8): every member of
 * the store shares it. Sends are optimistic (CLIENTS §1.12) and retry-safe: a message keeps its client
 * id until the server confirmed it, so "Try again" after a lost answer never posts it twice.
 */
export function SupportChat({
  storeId,
  sender,
  context,
  onClearContext,
}: {
  storeId: string;
  sender: Sender;
  context: SupportContext | null;
  onClearContext: () => void;
}) {
  const client = useApi();
  const config = useConfig();
  const threadId = supportThreadId('store', storeId);
  const threadQuery = queries.supportThread(threadId);
  const messagesQuery = queries.supportMessages(threadId);
  const thread = useLiveQuery(threadQuery);
  const messages = useLiveQuery(messagesQuery);
  const now = useServerNow(60_000);
  const [text, setText] = useState('');
  const [messageId, setMessageId] = useState(() => client.newRequestId());
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  const send = useApiMutation(
    (api, input: { id: string; text: string; context: SupportContext | null }) =>
      api.support.send(threadId, input),
    {
      optimistic: (cache, input) =>
        cache.patch<SupportMessage[]>(messagesQuery.key, (list) =>
          list.some((message) => message.id === input.id)
            ? list
            : [
                ...list,
                {
                  id: input.id,
                  text: input.text,
                  senderId: sender.uid,
                  senderName: sender.name,
                  senderRole: 'supplier',
                  context: input.context,
                  createdAt: client.serverNow(),
                },
              ],
        ),
    },
  );

  const markRead = useApiMutation((api) => api.support.markRead(threadId), {
    optimistic: (cache) =>
      cache.patch<WithId<SupportThread> | null>(threadQuery.key, (current) =>
        current ? { ...current, unreadByOwner: 0 } : current,
      ),
  });

  // Mark the thread read while the page is visible and InstaSupply has written something new.
  const unread = thread.data?.unreadByOwner ?? 0;
  const runMarkRead = markRead.run;
  useEffect(() => {
    if (unread === 0) return;
    const mark = () => {
      if (document.visibilityState === 'visible') void runMarkRead(undefined).catch(() => undefined);
    };
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [runMarkRead, unread]);

  // Keep the newest message in view.
  const count = messages.data.length;
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [count]);

  const submit = async () => {
    const body = text.trim();
    if (!body || send.busy) return;
    setError(null);
    try {
      await send.run({ id: messageId, text: body, context });
      setText('');
      setMessageId(client.newRequestId());
      onClearContext();
    } catch (caught) {
      setError(`Not sent: ${describeError(caught)} Your message is still here; press Send to try again.`);
    }
  };

  const supportPhone = config?.supportPhone ? formatPhone(config.supportPhone) : null;

  return (
    <Card className="flex h-[min(70vh,44rem)] flex-col overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-3 text-xs text-slate-500">
        InstaSupply ops reply here {supportHoursText()}.
        {supportPhone ? ` Urgent, with a driver at your counter? Call ${supportPhone}.` : ''}
      </div>
      {messages.loading && count === 0 ? (
        <PageSpinner label="Loading messages" />
      ) : messages.error && count === 0 ? (
        <div className="p-5">
          <ErrorState error={messages.error} onRetry={messages.retry} />
        </div>
      ) : count === 0 ? (
        <div className="flex-1 overflow-y-auto">
          <SceneEmpty
            artKey="scene-support"
            title="Ask InstaSupply anything"
            description="Stock questions, a customer who needs a call back, a driver who hasn't shown up: your whole team sees this chat."
          />
        </div>
      ) : (
        <ol
          ref={listRef}
          className="flex-1 space-y-3 overflow-y-auto px-5 py-4"
          aria-label="Messages"
          aria-live="polite"
        >
          {messages.data.map((message) => {
            const mine = message.senderRole === 'supplier';
            return (
              <li key={message.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm',
                    mine ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-900',
                  )}
                >
                  {message.context ? (
                    <p
                      className={cn(
                        'mb-1 text-[11px] font-semibold',
                        mine ? 'text-brand-100' : 'text-slate-500',
                      )}
                    >
                      About {message.context.label}
                    </p>
                  ) : null}
                  <p className="break-words whitespace-pre-wrap">{message.text}</p>
                  <p className={cn('mt-1 text-[11px]', mine ? 'text-brand-100' : 'text-slate-500')}>
                    {mine ? message.senderName : `${message.senderName} · InstaSupply`} ·{' '}
                    {formatDateTimeET(message.createdAt, now)}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <form
        className="space-y-2 border-t border-slate-100 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {context ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
              About {context.label}
            </span>
            <IconButton
              icon={CloseIcon}
              size="sm"
              label="Remove the order from this message"
              onClick={onClearContext}
            />
          </div>
        ) : null}
        {error ? (
          <Callout tone="danger" icon={ErrorIcon}>
            {error}
          </Callout>
        ) : null}
        <div className="flex items-end gap-2">
          <TextArea
            aria-label="Message to InstaSupply"
            placeholder="Write a message"
            className="min-h-11 flex-1 resize-none"
            rows={2}
            maxLength={MAX_CHAT_MESSAGE_LENGTH}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <Button type="submit" icon={SendIcon} loading={send.busy} disabled={!text.trim()}>
            Send
          </Button>
        </div>
      </form>
    </Card>
  );
}
