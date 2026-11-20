/**
 * Typed dollar amounts in the quote builder ("12.50", "$1,200", ".5"). Parsed with integer arithmetic so
 * a typed price never picks up a floating-point cent, and never reformatted while the user is typing.
 */

/** The largest agreed unit price the builder accepts: $100,000.00. */
export const MAX_PRICE_CENTS = 10_000_000;

export type PriceParse = { ok: true; cents: number | null } | { ok: false; error: string };

const DOLLARS = /^(\d*)(?:\.(\d*))?$/;

/** Empty text is `null` (no agreed price: the list price applies). */
export function parsePriceText(text: string): PriceParse {
  const raw = text.trim().replace(/^\$/, '').replace(/,/g, '').trim();
  if (raw === '') return { ok: true, cents: null };
  const match = DOLLARS.exec(raw);
  const whole = match?.[1] ?? '';
  const fraction = match?.[2] ?? '';
  if (!match || (whole === '' && fraction === '')) {
    return { ok: false, error: 'Enter dollars and cents, like 12.50.' };
  }
  if (fraction.length > 2) return { ok: false, error: 'Use at most two decimals, like 12.50.' };
  const cents = Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0'));
  if (cents < 1) return { ok: false, error: 'Enter at least $0.01, or leave it empty for the list price.' };
  if (cents > MAX_PRICE_CENTS) return { ok: false, error: 'Enter at most $100,000.00.' };
  return { ok: true, cents };
}

/** Cents as the plain text the price field shows when it is not being edited ("12.50"). */
export function priceText(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toFixed(2);
}
