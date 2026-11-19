/**
 * Driver pay (§3.3, §3.9, §3.10): the offer fixed at checkout, staff boosts, pay for waiting at the
 * store, and what a failed attempt or a cancelled job pays. The examples are the vectors of §3.11 (V1,
 * V3, V8) and the seed scenarios of §11.5; every amount is in cents.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FAILURE_REASONS,
  VEHICLE_CLASSES,
  cancellationPayCents,
  driverOffer,
  failurePayCents,
  roadTenths,
  summarizeLoad,
  waitPayCents,
  withBoost,
  withWaitPay,
  type DriverPayout,
  type FailureReasonId,
  type LatLng,
  type LoadInputLine,
  type VehicleClass,
} from '../src';

const MAX = Number.MAX_SAFE_INTEGER;
const MINUTE = 60_000;
/** Thu 2026-11-19 12:45 in Toronto (EST, UTC−5): the check-in time of the §3.11 wait example. */
const T_1245 = Date.UTC(2026, 10, 19, 17, 45);

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

const CLASSES: readonly VehicleClass[] = ['car', 'suv', 'pickup', 'cargo_van', 'box_truck', 'flatbed'];

/** A payout as checkout writes it: no boost and no wait pay yet. */
const payout = (offerCents: number, parts: [number, number, number, number]): DriverPayout => ({
  offerCents,
  baseCents: parts[0],
  distanceCents: parts[1],
  loadCents: parts[2],
  handlingCents: parts[3],
  boostCents: 0,
  waitCents: 0,
  totalCents: offerCents,
});

/** V1 Kestrel (Marco's job in seed scenario A): 1 600 + 2 600 + 200 + 360 = 4 760 → 4 775. */
const KESTREL = Object.freeze(payout(4775, [1600, 2600, 200, 360]));

/** Pins of §11.2 and §11.3. */
const PIN = {
  leslieville: { lat: 43.6648, lng: -79.3405 },
  mimico: { lat: 43.6163, lng: -79.4955 },
  kestrel: { lat: 43.6966, lng: -79.5752 },
  bluestone: { lat: 43.7709, lng: -79.4912 },
  boltbin: { lat: 43.7262, lng: -79.6885 },
  voltway: { lat: 43.6262, lng: -79.6143 },
  grainline: { lat: 43.7655, lng: -79.2829 },
  glassmoor: { lat: 43.7102, lng: -79.3615 },
  slatebridge: { lat: 43.4441, lng: -79.688 },
} satisfies Record<string, LatLng>;

/** A line of the load: quantity, then the unit's kg and l × w × h in cm (§11.4). */
const goods = (quantity: number, weightKg: number, l: number, w: number, h: number): LoadInputLine => ({
  name: 'Seed product',
  quantity,
  unit: 'each',
  size: null,
  weightKg,
  dimsCm: { l, w, h },
});

interface OfferExample {
  title: string;
  from: LatLng;
  to: LatLng;
  lines: LoadInputLine[];
  vehicleClass: VehicleClass;
  tenths: number;
  weightG: number;
  handlingPieces: number;
  /** base, distance, load, handling */
  parts: [number, number, number, number];
  offerCents: number;
}

/** The nine offers of §13.1, with the breakdowns of §3.11. */
const OFFERS: OfferExample[] = [
  {
    title: 'V1 Bluestone → Leslieville: 1 600 + 2 290 + 200 + 105 = 4 195 → 4 200',
    from: PIN.bluestone,
    to: PIN.leslieville,
    lines: [goods(6, 25, 244, 122, 1.3), goods(1, 28, 30, 30, 38)],
    vehicleClass: 'pickup',
    tenths: 229,
    weightG: 178_000,
    handlingPieces: 7,
    parts: [1600, 2290, 200, 105],
    offerCents: 4200,
  },
  {
    title: 'V1 Kestrel → Leslieville: 1 600 + 2 600 + 200 + 360 = 4 760 → 4 775',
    from: PIN.kestrel,
    to: PIN.leslieville,
    lines: [goods(20, 4.5, 244, 9, 4), goods(4, 23, 244, 122, 1.1)],
    vehicleClass: 'pickup',
    tenths: 260,
    weightG: 182_000,
    handlingPieces: 24,
    parts: [1600, 2600, 200, 360],
    offerCents: 4775,
  },
  {
    title: 'V3 Boltbin → Leslieville: 900 + 2 918 = 3 818 → 3 825',
    from: PIN.boltbin,
    to: PIN.leslieville,
    lines: [goods(24, 0.3, 15, 8, 5), goods(2, 2.4, 18, 12, 8)],
    vehicleClass: 'car',
    tenths: 389,
    weightG: 12_000,
    handlingPieces: 0,
    parts: [900, 2918, 0, 0],
    offerCents: 3825,
  },
  {
    title: 'V3 Kestrel → Leslieville: 1 600 + 2 600 + 300 + 450 = 4 950',
    from: PIN.kestrel,
    to: PIN.leslieville,
    lines: [goods(24, 4.5, 244, 9, 4), goods(6, 23, 244, 122, 1.1)],
    vehicleClass: 'pickup',
    tenths: 260,
    weightG: 246_000,
    handlingPieces: 30,
    parts: [1600, 2600, 300, 450],
    offerCents: 4950,
  },
  {
    title: 'V3 Voltway → Leslieville: 900 + 2 280 = 3 180 → 3 200',
    from: PIN.voltway,
    to: PIN.leslieville,
    lines: [goods(3, 7, 35, 35, 12), goods(20, 0.05, 10, 6, 6)],
    vehicleClass: 'car',
    tenths: 304,
    weightG: 22_000,
    handlingPieces: 0,
    parts: [900, 2280, 0, 0],
    offerCents: 3200,
  },
  {
    title: 'V8 scenario D, Grainline → Leslieville: 2 200 + 1 886 + 300 + 150 = 4 536 → 4 550',
    from: PIN.grainline,
    to: PIN.leslieville,
    lines: [goods(20, 9, 120, 40, 40), goods(10, 2.7, 244, 61, 5)],
    vehicleClass: 'cargo_van',
    tenths: 164,
    weightG: 207_000,
    handlingPieces: 10,
    parts: [2200, 1886, 300, 150],
    offerCents: 4550,
  },
  {
    title: 'V8 scenario E, Slatebridge → Mimico: 1 600 + 3 330 + 1 100 + 300 = 6 330 → 6 350',
    from: PIN.slatebridge,
    to: PIN.mimico,
    lines: [goods(20, 30, 100, 33, 13), goods(2, 12, 107, 25, 25)],
    vehicleClass: 'pickup',
    tenths: 333,
    weightG: 624_000,
    handlingPieces: 20,
    parts: [1600, 3330, 1100, 300],
    offerCents: 6350,
  },
  {
    title: 'V8 quote Q-10002, Kestrel → Mimico: 4 000 + 2 235 + 1 000 + 600 = 7 835 → 7 850',
    from: PIN.kestrel,
    to: PIN.mimico,
    lines: [goods(30, 14, 366, 14, 4), goods(8, 15, 244, 9, 9), goods(2, 27, 427, 24, 5)],
    vehicleClass: 'box_truck',
    tenths: 149,
    weightG: 594_000,
    handlingPieces: 40,
    parts: [4000, 2235, 1000, 600],
    offerCents: 7850,
  },
  {
    title: 'V8 Glassmoor mirror → Leslieville: 900 + 540 = 1 440 → 1 450',
    from: PIN.glassmoor,
    to: PIN.leslieville,
    lines: [goods(1, 9, 91, 61, 3)],
    vehicleClass: 'car',
    tenths: 72,
    weightG: 9000,
    handlingPieces: 0,
    parts: [900, 540, 0, 0],
    offerCents: 1450,
  },
];

describe('driverOffer: the worked examples (§3.11)', () => {
  for (const example of OFFERS) {
    it(example.title, () => {
      const { vehicleClass, tenths, weightG, handlingPieces, parts, offerCents } = example;
      assert.deepEqual(
        driverOffer(vehicleClass, tenths, { weightG, handlingPieces }),
        payout(offerCents, parts),
      );
    });
  }

  it('gives the same offers from the pins and the products, as checkout computes them', () => {
    for (const example of OFFERS) {
      const load = summarizeLoad(example.lines);
      const tenths = roadTenths(example.from, example.to);
      assert.equal(load.vehicleClass, example.vehicleClass, example.title);
      assert.equal(tenths, example.tenths, example.title);
      assert.equal(load.weightG, example.weightG, example.title);
      assert.equal(load.handlingPieces, example.handlingPieces, example.title);
      assert.deepEqual(
        driverOffer(example.vehicleClass, tenths, load),
        payout(example.offerCents, example.parts),
        example.title,
      );
    }
  });

  it('starts with no boost and no wait pay, so the total is the offer', () => {
    const offer = driverOffer('pickup', 260, { weightG: 182_000, handlingPieces: 24 });
    assert.equal(offer.boostCents, 0);
    assert.equal(offer.waitCents, 0);
    assert.equal(offer.totalCents, 4775);
    assert.equal(offer.totalCents, offer.offerCents);
  });
});

describe('driverOffer: the rules (§3.3)', () => {
  const light = { weightG: 0, handlingPieces: 0 };

  it('never offers less than $10', () => {
    // Only a car job under 1.4 km can fall below it: 900 + 75¢/km.
    assert.deepEqual(driverOffer('car', 0, light), payout(1000, [900, 0, 0, 0]));
    assert.deepEqual(driverOffer('car', 1, light), payout(1000, [900, 8, 0, 0])); // 7.5 → 8
    assert.deepEqual(driverOffer('car', 12, light), payout(1000, [900, 90, 0, 0])); // 990
    assert.deepEqual(driverOffer('car', 13, light), payout(1000, [900, 98, 0, 0])); // 97.5 → 98; 998
    assert.deepEqual(driverOffer('car', 14, light), payout(1025, [900, 105, 0, 0])); // 1 005 → next quarter
    assert.deepEqual(driverOffer('car', 0, { weightG: 0, handlingPieces: 6 }), payout(1000, [900, 0, 0, 90]));
    assert.deepEqual(
      driverOffer('car', 0, { weightG: 0, handlingPieces: 7 }),
      payout(1025, [900, 0, 0, 105]),
    );
    // Every other class starts above $10.
    assert.equal(driverOffer('suv', 0, light).offerCents, 1100);
    assert.equal(driverOffer('pickup', 0, light).offerCents, 1600);
    assert.equal(driverOffer('cargo_van', 0, light).offerCents, 2200);
    assert.equal(driverOffer('box_truck', 0, light).offerCents, 4000);
    assert.equal(driverOffer('flatbed', 0, light).offerCents, 5000);
  });

  it('pays the base and the per-km rate of the class, half-up', () => {
    // [class, base, distance at 0.5 km, at 10.0 km, at 33.3 km]
    const expected: [VehicleClass, number, number, number, number][] = [
      ['car', 900, 38, 750, 2498], // 37.5 → 38; 2 497.5 → 2 498
      ['suv', 1100, 43, 850, 2831], // 42.5 → 43; 2 830.5 → 2 831
      ['pickup', 1600, 50, 1000, 3330],
      ['cargo_van', 2200, 58, 1150, 3830], // 57.5 → 58; 3 829.5 → 3 830
      ['box_truck', 4000, 75, 1500, 4995],
      ['flatbed', 5000, 88, 1750, 5828], // 87.5 → 88; 5 827.5 → 5 828
    ];
    for (const [id, base, at5, at100, at333] of expected) {
      assert.equal(driverOffer(id, 0, light).baseCents, base, id);
      assert.equal(driverOffer(id, 5, light).distanceCents, at5, `${id} at 0.5 km`);
      assert.equal(driverOffer(id, 100, light).distanceCents, at100, `${id} at 10.0 km`);
      assert.equal(driverOffer(id, 333, light).distanceCents, at333, `${id} at 33.3 km`);
      assert.equal(VEHICLE_CLASSES[id].driverBaseCents, base);
    }
  });

  it('adds $1 for every started 50 kg above 100 kg', () => {
    const loadCents = (weightG: number) => driverOffer('pickup', 0, { weightG, handlingPieces: 0 }).loadCents;
    assert.equal(loadCents(0), 0);
    assert.equal(loadCents(99_999), 0);
    assert.equal(loadCents(100_000), 0);
    assert.equal(loadCents(100_001), 100); // one gram into the first 50 kg
    assert.equal(loadCents(150_000), 100);
    assert.equal(loadCents(150_001), 200);
    assert.equal(loadCents(200_000), 200);
    assert.equal(loadCents(249_999), 300);
    assert.equal(loadCents(250_000), 300);
    assert.equal(loadCents(250_001), 400);
    assert.equal(loadCents(624_000), 1100); // scenario E: 10.48 → 11
    assert.equal(loadCents(6_000_000), 11_800); // a full flatbed: 118 steps
  });

  it('adds 15¢ per handling piece, up to $30', () => {
    const handlingCents = (handlingPieces: number) =>
      driverOffer('pickup', 0, { weightG: 0, handlingPieces }).handlingCents;
    assert.equal(handlingCents(0), 0);
    assert.equal(handlingCents(1), 15);
    assert.equal(handlingCents(7), 105);
    assert.equal(handlingCents(199), 2985);
    assert.equal(handlingCents(200), 3000);
    assert.equal(handlingCents(201), 3000);
    assert.equal(handlingCents(9999), 3000);
    assert.equal(driverOffer('pickup', 0, { weightG: 0, handlingPieces: 200 }).offerCents, 4600);
    assert.equal(driverOffer('pickup', 0, { weightG: 0, handlingPieces: 5000 }).offerCents, 4600);
  });

  it('rounds the sum up to the next $0.25 and leaves a quarter alone', () => {
    const offerCents = (handlingPieces: number) =>
      driverOffer('pickup', 0, { weightG: 0, handlingPieces }).offerCents;
    assert.equal(offerCents(0), 1600);
    assert.equal(offerCents(1), 1625); // 1 615
    assert.equal(offerCents(2), 1650); // 1 630
    assert.equal(offerCents(5), 1675); // exactly 1 675
    assert.equal(offerCents(6), 1700); // 1 690
    assert.equal(offerCents(10), 1750); // exactly 1 750
  });

  it('follows the formula on 3 000 seeded random jobs', () => {
    const random = mulberry32(3103);
    for (let round = 0; round < 3000; round += 1) {
      const id = CLASSES[below(random, CLASSES.length)] ?? 'car';
      const spec = VEHICLE_CLASSES[id];
      const tenths = below(random, 700);
      const weightG = below(random, 6_000_001);
      const handlingPieces = below(random, 400);

      const base = BigInt(spec.driverBaseCents);
      const distance = (2n * BigInt(spec.driverPerKmCents) * BigInt(tenths) + 10n) / 20n;
      const over = weightG > 100_000 ? BigInt(weightG - 100_000) : 0n;
      const load = 100n * ((over + 49_999n) / 50_000n);
      const handling = handlingPieces >= 200 ? 3000n : 15n * BigInt(handlingPieces);
      const sum = base + distance + load + handling;
      const floored = sum < 1000n ? 1000n : sum;
      const offer = ((floored + 24n) / 25n) * 25n;

      assert.deepEqual(
        driverOffer(id, tenths, { weightG, handlingPieces }),
        payout(Number(offer), [Number(base), Number(distance), Number(load), Number(handling)]),
        `${id}, ${tenths / 10} km, ${weightG} g, ${handlingPieces} pieces`,
      );
    }
  });

  it('never pays less for a longer trip, a heavier load or more handling', () => {
    for (const id of CLASSES) {
      for (let tenths = 0; tenths < 400; tenths += 7) {
        const near = driverOffer(id, tenths, { weightG: 180_000, handlingPieces: 12 }).offerCents;
        assert.ok(near <= driverOffer(id, tenths + 1, { weightG: 180_000, handlingPieces: 12 }).offerCents);
        assert.ok(near <= driverOffer(id, tenths, { weightG: 180_001, handlingPieces: 12 }).offerCents);
        assert.ok(near <= driverOffer(id, tenths, { weightG: 180_000, handlingPieces: 13 }).offerCents);
        assert.equal(near % 25, 0);
        assert.ok(near >= 1000);
      }
    }
  });

  it('refuses a distance, weight or piece count that is not a non-negative whole number', () => {
    for (const bad of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, MAX + 1]) {
      assert.throws(() => driverOffer('car', bad, light), RangeError, `tenths ${bad}`);
      assert.throws(() => driverOffer('car', 10, { weightG: bad, handlingPieces: 0 }), RangeError);
      assert.throws(() => driverOffer('car', 10, { weightG: 0, handlingPieces: bad }), RangeError);
    }
    assert.throws(() => driverOffer('car', MAX, light), RangeError); // 75¢ × that many km is not exact
    assert.throws(() => driverOffer('truck' as VehicleClass, 10, light), RangeError);
    assert.throws(() => driverOffer(null as unknown as VehicleClass, 10, light), RangeError);
  });

  it('never returns a negative zero', () => {
    const offer = driverOffer('pickup', -0, { weightG: -0, handlingPieces: -0 });
    assert.deepEqual(offer, payout(1600, [1600, 0, 0, 0]));
  });
});

describe('withBoost (§3.10)', () => {
  it('adds a staff boost to the total and leaves the offer as it was', () => {
    assert.deepEqual(withBoost(KESTREL, 500), { ...KESTREL, boostCents: 500, totalCents: 5275 });
    assert.deepEqual(withBoost(KESTREL, 1000), { ...KESTREL, boostCents: 1000, totalCents: 5775 });
    assert.deepEqual(withBoost(KESTREL, 1500), { ...KESTREL, boostCents: 1500, totalCents: 6275 });
    assert.deepEqual(withBoost(KESTREL, 2000), { ...KESTREL, boostCents: 2000, totalCents: 6775 });
  });

  it('adds boosts up', () => {
    const twice = withBoost(withBoost(KESTREL, 500), 1000);
    assert.deepEqual(twice, { ...KESTREL, boostCents: 1500, totalCents: 6275 });
    assert.deepEqual(withBoost(twice, 2000), { ...KESTREL, boostCents: 3500, totalCents: 8275 });
  });

  it('keeps the wait pay in the total', () => {
    const waited = withWaitPay(KESTREL, 375);
    assert.deepEqual(withBoost(waited, 500), {
      ...KESTREL,
      boostCents: 500,
      waitCents: 375,
      totalCents: 5650,
    });
  });

  it('returns a new object and does not change the one it was given', () => {
    const boosted = withBoost(KESTREL, 500);
    assert.notEqual(boosted, KESTREL);
    assert.deepEqual(KESTREL, payout(4775, [1600, 2600, 200, 360]));
    const same = withBoost(KESTREL, 0);
    assert.notEqual(same, KESTREL);
    assert.deepEqual(same, KESTREL);
  });

  it('works the total out again instead of trusting a stale one', () => {
    const stale = { ...KESTREL, boostCents: 500, totalCents: 4775 };
    assert.equal(withBoost(stale, 500).totalCents, 5775);
  });

  it('refuses a boost that is not a non-negative whole number of cents', () => {
    for (const bad of [-500, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => withBoost(KESTREL, bad), RangeError, String(bad));
    }
    assert.throws(() => withBoost(KESTREL, MAX), RangeError);
    assert.throws(() => withBoost({ ...KESTREL, boostCents: -1 }, 500), RangeError);
    assert.throws(() => withBoost({ ...KESTREL, offerCents: Number.NaN }, 500), RangeError);
  });
});

describe('waitPayCents (§3.10)', () => {
  /** Checked in and promised at the same moment, collected `minutes` later. */
  const waited = (minutes: number) =>
    waitPayCents({ arrivedAt: T_1245, readyBy: T_1245, collectedAt: T_1245 + minutes * MINUTE });

  it('pays the §3.11 example: arrived 12:45, ready by 12:50, collected 13:20 → 30 min → 375', () => {
    assert.equal(
      waitPayCents({
        arrivedAt: T_1245,
        readyBy: T_1245 + 5 * MINUTE,
        collectedAt: T_1245 + 35 * MINUTE,
      }),
      375,
    );
  });

  it('pays 25¢ a minute after a 15-minute grace: 0, 15, 16, 30 and 80 minutes', () => {
    assert.equal(waited(0), 0);
    assert.equal(waited(15), 0);
    assert.equal(waited(16), 25);
    assert.equal(waited(30), 375);
    assert.equal(waited(80), 1500); // 65 paid minutes would be 1 625: capped
  });

  it('stops at $15, reached after 75 minutes', () => {
    assert.equal(waited(74), 1475);
    assert.equal(waited(75), 1500);
    assert.equal(waited(76), 1500);
    assert.equal(waited(600), 1500);
  });

  it('counts whole minutes only', () => {
    const at = (ms: number) => waitPayCents({ arrivedAt: T_1245, readyBy: T_1245, collectedAt: T_1245 + ms });
    assert.equal(at(16 * MINUTE - 1), 0); // 15 min 59.999 s
    assert.equal(at(16 * MINUTE), 25);
    assert.equal(at(17 * MINUTE - 1), 25);
    assert.equal(at(17 * MINUTE), 50);
  });

  it('starts the clock at the promised ready time for a driver who arrives early', () => {
    const readyBy = T_1245 + 5 * MINUTE; // 12:50
    const collectedAt = T_1245 + 35 * MINUTE; // 13:20
    assert.equal(waitPayCents({ arrivedAt: T_1245 - 60 * MINUTE, readyBy, collectedAt }), 375);
    assert.equal(waitPayCents({ arrivedAt: readyBy, readyBy, collectedAt }), 375);
  });

  it('starts the clock at the check-in for a driver who arrives after the ready time', () => {
    const readyBy = T_1245 + 5 * MINUTE; // 12:50
    const collectedAt = T_1245 + 35 * MINUTE; // 13:20
    assert.equal(waitPayCents({ arrivedAt: T_1245 + 15 * MINUTE, readyBy, collectedAt }), 125); // 20 min
    assert.equal(waitPayCents({ arrivedAt: T_1245 + 19 * MINUTE, readyBy, collectedAt }), 25); // 16 min
    assert.equal(waitPayCents({ arrivedAt: T_1245 + 20 * MINUTE, readyBy, collectedAt }), 0); // 15 min
  });

  it('pays nothing when the store hands over before the ready time', () => {
    assert.equal(
      waitPayCents({ arrivedAt: T_1245, readyBy: T_1245 + 30 * MINUTE, collectedAt: T_1245 + 10 * MINUTE }),
      0,
    );
  });

  it('pays nothing to a driver who never checked in', () => {
    assert.equal(waitPayCents({ arrivedAt: null, readyBy: T_1245, collectedAt: T_1245 + 80 * MINUTE }), 0);
  });

  it('refuses a time that is missing or not a number', () => {
    const good = { arrivedAt: T_1245, readyBy: T_1245, collectedAt: T_1245 + 30 * MINUTE };
    assert.throws(() => waitPayCents({ ...good, readyBy: Number.NaN }), RangeError);
    assert.throws(() => waitPayCents({ ...good, collectedAt: Number.POSITIVE_INFINITY }), RangeError);
    assert.throws(() => waitPayCents({ ...good, arrivedAt: Number.NaN }), RangeError);
    assert.throws(() => waitPayCents({ ...good, collectedAt: undefined as unknown as number }), RangeError);
    assert.throws(() => waitPayCents({ ...good, arrivedAt: undefined as unknown as null }), RangeError);
    assert.throws(() => waitPayCents({ ...good, arrivedAt: null, readyBy: Number.NaN }), RangeError);
  });
});

describe('withWaitPay (§3.10)', () => {
  it('sets the wait pay and adds it to the total', () => {
    assert.deepEqual(withWaitPay(KESTREL, 375), { ...KESTREL, waitCents: 375, totalCents: 5150 });
    assert.deepEqual(withWaitPay(KESTREL, 1500), { ...KESTREL, waitCents: 1500, totalCents: 6275 });
    assert.deepEqual(withWaitPay(KESTREL, 0), KESTREL);
  });

  it('sets the amount: it does not add to an earlier one', () => {
    assert.deepEqual(withWaitPay(withWaitPay(KESTREL, 375), 100), {
      ...KESTREL,
      waitCents: 100,
      totalCents: 4875,
    });
  });

  it('gives the delivery ledger amount of §3.9: offer + boost + wait', () => {
    const delivered = withWaitPay(withBoost(KESTREL, 1000), 375);
    assert.deepEqual(delivered, { ...KESTREL, boostCents: 1000, waitCents: 375, totalCents: 6150 });
    assert.equal(delivered.totalCents, delivered.offerCents + delivered.boostCents + delivered.waitCents);
  });

  it('returns a new object and does not change the one it was given', () => {
    const paid = withWaitPay(KESTREL, 375);
    assert.notEqual(paid, KESTREL);
    assert.deepEqual(KESTREL, payout(4775, [1600, 2600, 200, 360]));
    assert.ok(Object.is(withWaitPay(KESTREL, -0).waitCents, 0));
  });

  it('refuses wait pay that is not a non-negative whole number of cents', () => {
    for (const bad of [-25, 12.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => withWaitPay(KESTREL, bad), RangeError, String(bad));
    }
  });
});

describe('failurePayCents (§3.10)', () => {
  const boosted = { offerCents: 4775, boostCents: 1000 };

  it('pays the offer plus the boost when the site caused the failure', () => {
    const siteCaused: FailureReasonId[] = [
      'no_one_on_site',
      'site_closed',
      'access_issue',
      'wrong_address',
      'refused',
      'unsafe_to_unload',
    ];
    for (const reason of siteCaused) {
      assert.equal(failurePayCents(KESTREL, reason), 4775, reason);
      assert.equal(failurePayCents(boosted, reason), 5775, reason);
    }
  });

  it('pays nothing when the driver caused it, or the reason is "other" or missing', () => {
    const unpaid: (FailureReasonId | null)[] = ['damaged', 'vehicle_issue', 'other', null];
    for (const reason of unpaid) {
      assert.equal(failurePayCents(KESTREL, reason), 0, String(reason));
      assert.equal(failurePayCents(boosted, reason), 0, String(reason));
    }
    assert.equal(failurePayCents(boosted, 'customer_unavailable' as FailureReasonId), 0); // the old id is gone
  });

  it('covers every failure reason of §2.3', () => {
    assert.equal(FAILURE_REASONS.length, 9);
    for (const { id, siteCaused } of FAILURE_REASONS) {
      assert.equal(failurePayCents(boosted, id), siteCaused ? 5775 : 0, id);
    }
  });

  it('leaves wait pay out: it is only paid with a completed delivery', () => {
    const waited = withWaitPay(withBoost(KESTREL, 1000), 375);
    assert.equal(waited.totalCents, 6150);
    assert.equal(failurePayCents(waited, 'no_one_on_site'), 5775);
  });

  it('refuses amounts that are not non-negative whole numbers', () => {
    assert.throws(() => failurePayCents({ offerCents: -1, boostCents: 0 }, 'refused'), RangeError);
    assert.throws(() => failurePayCents({ offerCents: 4775, boostCents: 0.5 }, 'refused'), RangeError);
    assert.throws(() => failurePayCents({ offerCents: Number.NaN, boostCents: 0 }, 'damaged'), RangeError);
    assert.throws(() => failurePayCents({ offerCents: MAX, boostCents: 1 }, 'refused'), RangeError);
  });
});

describe('cancellationPayCents (§3.9, §3.10)', () => {
  const acceptedAt = T_1245;
  /** Cancelled 20 minutes after acceptance, with a check-in 10 minutes after it. */
  const earned = { acceptedAt, arrivedAt: acceptedAt + 10 * MINUTE, cancelledAt: acceptedAt + 20 * MINUTE };

  it('pays the §3.11 example: a 4 775 offer → ceilTo25(max(500, 1 194)) = 1 200', () => {
    assert.equal(cancellationPayCents(4775, earned), 1200);
  });

  it('pays a quarter of the offer, at least $5, rounded up to $0.25', () => {
    const expected: [number, number][] = [
      [1000, 500], // a quarter is 250: the minimum applies
      [1450, 500], // 362.5 → 363
      [2000, 500], // exactly 500
      [2025, 525], // 506.25 → 506 → 525
      [2100, 525], // exactly 525
      [3200, 800],
      [3825, 975], // 956.25 → 956 → 975
      [4200, 1050],
      [4550, 1150], // 1 137.5 → 1 138 → 1 150
      [4950, 1250], // 1 237.5 → 1 238 → 1 250
      [6350, 1600], // 1 587.5 → 1 588 → 1 600
      [7850, 1975], // 1 962.5 → 1 963 → 1 975
    ];
    for (const [offerCents, pay] of expected) {
      assert.equal(cancellationPayCents(offerCents, earned), pay, String(offerCents));
    }
  });

  it('is earned by a check-in at the store, however soon the job is cancelled', () => {
    assert.equal(
      cancellationPayCents(4775, {
        acceptedAt,
        arrivedAt: acceptedAt + MINUTE,
        cancelledAt: acceptedAt + 2 * MINUTE,
      }),
      1200,
    );
    assert.equal(
      cancellationPayCents(4775, {
        acceptedAt,
        arrivedAt: acceptedAt + MINUTE,
        cancelledAt: acceptedAt + MINUTE,
      }),
      1200,
    );
  });

  it('does not count a check-in recorded after the cancellation', () => {
    assert.equal(
      cancellationPayCents(4775, {
        acceptedAt,
        arrivedAt: acceptedAt + 5 * MINUTE,
        cancelledAt: acceptedAt + 4 * MINUTE,
      }),
      0,
    );
  });

  it('is earned by holding the job for 15 minutes, even without a check-in', () => {
    const held = (ms: number) =>
      cancellationPayCents(4775, { acceptedAt, arrivedAt: null, cancelledAt: acceptedAt + ms });
    assert.equal(held(0), 0);
    assert.equal(held(14 * MINUTE), 0);
    assert.equal(held(15 * MINUTE - 1), 0);
    assert.equal(held(15 * MINUTE), 1200);
    assert.equal(held(15 * MINUTE + 1), 1200);
    assert.equal(held(3 * 60 * MINUTE), 1200);
  });

  it('pays nothing for a job nobody had accepted', () => {
    assert.equal(
      cancellationPayCents(4775, { acceptedAt: null, arrivedAt: null, cancelledAt: T_1245 + 60 * MINUTE }),
      0,
    );
  });

  it('is the §3.9 ledger formula for every amount, quarter or not', () => {
    // A quarter of the offer is rounded half-up before the $5 minimum and the rounding to $0.25.
    assert.equal(cancellationPayCents(2001, earned), 500); // 500.25 → 500
    assert.equal(cancellationPayCents(2002, earned), 525); // 500.5 → 501 → 525
    assert.equal(cancellationPayCents(2102, earned), 550); // 525.5 → 526 → 550
    assert.equal(cancellationPayCents(0, earned), 500);
    for (let offerCents = 0; offerCents <= 12_000; offerCents += 1) {
      const quarter = (2n * BigInt(offerCents) + 4n) / 8n;
      const floored = quarter < 500n ? 500n : quarter;
      const expected = Number(((floored + 24n) / 25n) * 25n);
      assert.equal(cancellationPayCents(offerCents, earned), expected, String(offerCents));
    }
  });

  it('refuses an offer or a time that cannot be right', () => {
    const notEarned = { acceptedAt: null, arrivedAt: null, cancelledAt: acceptedAt };
    for (const bad of [-1, 47.75, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => cancellationPayCents(bad, earned), RangeError, String(bad));
      // Checked even when nothing is owed: a broken offer is a bug wherever it shows up.
      assert.throws(() => cancellationPayCents(bad, notEarned), RangeError, String(bad));
    }
    assert.throws(() => cancellationPayCents(4775, { ...earned, cancelledAt: Number.NaN }), RangeError);
    assert.throws(() => cancellationPayCents(4775, { ...earned, acceptedAt: Number.NaN }), RangeError);
    assert.throws(() => cancellationPayCents(4775, { ...earned, arrivedAt: Number.NaN }), RangeError);
    assert.throws(
      () => cancellationPayCents(4775, { ...earned, cancelledAt: undefined as unknown as number }),
      RangeError,
    );
  });
});
