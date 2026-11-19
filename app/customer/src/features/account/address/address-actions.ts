import type { Address } from '@instasupply/shared';

import { deleteAddress, setDefaultAddress } from '@/features/addresses/hooks';

/** Delete an address; if it was the default, the next one becomes the default. */
export async function removeAddress(uid: string, address: Address, all: Address[]) {
  await deleteAddress(uid, address.id);
  if (!address.isDefault) return;
  const remaining = all.filter((item) => item.id !== address.id);
  const next = remaining[0];
  if (next) await setDefaultAddress(uid, next.id, remaining);
}
