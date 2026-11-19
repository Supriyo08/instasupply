/**
 * Money arithmetic (§3.1): the rounding rules every price, tax, fee, discount share and driver offer
 * is built from, the hand-written money text, and the road distance in tenths of a km that fees are
 * charged on. Expected values are worked out by hand or with BigInt, never with the code under test.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ROAD_DISTANCE_FACTOR,
  allocate,
  ceilTo25,
  formatFee,
  formatMoney,
  haversineMeters,
  mulDivHalfUp,
  percentBps,
  r6,
  roadTenths,
  type LatLng,
} from '../src';

const MAX = Number.MAX_SAFE_INTEGER; // 9 007 199 254 740 991

/** Seeded PRNG, so a failing case can be reproduced: the same seed gives the same numbers. */
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

const below = (random: () => number, limit: number) => Math.floor(random() * limit);

/** §3.1 rule 2 in exact arithmetic. */
const halfUp = (a: number, b: number, c: number) =>
  Number((2n * BigInt(a) * BigInt(b) + BigInt(c)) / (2n * BigInt(c)));

/** §3.1 rule 4 in exact arithmetic: floor shares, then one cent each by remainder, lower index first. */
function allocateExact(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + BigInt(weight), 0n);
  const shares = weights.map((weight) => (BigInt(total) * BigInt(weight)) / sum);
  const remainders = weights.map((weight) => (BigInt(total) * BigInt(weight)) % sum);
  let left = BigInt(total) - shares.reduce((acc, share) => acc + share, 0n);
  const order = weights
    .map((_, index) => index)
    .sort((x, y) => {
      const rx = remainders[x] ?? 0n;
      const ry = remainders[y] ?? 0n;
      return rx === ry ? x - y : ry > rx ? 1 : -1;
    });
  for (const index of order) {
    if (left === 0n) break;
    shares[index] = (shares[index] ?? 0n) + 1n;
    left -= 1n;
  }
  return shares.map(Number);
}

describe('mulDivHalfUp (§3.1 rule 2)', () => {
  it('rounds …49 down and …50 up', () => {
    for (let whole = 0; whole <= 60; whole += 1) {
      assert.equal(mulDivHalfUp(100 * whole + 49, 1, 100), whole, `${whole}.49`);
      assert.equal(mulDivHalfUp(100 * whole + 50, 1, 100), whole + 1, `${whole}.50`);
      assert.equal(mulDivHalfUp(100 * whole + 51, 1, 100), whole + 1, `${whole}.51`);
    }
    assert.equal(mulDivHalfUp(1, 1, 2), 1); // 0.5
    assert.equal(mulDivHalfUp(3, 1, 2), 2); // 1.5
    assert.equal(mulDivHalfUp(5, 1, 2), 3); // 2.5: half-up, not half-to-even
    assert.equal(mulDivHalfUp(7, 3, 6), 4); // 3.5
    assert.equal(mulDivHalfUp(1, 1, 3), 0); // 0.33…
    assert.equal(mulDivHalfUp(2, 1, 3), 1); // 0.66…
    assert.equal(mulDivHalfUp(0, 999, 7), 0);
    assert.equal(mulDivHalfUp(7, 0, 7), 0);
    assert.equal(mulDivHalfUp(7, 13, 1), 91);
  });

  it('prices per-km amounts from tenths of a km (rule 6) as in §3.11', () => {
    assert.equal(mulDivHalfUp(149, 129, 10), 1922); // V1 Bluestone fee: 1 922.1
    assert.equal(mulDivHalfUp(149, 160, 10), 2384); // V1 Kestrel fee: 2 384.0
    assert.equal(mulDivHalfUp(99, 289, 10), 2861); // V3 Boltbin fee: 2 861.1
    assert.equal(mulDivHalfUp(99, 204, 10), 2020); // V3 Voltway fee: 2 019.6
    assert.equal(mulDivHalfUp(100, 229, 10), 2290); // V1 Bluestone driver distance
    assert.equal(mulDivHalfUp(75, 389, 10), 2918); // V3 Boltbin driver distance: 2 917.5, the half goes up
    assert.equal(mulDivHalfUp(75, 304, 10), 2280);
    assert.equal(mulDivHalfUp(115, 164, 10), 1886);
    assert.equal(mulDivHalfUp(150, 149, 10), 2235);
    assert.equal(mulDivHalfUp(75, 72, 10), 540);
  });

  it('scales a discount share and a cancellation fee as in §3.11', () => {
    assert.equal(mulDivHalfUp(215, 20, 24), 179); // V4: 179.17
    assert.equal(mulDivHalfUp(675, 2, 6), 225); // V5: exactly 225
    assert.equal(mulDivHalfUp(4775, 1, 4), 1194); // V8: 1 193.75
  });

  it('equals the exact formula for every small case', () => {
    for (let c = 1; c <= 40; c += 1) {
      for (let a = 0; a <= 90; a += 1) {
        for (const b of [0, 1, 2, 3, 7, 10]) {
          assert.equal(mulDivHalfUp(a, b, c), halfUp(a, b, c), `${a} × ${b} ÷ ${c}`);
        }
      }
    }
  });

  it('equals the exact formula on 20 000 seeded random cases', () => {
    const random = mulberry32(20261119);
    for (let round = 0; round < 20_000; round += 1) {
      const a = below(random, 2_000_000_000);
      const b = below(random, 100_000);
      const c = 1 + below(random, 100_000);
      assert.equal(mulDivHalfUp(a, b, c), halfUp(a, b, c), `${a} × ${b} ÷ ${c}`);
    }
  });

  it('stays exact up to the last safe integer and throws past it', () => {
    // 2·a·b + c may be at most 2^53 − 1.
    const top = (MAX - 1) / 2; // 4 503 599 627 370 495
    assert.equal(mulDivHalfUp(top, 1, 1), top);
    assert.throws(() => mulDivHalfUp(top + 1, 1, 1), RangeError);
    assert.equal(mulDivHalfUp(1, top, 1), top);
    assert.throws(() => mulDivHalfUp(1, top + 1, 1), RangeError);

    for (const c of [1, 2, 3, 4, 7, 10, 24, 25, 100, 9_999, 10_000, 123_456_789]) {
      const a = Math.floor((MAX - c) / 2);
      assert.equal(mulDivHalfUp(a, 1, c), halfUp(a, 1, c), `top of the range ÷ ${c}`);
      const third = Math.floor((MAX - c) / 6);
      assert.equal(mulDivHalfUp(third, 3, c), halfUp(third, 3, c), `3 × top ÷ ${c}`);
      assert.throws(() => mulDivHalfUp(a + 1, 1, c), RangeError, `one past the top ÷ ${c}`);
    }

    assert.equal(mulDivHalfUp(1, 1, MAX - 2), 0);
    assert.equal(mulDivHalfUp(top - 1, 1, 2), 2_251_799_813_685_247); // an even number halved
    assert.throws(() => mulDivHalfUp(94_906_266, 94_906_266, 1), RangeError); // a × b alone is above 2^53
    assert.throws(() => mulDivHalfUp(MAX, 2, 1), RangeError);
    assert.throws(() => mulDivHalfUp(MAX, 1, MAX), RangeError);
  });

  it('refuses anything that is not a non-negative whole number', () => {
    assert.throws(() => mulDivHalfUp(-1, 1, 1), RangeError);
    assert.throws(() => mulDivHalfUp(1, -1, 1), RangeError);
    assert.throws(() => mulDivHalfUp(1, 1, -5), RangeError);
    assert.throws(() => mulDivHalfUp(1, 1, 0), RangeError);
    assert.throws(() => mulDivHalfUp(1.5, 1, 1), RangeError);
    assert.throws(() => mulDivHalfUp(1, 0.1, 1), RangeError);
    assert.throws(() => mulDivHalfUp(1, 1, 2.5), RangeError);
    assert.throws(() => mulDivHalfUp(Number.NaN, 1, 1), RangeError);
    assert.throws(() => mulDivHalfUp(1, Number.POSITIVE_INFINITY, 1), RangeError);
    assert.throws(() => mulDivHalfUp(MAX + 1, 0, 1), RangeError); // 2^53 is not a safe integer
    assert.throws(() => mulDivHalfUp('5' as unknown as number, 1, 1), RangeError);
    assert.throws(() => mulDivHalfUp(1, null as unknown as number, 1), RangeError);
  });
});

describe('percentBps (§3.1 rule 3)', () => {
  it('rounds …49 down and …50 up', () => {
    // 1 % of x cents is x ÷ 100.
    for (let whole = 0; whole <= 60; whole += 1) {
      assert.equal(percentBps(100 * whole + 49, 100), whole, `${whole}.49`);
      assert.equal(percentBps(100 * whole + 50, 100), whole + 1, `${whole}.50`);
    }
    // HST: 13 × 73 = 949 → 9.49; 13 × 50 = 650 → 6.50; 13 × 150 = 1 950 → 19.50.
    assert.equal(percentBps(73, 1300), 9);
    assert.equal(percentBps(173, 1300), 22); // 22.49
    assert.equal(percentBps(50, 1300), 7);
    assert.equal(percentBps(150, 1300), 20);
    assert.equal(percentBps(3, 1300), 0); // 0.39
    assert.equal(percentBps(4, 1300), 1); // 0.52
    assert.equal(percentBps(0, 1300), 0);
    assert.equal(percentBps(1000, 0), 0);
    assert.equal(percentBps(12_345, 10_000), 12_345);
  });

  it('gives the HST of every §3.11 vector', () => {
    assert.equal(percentBps(13_229, 1300), 1720); // V1 A: 1 719.77
    assert.equal(percentBps(21_129, 1300), 2747); // V1 B: 2 746.77
    assert.equal(percentBps(19_007, 1300), 2471); // V2 A: 2 470.91
    assert.equal(percentBps(27_655, 1300), 3595); // V2 B: 3 595.15
    assert.equal(percentBps(13_253, 1300), 1723); // V3 A: 1 722.89
    assert.equal(percentBps(27_973, 1300), 3636); // V3 B: 3 636.49, stays down
    assert.equal(percentBps(37_704, 1300), 4902); // V3 C: 4 901.52
    assert.equal(percentBps(12_173, 1300), 1582); // V4: 1 582.49, stays down
    assert.equal(percentBps(3471, 1300), 451); // V5: 451.23
    assert.equal(percentBps(50_180, 1300), 6523); // V6: 6 523.40
    assert.equal(percentBps(131_456, 1300), 17_089); // V9: 17 089.28
    assert.equal(percentBps(127_956, 1300), 16_634); // V9 attended: 16 634.28
  });

  it('gives the commission of §3.11 (rule 9: half-up)', () => {
    assert.equal(percentBps(14_086, 1000), 1409); // Bluestone 10 %: 1 408.6
    assert.equal(percentBps(18_772, 900), 1689); // Kestrel 9 %: 1 689.48
    assert.equal(percentBps(3696, 1000), 370); // V5 clawback: 369.6
    assert.equal(percentBps(1005, 1000), 101); // 100.5
    assert.equal(percentBps(1004, 1000), 100); // 100.4
  });

  it('is mulDivHalfUp(cents, bps, 10 000)', () => {
    for (let cents = 0; cents < 30_000; cents += 7) {
      for (const bps of [0, 1, 900, 1000, 1100, 1200, 1300, 3000, 9999, 10_000]) {
        const expected = Number((BigInt(cents) * BigInt(bps) + 5000n) / 10_000n);
        assert.equal(percentBps(cents, bps), expected, `${cents} at ${bps} bps`);
        assert.equal(mulDivHalfUp(cents, bps, 10_000), expected, `${cents} at ${bps} bps`);
      }
    }
  });

  it('stays exact up to the last safe integer and throws past it', () => {
    // cents × bps + 5 000 may be at most 2^53 − 1.
    assert.equal(percentBps(MAX - 5000, 1), 900_719_925_474);
    assert.throws(() => percentBps(MAX - 4999, 1), RangeError);
    const top = Math.floor((MAX - 5000) / 1300); // 6 928 614 811 335
    assert.equal(percentBps(top, 1300), Number((BigInt(top) * 1300n + 5000n) / 10_000n));
    assert.throws(() => percentBps(top + 1, 1300), RangeError);
    assert.throws(() => percentBps(MAX, 1300), RangeError);
  });

  it('refuses anything that is not a non-negative whole number', () => {
    assert.throws(() => percentBps(-1, 1300), RangeError);
    assert.throws(() => percentBps(1, -1), RangeError);
    assert.throws(() => percentBps(1.2, 1300), RangeError);
    assert.throws(() => percentBps(100, 12.5), RangeError);
    assert.throws(() => percentBps(Number.NaN, 1300), RangeError);
    assert.throws(() => percentBps(undefined as unknown as number, 1300), RangeError);
  });
});

describe('allocate (§3.1 rule 4)', () => {
  it('spreads the §3.11 discounts over stores, then over lines', () => {
    // V1: $20 welcome discount.
    assert.deepEqual(allocate(2000, [14_086, 18_772]), [857, 1143]);
    assert.deepEqual(allocate(857, [11_088, 2998]), [675, 182]);
    assert.deepEqual(allocate(1143, [9580, 9192]), [583, 560]);
    // V3: BUILD25.
    assert.deepEqual(allocate(2500, [13_692, 25_284, 38_954]), [439, 811, 1250]);
    assert.deepEqual(allocate(439, [6696, 6996]), [215, 224]);
    assert.deepEqual(allocate(811, [11_496, 13_788]), [369, 442]);
    assert.deepEqual(allocate(1250, [35_994, 2960]), [1155, 95]);
  });

  it('gives the leftover cents to the largest remainders', () => {
    assert.deepEqual(allocate(10, [3, 4]), [4, 6]); // 4.29 and 5.71: the later part has more left over
    assert.deepEqual(allocate(100, [1, 2]), [33, 67]); // 33.33 and 66.67
    assert.deepEqual(allocate(100, [2, 1]), [67, 33]);
    assert.deepEqual(allocate(1, [1, 2, 3]), [0, 0, 1]); // 0.17, 0.33, 0.50
    assert.deepEqual(allocate(2, [1, 2, 3]), [0, 1, 1]); // 0.33, 0.67, 1.00
    assert.deepEqual(allocate(5, [1, 1, 3]), [1, 1, 3]);
  });

  it('breaks a tie in favour of the lower index', () => {
    assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
    assert.deepEqual(allocate(101, [1, 1, 1]), [34, 34, 33]);
    assert.deepEqual(allocate(1, [1, 1]), [1, 0]);
    assert.deepEqual(allocate(1, [7, 7, 7, 7]), [1, 0, 0, 0]);
    assert.deepEqual(allocate(3, [5, 5, 5, 5]), [1, 1, 1, 0]);
    assert.deepEqual(allocate(10, [1, 2, 1]), [3, 5, 2]); // 2.5, 5, 2.5: one cent left, index 0 before 2
    assert.deepEqual(allocate(10, [1, 3]), [3, 7]); // 2.5 and 7.5
    assert.deepEqual(allocate(7, [0, 3, 0, 3]), [0, 4, 0, 3]);
  });

  it('never gives a cent to a zero weight', () => {
    assert.deepEqual(allocate(5, [0, 0, 5]), [0, 0, 5]);
    assert.deepEqual(allocate(1, [0, 1, 0]), [0, 1, 0]);
    assert.deepEqual(allocate(999, [0, 1, 0, 1, 0]), [0, 500, 0, 499, 0]);
  });

  it('handles nothing to share and a single part', () => {
    assert.deepEqual(allocate(0, [3, 4]), [0, 0]);
    assert.deepEqual(allocate(0, [0, 0]), [0, 0]); // a replacement order: $0 lines, $0 discount
    assert.deepEqual(allocate(0, []), []);
    assert.deepEqual(allocate(9, [4]), [9]);
    assert.deepEqual(allocate(2500, [1]), [2500]);
  });

  it('always adds up to the total and matches the exact rule on 5 000 seeded random cases', () => {
    const random = mulberry32(31);
    for (let round = 0; round < 5000; round += 1) {
      const count = 1 + below(random, 8);
      const weights = Array.from({ length: count }, () => (random() < 0.15 ? 0 : below(random, 2_000_000)));
      if (!weights.some((weight) => weight > 0)) weights[0] = 1;
      const total = below(random, 3_000_000);

      const parts = allocate(total, weights);
      assert.equal(parts.length, count);
      assert.equal(
        parts.reduce((sum, part) => sum + part, 0),
        total,
        `sum of ${total} over ${weights.join(', ')}`,
      );
      assert.deepEqual(parts, allocateExact(total, weights), `${total} over ${weights.join(', ')}`);
      const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
      parts.forEach((part, index) => {
        const weight = weights[index] ?? 0;
        assert.ok(Number.isSafeInteger(part) && part >= 0);
        // Each part is its exact share rounded down or up, never further away.
        assert.ok(part * weightSum > total * weight - weightSum, `part ${index} too small`);
        assert.ok(part * weightSum < total * weight + weightSum, `part ${index} too large`);
      });
    }
  });

  it('is exact on many equal lines (the cents go to the first ones)', () => {
    const parts = allocate(
      2000,
      Array.from({ length: 100 }, () => 479),
    );
    assert.deepEqual(
      parts,
      Array.from({ length: 100 }, () => 20),
    );
    const uneven = allocate(
      1999,
      Array.from({ length: 100 }, () => 479),
    ); // 19.99 each
    assert.deepEqual(uneven, [...Array.from({ length: 99 }, () => 20), 19]);
  });

  it('stays exact up to the last safe integer and throws past it', () => {
    assert.deepEqual(allocate(MAX, [1]), [MAX]);
    assert.deepEqual(allocate(MAX, [1, 1]), [4_503_599_627_370_496, 4_503_599_627_370_495]);
    assert.deepEqual(allocate(1, [MAX]), [1]);
    // 3 000 000 × 3 002 399 751 = 9 007 199 253 000 000, just under 2^53.
    assert.deepEqual(
      allocate(3_000_000, [3_002_399_751, 1, 2]),
      allocateExact(3_000_000, [3_002_399_751, 1, 2]),
    );
    assert.throws(() => allocate(3_000_001, [3_002_399_751, 1]), RangeError);
    assert.throws(() => allocate(MAX, [2, 3]), RangeError); // total × weight is above 2^53
    assert.throws(() => allocate(1, [MAX, MAX]), RangeError); // the weights do not add up exactly
    assert.throws(() => allocate(0, [MAX, 1]), RangeError);
  });

  it('does not change its input', () => {
    const weights = Object.freeze([3, 1, 2]);
    assert.deepEqual(allocate(10, weights), [5, 2, 3]); // 5, 1.67, 3.33
    assert.deepEqual(weights, [3, 1, 2]);
  });

  it('never returns a negative zero', () => {
    // -0 is not an integer to Firestore; a share must come out as plain 0.
    assert.deepEqual(allocate(-0, [1, 1]), [0, 0]);
    assert.deepEqual(allocate(5, [-0, 5]), [0, 5]);
    assert.deepEqual(allocate(-0, [-0, -0]), [0, 0]);
    assert.deepEqual(allocate(0, [0, 7]), [0, 0]);
  });

  it('refuses a total or a weight that is not a non-negative whole number', () => {
    assert.throws(() => allocate(-1, [1]), RangeError);
    assert.throws(() => allocate(1.5, [1]), RangeError);
    assert.throws(() => allocate(Number.NaN, [1]), RangeError);
    assert.throws(() => allocate(1, [1, -1]), RangeError);
    assert.throws(() => allocate(1, [0.5]), RangeError);
    assert.throws(() => allocate(10, [1, undefined as unknown as number]), RangeError);
    assert.throws(() => allocate(0, new Array<number>(3)), RangeError); // holes are not weights
  });

  it('refuses to share a total when no weight can take it', () => {
    assert.throws(() => allocate(1, []), RangeError);
    assert.throws(() => allocate(1, [0, 0]), RangeError);
  });
});

describe('ceilTo25 (§3.1 rule 9)', () => {
  it('rounds up to the next quarter and leaves a quarter alone', () => {
    assert.equal(ceilTo25(0), 0);
    assert.equal(ceilTo25(1), 25);
    assert.equal(ceilTo25(24), 25);
    assert.equal(ceilTo25(25), 25);
    assert.equal(ceilTo25(26), 50);
    assert.equal(ceilTo25(49), 50);
    assert.equal(ceilTo25(50), 50);
    assert.equal(ceilTo25(51), 75);
    assert.equal(ceilTo25(1000), 1000);
    assert.equal(ceilTo25(1001), 1025);
    for (let cents = 0; cents <= 5000; cents += 1) {
      const expected = Number(((BigInt(cents) + 24n) / 25n) * 25n);
      assert.equal(ceilTo25(cents), expected, String(cents));
    }
  });

  it('never returns a negative zero', () => {
    assert.ok(Object.is(ceilTo25(-0), 0));
    assert.ok(Object.is(mulDivHalfUp(-0, 5, 3), 0));
    assert.ok(Object.is(mulDivHalfUp(5, -0, 3), 0));
    assert.ok(Object.is(percentBps(-0, 1300), 0));
    assert.ok(Object.is(percentBps(100, -0), 0));
  });

  it('rounds the §3.11 driver offers', () => {
    const offers: [number, number][] = [
      [4195, 4200],
      [4760, 4775],
      [3818, 3825],
      [4950, 4950],
      [3180, 3200],
      [4536, 4550],
      [6330, 6350],
      [7835, 7850],
      [1440, 1450],
      [1194, 1200],
    ];
    for (const [raw, offer] of offers) assert.equal(ceilTo25(raw), offer);
  });

  it('stays exact up to the last safe integer and throws past it', () => {
    assert.equal(ceilTo25(MAX - 16), MAX - 16); // 9 007 199 254 740 975 is a multiple of 25
    assert.equal(ceilTo25(MAX - 17), MAX - 16);
    assert.equal(ceilTo25(MAX - 40), MAX - 16);
    assert.equal(ceilTo25(MAX - 41), MAX - 41);
    assert.throws(() => ceilTo25(MAX - 15), RangeError); // the next quarter is above 2^53 − 1
    assert.throws(() => ceilTo25(MAX), RangeError);
  });

  it('refuses anything that is not a non-negative whole number', () => {
    assert.throws(() => ceilTo25(-25), RangeError);
    assert.throws(() => ceilTo25(12.5), RangeError);
    assert.throws(() => ceilTo25(Number.NaN), RangeError);
    assert.throws(() => ceilTo25(Number.POSITIVE_INFINITY), RangeError);
  });
});

describe('formatMoney and formatFee (§3.1 rule 11)', () => {
  it('writes cents as dollars with two decimals', () => {
    assert.equal(formatMoney(0), '$0.00');
    assert.equal(formatMoney(5), '$0.05');
    assert.equal(formatMoney(50), '$0.50');
    assert.equal(formatMoney(99), '$0.99');
    assert.equal(formatMoney(100), '$1.00');
    assert.equal(formatMoney(1299), '$12.99');
    assert.equal(formatMoney(38_825), '$388.25');
    assert.equal(formatMoney(52_728), '$527.28');
    assert.equal(formatMoney(17_142), '$171.42');
    assert.equal(formatMoney(22_070), '$220.70');
    assert.equal(formatMoney(99_999), '$999.99');
  });

  it('groups thousands with commas', () => {
    assert.equal(formatMoney(100_000), '$1,000.00');
    assert.equal(formatMoney(128_450), '$1,284.50');
    assert.equal(formatMoney(129_970), '$1,299.70');
    assert.equal(formatMoney(999_999), '$9,999.99');
    assert.equal(formatMoney(1_000_000), '$10,000.00');
    assert.equal(formatMoney(12_345_678), '$123,456.78');
    assert.equal(formatMoney(99_999_999), '$999,999.99');
    assert.equal(formatMoney(100_000_000), '$1,000,000.00');
    assert.equal(formatMoney(123_456_789_012), '$1,234,567,890.12');
    assert.equal(formatMoney(MAX), '$90,071,992,547,409.91');
  });

  it('puts the minus sign before the dollar sign', () => {
    assert.equal(formatMoney(-1221), '-$12.21');
    assert.equal(formatMoney(-5), '-$0.05');
    assert.equal(formatMoney(-3326), '-$33.26');
    assert.equal(formatMoney(-100_000), '-$1,000.00');
    assert.equal(formatMoney(-100_000_000), '-$1,000,000.00');
    assert.equal(formatMoney(-MAX), '-$90,071,992,547,409.91');
    assert.equal(formatMoney(-0), '$0.00');
  });

  it('shows a dash instead of a wrong amount', () => {
    assert.equal(formatMoney(null), '—');
    assert.equal(formatMoney(undefined), '—');
    assert.equal(formatMoney(12.5), '—');
    assert.equal(formatMoney(Number.NaN), '—');
    assert.equal(formatMoney(Number.POSITIVE_INFINITY), '—');
    assert.equal(formatMoney(MAX + 1), '—');
    assert.equal(formatMoney('1299' as unknown as number), '—');
  });

  it('says Free for a fee of 0 and the amount otherwise', () => {
    assert.equal(formatFee(0), 'Free');
    assert.equal(formatFee(-0), 'Free');
    assert.equal(formatFee(1), '$0.01');
    assert.equal(formatFee(1299), '$12.99');
    assert.equal(formatFee(4921), '$49.21');
    assert.equal(formatFee(3500), '$35.00');
    assert.equal(formatFee(null), '—');
    assert.equal(formatFee(undefined), '—');
  });
});

describe('roadTenths (§3.1 rule 5)', () => {
  const sites = {
    leslieville: { lat: 43.6648, lng: -79.3405 },
    mimico: { lat: 43.6163, lng: -79.4955 },
  };
  const stores = {
    kestrel: { lat: 43.6966, lng: -79.5752 },
    bluestone: { lat: 43.7709, lng: -79.4912 },
    boltbin: { lat: 43.7262, lng: -79.6885 },
    voltway: { lat: 43.6262, lng: -79.6143 },
    grainline: { lat: 43.7655, lng: -79.2829 },
    glassmoor: { lat: 43.7102, lng: -79.3615 },
    slatebridge: { lat: 43.4441, lng: -79.688 },
  };

  it('gives the road km of §11.3 for the seed stores and jobsites', () => {
    assert.equal(roadTenths(stores.kestrel, sites.leslieville), 260);
    assert.equal(roadTenths(stores.bluestone, sites.leslieville), 229);
    assert.equal(roadTenths(stores.boltbin, sites.leslieville), 389);
    assert.equal(roadTenths(stores.voltway, sites.leslieville), 304);
    assert.equal(roadTenths(stores.grainline, sites.leslieville), 164);
    assert.equal(roadTenths(stores.glassmoor, sites.leslieville), 72);
    assert.equal(roadTenths(stores.slatebridge, sites.mimico), 333);
    assert.equal(roadTenths(stores.kestrel, sites.mimico), 149);
    assert.equal(roadTenths(stores.boltbin, sites.mimico), 267);
  });

  it('is the same in both directions', () => {
    for (const store of Object.values(stores)) {
      for (const site of Object.values(sites)) {
        assert.equal(roadTenths(store, site), roadTenths(site, store));
      }
    }
  });

  it('is 0, not -0, for one and the same place', () => {
    assert.ok(Object.is(roadTenths(sites.leslieville, sites.leslieville), 0));
    // Two pins that only differ beyond the 6th decimal are the same place.
    assert.ok(Object.is(roadTenths({ lat: 43.66480004, lng: -79.34049996 }, sites.leslieville), 0));
  });

  it('rounds pins to 6 decimals first', () => {
    assert.deepEqual(r6({ lat: 43.66480004, lng: -79.34049996 }), { lat: 43.6648, lng: -79.3405 });
    assert.deepEqual(r6({ lat: 43.1234564, lng: -79.1234566 }), { lat: 43.123456, lng: -79.123457 });
    assert.equal(
      roadTenths({ lat: 43.69660004, lng: -79.57520004 }, { lat: 43.66479996, lng: -79.34050004 }),
      260,
    );
  });

  it('rounds up to the next tenth of a km', () => {
    const from = { lat: 43.7, lng: -79.4 };
    // 0.001° of latitude is 111.19 m in a straight line, 150.1 m by road: more than 0.1 km, so 0.2.
    assert.equal(roadTenths(from, { lat: 43.701, lng: -79.4 }), 2);
    // 0.0006° is 66.7 m, 90.1 m by road: under 0.1 km, still charged as 0.1.
    assert.equal(roadTenths(from, { lat: 43.7006, lng: -79.4 }), 1);
    // 0.000001° is 15 cm by road: any distance at all is at least 0.1 km.
    assert.equal(roadTenths(from, { lat: 43.700001, lng: -79.4 }), 1);
    // 0.1° is 11 119.5 m, 15 011.3 m by road → 15.1 km.
    assert.equal(roadTenths(from, { lat: 43.8, lng: -79.4 }), 151);
  });

  it('keeps a distance a hair past a tenth at that tenth (the epsilon)', () => {
    const toronto = { lat: 43.6532, lng: -79.3832 };
    // By road these two pins are 41 900.000035 m apart: 0.035 mm past 41.9 km. Whichever way the last
    // bits of sin and cos fall on an engine, the 0.1 mm epsilon keeps the fee at 41.9 km.
    const hairPast = { lat: 43.794199, lng: -79.049869 };
    const tenths = (haversineMeters(toronto, hairPast) * 1.35) / 100;
    assert.ok(tenths > 419.0000001 && tenths < 419.0000009, String(tenths));
    assert.equal(roadTenths(toronto, hairPast), 419);
    assert.equal(roadTenths(hairPast, toronto), 419);
    // 0.5 mm past 13.4 km is a real distance, not noise: it is charged as 13.5 km.
    const wellPast = { lat: 43.563934, lng: -79.3832 };
    const more = (haversineMeters(toronto, wellPast) * 1.35) / 100;
    assert.ok(more > 134.000004 && more < 134.000007, String(more));
    assert.equal(roadTenths(toronto, wellPast), 135);
  });

  it('is the spec formula on 2 000 seeded random pins in the service area', () => {
    const random = mulberry32(416);
    const pin = (): LatLng => ({ lat: 43.25 + random() * 0.9, lng: -80 + random() * 1.25 });
    for (let round = 0; round < 2000; round += 1) {
      const a = pin();
      const b = pin();
      const roadMeters = haversineMeters(r6(a), r6(b)) * 1.35;
      const tenths = roadTenths(a, b);
      assert.equal(tenths, Math.ceil(roadMeters / 100 - 1e-6));
      assert.ok(Number.isSafeInteger(tenths) && tenths >= 0);
      // The smallest whole number of tenths that covers the road distance (give or take 0.1 mm).
      assert.ok(tenths * 100 >= roadMeters - 1e-4);
      assert.ok((tenths - 1) * 100 < roadMeters);
    }
  });

  it('uses the road factor of 1.35', () => {
    assert.equal(ROAD_DISTANCE_FACTOR, 1.35);
  });

  it('refuses a point that is not on the map', () => {
    assert.throws(() => roadTenths({ lat: Number.NaN, lng: 0 }, sites.leslieville), RangeError);
    assert.throws(() => roadTenths(sites.leslieville, { lat: 91, lng: 0 }), RangeError);
    assert.throws(() => roadTenths(sites.leslieville, { lat: 0, lng: -181 }), RangeError);
    assert.throws(() => roadTenths(null as unknown as LatLng, sites.leslieville), RangeError);
  });

  it('does not change its inputs', () => {
    const a = Object.freeze({ lat: 43.69660004, lng: -79.57520004 });
    const b = Object.freeze({ lat: 43.6648, lng: -79.3405 });
    assert.equal(roadTenths(a, b), 260);
    assert.deepEqual(a, { lat: 43.69660004, lng: -79.57520004 });
  });
});
