import type { DeliveryInput, LatLng, Priority } from '@instasupply/shared';
import { useCallback } from 'react';

import { Field, Segmented, TextArea, TextInput, Toggle } from '@/components/ui/Form';

import type { DeliveryDraft } from './delivery-form';
import { LocationPicker } from './LocationPicker';

export type DraftErrors = Partial<Record<keyof DeliveryInput | 'form', string>>;

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

/**
 * Site contact, drop-off and load fields shared by the create and edit dialogs of a manual delivery.
 * Payment is by card at checkout for marketplace orders; manual deliveries carry no cash amount.
 */
export function DeliveryFormFields({
  draft,
  errors,
  onChange,
}: {
  draft: DeliveryDraft;
  errors: DraftErrors;
  onChange: (patch: Partial<DeliveryDraft>) => void;
}) {
  const setLocation = useCallback(
    (location: LatLng, label?: string | null) => onChange({ location, locationLabel: label ?? null }),
    [onChange],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <Field label="Site contact" required error={errors.customerName}>
          {(id) => (
            <TextInput
              id={id}
              value={draft.customerName}
              invalid={!!errors.customerName}
              onChange={(event) => onChange({ customerName: event.target.value })}
              placeholder="Dana Whitfield"
              autoComplete="off"
              autoFocus
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone" error={errors.customerPhone} hint="Gets the live tracking text.">
            {(id, describedBy) => (
              <TextInput
                id={id}
                type="tel"
                aria-describedby={describedBy}
                value={draft.customerPhone}
                invalid={!!errors.customerPhone}
                onChange={(event) => onChange({ customerPhone: event.target.value })}
                placeholder="416-555-0142"
              />
            )}
          </Field>
          <Field label="Email" error={errors.customerEmail}>
            {(id) => (
              <TextInput
                id={id}
                type="email"
                value={draft.customerEmail}
                invalid={!!errors.customerEmail}
                onChange={(event) => onChange({ customerEmail: event.target.value })}
                placeholder="site@whitfieldreno.ca"
              />
            )}
          </Field>
        </div>
        <Field label="Jobsite address" required error={errors.address}>
          {(id) => (
            <TextInput
              id={id}
              value={draft.address}
              invalid={!!errors.address}
              onChange={(event) => onChange({ address: event.target.value })}
              placeholder="1200 Queen St E, Toronto, ON M4M 1L5"
            />
          )}
        </Field>
        <Field label="Directions for the driver" hint="Gate code, where to unload, who to ask for…">
          {(id, describedBy) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              value={draft.addressNotes}
              onChange={(event) => onChange({ addressNotes: event.target.value })}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Pieces" error={errors.packageCount} hint="Bundles, boxes or loose pieces.">
            {(id, describedBy) => (
              <TextInput
                id={id}
                type="number"
                min={1}
                max={99}
                aria-describedby={describedBy}
                value={draft.packageCount}
                invalid={!!errors.packageCount}
                onChange={(event) => onChange({ packageCount: event.target.value })}
              />
            )}
          </Field>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-slate-700">Priority</p>
            <Segmented
              ariaLabel="Priority"
              value={draft.priority}
              options={PRIORITY_OPTIONS}
              onChange={(priority) => onChange({ priority })}
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Window starts" hint="Toronto time.">
            {(id, describedBy) => (
              <TextInput
                id={id}
                type="datetime-local"
                aria-describedby={describedBy}
                value={draft.windowStart}
                onChange={(event) => onChange({ windowStart: event.target.value })}
              />
            )}
          </Field>
          <Field label="Deliver by" error={errors.windowEnd} hint="Toronto time.">
            {(id, describedBy) => (
              <TextInput
                id={id}
                type="datetime-local"
                aria-describedby={describedBy}
                value={draft.windowEnd}
                invalid={!!errors.windowEnd}
                onChange={(event) => onChange({ windowEnd: event.target.value })}
              />
            )}
          </Field>
        </div>
        <Toggle
          checked={draft.requireCode}
          onChange={(requireCode) => onChange({ requireCode })}
          label="Require hand-off code"
          description="The site contact sees a 4-digit code on their tracking page; the driver enters it to complete."
        />
        <Field label="Internal notes" hint="Visible to dispatch and the assigned driver.">
          {(id, describedBy) => (
            <TextArea
              id={id}
              aria-describedby={describedBy}
              value={draft.notes}
              onChange={(event) => onChange({ notes: event.target.value })}
              rows={2}
            />
          )}
        </Field>
      </div>

      <LocationPicker
        address={draft.address}
        location={draft.location}
        locationLabel={draft.locationLabel}
        onLocationChange={setLocation}
        onAddressSuggestion={(label) => {
          if (!draft.address.trim()) onChange({ address: label });
        }}
        error={errors.location}
      />
    </div>
  );
}
