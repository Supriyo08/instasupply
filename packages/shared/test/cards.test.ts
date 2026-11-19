/**
 * Saved test cards (§1.3, §3.8): brand detection, the Luhn check and the expiry rule. Only the brand,
 * the last four digits and the expiry are ever stored.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { detectCardBrand, fromLocal, isFutureExpiry, isValidCardNumber, type CardBrand } from '../src';

/** A small seeded generator (mulberry32): the random cases are the same on every run. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The brands a saved card can have, as the rules list them (§6.3 `isValidCard`). Written as a record so
 * that this file stops compiling when a brand is added to or removed from `CardBrand`.
 */
const BRANDS: Record<CardBrand, true> = {
  visa: true,
  mastercard: true,
  amex: true,
  discover: true,
  card: true,
};

/** The numbers §3.8 publishes for test mode, with the brand each one is saved under. */
const PUBLISHED: [number: string, brand: CardBrand, last4: string][] = [
  ['4242 4242 4242 4242', 'visa', '4242'],
  ['5555 5555 5555 4444', 'mastercard', '4444'],
  ['3782 822463 10005', 'amex', '0005'],
  ['4000 0000 0000 0002', 'visa', '0002'], // declined
  ['4000 0000 0000 9995', 'visa', '9995'], // insufficient funds
  ['4000 0000 0000 0069', 'visa', '0069'], // expired
  ['4000 0000 0000 0341', 'visa', '0341'], // authorizes, capture fails
];

/** The check digit that makes `body` plus that digit pass the Luhn test. */
function luhnDigit(body: string): number {
  let sum = 0;
  for (let offset = 0; offset < body.length; offset += 1) {
    let digit = Number(body.charAt(body.length - 1 - offset));
    if (offset % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return (10 - (sum % 10)) % 10;
}

describe('card brands', () => {
  it('has exactly the five brands the rules accept', () => {
    assert.deepEqual(Object.keys(BRANDS), ['visa', 'mastercard', 'amex', 'discover', 'card']);
  });

  it('detects Visa, Mastercard and American Express from the leading digits', () => {
    assert.equal(detectCardBrand('4242 4242 4242 4242'), 'visa');
    assert.equal(detectCardBrand('4'), 'visa');
    assert.equal(detectCardBrand('5100 0000 0000 0000'), 'mastercard');
    assert.equal(detectCardBrand('5555 5555 5555 4444'), 'mastercard');
    assert.equal(detectCardBrand('2221 0000 0000 0009'), 'mastercard');
    assert.equal(detectCardBrand('2720 9900 0000 0000'), 'mastercard');
    assert.equal(detectCardBrand('3782 822463 10005'), 'amex');
    assert.equal(detectCardBrand('3400 000000 00000'), 'amex');
    // Next to the ranges.
    assert.equal(detectCardBrand('5000 0000 0000 0000'), 'card');
    assert.equal(detectCardBrand('5600 0000 0000 0000'), 'card');
    assert.equal(detectCardBrand('2100 0000 0000 0000'), 'card');
    assert.equal(detectCardBrand('2800 0000 0000 0000'), 'card');
    assert.equal(detectCardBrand('3600 000000 0000'), 'card');
  });

  it('detects Discover: 6011, 644–649 and 65', () => {
    assert.equal(detectCardBrand('6011 0000 0000 0004'), 'discover');
    assert.equal(detectCardBrand('6440 0000 0000 0000'), 'discover');
    assert.equal(detectCardBrand('6490 0000 0000 0000'), 'discover');
    assert.equal(detectCardBrand('6500 0000 0000 0002'), 'discover');
    assert.equal(detectCardBrand('6599 0000 0000 0000'), 'discover');
    // Next to the ranges.
    assert.equal(detectCardBrand('6010 0000 0000 0000'), 'card');
    assert.equal(detectCardBrand('6012 0000 0000 0000'), 'card');
    assert.equal(detectCardBrand('6430 0000 0000 0000'), 'card');
    assert.equal(detectCardBrand('6600 0000 0000 0000'), 'card');
  });

  it('names no other network: their numbers are a plain card', () => {
    // Prefixes 60, 81, 82 and 508 used to have a brand of their own in the prototype.
    for (const number of [
      '6080 0000 0000 0000',
      '8100 0000 0000 0000',
      '8200 0000 0000 0000',
      '5085 0000 0000 0000',
    ]) {
      assert.equal(detectCardBrand(number), 'card', number);
    }
    assert.equal(detectCardBrand('9999'), 'card');
    assert.equal(detectCardBrand(''), 'card');
    assert.equal(detectCardBrand('not a number'), 'card');
  });

  it('only ever answers with one of the five brands', () => {
    const random = mulberry32(38);
    for (let round = 0; round < 500; round += 1) {
      const number = Array.from({ length: 16 }, () => Math.floor(random() * 10)).join('');
      assert.ok(detectCardBrand(number) in BRANDS, number);
    }
  });
});

describe('card numbers', () => {
  it('accepts every published test number under its brand', () => {
    for (const [number, brand, last4] of PUBLISHED) {
      assert.equal(isValidCardNumber(number), true, number);
      assert.equal(detectCardBrand(number), brand, number);
      assert.equal(number.replace(/\D/g, '').slice(-4), last4);
    }
  });

  it('ignores spaces and dashes', () => {
    assert.equal(isValidCardNumber('378282246310005'), true);
    assert.equal(isValidCardNumber('4111-1111-1111-1111'), true);
    assert.equal(isValidCardNumber(' 4111 1111 1111 1111 '), true);
    assert.equal(isValidCardNumber('4111 1111 1111 1112'), false);
  });

  it('wants 12 to 19 digits', () => {
    for (let length = 8; length <= 22; length += 1) {
      const body = '4'.padEnd(length - 1, '0');
      const number = `${body}${luhnDigit(body)}`;
      assert.equal(isValidCardNumber(number), length >= 12 && length <= 19, `${length} digits`);
    }
    assert.equal(isValidCardNumber(''), false);
    assert.equal(isValidCardNumber('4242'), false);
  });

  it('catches every single mistyped digit of the published numbers', () => {
    for (const [number] of PUBLISHED) {
      const digits = number.replace(/\D/g, '');
      for (let position = 0; position < digits.length; position += 1) {
        for (let digit = 0; digit <= 9; digit += 1) {
          const typed = `${digits.slice(0, position)}${digit}${digits.slice(position + 1)}`;
          assert.equal(isValidCardNumber(typed), typed === digits, typed);
        }
      }
    }
  });

  it('accepts 300 random numbers with the right check digit and no other', () => {
    const random = mulberry32(3_8);
    for (let round = 0; round < 300; round += 1) {
      const length = 12 + Math.floor(random() * 8);
      const body = Array.from({ length: length - 1 }, () => Math.floor(random() * 10)).join('');
      const check = luhnDigit(body);
      for (let digit = 0; digit <= 9; digit += 1) {
        assert.equal(isValidCardNumber(`${body}${digit}`), digit === check, `${body}${digit}`);
      }
    }
  });
});

describe('card expiry', () => {
  const now = Date.UTC(2026, 10, 19, 17, 25); // Thu 19 Nov 2026, 12:25 pm in Toronto

  it('accepts a card until the end of its expiry month', () => {
    assert.equal(isFutureExpiry(11, 2026, now), true);
    assert.equal(isFutureExpiry(12, 2026, now), true);
    assert.equal(isFutureExpiry(1, 2027, now), true);
    assert.equal(isFutureExpiry(10, 2026, now), false);
    assert.equal(isFutureExpiry(12, 2025, now), false);
    // The last millisecond of November in Toronto (EST, UTC−5), then the first of December.
    assert.equal(isFutureExpiry(11, 2026, Date.UTC(2026, 11, 1, 4, 59, 59, 999)), true);
    assert.equal(isFutureExpiry(11, 2026, Date.UTC(2026, 11, 1, 5)), false);
    assert.equal(isFutureExpiry(12, 2026, Date.UTC(2027, 0, 1, 4, 59, 59, 999)), true);
    assert.equal(isFutureExpiry(12, 2026, Date.UTC(2027, 0, 1, 5)), false);
  });

  it('ends the month at midnight in Toronto, not in UTC (§1.1)', () => {
    // 8 pm and 11:59 pm on 30 Nov in Toronto are already 1 Dec in UTC; the card is still good.
    assert.equal(isFutureExpiry(11, 2026, fromLocal('2026-11-30', 20 * 60)), true);
    assert.equal(isFutureExpiry(11, 2026, fromLocal('2026-11-30', 23 * 60 + 59)), true);
    assert.equal(isFutureExpiry(11, 2026, fromLocal('2026-12-01', 0)), false);
    // In summer time (EDT, UTC−4): 31 Jul at 8:30 pm is still July.
    assert.equal(isFutureExpiry(7, 2027, fromLocal('2027-07-31', 20 * 60 + 30)), true);
    assert.equal(isFutureExpiry(7, 2027, fromLocal('2027-08-01', 0)), false);
    // A year no date can spell falls back to the month end in UTC.
    assert.equal(isFutureExpiry(12, 9999, now), true);
    assert.equal(isFutureExpiry(6, 999, now), false);
  });

  it('reads a two-digit year as 20xx', () => {
    assert.equal(isFutureExpiry(11, 26, now), true);
    assert.equal(isFutureExpiry(10, 26, now), false);
    assert.equal(isFutureExpiry(1, 30, now), true);
  });

  it('refuses a month or a year that does not exist', () => {
    assert.equal(isFutureExpiry(13, 2030, now), false);
    assert.equal(isFutureExpiry(0, 2030, now), false);
    assert.equal(isFutureExpiry(-1, 2030, now), false);
    assert.equal(isFutureExpiry(6.5, 2030, now), false);
    assert.equal(isFutureExpiry(Number.NaN, 2030, now), false);
    assert.equal(isFutureExpiry(6, -2030, now), false);
    assert.equal(isFutureExpiry(6, 2030.5, now), false);
    assert.equal(isFutureExpiry(6, Number.NaN, now), false);
  });
});
