/**
 * One support chat (MARKETPLACE §1.3 supportThreads, D11): the messages, oldest first, and a composer.
 * Sending is optimistic (CLIENTS §1.12) with a client message id, so a retry is the same message.
 * The ops support page and the issue page (the store's response thread) both use it.
 */
import { useApiMutation, useLiveQuery } from '@instasupply/api-client/react';
import {
  formatDateTimeET,
  type SupportContext,
  type SupportMessage,
  type SupportSenderRole,
} from '@instasupply/shared';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/Button';
import { ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { TextArea } from '@/components/ui/Form';
import { SendIcon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/Toast';
import { useSignedInUser } from '@/features/auth/AuthProvider';
import { api, describeError, queries } from '@/lib/api';
import { cn } from '@/lib/cn';

const MAX_LENGTH = 2000;

const ROLE_LABEL: Record<SupportSenderRole, string> = {
  customer: 'Customer',
  supplier: 'Store',
  staff: 'InstaSupply',
};

/** Where a context chip leads. A store order id is `{orderId}-{letter}`, so it opens the parent order. */
export function contextHref(context: SupportContext): string {
  switch (context.kind) {
    case 'order':
      return `/orders/${encodeURIComponent(context.id)}`;
    case 'store_order':
      return `/orders/${encodeURIComponent(context.id.replace(/-[A-Z]$/, ''))}`;
    case 'quote':
      return `/quotes/${encodeURIComponent(context.id)}`;
    case 'issue':
      return `/issues/${encodeURIComponent(context.id)}`;
  }
}

function Bubble({ message, mine }: { message: SupportMessage; mine: boolean }) {
  return (
    <li className={cn('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap',
          message.senderRole === 'staff' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-900',
        )}
      >
        {message.text}
      </div>
      <p className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        <span>
          {message.senderName} · {ROLE_LABEL[message.senderRole]} · {formatDateTimeET(message.createdAt)}
        </span>
        {message.context ? (
          <Link
            to={contextHref(message.context)}
            className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700 hover:bg-slate-200"
          >
            {message.context.label}
          </Link>
        ) : null}
      </p>
    </li>
  );
}

export function SupportConversation({
  threadId,
  context = null,
  className,
  emptyText = 'No messages yet. Write the first one below.',
}: {
  threadId: string;
  /** Attached to the messages sent from here (an issue page sends `{ kind: 'issue', … }`). */
  context?: SupportContext | null;
  className?: string;
  emptyText?: string;
}) {
  const { user, displayName } = useSignedInUser();
  const toast = useToast();
  const messages = useLiveQuery(queries.supportMessages(threadId));
  const [text, setText] = useState('');
  const pendingId = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const send = useApiMutation(
    (client, input: { id: string; text: string }) =>
      client.support.send(threadId, { id: input.id, text: input.text, context }),
    {
      optimistic: (cache, input) => {
        const message: SupportMessage = {
          id: input.id,
          text: input.text,
          senderId: user.uid,
          senderName: displayName,
          senderRole: 'staff',
          context,
          createdAt: api.serverNow(),
        };
        cache.patch<SupportMessage[] | undefined>(['support-messages', threadId], (current) =>
          current ? [...current.filter((item) => item.id !== message.id), message] : [message],
        );
      },
    },
  );

  const count = messages.data.length;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' });
  }, [count]);

  const submit = async () => {
    const body = text.trim();
    if (!body || send.busy) return;
    // One id per message the user means to send, reused if they press Send again after a failure.
    pendingId.current ??= api.newRequestId();
    try {
      await send.run({ id: pendingId.current, text: body });
      pendingId.current = null;
      setText('');
    } catch (error) {
      toast.error("Couldn't send the message", describeError(error));
    }
  };

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" aria-live="polite">
        {messages.loading && count === 0 ? (
          <PageSpinner label="Loading messages" />
        ) : messages.error && count === 0 ? (
          <ErrorState error={messages.error} onRetry={messages.retry} />
        ) : count === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">{emptyText}</p>
        ) : (
          <ol className="space-y-3" aria-label="Messages">
            {messages.data.map((message) => (
              <Bubble key={message.id} message={message} mine={message.senderId === user.uid} />
            ))}
          </ol>
        )}
        <div ref={bottom} />
      </div>
      <form
        className="flex items-end gap-2 border-t border-slate-100 px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <TextArea
          aria-label="Message"
          value={text}
          maxLength={MAX_LENGTH}
          placeholder="Write a reply…"
          className="min-h-11 flex-1 resize-y"
          onChange={(event) => {
            setText(event.target.value);
            pendingId.current = null;
          }}
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
      </form>
    </div>
  );
}
