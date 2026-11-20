/**
 * Profile and hours of a store (MARKETPLACE §8 `/portal/store` fields, used by ops on the store page):
 * photo, description, phone, email, order-alert mobile, hours, closures, prep time, same-day cut-off,
 * pickup and delivery, "Pause new orders" and the private loading notes. Checked with
 * `validateStoreProfile` from shared, saved with `updateStoreProfile`; only changed fields are sent.
 */
import {
  localDateOf,
  validateStoreProfile,
  type Store,
  type StorePrivateSettings,
  type StoreProfilePatch,
} from '@instasupply/shared';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Callout } from '@/components/ui/Feedback';
import { Field, TextArea, TextInput, Toggle } from '@/components/ui/Form';
import { ErrorIcon, ImageIcon, UploadIcon, WarningIcon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/Toast';
import { api, call, describeError } from '@/lib/api';

import { ClosuresEditor, HoursEditor, type WeekHours } from './HoursEditor';

interface ProfileDraft {
  description: string;
  phone: string;
  email: string;
  alertPhone: string;
  loadingNotes: string;
  hours: WeekHours;
  closures: string[];
  prepMinutes: string;
  sameDayCutoff: string;
  delivery: boolean;
  pickup: boolean;
  acceptingOrders: boolean;
}

function draftOf(store: Store, settings: StorePrivateSettings | null, today: string): ProfileDraft {
  return {
    description: store.description,
    phone: store.phone,
    email: store.email ?? '',
    alertPhone: settings?.alertPhone ?? '',
    loadingNotes: settings?.loadingNotes ?? '',
    hours: store.hours,
    // A closure that has passed is refused on save, so the editor only keeps today and later.
    closures: store.closures.filter((day) => day >= today),
    prepMinutes: String(store.prepMinutes),
    sameDayCutoff: store.sameDayCutoff,
    delivery: store.fulfilment.delivery,
    pickup: store.fulfilment.pickup,
    acceptingOrders: store.acceptingOrders,
  };
}

/** The patch of the fields that differ from the draft the form started from (R42: never resend the rest). */
function changedPatch(base: ProfileDraft, draft: ProfileDraft): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (draft.description !== base.description) patch.description = draft.description.trim();
  if (draft.phone !== base.phone) patch.phone = draft.phone.trim();
  if (draft.email !== base.email) patch.email = draft.email.trim() || null;
  if (draft.alertPhone !== base.alertPhone) patch.alertPhone = draft.alertPhone.trim() || null;
  if (draft.loadingNotes !== base.loadingNotes) patch.loadingNotes = draft.loadingNotes.trim() || null;
  if (JSON.stringify(draft.hours) !== JSON.stringify(base.hours)) patch.hours = draft.hours;
  if (JSON.stringify(draft.closures) !== JSON.stringify(base.closures)) patch.closures = draft.closures;
  if (draft.prepMinutes !== base.prepMinutes) patch.prepMinutes = Number(draft.prepMinutes);
  if (draft.sameDayCutoff !== base.sameDayCutoff) patch.sameDayCutoff = draft.sameDayCutoff;
  if (draft.delivery !== base.delivery || draft.pickup !== base.pickup) {
    patch.fulfilment = { delivery: draft.delivery, pickup: draft.pickup };
  }
  if (draft.acceptingOrders !== base.acceptingOrders) patch.acceptingOrders = draft.acceptingOrders;
  return patch;
}

export function StoreProfileForm({
  store,
  settings,
}: {
  store: Store;
  settings: StorePrivateSettings | null;
}) {
  const toast = useToast();
  const [today] = useState(() => localDateOf(api.serverNow()));
  const [base, setBase] = useState(() => draftOf(store, settings, today));
  const [draft, setDraft] = useState(base);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const patch = changedPatch(base, draft);
  const dirty = Object.keys(patch).length > 0;
  const set = (next: Partial<ProfileDraft>) => setDraft((current) => ({ ...current, ...next }));

  // A change from elsewhere (the portal, another tab): take it when nothing is being edited, otherwise say so.
  const marker = `${store.updatedAt}:${JSON.stringify(settings)}`;
  const [seen, setSeen] = useState(marker);
  const [stale, setStale] = useState(false);
  if (marker !== seen) {
    setSeen(marker);
    if (!dirty) {
      const fresh = draftOf(store, settings, today);
      setBase(fresh);
      setDraft(fresh);
      setStale(false);
    } else setStale(true);
  }

  const save = async () => {
    if (busy || !dirty) return;
    const result = validateStoreProfile(patch, today, store.id);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setError(null);
    setBusy(true);
    try {
      await call('updateStoreProfile', { storeId: store.id, patch: result.value });
      setBase(draft);
      toast.success('Store profile saved');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const uploaded = await api.upload({
        purpose: 'store_photo',
        ownerId: store.id,
        source: { kind: 'blob', blob: file, name: file.name, contentType: file.type },
      });
      const photo: StoreProfilePatch = { photoPath: uploaded.path };
      await call('updateStoreProfile', { storeId: store.id, patch: photo });
      toast.success('Store photo updated');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title="Profile" description="What customers see on the store card." />
        <CardBody className="space-y-4">
          <div className="flex items-center gap-4">
            {store.photoUrl ? (
              <img
                src={store.photoUrl}
                alt={`${store.name} storefront`}
                className="size-20 rounded-xl object-cover"
              />
            ) : (
              <span className="grid size-20 place-items-center rounded-xl bg-slate-100 text-slate-400">
                <ImageIcon size={24} aria-hidden />
              </span>
            )}
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
              <UploadIcon size={16} aria-hidden />
              {uploading ? 'Uploading…' : 'Upload photo'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void upload(file);
                }}
              />
            </label>
          </div>
          <Field label="Description" error={errors.description}>
            {(id, describedBy) => (
              <TextArea
                id={id}
                aria-describedby={describedBy}
                value={draft.description}
                onChange={(event) => set({ description: event.target.value })}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Store phone" error={errors.phone}>
              {(id, describedBy) => (
                <TextInput
                  id={id}
                  type="tel"
                  aria-describedby={describedBy}
                  value={draft.phone}
                  onChange={(event) => set({ phone: event.target.value })}
                />
              )}
            </Field>
            <Field label="Store email" error={errors.email}>
              {(id, describedBy) => (
                <TextInput
                  id={id}
                  type="email"
                  aria-describedby={describedBy}
                  value={draft.email}
                  onChange={(event) => set({ email: event.target.value })}
                />
              )}
            </Field>
            <Field
              label="Order alert mobile"
              error={errors.alertPhone}
              hint="Texted for every new order: suppliers have no app."
            >
              {(id, describedBy) => (
                <TextInput
                  id={id}
                  type="tel"
                  aria-describedby={describedBy}
                  value={draft.alertPhone}
                  onChange={(event) => set({ alertPhone: event.target.value })}
                />
              )}
            </Field>
          </div>
          <Field
            label="Loading notes (private)"
            error={errors.loadingNotes}
            hint="Drivers see them on the job."
          >
            {(id, describedBy) => (
              <TextArea
                id={id}
                aria-describedby={describedBy}
                value={draft.loadingNotes}
                maxLength={500}
                onChange={(event) => set({ loadingNotes: event.target.value })}
              />
            )}
          </Field>
          <Toggle
            checked={draft.delivery}
            onChange={(delivery) => set({ delivery })}
            label="Delivery to jobsites"
          />
          <Toggle
            checked={draft.pickup}
            onChange={(pickup) => set({ pickup })}
            label="Pickup at the counter"
          />
          <Toggle
            checked={!draft.acceptingOrders}
            onChange={(paused) => set({ acceptingOrders: !paused })}
            label="Pause new orders"
            description="The store stays listed but cannot take orders."
          />
          {errors.fulfilment ? (
            <p className="text-xs font-medium text-rose-600">{errors.fulfilment}</p>
          ) : null}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Hours" description="Customers see ASAP and scheduled windows from these." />
        <CardBody className="space-y-5">
          <HoursEditor value={draft.hours} onChange={(hours) => set({ hours })} />
          {errors.hours ? <p className="text-xs font-medium text-rose-600">{errors.hours}</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Prep time (minutes)" error={errors.prepMinutes}>
              {(id, describedBy) => (
                <TextInput
                  id={id}
                  type="number"
                  min={5}
                  max={240}
                  aria-describedby={describedBy}
                  value={draft.prepMinutes}
                  onChange={(event) => set({ prepMinutes: event.target.value })}
                />
              )}
            </Field>
            <Field label="Same-day cut-off" error={errors.sameDayCutoff}>
              {(id, describedBy) => (
                <TextInput
                  id={id}
                  type="time"
                  aria-describedby={describedBy}
                  value={draft.sameDayCutoff}
                  onChange={(event) => set({ sameDayCutoff: event.target.value })}
                />
              )}
            </Field>
          </div>
          <ClosuresEditor value={draft.closures} minDate={today} onChange={(closures) => set({ closures })} />
          {errors.closures ? <p className="text-xs font-medium text-rose-600">{errors.closures}</p> : null}
        </CardBody>
      </Card>
      <div className="flex flex-wrap items-center justify-end gap-3 xl:col-span-2">
        {stale ? (
          <div className="mr-auto">
            <Callout tone="warning" icon={WarningIcon} title="Someone else changed this store">
              <button
                type="button"
                className="font-semibold underline"
                onClick={() => {
                  const fresh = draftOf(store, settings, today);
                  setBase(fresh);
                  setDraft(fresh);
                  setStale(false);
                }}
              >
                Load the latest and drop my changes
              </button>
            </Callout>
          </div>
        ) : null}
        {error ? (
          <div className="mr-auto">
            <Callout tone="danger" icon={ErrorIcon}>
              {error}
            </Callout>
          </div>
        ) : null}
        <Button variant="secondary" disabled={!dirty || busy} onClick={() => setDraft(base)}>
          Discard changes
        </Button>
        <Button loading={busy} disabled={!dirty} onClick={() => void save()}>
          Save profile
        </Button>
      </div>
    </div>
  );
}
