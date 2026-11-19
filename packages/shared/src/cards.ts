/**
 * Saved cards for test-mode payments (§1.3, §3.8). Only the brand, the last 4 digits and the expiry
 * are ever stored: a full card number never leaves the form it was typed into.
 */
import { fromLocal } from './time-zone';
import type { TimestampLike } from './types';

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'discover' | 'card';

/** `users/{uid}/cards/{cardId}`. */
export interface SavedCard {
  id: string;
  brand: CardBrand;
  last4: string;
  expMonth: number;
  expYear: number;
  holder: string;
  isDefault: boolean;
  createdAt?: TimestampLike;
}

/** The card network, from the leading digits. `card` when the number matches none we name. */
export function detectCardBrand(number: string): CardBrand {
  const digits = number.replace(/\D/g, '');
  if (/^4/.test(digits)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'mastercard';
  if (/^3[47]/.test(digits)) return 'amex';
  if (/^6(011|5|4[4-9])/.test(digits)) return 'discover';
  return 'card';
}

/**
 * Luhn checksum over 12–19 digits; spaces and dashes are ignored, anything else makes the number
 * invalid. All zeros passes Luhn but is no card (§7.3, "Luhn and expiry checks").
 */
export function isValidCardNumber(number: string): boolean {
  if (typeof number !== 'string' || !/^[\d -]+$/.test(number)) return false;
  const digits = number.replace(/[ -]/g, '');
  if (digits.length < 12 || digits.length > 19 || /^0+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits.charAt(index));
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * A card can be used until the end of its expiry month in Toronto (§1.1: business dates are
 * America/Toronto). `now` is epoch milliseconds and is always passed in, so the app and the server
 * judge the same card the same way.
 */
export function isFutureExpiry(month: number, year: number, now: number): boolean {
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(year) || year < 0) return false;
  const fullYear = year < 100 ? 2000 + year : year;
  const nextYear = month === 12 ? fullYear + 1 : fullYear;
  const nextMonth = month === 12 ? 1 : month + 1;
  // A year that a 'YYYY-MM-DD' date cannot spell is centuries away from any `now`: the UTC month end
  // is as good as Toronto's there. Months are 0-based in Date.UTC, so `month` is the following month.
  if (nextYear < 1000 || nextYear > 9999) return Date.UTC(fullYear, month, 1) > now;
  const firstOfNextMonth = `${String(nextYear)}-${String(nextMonth).padStart(2, '0')}-01`;
  return now < fromLocal(firstOfNextMonth, 0);
}
