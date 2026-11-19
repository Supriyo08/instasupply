import { useLiveQuery } from '@instasupply/expo-firebase';
import {
  COLLECTIONS,
  cleanText,
  detectCardBrand,
  isFutureExpiry,
  isValidCardNumber,
  type SavedCard,
} from '@instasupply/shared';
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

const cardsCol = (uid: string) => collection(db, COLLECTIONS.users, uid, COLLECTIONS.cards);

export function useCards(uid: string) {
  const cardsQuery = useMemo(() => query(cardsCol(uid), orderBy('createdAt', 'asc')), [uid]);
  const result = useLiveQuery<SavedCard>(cardsQuery, `cards:${uid}`);
  return { ...result, defaultCard: result.data.find((card) => card.isDefault) ?? result.data[0] ?? null };
}

export interface NewCardInput {
  holder: string;
  number: string;
  expiry: string; // MM/YY
  cvv: string;
  makeDefault: boolean;
}

export type CardErrors = Partial<Record<'holder' | 'number' | 'expiry' | 'cvv', string>>;

export function validateCard(input: NewCardInput): CardErrors {
  const errors: CardErrors = {};
  if (!cleanText(input.holder, 80)) errors.holder = 'Enter the name on the card.';
  if (!isValidCardNumber(input.number)) errors.number = 'Enter a valid card number.';
  const [month, year] = input.expiry.split('/').map((part) => Number(part.trim()));
  if (!month || !year || !isFutureExpiry(month, year)) errors.expiry = 'Enter a valid expiry (MM/YY).';
  if (!/^\d{3,4}$/.test(input.cvv)) errors.cvv = 'Enter the 3 or 4 digit CVV.';
  return errors;
}

/**
 * Saves only brand, last 4 digits and expiry — never the full number or CVV (the security rules
 * reject any other field). Payments run in test mode until a payment gateway is connected.
 */
export async function addCard(uid: string, input: NewCardInput, existing: SavedCard[]) {
  const digits = input.number.replace(/\D/g, '');
  const [month, year] = input.expiry.split('/').map((part) => Number(part.trim()));
  const isDefault = input.makeDefault || existing.length === 0;
  const created = await addDoc(cardsCol(uid), {
    brand: detectCardBrand(digits),
    last4: digits.slice(-4),
    expMonth: month,
    expYear: year! < 100 ? 2000 + year! : year,
    holder: cleanText(input.holder, 80),
    isDefault,
    createdAt: serverTimestamp(),
  });
  if (isDefault) await clearOtherDefaults(uid, created.id, existing);
  return created.id;
}

export async function setDefaultCard(uid: string, id: string, cards: SavedCard[]) {
  await updateDoc(doc(cardsCol(uid), id), { isDefault: true });
  await clearOtherDefaults(uid, id, cards);
}

async function clearOtherDefaults(uid: string, keepId: string, cards: SavedCard[]) {
  const toClear = cards.filter((card) => card.id !== keepId && card.isDefault);
  if (toClear.length === 0) return;
  const batch = writeBatch(db);
  toClear.forEach((card) => batch.update(doc(cardsCol(uid), card.id), { isDefault: false }));
  await batch.commit();
}

export async function deleteCard(uid: string, id: string) {
  await deleteDoc(doc(cardsCol(uid), id));
}
