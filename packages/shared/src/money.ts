/**
 * Money arithmetic (§3.1). Every amount is a whole number of CAD cents, so the app, the server, the
 * seed and the tests agree to the cent (D4). Nothing here uses floats for money or `Intl` (D14).
 *
 * The arithmetic functions throw a `RangeError` on anything that is not a non-negative whole number,
 * and when an intermediate product would leave the range where JavaScript integers are exact: a wrong
 * charge must fail loudly, never round quietly. The two display functions never throw, because a
 * missing amount on a screen should show a dash, not crash the screen.
 */

/** Shown in place of an amount that is missing or is not whole cents. */
const NO_AMOUNT = '—';

/**
 * Returns the checked value, with -0 as 0. A -0 is "zero cents" and passes the check, but it is not the
 * same value: Firestore stores it as a double, so a rule that asks for an integer amount would refuse it.
 */
function requireWhole(label: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative whole number, got ${String(value)}`);
  }
  return value === 0 ? 0 : value;
}

/** Above 2^53 − 1 JavaScript integers stop being exact, and a cent could go missing unnoticed. */
function requireExact(label: string, value: number): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} is too large to stay exact`);
}

/**
 * `a × b ÷ c`, rounded half-up, for non-negative whole numbers (§3.1 rule 2). Used wherever one
 * amount is scaled by a ratio: per-km fees (`mulDivHalfUp(perKmCents, tenths, 10)`, rule 6), the
 * discount kept on a short-shipped line (§3.6) and refunds (§3.7).
 */
export function mulDivHalfUp(a: number, b: number, c: number): number {
  requireWhole('mulDivHalfUp: a', a);
  requireWhole('mulDivHalfUp: b', b);
  requireWhole('mulDivHalfUp: c', c);
  if (c === 0) throw new RangeError('mulDivHalfUp: c must be greater than 0');
  const numerator = 2 * a * b + c;
  requireExact('mulDivHalfUp: a × b', numerator);
  return Math.floor(numerator / (2 * c));
}

/**
 * A share of an amount in basis points (1 % = 100 bps), rounded half-up (§3.1 rule 3). HST is
 * `percentBps(taxable, 1300)`; commission uses the store's rate (rule 9).
 */
export function percentBps(cents: number, bps: number): number {
  requireWhole('percentBps: cents', cents);
  requireWhole('percentBps: bps', bps);
  const numerator = cents * bps + 5000;
  requireExact('percentBps: cents × bps', numerator);
  return Math.floor(numerator / 10000);
}

/**
 * Splits `total` in proportion to `weights` so that the parts always add up to `total` (§3.1 rule 4).
 * Each part first gets its share rounded down; the cents left over go, one each, to the parts with
 * the largest exact remainders `(total × weight) mod sum`, the earlier part winning a tie. This is how
 * one discount is spread over stores and then over each store's lines (§3.4 step 4).
 *
 * Weights that add up to zero can only share a total of zero (a replacement order has $0 lines).
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  const wholeTotal = requireWhole('allocate: total', total);
  const wholeWeights: number[] = [];
  let weightSum = 0;
  // `entries()` also visits the holes of a sparse array, so a missing weight fails the check below.
  for (const [index, weight] of weights.entries()) {
    wholeWeights.push(requireWhole(`allocate: weights[${index}]`, weight));
    weightSum += weight;
  }
  requireExact('allocate: the sum of the weights', weightSum);

  if (weightSum === 0) {
    if (wholeTotal === 0) return wholeWeights.map(() => 0);
    throw new RangeError('allocate: a total above 0 needs at least one weight above 0');
  }

  const shares: number[] = [];
  const ranked: { index: number; remainder: number }[] = [];
  let assigned = 0;
  for (const [index, weight] of wholeWeights.entries()) {
    const scaled = wholeTotal * weight;
    requireExact(`allocate: total × weights[${index}]`, scaled);
    const share = Math.floor(scaled / weightSum);
    shares.push(share);
    ranked.push({ index, remainder: scaled % weightSum });
    assigned += share;
  }

  // The index is part of the order on purpose: the tie rule must not depend on how an engine sorts.
  ranked.sort((x, y) => y.remainder - x.remainder || x.index - y.index);
  const extraCent = new Set(ranked.slice(0, wholeTotal - assigned).map((entry) => entry.index));
  return shares.map((share, index) => (extraCent.has(index) ? share + 1 : share));
}

/** Rounds up to the next 25 cents: driver offers are quoted in quarters (§3.1 rule 9). */
export function ceilTo25(cents: number): number {
  const whole = requireWhole('ceilTo25: cents', cents);
  const past = whole % 25;
  const rounded = past === 0 ? whole : whole + (25 - past);
  requireExact('ceilTo25: cents', rounded);
  return rounded;
}

/**
 * Cents as Canadian dollars: `$1,284.50`, `-$12.21`, `$0.00` (§3.1 rule 11). Written by hand because
 * `Intl` gives different results on Hermes, browsers and Node (D14). A missing value, or one that is
 * not whole cents, shows as a dash.
 */
export function formatMoney(cents: number | null | undefined): string {
  if (cents == null || !Number.isSafeInteger(cents)) return NO_AMOUNT;
  const absolute = Math.abs(cents);
  const dollars = String((absolute - (absolute % 100)) / 100);
  const head = dollars.length % 3 || 3;
  let grouped = dollars.slice(0, head);
  for (let index = head; index < dollars.length; index += 3) grouped += `,${dollars.slice(index, index + 3)}`;
  return `${cents < 0 ? '-' : ''}$${grouped}.${String(absolute % 100).padStart(2, '0')}`;
}

/** A fee line: `Free` when nothing is charged, otherwise the amount (§3.1 rule 11). */
export function formatFee(cents: number | null | undefined): string {
  return cents === 0 ? 'Free' : formatMoney(cents);
}
