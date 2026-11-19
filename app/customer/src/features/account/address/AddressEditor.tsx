import { describeError } from '@instasupply/expo-firebase';
import { validateAddressFields, type Address, type UserProfile } from '@instasupply/shared';
import { useState } from 'react';

import { Button, Header, Screen } from '@/components/ui';
import { saveAddress } from '@/features/addresses/hooks';
import { useToast } from '@/features/notifications/ToastProvider';
import { notify } from '@/lib/notify';

import { leaveTo } from '../format';
import { FormSection } from '../FormSection';
import { SwitchRow } from '../SwitchRow';
import {
  ADDRESS_LABELS,
  draftFromAddress,
  fillEmpty,
  newAddressDraft,
  type AddressDraft,
  type AddressErrors,
} from './address-form';
import { AddressInputs } from './AddressInputs';
import { LabelChips } from './LabelChips';
import { LocationCard } from './LocationCard';
import { useCurrentLocation } from './useCurrentLocation';

/** First of Home / Work that isn't used yet, else Other. */
function suggestedLabel(addresses: Address[]) {
  const used = new Set(addresses.map((address) => address.label.toLowerCase()));
  return ADDRESS_LABELS.find((option) => !used.has(option.value.toLowerCase()))?.value ?? 'Other';
}

/** Add / edit address form (Big Cart "Shipping Address"); mounted once the address book loaded. */
export function AddressEditor({
  uid,
  profile,
  existing,
  addresses,
  returnTo,
}: {
  uid: string;
  profile: UserProfile;
  existing: Address | null;
  addresses: Address[];
  returnTo?: string;
}) {
  const toast = useToast();
  const { locating, locate } = useCurrentLocation();
  const first = !existing && addresses.length === 0;
  const lockedDefault = first || existing?.isDefault === true;
  const [draft, setDraft] = useState<AddressDraft>(() =>
    existing ? draftFromAddress(existing) : newAddressDraft(profile, suggestedLabel(addresses)),
  );
  const [makeDefault, setMakeDefault] = useState(
    existing ? existing.isDefault : first || returnTo === 'checkout',
  );
  const [errors, setErrors] = useState<AddressErrors>({});
  const [saving, setSaving] = useState(false);

  const clearErrors = (keys: string[]) =>
    setErrors((current) => {
      const next = { ...current };
      for (const key of keys) delete next[key as keyof AddressErrors];
      return next;
    });

  const change = (patch: Partial<AddressDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    clearErrors(Object.keys(patch));
  };

  const pinLocation = async () => {
    const place = await locate();
    if (!place) return;
    setDraft((current) => fillEmpty({ ...current, location: place.location }, place.found));
    clearErrors(['location', ...Object.keys(place.found)]);
    const filled = Object.values(place.found).some(Boolean);
    toast({
      title: 'Location pinned',
      body: filled ? 'We filled in what we could. Please check the details.' : undefined,
      icon: 'map-pin',
    });
  };

  const save = async () => {
    const result = validateAddressFields(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setSaving(true);
    try {
      await saveAddress(uid, result.value, {
        id: existing?.id,
        makeDefault: makeDefault || lockedDefault,
        others: addresses,
      });
      toast({ title: existing ? 'Address updated' : 'Address saved', icon: 'check-circle' });
      leaveTo(returnTo === 'checkout' ? '/checkout/address' : '/addresses');
    } catch (error) {
      notify("Couldn't save the address", describeError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      header={<Header title={existing ? 'Edit address' : 'Add address'} />}
      footer={<Button label="Save address" loading={saving} onPress={() => void save()} />}
    >
      <LocationCard
        location={draft.location}
        locating={locating}
        error={errors.location}
        onLocate={() => void pinLocation()}
        onClear={() => change({ location: null })}
      />
      <FormSection title="Save address as">
        <LabelChips value={draft.label} onChange={(label) => change({ label })} />
      </FormSection>
      <FormSection title="Delivery details">
        <AddressInputs draft={draft} errors={errors} onChange={change} />
      </FormSection>
      <SwitchRow
        label="Make default"
        value={makeDefault || lockedDefault}
        locked={lockedDefault || saving}
        onChange={setMakeDefault}
        hint={
          first
            ? 'Your first address becomes your default.'
            : existing?.isDefault
              ? 'This is your default delivery address.'
              : 'Select this address automatically at checkout.'
        }
      />
    </Screen>
  );
}
