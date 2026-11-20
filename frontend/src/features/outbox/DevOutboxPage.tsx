import type { OutboxMessage } from '@instasupply/api-client';
import { useConfig, usePagedQuery } from '@instasupply/api-client/react';
import { formatDateTime, formatRelativeTime } from '@instasupply/shared';
import { Fragment } from 'react';

import { Badge, type Tone } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { LoadMore } from '@/components/ui/Data';
import { Callout, EmptyState, ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { DeviceIcon, InboxIcon, InfoIcon, MailIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/Layout';
import { queries } from '@/lib/api';
import { useNow } from '@/lib/data';

const PURPOSE: Record<OutboxMessage['purpose'], { label: string; tone: Tone }> = {
  otp: { label: 'OTP code', tone: 'warning' },
  tracking_link: { label: 'Tracking link', tone: 'brand' },
  store_alert: { label: 'Store alert', tone: 'info' },
  password_reset: { label: 'Password reset', tone: 'warning' },
  invite: { label: 'Invite', tone: 'brand' },
  other: { label: 'Other', tone: 'neutral' },
};

/** Turn URLs in a message into links. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return (
    <>
      {parts.map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noreferrer"
            className="font-medium break-all text-brand-600 hover:underline"
          >
            {part}
          </a>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

export default function DevOutboxPage() {
  const now = useNow();
  const config = useConfig();
  const outbox = usePagedQuery(queries.outbox());
  const production = config !== null && config.smsDriver !== 'outbox';

  return (
    <>
      <PageHeader
        title="Dev SMS outbox"
        description="Text messages and emails the server stored instead of sending. Used when no provider is configured."
      />
      {production ? (
        <Callout tone="warning" icon={InfoIcon} title="Production mode">
          SMS go out through the real provider; only messages without a provider appear here.
        </Callout>
      ) : null}
      <Card className="mt-4">
        {outbox.error && outbox.items.length === 0 ? (
          <ErrorState error={outbox.error} onRetry={outbox.retry} className="m-5" />
        ) : outbox.loading && outbox.items.length === 0 ? (
          <PageSpinner />
        ) : outbox.items.length === 0 ? (
          <EmptyState
            icon={InboxIcon}
            title="Nothing sent yet"
            description="OTP codes, store alerts, invites and customer tracking links will appear here."
          />
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {outbox.items.map((message) => {
                const purpose = PURPOSE[message.purpose] ?? PURPOSE.other;
                const Icon = message.channel === 'email' ? MailIcon : DeviceIcon;
                return (
                  <li key={message.id} className="flex gap-4 px-5 py-4">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500">
                      <Icon size={16} aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-medium text-slate-900">{message.to}</span>
                        <Badge tone={purpose.tone}>{purpose.label}</Badge>
                        <span className="sr-only">
                          {message.channel === 'email' ? 'Email' : 'Text message'}
                        </span>
                        {message.status === 'failed' ? (
                          <Badge tone="danger">Failed</Badge>
                        ) : message.provider !== 'outbox' ? (
                          <Badge tone="neutral">Sent by {message.provider}</Badge>
                        ) : null}
                        <span
                          className="text-xs text-slate-400"
                          title={formatDateTime(message.createdAt, now)}
                        >
                          {formatRelativeTime(message.createdAt, now)}
                        </span>
                      </div>
                      {message.subject ? (
                        <p className="mt-1 text-sm font-medium text-slate-800">{message.subject}</p>
                      ) : null}
                      <p className="mt-1 text-sm whitespace-pre-line text-slate-700">
                        {message.body === null ? (
                          <span className="text-slate-400 italic">
                            Delivered by the provider; content hidden.
                          </span>
                        ) : (
                          <Linkified text={message.body} />
                        )}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
            <LoadMore
              hasMore={outbox.hasMore}
              loadingMore={outbox.loadingMore}
              onLoadMore={outbox.loadMore}
            />
          </>
        )}
      </Card>
    </>
  );
}
