import { useLiveQuery } from '@instasupply/expo-firebase';
import { COLLECTIONS, type Address, type AddressFields } from '@instasupply/shared';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { useMemo } from 'react';

import { db } from '@/lib/firebase';

const addressesCol = (uid: string) => collection(db, COLLECTIONS.users, uid, COLLECTIONS.addresses);

/** Address book with the default address first. */
export function useAddresses(uid: string) {
  const addressesQuery = useMemo(() => query(addressesCol(uid), orderBy('createdAt', 'asc')), [uid]);
  const result = useLiveQuery<Address>(addressesQuery, `addresses:${uid}`);
  const data = useMemo(
    () => [...result.data].sort((a, b) => Number(b.isDefault) - Number(a.isDefault)),
    [result.data],
  );
  return { ...result, data, defaultAddress: data.find((address) => address.isDefault) ?? data[0] ?? null };
}

/** Create or update an address; making it default clears the flag on the others. */
export async function saveAddress(
  uid: string,
  fields: AddressFields,
  options: { id?: string; makeDefault: boolean; others: Address[] },
): Promise<string> {
  const isDefault = options.makeDefault || options.others.length === 0;
  let id = options.id;
  if (id) {
    await updateDoc(doc(addressesCol(uid), id), { ...fields, isDefault, updatedAt: serverTimestamp() });
  } else {
    const created = await addDoc(addressesCol(uid), {
      ...fields,
      isDefault,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    id = created.id;
  }
  if (isDefault) await clearOtherDefaults(uid, id, options.others);
  return id;
}

export async function setDefaultAddress(uid: string, id: string, others: Address[]) {
  await updateDoc(doc(addressesCol(uid), id), { isDefault: true, updatedAt: serverTimestamp() });
  await clearOtherDefaults(uid, id, others);
}

async function clearOtherDefaults(uid: string, keepId: string, others: Address[]) {
  const toClear = others.filter((address) => address.id !== keepId && address.isDefault);
  if (toClear.length === 0) return;
  const batch = writeBatch(db);
  toClear.forEach((address) =>
    batch.update(doc(addressesCol(uid), address.id), { isDefault: false, updatedAt: serverTimestamp() }),
  );
  await batch.commit();
}

export async function deleteAddress(uid: string, id: string) {
  await deleteDoc(doc(addressesCol(uid), id));
}
