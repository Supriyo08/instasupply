import type { Address, AddressFields, LatLng, UserProfile } from '@instasupply/shared';

import type { IconName } from '@/components/ui';

import { displayPhone } from '../format';

/** Label chips offered on the form; other stored labels are kept as their own chip. */
export const ADDRESS_LABELS: readonly { value: string; icon: IconName }[] = [
  { value: 'Home', icon: 'home' },
  { value: 'Work', icon: 'briefcase' },
  { value: 'Other', icon: 'map-pin' },
];

export function labelIcon(label: string): IconName {
  return ADDRESS_LABELS.find((item) => item.value.toLowerCase() === label.toLowerCase())?.icon ?? 'map-pin';
}

/** Raw form values (strings as typed); `validateAddressFields` turns them into AddressFields. */
export interface AddressDraft {
  label: string;
  name: string;
  phone: string;
  line1: string;
  line2: string;
  landmark: string;
  city: string;
  zip: string;
  location: LatLng | null;
}

export type AddressErrors = Partial<Record<keyof AddressFields | 'form', string>>;

/** A new address starts with the shopper's own name and verified number. */
export function newAddressDraft(
  profile: Pick<UserProfile, 'displayName' | 'phoneNumber'>,
  label = 'Home',
): AddressDraft {
  return {
    label,
    name: profile.displayName,
    // Shown spaced for readability; validateAddressFields normalises it back to E.164.
    phone: displayPhone(profile.phoneNumber),
    line1: '',
    line2: '',
    landmark: '',
    city: '',
    zip: '',
    location: null,
  };
}

export function draftFromAddress(address: Address): AddressDraft {
  return {
    label: address.label,
    name: address.name,
    phone: displayPhone(address.phone),
    line1: address.line1,
    line2: address.line2 ?? '',
    landmark: address.landmark ?? '',
    city: address.city,
    zip: address.zip,
    location: address.location,
  };
}

/** Address lines found by reverse geocoding; only fills fields the shopper left empty. */
export function fillEmpty(
  draft: AddressDraft,
  found: Partial<Pick<AddressDraft, 'line1' | 'line2' | 'city' | 'zip'>>,
) {
  const pick = (current: string, next: string | undefined) => (current.trim() ? current : (next ?? current));
  return {
    ...draft,
    line1: pick(draft.line1, found.line1),
    line2: pick(draft.line2, found.line2),
    city: pick(draft.city, found.city),
    zip: pick(draft.zip, found.zip),
  };
}
