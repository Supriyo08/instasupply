/**
 * Ops-only store settings (MARKETPLACE §9 store detail "Settings"): name, specialty, status, area,
 * delivery radius, commission, payout account (a test reference until Stripe Connect), orders email,
 * the onboarding checklist and internal notes. Saved with `updateStoreSettings`, changed fields only.
 */
import {
  STORE_SPECIALTY_LABELS,
  type Store,
  type StorePrivateSettings,
  type StoreSpecialty,
  type StoreStatus,
  type UpdateStoreSettingsRequest,
} from '@instasupply/shared';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Callout } from '@/components/ui/Feedback';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Form';
import { ErrorIcon, WarningIcon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/Toast';
import { call, describeError } from '@/lib/api';

import { STORE_STATUSES, STORE_STATUS_META, bpsToPercent, percentToBps } from '../store-format';

interface SettingsDraft {
  name: string;
  specialty: StoreSpecialty;
  status: StoreStatus;
  areaLabel: string;
  radiusKm: string;
  commission: string;
  accountRef: string;
  accountLabel: string;
  ordersEmail: string;
  catalogReady: boolean;
  payoutsReady: boolean;
  trained: boolean;
  notes: string;
}

function draftOf(store: Store, settings: StorePrivateSettings): SettingsDraft {
  return {
    name: store.name,
    specialty: store.specialty,
    status: store.status,
    areaLabel: store.areaLabel,
    radiusKm: String(store.fulfilment.deliveryRadiusKm),
    commission: bpsToPercent(settings.commissionBps),
    accountRef: settings.payoutAccount?.accountRef ?? '',
    accountLabel: settings.payoutAccount?.label ?? '',
    ordersEmail: settings.ordersEmail ?? '',
    catalogReady: settings.onboarding.catalogReady,
    payoutsReady: settings.onboarding.payoutsReady,
    trained: settings.onboarding.trained,
    notes: settings.notes ?? '',
  };
}

const SPECIALTIES = Object.keys(STORE_SPECIALTY_LABELS) as StoreSpecialty[];

export function StoreSettingsForm({ store, settings }: { store: Store; settings: StorePrivateSettings }) {
  const toast = useToast();
  const [base, setBase] = useState(() => draftOf(store, settings));
  const [draft, setDraft] = useState(base);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (next: Partial<SettingsDraft>) => setDraft((current) => ({ ...current, ...next }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);

  // A change from elsewhere (the portal, another tab): take it when nothing is being edited, otherwise say so.
  const marker = `${store.updatedAt}:${JSON.stringify(settings)}`;
  const [seen, setSeen] = useState(marker);
  const [stale, setStale] = useState(false);
  if (marker !== seen) {
    setSeen(marker);
    if (!dirty) {
      const fresh = draftOf(store, settings);
      setBase(fresh);
      setDraft(fresh);
      setStale(false);
    } else setStale(true);
  }

  const build = (): UpdateStoreSettingsRequest | string => {
    const request: UpdateStoreSettingsRequest = { storeId: store.id };
    const storePatch: NonNullable<UpdateStoreSettingsRequest['store']> = {};
    const settingsPatch: Partial<StorePrivateSettings> = {};
    if (draft.name !== base.name) storePatch.name = draft.name.trim();
    if (draft.specialty !== base.specialty) storePatch.specialty = draft.specialty;
    if (draft.status !== base.status) storePatch.status = draft.status;
    if (draft.areaLabel !== base.areaLabel) storePatch.areaLabel = draft.areaLabel.trim();
    if (draft.radiusKm !== base.radiusKm) {
      const radius = Number(draft.radiusKm);
      if (!Number.isFinite(radius) || radius < 1 || radius > 60)
        return 'Set a delivery radius of 1 to 60 km.';
      storePatch.deliveryRadiusKm = radius;
    }
    if (draft.commission !== base.commission) {
      const bps = percentToBps(draft.commission);
      if (bps === null) return 'Enter a commission from 0 to 50 %.';
      settingsPatch.commissionBps = bps;
    }
    if (draft.accountRef !== base.accountRef || draft.accountLabel !== base.accountLabel) {
      const ref = draft.accountRef.trim();
      settingsPatch.payoutAccount = ref
        ? { provider: 'test', accountRef: ref, label: draft.accountLabel.trim() || ref }
        : null;
    }
    if (draft.ordersEmail !== base.ordersEmail) settingsPatch.ordersEmail = draft.ordersEmail.trim() || null;
    if (
      draft.catalogReady !== base.catalogReady ||
      draft.payoutsReady !== base.payoutsReady ||
      draft.trained !== base.trained
    ) {
      settingsPatch.onboarding = {
        catalogReady: draft.catalogReady,
        payoutsReady: draft.payoutsReady,
        trained: draft.trained,
      };
    }
    if (draft.notes !== base.notes) settingsPatch.notes = draft.notes.trim() || null;
    if (Object.keys(storePatch).length > 0) request.store = storePatch;
    if (Object.keys(settingsPatch).length > 0) request.settings = settingsPatch;
    return request;
  };

  const request = build();
  const goingLive = draft.status === 'live' && base.status !== 'live';
  const checklistDone = draft.catalogReady && draft.payoutsReady && draft.trained;

  const save = async () => {
    if (busy) return;
    if (typeof request === 'string') {
      setError(request);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await call('updateStoreSettings', request);
      setBase(draft);
      toast.success('Store settings saved');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title="Store" description="Only ops can change these." />
        <CardBody className="space-y-4">
          <Field label="Store name">
            {(id) => (
              <TextInput id={id} value={draft.name} onChange={(event) => set({ name: event.target.value })} />
            )}
          </Field>
          <Field label="Specialty">
            {(id) => (
              <Select
                id={id}
                value={draft.specialty}
                onChange={(event) => set({ specialty: event.target.value as StoreSpecialty })}
              >
                {SPECIALTIES.map((specialty) => (
                  <option key={specialty} value={specialty}>
                    {STORE_SPECIALTY_LABELS[specialty]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Status" hint={STORE_STATUS_META[draft.status].hint}>
            {(id, describedBy) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={draft.status}
                onChange={(event) => set({ status: event.target.value as StoreStatus })}
              >
                {STORE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STORE_STATUS_META[status].label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {goingLive && !checklistDone ? (
            <Callout tone="warning" icon={WarningIcon}>
              The onboarding checklist is not complete. Customers will be able to order as soon as it is live.
            </Callout>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Area on the store card">
              {(id) => (
                <TextInput
                  id={id}
                  value={draft.areaLabel}
                  onChange={(event) => set({ areaLabel: event.target.value })}
                />
              )}
            </Field>
            <Field label="Delivery radius (road km)">
              {(id) => (
                <TextInput
                  id={id}
                  type="number"
                  min={1}
                  max={60}
                  value={draft.radiusKm}
                  onChange={(event) => set({ radiusKm: event.target.value })}
                />
              )}
            </Field>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Money and onboarding" />
        <CardBody className="space-y-4">
          <Field label="Commission (%)" hint="Applies to orders placed from now on.">
            {(id, describedBy) => (
              <TextInput
                id={id}
                type="number"
                min={0}
                max={50}
                step={0.5}
                aria-describedby={describedBy}
                value={draft.commission}
                onChange={(event) => set({ commission: event.target.value })}
                className="w-32"
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Payout account reference" hint="A test reference until Stripe Connect is set up.">
              {(id, describedBy) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  value={draft.accountRef}
                  placeholder="test_acct_kestrel"
                  className="font-mono"
                  onChange={(event) => set({ accountRef: event.target.value })}
                />
              )}
            </Field>
            <Field label="Payout account label">
              {(id) => (
                <TextInput
                  id={id}
                  value={draft.accountLabel}
                  placeholder="RBC •••• 4021"
                  onChange={(event) => set({ accountLabel: event.target.value })}
                />
              )}
            </Field>
          </div>
          <Field label="Orders email">
            {(id) => (
              <TextInput
                id={id}
                type="email"
                value={draft.ordersEmail}
                onChange={(event) => set({ ordersEmail: event.target.value })}
              />
            )}
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-700">Onboarding checklist</legend>
            {(
              [
                ['catalogReady', 'Catalogue loaded and priced'],
                ['payoutsReady', 'Payout account set up'],
                ['trained', 'Counter staff trained on the portal and PINs'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={draft[key]}
                  onChange={(event) => set({ [key]: event.target.checked })}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <Field label="Internal notes">
            {(id) => (
              <TextArea
                id={id}
                value={draft.notes}
                maxLength={2000}
                onChange={(event) => set({ notes: event.target.value })}
              />
            )}
          </Field>
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
                  const fresh = draftOf(store, settings);
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
          Save settings
        </Button>
      </div>
    </div>
  );
}
