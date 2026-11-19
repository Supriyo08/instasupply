import { detectCardBrand, isFutureExpiry, type CardBrand, type SavedCard } from '@instasupply/shared';

export const CARD_BRAND_LABEL: Record<CardBrand, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  rupay: 'RuPay',
  amex: 'American Express',
  card: 'Card',
};

const MAX_DIGITS = 19;
const BULLET = '•';

export const digitsOnly = (value: string) => value.replace(/\D/g, '');

/** Digit group sizes: Amex 4-6-5, everything else 4-4-4-4 (+3 for 19-digit cards). */
function groupsFor(brand: CardBrand, length: number): number[] {
  if (brand === 'amex') return [4, 6, 5];
  return length > 16 ? [4, 4, 4, 4, 3] : [4, 4, 4, 4];
}

function group(digits: string, sizes: number[], separator: string): string {
  const parts: string[] = [];
  let index = 0;
  for (const size of sizes) {
    const part = digits.slice(index, index + size);
    if (!part) break;
    parts.push(part);
    index += size;
  }
  return parts.join(separator);
}

/** Card number as typed, grouped: "4242 4242 4242 4242". */
export function formatCardNumber(value: string): string {
  const digits = digitsOnly(value).slice(0, MAX_DIGITS);
  return group(digits, groupsFor(detectCardBrand(digits), digits.length), ' ');
}

/** Max characters for the number field (digits + spaces) for the detected brand. */
export function cardNumberMaxLength(brand: CardBrand): number {
  return brand === 'amex' ? 17 : MAX_DIGITS + 4;
}

/** Live preview: typed digits with bullets for the rest ("4242  42••  ••••  ••••"). */
export function previewCardNumber(value: string): string {
  const digits = digitsOnly(value).slice(0, MAX_DIGITS);
  const sizes = groupsFor(detectCardBrand(digits), digits.length);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  // Long (19-digit) numbers get single spaces so they still fit on the card.
  return group(digits.padEnd(total, BULLET), sizes, total > 16 ? ' ' : '  ');
}

/** Saved cards only keep the last 4 digits. */
export function maskedCardNumber(last4: string): string {
  return `${BULLET.repeat(4)}  ${BULLET.repeat(4)}  ${BULLET.repeat(4)}  ${last4}`;
}

/** MM/YY field: inserts the slash, pads "4" to "04", and lets backspace remove the slash. */
export function formatExpiryInput(next: string, previous: string): string {
  let digits = digitsOnly(next).slice(0, 4);
  if (digits.length === 1 && Number(digits) > 1) digits = `0${digits}`;
  if (digits.length > 2) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  const deleting = next.length < previous.length;
  return digits.length === 2 && !deleting ? `${digits}/` : digits;
}

export function expiryLabel(month: number, year: number): string {
  return `${String(month).padStart(2, '0')}/${String(year % 100).padStart(2, '0')}`;
}

export function isCardExpired(card: Pick<SavedCard, 'expMonth' | 'expYear'>): boolean {
  return !isFutureExpiry(card.expMonth, card.expYear);
}

/** "Visa ending 4242, expires 08/29" for screen readers. */
export function describeCard(brand: CardBrand, last4: string, expiry: string): string {
  return `${CARD_BRAND_LABEL[brand]} ending ${last4}, expires ${expiry}`;
}
