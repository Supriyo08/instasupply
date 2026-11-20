import { queries } from '@instasupply/api-client';
import { useLiveQuery } from '@instasupply/api-client/react';
import {
  cleanText,
  detectCardBrand,
  isFutureExpiry,
  isValidCardNumber,
  type SavedCard,
} from '@instasupply/shared';

import { api } from '@/lib/api';
import { newRequestId } from '@/lib/ids';

/**
 * Saved cards (`queries.cards`), default first. Only brand, last 4, expiry and holder are stored;
 * payments run in the mode `useConfig().paymentsMode` says (test mode shows the test banner).
 */
export function useCards(uid: string | null | undefined) {
  const result = useLiveQuery(queries.cards(uid));
  return { ...result, defaultCard: result.data.find((card) => card.isDefault) ?? result.data[0] ?? null };
}

export interface NewCardInput {
  holder: string;
  number: string;
  /** MM/YY */
  expiry: string;
  cvv: string;
  makeDefault: boolean;
}

export type CardErrors = Partial<Record<'holder' | 'number' | 'expiry' | 'cvv', string>>;

function parseExpiry(expiry: string): { month: number; year: number } | null {
  const [month, year] = expiry.split('/').map((part) => Number(part.trim()));
  if (!month || year === undefined || Number.isNaN(year)) return null;
  return { month, year: year < 100 ? 2000 + year : year };
}

/** Luhn, expiry (against `now`) and CVV checks for the add-card form. */
export function validateCard(input: NewCardInput, now: number = Date.now()): CardErrors {
  const errors: CardErrors = {};
  if (!cleanText(input.holder, 80)) errors.holder = 'Enter the name on the card.';
  if (!isValidCardNumber(input.number)) errors.number = 'Enter a valid card number.';
  const expiry = parseExpiry(input.expiry);
  if (!expiry || !isFutureExpiry(expiry.month, expiry.year, now))
    errors.expiry = 'Enter a valid expiry (MM/YY).';
  if (!/^\d{3,4}$/.test(input.cvv)) errors.cvv = 'Enter the 3 or 4 digit CVV.';
  return errors;
}

/** Saves brand, last 4, expiry and holder only — never the number or CVV. The server moves the default. */
export function addCard(input: NewCardInput, existing: readonly SavedCard[]): Promise<SavedCard> {
  const digits = input.number.replace(/\D/g, '');
  const expiry = parseExpiry(input.expiry);
  if (!expiry) return Promise.reject(new Error('Enter a valid expiry (MM/YY).'));
  return api.cards.save({
    id: newRequestId(),
    brand: detectCardBrand(digits),
    last4: digits.slice(-4),
    expMonth: expiry.month,
    expYear: expiry.year,
    holder: cleanText(input.holder, 80) ?? '',
    isDefault: input.makeDefault || existing.length === 0,
  });
}

export function setDefaultCard(card: SavedCard): Promise<SavedCard> {
  const { createdAt: _createdAt, ...fields } = card;
  return api.cards.save({ ...fields, isDefault: true });
}

export function deleteCard(id: string): Promise<unknown> {
  return api.cards.remove(id);
}
