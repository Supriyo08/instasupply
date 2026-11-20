/**
 * `/suggestions` (MARKETPLACE §9, CLIENTS §4.5): stores that customers asked for in the app or on the
 * website, with their status. Changing the status is optimistic (the server confirms it); "Create
 * store" opens the new store wizard pre-filled with the name and city.
 */
import { useApiMutation, useLiveQuery } from '@instasupply/api-client/react';
import { formatRelativeTime, type StoreSuggestion, type WithId } from '@instasupply/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { Badge, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { Segmented, Select } from '@/components/ui/Form';
import { MailIcon, PlusIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/Layout';
import { useToast } from '@/components/ui/Toast';
import { ArtEmptyState } from '@/features/orders/components/ItemThumb';
import { describeError, queries } from '@/lib/api';
import { useNow } from '@/lib/data';

type Status = StoreSuggestion['status'];
type Filter = 'all' | Status;

const STATUS_META: Record<Status, { label: string; tone: Tone }> = {
  new: { label: 'New', tone: 'warning' },
  contacted: { label: 'Contacted', tone: 'info' },
  onboarding: { label: 'Onboarding', tone: 'brand' },
  dismissed: { label: 'Dismissed', tone: 'neutral' },
};
const STATUSES = Object.keys(STATUS_META) as Status[];

function SuggestionRow({ suggestion, now }: { suggestion: WithId<StoreSuggestion>; now: number }) {
  const navigate = useNavigate();
  const toast = useToast();
  const setStatus = useApiMutation(
    (api, status: Status) => api.suggestions.setStatus(suggestion.id, status),
    {
      optimistic: (cache, status) => {
        for (const key of [
          ['suggestions', null],
          ['suggestions', suggestion.status],
        ] as const) {
          cache.patch<WithId<StoreSuggestion>[] | undefined>([...key], (rows) =>
            rows?.map((row) => (row.id === suggestion.id ? { ...row, status } : row)),
          );
        }
      },
      onError: (error) => toast.error("Couldn't change the status", describeError(error)),
    },
  );
  const meta = STATUS_META[suggestion.status];

  return (
    <li className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-900">{suggestion.storeName}</span>
          <span className="text-sm text-slate-500">{suggestion.city}</span>
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {formatRelativeTime(suggestion.createdAt, now)} · from the{' '}
          {suggestion.source === 'app' ? 'app' : 'website'}
          {suggestion.suggestedBy ? '' : ' · guest'}
        </p>
        {suggestion.interests.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="What they buy most">
            {suggestion.interests.map((interest) => (
              <li key={interest} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                {interest}
              </li>
            ))}
          </ul>
        ) : null}
        {suggestion.email ? (
          <a
            href={`mailto:${suggestion.email}`}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
          >
            <MailIcon size={14} aria-hidden /> {suggestion.email}
          </a>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <div className="w-40">
          <Select
            aria-label={`Status of ${suggestion.storeName}`}
            value={suggestion.status}
            disabled={setStatus.busy}
            onChange={(event) => void setStatus.run(event.target.value as Status).catch(() => undefined)}
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_META[status].label}
              </option>
            ))}
          </Select>
        </div>
        <Button
          size="sm"
          variant="secondary"
          icon={PlusIcon}
          onClick={() => {
            const params = new URLSearchParams({
              name: suggestion.storeName,
              city: suggestion.city,
              suggestion: suggestion.id,
            });
            navigate(`/stores/new?${params.toString()}`);
          }}
        >
          Create store
        </Button>
      </div>
    </li>
  );
}

export default function SuggestionsPage() {
  const now = useNow();
  const [filter, setFilter] = useState<Filter>('new');
  const suggestions = useLiveQuery(queries.suggestions(filter === 'all' ? null : filter));

  return (
    <>
      <PageHeader
        title="Store suggestions"
        description="Suppliers customers want on InstaSupply. Reach out, then onboard them with the store wizard."
      />
      <div className="mb-4">
        <Segmented<Filter>
          ariaLabel="Suggestion status"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'new', label: 'New' },
            { value: 'contacted', label: 'Contacted' },
            { value: 'onboarding', label: 'Onboarding' },
            { value: 'dismissed', label: 'Dismissed' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>
      <Card className="overflow-hidden">
        {suggestions.loading && suggestions.data.length === 0 ? (
          <PageSpinner label="Loading suggestions" />
        ) : suggestions.error && suggestions.data.length === 0 ? (
          <ErrorState error={suggestions.error} onRetry={suggestions.retry} className="m-5" />
        ) : suggestions.data.length === 0 ? (
          <ArtEmptyState
            artKey="scene-local-suppliers"
            title={filter === 'new' ? 'No new suggestions' : 'Nothing here'}
            description="Customers suggest stores from the app's “Suggest a store” form."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {suggestions.data.map((suggestion) => (
              <SuggestionRow key={suggestion.id} suggestion={suggestion} now={now} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
