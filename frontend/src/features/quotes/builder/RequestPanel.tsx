/**
 * What the customer asked for (MARKETPLACE §9 quote builder, left side): the lines, attachment
 * previews and links, needed-by, the contact preference with `tel:` and `wa.me` links, the jobsite
 * map and the notes. Each line shows whether the draft answers it, and opens the listing search.
 */
import { useFileUrl } from '@instasupply/api-client/react';
import { formatPhone, type Quote, type Store, type WithId } from '@instasupply/shared';

import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/Card';
import { MailIcon, MessageIcon, PhoneIcon, QuoteIcon, SearchIcon } from '@/components/ui/icons';
import { AppMap } from '@/components/map/AppMap';
import { fitKeyFor, type MapMarker } from '@/components/map/map-types';
import { SignedImage } from '@/features/files/SignedImage';
import { cn } from '@/lib/cn';

import { neededByLabel, whatsappHref } from '../quote-format';
import type { BuilderDraft } from './draft';

function AttachmentLink({ path, name }: { path: string; name: string }) {
  const file = useFileUrl(path);
  return file.url ? (
    <a
      href={file.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-sm text-brand-700 hover:underline"
    >
      <QuoteIcon size={14} aria-hidden /> {name}
    </a>
  ) : (
    <button
      type="button"
      onClick={file.retry}
      className="inline-flex items-center gap-1.5 text-sm text-slate-500"
    >
      <QuoteIcon size={14} aria-hidden /> {name} {file.loading ? '(loading…)' : '(try again)'}
    </button>
  );
}

export function RequestPanel({
  quote,
  draft,
  stores,
  activeLine,
  onFind,
}: {
  quote: Quote;
  draft: BuilderDraft | null;
  stores: ReadonlyMap<string, WithId<Store>>;
  activeLine: number | null;
  onFind: (requestLine: number) => void;
}) {
  const { request } = quote;
  const contact = request.contact;
  const site = request.jobsite;
  const storeIds = [...new Set(draft?.lines.map((line) => line.storeId) ?? [])];
  const markers: MapMarker[] = [
    ...(site ? [{ id: 'site', kind: 'site' as const, position: site.location, title: site.label }] : []),
    ...storeIds.flatMap((storeId) => {
      const store = stores.get(storeId);
      return store
        ? [{ id: storeId, kind: 'store' as const, position: store.location, title: store.name }]
        : [];
    }),
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Material list"
          description={`${neededByLabel(request.neededBy)} · ${request.fulfilment === 'pickup' ? 'Pickup' : 'Delivery'}`}
        />
        <CardBody>
          {request.lines.length === 0 ? (
            <p className="text-sm text-slate-500">No typed lines: see the attached files.</p>
          ) : (
            <ol className="space-y-2">
              {request.lines.map((line, index) => {
                const answered = draft?.lines.filter((item) => item.requestLine === index).length ?? 0;
                const unmatched = draft?.unmatched.some((item) => item.requestLine === index) ?? false;
                return (
                  <li
                    key={index}
                    className={cn(
                      'flex items-start gap-3 rounded-xl p-2.5 ring-1',
                      activeLine === index ? 'bg-brand-50/60 ring-brand-300' : 'ring-slate-200',
                    )}
                  >
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-900">
                        {line.quantity != null ? (
                          <span className="font-semibold">{line.quantity} × </span>
                        ) : null}
                        {line.text}
                      </p>
                      <p className="mt-1">
                        {answered > 0 ? (
                          <Badge tone="success">{answered === 1 ? 'Matched' : `${answered} lines`}</Badge>
                        ) : unmatched ? (
                          <Badge tone="neutral">Unmatched</Badge>
                        ) : (
                          <Badge tone="warning">To source</Badge>
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onFind(index)}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand-600 hover:bg-brand-50"
                      aria-label={`Find listings for line ${index + 1}: ${line.text}`}
                    >
                      <SearchIcon size={14} aria-hidden /> Find
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {request.attachments.length > 0 ? (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Attachments</p>
              <ul className="grid grid-cols-2 gap-3">
                {request.attachments.map((file) => (
                  <li key={file.path}>
                    {file.contentType.startsWith('image/') ? (
                      <SignedImage
                        path={file.path}
                        alt={file.name}
                        className="aspect-[4/3] w-full rounded-lg object-cover"
                      />
                    ) : (
                      <AttachmentLink path={file.path} name={file.name} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {request.notes ? (
            <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm whitespace-pre-wrap text-amber-900">
              {request.notes}
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Customer" />
        <CardBody>
          <dl className="divide-y divide-slate-100">
            <DetailRow label="Name">
              {quote.companyName ? `${quote.customerName} · ${quote.companyName}` : quote.customerName}
            </DetailRow>
            <DetailRow label="Prefers">
              {contact.preferred === 'whatsapp'
                ? 'WhatsApp'
                : contact.preferred === 'email'
                  ? 'Email'
                  : 'A call'}
            </DetailRow>
            {contact.phone ? (
              <DetailRow label="Phone">
                <span className="flex flex-wrap justify-end gap-3">
                  <a
                    href={`tel:${contact.phone}`}
                    className="inline-flex items-center gap-1 text-brand-700 hover:underline"
                  >
                    <PhoneIcon size={14} aria-hidden /> {formatPhone(contact.phone)}
                  </a>
                  <a
                    href={whatsappHref(contact.phone)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-emerald-700 hover:underline"
                  >
                    <MessageIcon size={14} aria-hidden /> WhatsApp
                  </a>
                </span>
              </DetailRow>
            ) : null}
            {contact.email ? (
              <DetailRow label="Email">
                <a
                  href={`mailto:${contact.email}`}
                  className="inline-flex items-center gap-1 text-brand-700 hover:underline"
                >
                  <MailIcon size={14} aria-hidden /> {contact.email}
                </a>
              </DetailRow>
            ) : null}
            {site ? (
              <DetailRow label="Jobsite">
                {site.label}
                <span className="block text-xs font-normal text-slate-500">{site.addressLine}</span>
                <span className="block text-xs font-normal text-slate-500">{site.areaLabel}</span>
              </DetailRow>
            ) : null}
          </dl>
          {site ? (
            <AppMap
              className="mt-3 h-56"
              accessibilityLabel={`Jobsite ${site.label} and ${storeIds.length} stores on the quote`}
              markers={markers}
              fit={{
                key: fitKeyFor(markers.map((marker) => marker.position)),
                points: markers.map((m) => m.position),
                maxZoom: 14,
              }}
            />
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
