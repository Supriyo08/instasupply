import { COLLECTIONS, formatDateTime, formatRelativeTime, type DevOutboxMessage } from '@instasupply/shared';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { Fragment, useMemo } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Callout, EmptyState, ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { DeviceIcon, InboxIcon, InfoIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/Layout';
import { useNow } from '@/lib/data';
import { env } from '@/lib/env';
import { db } from '@/lib/firebase/app';
import { useCollection } from '@/lib/firebase/hooks';

const PURPOSE = {
  otp: { label: 'OTP code', tone: 'warning' },
  tracking_link: { label: 'Tracking link', tone: 'brand' },
  other: { label: 'Other', tone: 'neutral' },
} as const;

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
  const q = useMemo(
    () => query(collection(db, COLLECTIONS.devOutbox), orderBy('createdAt', 'desc'), limit(100)),
    [],
  );
  const outbox = useCollection<DevOutboxMessage>(q);

  return (
    <>
      <PageHeader
        title="Dev SMS outbox"
        description="Text messages the backend would have sent. Only used when no SMS provider is configured."
      />
      {!env.useEmulators ? (
        <Callout tone="warning" icon={InfoIcon} title="Production mode">
          The outbox only fills up in local development or when Twilio isn't configured.
        </Callout>
      ) : null}
      <Card className="mt-4">
        {outbox.error ? (
          <ErrorState error={outbox.error} className="m-5" />
        ) : outbox.loading && outbox.data.length === 0 ? (
          <PageSpinner />
        ) : outbox.data.length === 0 ? (
          <EmptyState
            icon={InboxIcon}
            title="Nothing sent yet"
            description="OTP codes and customer tracking links will appear here."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {outbox.data.map((message) => {
              const purpose = PURPOSE[message.purpose] ?? PURPOSE.other;
              return (
                <li key={message.id} className="flex gap-4 px-5 py-4">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500">
                    <DeviceIcon size={16} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-medium text-slate-900">{message.to}</span>
                      <Badge tone={purpose.tone}>{purpose.label}</Badge>
                      <span className="text-xs text-slate-400" title={formatDateTime(message.createdAt)}>
                        {formatRelativeTime(message.createdAt, now)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-700">
                      <Linkified text={message.body} />
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
