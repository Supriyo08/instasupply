/**
 * `/stores/new` (MARKETPLACE §9, CLIENTS §4.5): the new store wizard. Basics → location (geocode +
 * pin) → hours → fulfilment and radius → commission → invite owner. The whole store is checked with
 * `validateStore` from shared before `createStore`; then `inviteSupplierUser` returns the owner's
 * set-password link. `/stores/new?name=…&city=…&suggestion=…` pre-fills it from a store suggestion.
 * The draft is kept until the store exists or the user leaves; a retried create after a lost answer
 * finds the store already there and carries on.
 */
import { useLiveQuery } from '@instasupply/api-client/react';
import {
  CITIES,
  CITY_IDS,
  MARKET_ID,
  STORE_SPECIALTY_ART,
  STORE_SPECIALTY_LABELS,
  isStoreId,
  localDateOf,
  nearestCity,
  validateStore,
  type CategoryId,
  type CityId,
  type GeocodeAddressResponse,
  type LatLng,
  type StoreInput,
  type StorePrivateSettings,
  type StoreSpecialty,
  type StoreStatus,
} from '@instasupply/shared';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { CopyField } from '@/components/ui/CopyField';
import { Callout } from '@/components/ui/Feedback';
import { Field, Select, TextArea, TextInput, Toggle } from '@/components/ui/Form';
import { CheckIcon, ErrorIcon, LocateIcon, SearchIcon, SuccessIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/Layout';
import { AppMap } from '@/components/map/AppMap';
import { fitKeyFor } from '@/components/map/map-types';
import { SceneArt } from '@/features/orders/components/ItemThumb';
import { api, call, describeError, isApiError, queries } from '@/lib/api';
import { cn } from '@/lib/cn';

import { ClosuresEditor, HoursEditor, type WeekHours } from './components/HoursEditor';
import { STORE_STATUSES, STORE_STATUS_META, defaultHours, percentToBps, storeSlug } from './store-format';

const STEPS = ['Basics', 'Location', 'Hours', 'Fulfilment', 'Commission', 'Owner'] as const;
type Step = 0 | 1 | 2 | 3 | 4 | 5;

interface Draft {
  name: string;
  storeId: string;
  idTouched: boolean;
  specialty: StoreSpecialty;
  categoryIds: CategoryId[];
  description: string;
  phone: string;
  email: string;
  line1: string;
  line2: string;
  city: string;
  postalCode: string;
  location: LatLng | null;
  cityId: CityId;
  areaLabel: string;
  hours: WeekHours;
  closures: string[];
  prepMinutes: string;
  sameDayCutoff: string;
  delivery: boolean;
  pickup: boolean;
  radiusKm: string;
  commission: string;
  status: StoreStatus;
  ordersEmail: string;
  alertPhone: string;
  loadingNotes: string;
  ownerName: string;
  ownerEmail: string;
}

/** Which step shows the error of each store field. */
const FIELD_STEP: Partial<Record<keyof StoreInput | 'form', Step>> = {
  name: 0,
  specialty: 0,
  categoryIds: 0,
  description: 0,
  phone: 0,
  email: 0,
  address: 1,
  location: 1,
  cityId: 1,
  areaLabel: 1,
  hours: 2,
  closures: 2,
  prepMinutes: 2,
  sameDayCutoff: 2,
  fulfilment: 3,
  status: 4,
};

const SPECIALTIES = Object.keys(STORE_SPECIALTY_LABELS) as StoreSpecialty[];

function initialDraft(params: URLSearchParams): Draft {
  const name = params.get('name')?.slice(0, 80) ?? '';
  const city = params.get('city')?.slice(0, 80) ?? '';
  const cityId =
    CITY_IDS.find((id) => CITIES[id].name.toLowerCase() === city.trim().toLowerCase()) ?? 'toronto';
  return {
    name,
    storeId: storeSlug(name),
    idTouched: false,
    specialty: 'lumber_building',
    categoryIds: [],
    description: '',
    phone: '',
    email: '',
    line1: '',
    line2: '',
    city: city || 'Toronto',
    postalCode: '',
    location: null,
    cityId,
    areaLabel: '',
    hours: defaultHours(),
    closures: [],
    prepMinutes: '30',
    sameDayCutoff: '14:00',
    delivery: true,
    pickup: true,
    radiusKm: '40',
    commission: '10',
    status: 'onboarding',
    ordersEmail: '',
    alertPhone: '',
    loadingNotes: '',
    ownerName: '',
    ownerEmail: '',
  };
}

function storeInputOf(draft: Draft): unknown {
  return {
    name: draft.name.trim(),
    specialty: draft.specialty,
    categoryIds: draft.categoryIds,
    description: draft.description.trim(),
    marketId: MARKET_ID,
    cityId: draft.cityId,
    areaLabel: draft.areaLabel.trim(),
    address: {
      line1: draft.line1.trim(),
      line2: draft.line2.trim() || null,
      city: draft.city.trim(),
      province: 'ON',
      postalCode: draft.postalCode.trim() || null,
    },
    location: draft.location,
    phone: draft.phone.trim(),
    email: draft.email.trim() || null,
    photoUrl: null,
    imageKey: STORE_SPECIALTY_ART[draft.specialty],
    hours: draft.hours,
    closures: draft.closures,
    fulfilment: { delivery: draft.delivery, pickup: draft.pickup, deliveryRadiusKm: Number(draft.radiusKm) },
    prepMinutes: Number(draft.prepMinutes),
    sameDayCutoff: draft.sameDayCutoff,
    status: draft.status,
    acceptingOrders: true,
  };
}

function LocationStep({
  draft,
  patch,
  errors,
}: {
  draft: Draft;
  patch: (next: Partial<Draft>) => void;
  errors: Partial<Record<string, string>>;
}) {
  const [results, setResults] = useState<GeocodeAddressResponse['results'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const find = async () => {
    const query = [draft.line1, draft.city, draft.postalCode, 'Ontario']
      .filter((part) => part.trim())
      .join(', ');
    if (!draft.line1.trim()) {
      setError('Type the street address first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await call('geocodeAddress', {
        query,
        near: draft.location ?? CITIES[draft.cityId].center,
      });
      setResults(response.results);
      if (response.results.length === 0)
        setError("We couldn't find that address. Drop the pin on the map instead.");
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const choose = (result: GeocodeAddressResponse['results'][number]) => {
    patch({
      location: result.location,
      cityId: result.cityId,
      areaLabel: draft.areaLabel || result.areaLabel,
      postalCode: draft.postalCode || result.postalCode || '',
      city: result.city ?? draft.city,
    });
    setResults(null);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <Field label="Street address" required error={errors.address}>
          {(id, describedBy) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              value={draft.line1}
              placeholder="1120 Lakeshore Rd E"
              onChange={(event) => patch({ line1: event.target.value })}
            />
          )}
        </Field>
        <Field label="Unit, yard or gate (optional)">
          {(id) => (
            <TextInput
              id={id}
              value={draft.line2}
              onChange={(event) => patch({ line2: event.target.value })}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City" required>
            {(id) => (
              <TextInput
                id={id}
                value={draft.city}
                onChange={(event) => patch({ city: event.target.value })}
              />
            )}
          </Field>
          <Field label="Postal code" required>
            {(id) => (
              <TextInput
                id={id}
                value={draft.postalCode}
                placeholder="M4M 1A1"
                autoCapitalize="characters"
                onChange={(event) => patch({ postalCode: event.target.value.toUpperCase() })}
              />
            )}
          </Field>
        </div>
        <Button variant="secondary" icon={SearchIcon} loading={busy} onClick={() => void find()}>
          Find address
        </Button>
        {error ? (
          <Callout tone="warning" icon={ErrorIcon}>
            {error}
          </Callout>
        ) : null}
        {results && results.length > 0 ? (
          <ul
            className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200"
            aria-label="Address matches"
          >
            {results.map((result) => (
              <li key={`${result.location.lat},${result.location.lng}`}>
                <button
                  type="button"
                  onClick={() => choose(result)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <LocateIcon size={16} className="mt-0.5 shrink-0 text-brand-600" aria-hidden />
                  <span>
                    {result.label}
                    <span className="block text-xs text-slate-500">
                      {CITIES[result.cityId].name} · {result.areaLabel}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="City for drivers"
            required
            error={errors.cityId}
            hint="Drivers see jobs in their own city."
          >
            {(id, describedBy) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={draft.cityId}
                onChange={(event) => patch({ cityId: event.target.value as CityId })}
              >
                {CITY_IDS.map((cityId) => (
                  <option key={cityId} value={cityId}>
                    {CITIES[cityId].name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Area on the store card" required error={errors.areaLabel}>
            {(id, describedBy) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                value={draft.areaLabel}
                placeholder="Etobicoke"
                onChange={(event) => patch({ areaLabel: event.target.value })}
              />
            )}
          </Field>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700">
          Pin <span className="text-rose-500">*</span>
        </p>
        <p className="text-xs text-slate-500">
          Click the map or drag the pin onto the yard entrance. Drivers navigate to it.
        </p>
        <AppMap
          className="h-80"
          accessibilityLabel={
            draft.location
              ? `Store pin at ${draft.location.lat.toFixed(5)}, ${draft.location.lng.toFixed(5)}`
              : 'Map of the Greater Toronto Area with no store pin yet'
          }
          pick={{ position: draft.location, draggable: true, tapToPlace: true }}
          onPick={(point) =>
            patch({ location: point, cityId: draft.location ? draft.cityId : nearestCity(point) })
          }
          fit={
            draft.location
              ? { key: fitKeyFor([draft.location]), points: [draft.location], maxZoom: 15 }
              : null
          }
        />
        {draft.location ? (
          <p className="text-xs text-slate-500">
            {draft.location.lat.toFixed(5)}, {draft.location.lng.toFixed(5)}
          </p>
        ) : null}
        {errors.location ? <p className="text-xs font-medium text-rose-600">{errors.location}</p> : null}
      </div>
    </div>
  );
}

export default function NewStorePage() {
  const [params] = useSearchParams();
  const suggestionId = params.get('suggestion');
  const [draft, setDraft] = useState<Draft>(() => initialDraft(params));
  const [step, setStep] = useState<Step>(0);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ link: string; email: string } | null>(null);
  const categories = useLiveQuery(queries.categories());

  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));
  const commissionBps = percentToBps(draft.commission);
  const today = useMemo(() => localDateOf(api.serverNow()), []);

  const checkStep = (target: Step): boolean => {
    const next: Partial<Record<string, string>> = {};
    if (target === 0) {
      if (!isStoreId(draft.storeId)) {
        next.storeId = 'Use 3 to 40 lower-case letters, digits and single dashes, like kestrel-lumber.';
      }
      if (draft.categoryIds.length === 0) next.categoryIds = 'Choose at least one category.';
    }
    const result = validateStore(storeInputOf(draft));
    if (!result.ok) {
      for (const [field, message] of Object.entries(result.errors)) {
        if (FIELD_STEP[field as keyof StoreInput] === target && message) next[field] = message;
      }
    }
    if (target === 4 && commissionBps === null) next.commission = 'Enter a commission from 0 to 50 %.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const goNext = () => {
    if (!checkStep(step)) return;
    setStep((current) => Math.min(5, current + 1) as Step);
  };

  const sendInvite = async (storeId: string) => {
    if (!draft.ownerEmail.trim()) return;
    const response = await call('inviteSupplierUser', {
      storeId,
      email: draft.ownerEmail.trim(),
      displayName: draft.ownerName.trim(),
      storeRole: 'owner',
    });
    setInvite({ link: response.passwordSetupLink, email: draft.ownerEmail.trim() });
  };

  const submit = async () => {
    if (busy) return;
    setFormError(null);
    if (draft.ownerEmail.trim() && draft.ownerName.trim().length < 2) {
      setErrors({ ownerName: "Enter the owner's name." });
      return;
    }
    const result = validateStore(storeInputOf(draft));
    if (!result.ok || commissionBps === null || !isStoreId(draft.storeId)) {
      const firstField = result.ok
        ? null
        : (Object.keys(result.errors)[0] as keyof StoreInput | 'form' | undefined);
      const target = (firstField && FIELD_STEP[firstField]) ?? (commissionBps === null ? 4 : 0);
      setStep(target);
      checkStep(target);
      return;
    }
    const settings: StorePrivateSettings = {
      commissionBps,
      payoutAccount: null,
      ordersEmail: draft.ordersEmail.trim() || null,
      alertPhone: draft.alertPhone.trim() || null,
      loadingNotes: draft.loadingNotes.trim() || null,
      onboarding: { catalogReady: false, payoutsReady: false, trained: false },
      notes: null,
    };
    setBusy(true);
    try {
      if (!created) {
        try {
          await call('createStore', { storeId: draft.storeId, store: result.value, settings });
        } catch (caught) {
          // A retry after a lost answer: the store is already there, so carry on with the invite.
          if (!isApiError(caught) || caught.status !== 'already-exists') throw caught;
          const existing = await api.cache.prefetch(queries.store(draft.storeId)).catch(() => null);
          if (!existing || existing.name !== result.value.name) {
            throw new Error(
              'A store with this id already exists. Choose another store id on the Basics step.',
              {
                cause: caught,
              },
            );
          }
        }
        setCreated(draft.storeId);
        if (suggestionId) void api.suggestions.setStatus(suggestionId, 'onboarding').catch(() => undefined);
      }
      await sendInvite(draft.storeId);
    } catch (caught) {
      setFormError(!isApiError(caught) && caught instanceof Error ? caught.message : describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  if (created && (invite || !draft.ownerEmail.trim())) {
    return (
      <>
        <PageHeader title="Store created" back={{ to: '/stores', label: 'Stores' }} />
        <Card className="max-w-2xl">
          <CardBody className="space-y-4">
            <SceneArt artKey="scene-local-suppliers" />
            <Callout tone="success" icon={SuccessIcon} title={`${draft.name} is set up`}>
              It is in {STORE_STATUS_META[draft.status].label.toLowerCase()} status. Add its catalogue and
              payout account from the store page before it goes live.
            </Callout>
            {invite ? (
              <div className="space-y-2">
                <p className="text-sm text-slate-700">
                  Send this link to {invite.email}. It lets the owner choose a password and sign in to the
                  supplier portal.
                </p>
                <CopyField value={invite.link} label="Owner's set-password link" />
              </div>
            ) : null}
            <Link
              to={`/stores/${encodeURIComponent(created)}`}
              className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700"
            >
              Open the store
            </Link>
          </CardBody>
        </Card>
      </>
    );
  }

  const radiusKm = Number(draft.radiusKm);

  return (
    <>
      <PageHeader
        title="New store"
        description="Bring a building-supply store onto InstaSupply."
        back={{ to: '/stores', label: 'Stores' }}
      />
      <ol className="mb-6 flex flex-wrap gap-2" aria-label="Steps">
        {STEPS.map((label, index) => (
          <li key={label}>
            <button
              type="button"
              aria-current={index === step ? 'step' : undefined}
              onClick={() => index < step && setStep(index as Step)}
              disabled={index > step}
              className={cn(
                'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1',
                index === step
                  ? 'bg-brand-600 text-white ring-brand-600'
                  : index < step
                    ? 'bg-white text-brand-700 ring-brand-200 hover:bg-brand-50'
                    : 'bg-white text-slate-400 ring-slate-200',
              )}
            >
              {index < step ? <CheckIcon size={12} aria-hidden /> : <span>{index + 1}</span>}
              {label}
            </button>
          </li>
        ))}
      </ol>

      <Card>
        <CardBody className="space-y-5">
          {step === 0 ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Field label="Store name" required error={errors.name}>
                {(id, describedBy) => (
                  <TextInput
                    id={id}
                    aria-describedby={describedBy}
                    value={draft.name}
                    placeholder="Kestrel Lumber Yard"
                    onChange={(event) =>
                      patch({
                        name: event.target.value,
                        storeId: draft.idTouched ? draft.storeId : storeSlug(event.target.value),
                      })
                    }
                  />
                )}
              </Field>
              <Field
                label="Store id"
                required
                error={errors.storeId}
                hint="Part of every product id; it cannot change later."
              >
                {(id, describedBy) => (
                  <TextInput
                    id={id}
                    aria-describedby={describedBy}
                    value={draft.storeId}
                    className="font-mono"
                    onChange={(event) =>
                      patch({ storeId: event.target.value.toLowerCase(), idTouched: true })
                    }
                  />
                )}
              </Field>
              <Field label="Specialty" required error={errors.specialty}>
                {(id) => (
                  <Select
                    id={id}
                    value={draft.specialty}
                    onChange={(event) => patch({ specialty: event.target.value as StoreSpecialty })}
                  >
                    {SPECIALTIES.map((specialty) => (
                      <option key={specialty} value={specialty}>
                        {STORE_SPECIALTY_LABELS[specialty]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Store phone" required error={errors.phone}>
                {(id, describedBy) => (
                  <TextInput
                    id={id}
                    type="tel"
                    aria-describedby={describedBy}
                    value={draft.phone}
                    placeholder="(416) 555-0120"
                    onChange={(event) => patch({ phone: event.target.value })}
                  />
                )}
              </Field>
              <Field label="Store email (optional)" error={errors.email}>
                {(id, describedBy) => (
                  <TextInput
                    id={id}
                    type="email"
                    aria-describedby={describedBy}
                    value={draft.email}
                    onChange={(event) => patch({ email: event.target.value })}
                  />
                )}
              </Field>
              <Field label="Description" error={errors.description} className="lg:col-span-2">
                {(id, describedBy) => (
                  <TextArea
                    id={id}
                    aria-describedby={describedBy}
                    value={draft.description}
                    placeholder="Framing lumber, sheet goods and engineered joists, cut to length."
                    onChange={(event) => patch({ description: event.target.value })}
                  />
                )}
              </Field>
              <fieldset className="lg:col-span-2">
                <legend className="text-sm font-medium text-slate-700">
                  Categories it carries <span className="text-rose-500">*</span>
                </legend>
                {errors.categoryIds ? (
                  <p className="mt-1 text-xs font-medium text-rose-600">{errors.categoryIds}</p>
                ) : null}
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {categories.data.map((category) => {
                    const checked = draft.categoryIds.includes(category.id);
                    return (
                      <label key={category.id} className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            patch({
                              categoryIds: checked
                                ? draft.categoryIds.filter((id) => id !== category.id)
                                : [...draft.categoryIds, category.id],
                            })
                          }
                        />
                        {category.name}
                      </label>
                    );
                  })}
                  {categories.loading && categories.data.length === 0 ? (
                    <p className="text-sm text-slate-500">Loading categories…</p>
                  ) : null}
                </div>
              </fieldset>
            </div>
          ) : null}

          {step === 1 ? <LocationStep draft={draft} patch={patch} errors={errors} /> : null}

          {step === 2 ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <HoursEditor value={draft.hours} onChange={(hours) => patch({ hours })} />
              <div className="space-y-4">
                {errors.hours ? <p className="text-xs font-medium text-rose-600">{errors.hours}</p> : null}
                <Field
                  label="Prep time (minutes)"
                  required
                  error={errors.prepMinutes}
                  hint="5 to 240 minutes."
                >
                  {(id, describedBy) => (
                    <TextInput
                      id={id}
                      type="number"
                      min={5}
                      max={240}
                      aria-describedby={describedBy}
                      value={draft.prepMinutes}
                      onChange={(event) => patch({ prepMinutes: event.target.value })}
                      className="w-32"
                    />
                  )}
                </Field>
                <Field
                  label="Same-day cut-off"
                  required
                  error={errors.sameDayCutoff}
                  hint="Orders after this time are delivered the next working day."
                >
                  {(id, describedBy) => (
                    <TextInput
                      id={id}
                      type="time"
                      aria-describedby={describedBy}
                      value={draft.sameDayCutoff}
                      onChange={(event) => patch({ sameDayCutoff: event.target.value })}
                      className="w-32"
                    />
                  )}
                </Field>
                <ClosuresEditor
                  value={draft.closures}
                  minDate={today}
                  onChange={(closures) => patch({ closures })}
                />
                {errors.closures ? (
                  <p className="text-xs font-medium text-rose-600">{errors.closures}</p>
                ) : null}
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <Toggle
                  checked={draft.delivery}
                  onChange={(delivery) => patch({ delivery })}
                  label="Delivery to jobsites"
                  description="Independent drivers collect at the counter."
                />
                <Toggle
                  checked={draft.pickup}
                  onChange={(pickup) => patch({ pickup })}
                  label="Pickup at the counter"
                  description="The customer shows a 4-digit PIN."
                />
                <Field
                  label="Delivery radius (road km)"
                  required
                  error={errors.fulfilment}
                  hint="1 to 60 km from the yard."
                >
                  {(id, describedBy) => (
                    <TextInput
                      id={id}
                      type="number"
                      min={1}
                      max={60}
                      aria-describedby={describedBy}
                      value={draft.radiusKm}
                      onChange={(event) => patch({ radiusKm: event.target.value })}
                      className="w-32"
                    />
                  )}
                </Field>
                <Field
                  label="Loading notes for drivers (optional)"
                  hint="Gate codes, dock directions. Never public."
                >
                  {(id, describedBy) => (
                    <TextArea
                      id={id}
                      aria-describedby={describedBy}
                      value={draft.loadingNotes}
                      maxLength={500}
                      onChange={(event) => patch({ loadingNotes: event.target.value })}
                    />
                  )}
                </Field>
              </div>
              {draft.location ? (
                <AppMap
                  className="h-72"
                  accessibilityLabel={`Delivery radius of ${draft.radiusKm} km around the store`}
                  markers={[{ id: 'store', kind: 'store', position: draft.location, title: draft.name }]}
                  circles={
                    Number.isFinite(radiusKm) && radiusKm > 0
                      ? [{ id: 'radius', center: draft.location, radiusM: radiusKm * 1000 }]
                      : []
                  }
                  fit={{
                    key: `${fitKeyFor([draft.location])}:${draft.radiusKm}`,
                    points: [draft.location],
                    maxZoom: 9,
                  }}
                />
              ) : null}
            </div>
          ) : null}

          {step === 4 ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Field
                label="Commission (%)"
                required
                error={errors.commission}
                hint="InstaSupply's share of the store's sales. The default is 10 %."
              >
                {(id, describedBy) => (
                  <TextInput
                    id={id}
                    type="number"
                    min={0}
                    max={50}
                    step={0.5}
                    aria-describedby={describedBy}
                    value={draft.commission}
                    onChange={(event) => patch({ commission: event.target.value })}
                    className="w-32"
                  />
                )}
              </Field>
              <Field
                label="Status"
                required
                error={errors.status}
                hint={STORE_STATUS_META[draft.status].hint}
              >
                {(id, describedBy) => (
                  <Select
                    id={id}
                    aria-describedby={describedBy}
                    value={draft.status}
                    onChange={(event) => patch({ status: event.target.value as StoreStatus })}
                  >
                    {STORE_STATUSES.filter((status) => status !== 'closed').map((status) => (
                      <option key={status} value={status}>
                        {STORE_STATUS_META[status].label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Order alert mobile (optional)" hint="Gets a text for every new order.">
                {(id, describedBy) => (
                  <TextInput
                    id={id}
                    type="tel"
                    aria-describedby={describedBy}
                    value={draft.alertPhone}
                    onChange={(event) => patch({ alertPhone: event.target.value })}
                  />
                )}
              </Field>
              <Field label="Orders email (optional)">
                {(id) => (
                  <TextInput
                    id={id}
                    type="email"
                    value={draft.ordersEmail}
                    onChange={(event) => patch({ ordersEmail: event.target.value })}
                  />
                )}
              </Field>
            </div>
          ) : null}

          {step === 5 ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <p className="text-sm text-slate-600 lg:col-span-2">
                Invite the store owner now, or later from the store's Team tab. The owner gets a link to
                choose a password for the supplier portal.
              </p>
              <Field label="Owner's name" error={errors.ownerName}>
                {(id, describedBy) => (
                  <TextInput
                    id={id}
                    aria-describedby={describedBy}
                    value={draft.ownerName}
                    onChange={(event) => patch({ ownerName: event.target.value })}
                  />
                )}
              </Field>
              <Field label="Owner's email">
                {(id) => (
                  <TextInput
                    id={id}
                    type="email"
                    value={draft.ownerEmail}
                    onChange={(event) => patch({ ownerEmail: event.target.value })}
                  />
                )}
              </Field>
              {created ? (
                <Callout tone="info" icon={SuccessIcon}>
                  The store is created. Only the invite is left.
                </Callout>
              ) : null}
            </div>
          ) : null}

          {formError ? (
            <Callout tone="danger" icon={ErrorIcon}>
              {formError}
            </Callout>
          ) : null}

          <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-4">
            <Button
              variant="secondary"
              disabled={step === 0 || busy}
              onClick={() => setStep((current) => Math.max(0, current - 1) as Step)}
            >
              Back
            </Button>
            {step < 5 ? (
              <Button onClick={goNext}>Continue</Button>
            ) : (
              <Button loading={busy} onClick={() => void submit()}>
                {created
                  ? 'Send invite'
                  : draft.ownerEmail.trim()
                    ? 'Create store and invite owner'
                    : 'Create store'}
              </Button>
            )}
          </div>
        </CardBody>
      </Card>
    </>
  );
}
