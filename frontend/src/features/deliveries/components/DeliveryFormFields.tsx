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

/** Customer, drop-off and package fields shared by the create and edit dialogs. */
export function DeliveryFormFields({
  draft,
  errors,
  onChange,
}: {
  draft: DeliveryDraft;
  errors: DraftErrors;
  onChange: (patch: Partial<DeliveryDraft>) => void;
}) {
  const setLocation = useCallback((location: LatLng) => onChange({ location }), [onChange]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <Field label="Customer name" required error={errors.customerName}>
          {(id) => (
            <TextInput
              id={id}
              value={draft.customerName}
              invalid={!!errors.customerName}
              onChange={(event) => onChange({ customerName: event.target.value })}
              placeholder="Asha Rao"
              autoFocus
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone" error={errors.customerPhone} hint="Used for the live tracking SMS.">
            {(id, describedBy) => (
              <TextInput
                id={id}
                type="tel"
                aria-describedby={describedBy}
                value={draft.customerPhone}
                invalid={!!errors.customerPhone}
                onChange={(event) => onChange({ customerPhone: event.target.value })}
                placeholder="+91 98765 43210"
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
                placeholder="asha@example.com"
              />
            )}
          </Field>
        </div>
        <Field label="Address" required error={errors.address}>
          {(id) => (
            <TextInput
              id={id}
              value={draft.address}
              invalid={!!errors.address}
              onChange={(event) => onChange({ address: event.target.value })}
              placeholder="12, 80 Feet Rd, Koramangala, Bengaluru"
            />
          )}
        </Field>
        <Field label="Directions for the driver" hint="Gate, floor, landmark…">
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
          <Field label="Packages" error={errors.packageCount}>
            {(id) => (
              <TextInput
                id={id}
                type="number"
                min={1}
                max={99}
                value={draft.packageCount}
                invalid={!!errors.packageCount}
                onChange={(event) => onChange({ packageCount: event.target.value })}
              />
            )}
          </Field>
          <Field label="Cash on delivery (₹)" error={errors.codAmount} hint="Leave empty if prepaid.">
            {(id, describedBy) => (
              <TextInput
                id={id}
                type="number"
                min={0}
                step="0.01"
                aria-describedby={describedBy}
                value={draft.codAmount}
                invalid={!!errors.codAmount}
                onChange={(event) => onChange({ codAmount: event.target.value })}
              />
            )}
          </Field>
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-slate-700">Priority</p>
          <Segmented
            ariaLabel="Priority"
            value={draft.priority}
            options={PRIORITY_OPTIONS}
            onChange={(priority) => onChange({ priority })}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Window starts">
            {(id) => (
              <TextInput
                id={id}
                type="datetime-local"
                value={draft.windowStart}
                onChange={(event) => onChange({ windowStart: event.target.value })}
              />
            )}
          </Field>
          <Field label="Deliver by" error={errors.windowEnd}>
            {(id) => (
              <TextInput
                id={id}
                type="datetime-local"
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
          description="The customer sees a 4-digit code on their tracking page; the driver must enter it to complete."
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
        onLocationChange={setLocation}
        onAddressSuggestion={(label) => {
          if (!draft.address.trim()) onChange({ address: label });
        }}
        error={errors.location}
      />
    </div>
  );
}
