import { validateUpload, type WithId } from '@instasupply/api-client';
import { useApiMutation, useLiveQuery } from '@instasupply/api-client/react';
import { artDataUri } from '@instasupply/art';
import {
  STORE_SPECIALTY_ART,
  STORE_SPECIALTY_LABELS,
  formatAddressLine,
  localDateOf,
  type Store,
  type StorePrivateSettings,
  type StoreProfilePatch,
  type StoreStatus,
} from '@instasupply/shared';
import { useRef, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/Card';
import { useServerNow } from '@/components/ui/Countdown';
import { Callout, ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { Field, TextArea, TextInput, Toggle } from '@/components/ui/Form';
import { DeleteIcon, ErrorIcon, ImageIcon, InfoIcon, LockIcon, UploadIcon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/Toast';
import { describeError, queries } from '@/lib/api';

import { ClosuresEditor, HoursEditor } from './HoursEditor';
import { buildPatch, draftFrom, isDirty, type ProfileDraft, type ProfileErrors } from './profile-form';

const STATUS_LABELS: Record<
  StoreStatus,
  { label: string; tone: 'success' | 'warning' | 'neutral' | 'info' }
> = {
  live: { label: 'Live', tone: 'success' },
  onboarding: { label: 'Onboarding', tone: 'info' },
  coming_soon: { label: 'Coming soon', tone: 'warning' },
  closed: { label: 'Closed', tone: 'neutral' },
};

function PhotoCard({ store }: { store: WithId<Store> }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation(async (api, file: File | null) => {
    if (!file) return api.call('updateStoreProfile', { storeId: store.id, patch: { photoPath: null } });
    const uploaded = await api.upload({
      purpose: 'store_photo',
      ownerId: store.id,
      source: { kind: 'blob', blob: file, name: file.name, contentType: file.type },
    });
    return api.call('updateStoreProfile', { storeId: store.id, patch: { photoPath: uploaded.path } });
  });
  const fallback = artDataUri(store.imageKey ?? STORE_SPECIALTY_ART[store.specialty]);
  const src = store.photoUrl ?? fallback;

  const choose = async (file: File | undefined) => {
    if (!file) return;
    const problem = validateUpload('store_photo', {
      kind: 'blob',
      blob: file,
      name: file.name,
      contentType: file.type,
    });
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      await save.run(file);
      toast.success('Store photo updated', 'Customers see it on your store page within a minute.');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader
        title="Store photo"
        description="Your storefront or yard, shown on your store page in the app."
      />
      <CardBody className="space-y-3">
        <div className="aspect-[16/9] overflow-hidden rounded-xl bg-slate-100">
          {src ? (
            <img
              src={src}
              alt={store.photoUrl ? `Photo of ${store.name}` : ''}
              className={store.photoUrl ? 'h-full w-full object-cover' : 'h-full w-full object-contain p-6'}
            />
          ) : (
            <div className="grid h-full place-items-center text-slate-400">
              <ImageIcon size={28} aria-hidden />
            </div>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="sr-only"
          aria-label="Choose a store photo"
          onChange={(event) => void choose(event.target.files?.[0])}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            icon={UploadIcon}
            loading={save.busy}
            onClick={() => input.current?.click()}
          >
            {store.photoUrl ? 'Replace photo' : 'Upload photo'}
          </Button>
          {store.photoUrl ? (
            <Button
              variant="ghost"
              icon={DeleteIcon}
              disabled={save.busy}
              onClick={() => {
                setError(null);
                void save
                  .run(null)
                  .then(() => toast.success('Photo removed'))
                  .catch((caught: unknown) => setError(describeError(caught)));
              }}
            >
              Remove
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-slate-500">
          JPEG, PNG or WebP, up to 5 MB. Without a photo we show the illustration.
        </p>
        {error ? (
          <Callout tone="danger" icon={ErrorIcon}>
            {error}
          </Callout>
        ) : null}
      </CardBody>
    </Card>
  );
}

function ReadOnlyCard({ store, staff }: { store: WithId<Store>; staff: boolean }) {
  const status = STATUS_LABELS[store.status];
  return (
    <Card>
      <CardHeader
        title="Listing"
        description={
          staff ? 'Change these in the store settings.' : 'Message InstaSupply from Support to change these.'
        }
      />
      <CardBody>
        <dl className="divide-y divide-slate-100">
          <DetailRow label="Name">{store.name}</DetailRow>
          <DetailRow label="Specialty">{STORE_SPECIALTY_LABELS[store.specialty]}</DetailRow>
          <DetailRow label="Address">{formatAddressLine(store.address)}</DetailRow>
          <DetailRow label="Area">{store.areaLabel}</DetailRow>
          <DetailRow label="Delivery radius">{store.fulfilment.deliveryRadiusKm} km by road</DetailRow>
          <DetailRow label="Status">
            <Badge tone={status.tone}>{status.label}</Badge>
          </DetailRow>
          <DetailRow label="Rating">
            {store.ratingCount > 0 ? `${store.rating.toFixed(1)} ★ (${store.ratingCount})` : 'No reviews yet'}
          </DetailRow>
        </dl>
      </CardBody>
    </Card>
  );
}

function ProfileForm({
  store,
  settings,
  withPrivate,
}: {
  store: WithId<Store>;
  settings: StorePrivateSettings | null;
  withPrivate: boolean;
}) {
  const toast = useToast();
  const now = useServerNow(60_000);
  const today = localDateOf(now);
  const [base, setBase] = useState<ProfileDraft>(() => draftFrom(store, settings, today));
  const [draft, setDraft] = useState<ProfileDraft>(base);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const dirty = isDirty(draft, base, withPrivate);

  // Someone else saved while this form had no unsaved changes: show their values.
  const server = draftFrom(store, settings, today);
  if (!dirty && JSON.stringify(server) !== JSON.stringify(base)) {
    setBase(server);
    setDraft(server);
  }

  const save = useApiMutation((api, patch: StoreProfilePatch) =>
    api.call('updateStoreProfile', { storeId: store.id, patch }),
  );

  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    setFormError(null);
    const result = buildPatch(draft, base, { withPrivate, today, storeId: store.id });
    if (!result.ok) {
      setErrors(result.errors);
      setFormError(result.errors.form ?? 'Check the highlighted fields.');
      return;
    }
    setErrors({});
    if (result.changed === 0) return;
    try {
      await save.run(result.patch);
      setBase(draft);
      toast.success('Store profile saved');
    } catch (caught) {
      setFormError(describeError(caught));
    }
  };

  const disabled = save.busy;

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Card>
        <CardHeader title="About the store" description="What contractors read on your store page." />
        <CardBody className="space-y-4">
          <Field
            label="Description"
            error={errors.description}
            hint="Up to 2,000 characters: what you stock, brands, trade counter perks."
          >
            {(id, describedBy) => (
              <TextArea
                id={id}
                aria-describedby={describedBy}
                rows={4}
                maxLength={2000}
                disabled={disabled}
                value={draft.description}
                onChange={(event) => set('description', event.target.value)}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Store phone" required error={errors.phone} hint="Shown to customers and drivers.">
              {(id, describedBy) => (
                <TextInput
                  id={id}
                  type="tel"
                  autoComplete="tel"
                  aria-describedby={describedBy}
                  invalid={!!errors.phone}
                  disabled={disabled}
                  value={draft.phone}
                  onChange={(event) => set('phone', event.target.value)}
                />
              )}
            </Field>
            <Field label="Store email" error={errors.email}>
              {(id, describedBy) => (
                <TextInput
                  id={id}
                  type="email"
                  autoComplete="email"
                  aria-describedby={describedBy}
                  invalid={!!errors.email}
                  disabled={disabled}
                  value={draft.email}
                  onChange={(event) => set('email', event.target.value)}
                />
              )}
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Hours" description="Toronto time. Orders are only promised while you're open." />
        <CardBody className="space-y-6">
          <HoursEditor
            value={draft.hours}
            onChange={(hours) => set('hours', hours)}
            error={errors.hours}
            disabled={disabled}
          />
          <ClosuresEditor
            value={draft.closures}
            onChange={(closures) => set('closures', closures)}
            today={today}
            now={now}
            error={errors.closures}
            disabled={disabled}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Fulfilment"
          description="How quickly you turn orders around, and how customers get them."
        />
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Prep time (minutes)"
              required
              error={errors.prepMinutes}
              hint="5 to 240: from Accept to the load waiting at the counter."
            >
              {(id, describedBy) => (
                <TextInput
                  id={id}
                  inputMode="numeric"
                  aria-describedby={describedBy}
                  invalid={!!errors.prepMinutes}
                  disabled={disabled}
                  value={draft.prepMinutes}
                  onChange={(event) => set('prepMinutes', event.target.value)}
                />
              )}
            </Field>
            <Field
              label="Same-day cut-off"
              required
              error={errors.sameDayCutoff}
              hint="Orders after this are delivered the next day you're open."
            >
              {(id, describedBy) => (
                <TextInput
                  id={id}
                  type="time"
                  step={300}
                  aria-describedby={describedBy}
                  invalid={!!errors.sameDayCutoff}
                  disabled={disabled}
                  value={draft.sameDayCutoff}
                  onChange={(event) => set('sameDayCutoff', event.target.value)}
                />
              )}
            </Field>
          </div>
          <div className="flex flex-wrap gap-6">
            <Toggle
              label="Delivery to jobsites"
              description="InstaSupply drivers collect from your counter."
              checked={draft.delivery}
              disabled={disabled}
              onChange={(value) => set('delivery', value)}
            />
            <Toggle
              label="Pickup at the counter"
              description="The customer shows a PIN when they collect."
              checked={draft.pickup}
              disabled={disabled}
              onChange={(value) => set('pickup', value)}
            />
          </div>
          {errors.fulfilment ? (
            <p className="text-xs font-medium text-rose-600">{errors.fulfilment}</p>
          ) : null}
        </CardBody>
      </Card>

      {withPrivate ? (
        <Card>
          <CardHeader
            title={
              <span className="inline-flex items-center gap-1.5">
                <LockIcon size={14} aria-hidden /> Private to your store and InstaSupply
              </span>
            }
          />
          <CardBody className="space-y-4">
            <Field
              label="Order-alert mobile"
              error={errors.alertPhone}
              hint="We text this number for every new order and a reminder before it times out. Use a phone at the counter."
            >
              {(id, describedBy) => (
                <TextInput
                  id={id}
                  type="tel"
                  autoComplete="off"
                  placeholder="(416) 555-0120"
                  aria-describedby={describedBy}
                  invalid={!!errors.alertPhone}
                  disabled={disabled}
                  value={draft.alertPhone}
                  onChange={(event) => set('alertPhone', event.target.value)}
                />
              )}
            </Field>
            <Field
              label="Loading notes for drivers"
              error={errors.loadingNotes}
              hint="Gate codes, which door, where to back in. Drivers see these on the job, never customers."
            >
              {(id, describedBy) => (
                <TextArea
                  id={id}
                  aria-describedby={describedBy}
                  rows={3}
                  maxLength={500}
                  disabled={disabled}
                  value={draft.loadingNotes}
                  onChange={(event) => set('loadingNotes', event.target.value)}
                />
              )}
            </Field>
          </CardBody>
        </Card>
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
        {formError ? (
          <p className="mr-auto flex items-center gap-1.5 text-sm text-rose-700" role="alert">
            <ErrorIcon size={16} aria-hidden /> {formError}
          </p>
        ) : dirty ? (
          <p className="mr-auto text-sm text-slate-600">You have unsaved changes.</p>
        ) : (
          <p className="mr-auto text-sm text-slate-500">All changes saved.</p>
        )}
        <Button
          variant="secondary"
          disabled={!dirty || disabled}
          onClick={() => {
            setDraft(base);
            setErrors({});
            setFormError(null);
          }}
        >
          Discard
        </Button>
        <Button type="submit" loading={save.busy} disabled={!dirty}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

/**
 * The store profile and hours editors (MARKETPLACE §8 `/portal/store`), shared with ops
 * (`/stores/:storeId`, Profile & hours tab). Photo, description, phone, email, order-alert mobile,
 * hours, closures, prep time, same-day cut-off, delivery and pickup switches and loading notes.
 * Name, address, radius and status are read-only here. `withPrivate` (store owners and staff) adds
 * the private settings, which other members cannot read.
 */
export function StoreProfileEditor({
  storeId,
  withPrivate,
  staff = false,
}: {
  storeId: string;
  withPrivate: boolean;
  staff?: boolean;
}) {
  const store = useLiveQuery(queries.store(storeId));
  const settings = useLiveQuery(queries.storeSettings(storeId), { enabled: withPrivate });

  if ((store.loading && !store.data) || (withPrivate && settings.loading && !settings.data)) {
    return <PageSpinner label="Loading store profile" />;
  }
  if (!store.data) {
    return store.error ? (
      <ErrorState error={store.error} onRetry={store.retry} />
    ) : (
      <Callout tone="warning" icon={InfoIcon} title="Store not found">
        This store no longer exists.
      </Callout>
    );
  }
  if (withPrivate && settings.error && !settings.data) {
    return (
      <ErrorState
        title="Couldn't load the private settings"
        error={settings.error}
        onRetry={settings.retry}
      />
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <ProfileForm
        key={store.data.id}
        store={store.data}
        settings={withPrivate ? (settings.data ?? null) : null}
        withPrivate={withPrivate}
      />
      <div className="space-y-6">
        <PhotoCard store={store.data} />
        <ReadOnlyCard store={store.data} staff={staff} />
      </div>
    </div>
  );
}
