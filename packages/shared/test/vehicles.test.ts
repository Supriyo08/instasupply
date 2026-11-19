/**
 * Vehicle classes and the load (§3.3): what an order weighs and measures, the smallest vehicle that can
 * carry it, the customer's list fee and the drive time. The loads are the seed products of §11.4 in the
 * worked examples of §3.11; expected values are worked out by hand or with BigInt.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  INCLUDED_ROAD_TENTHS,
  VEHICLE_CLASSES,
  VEHICLE_CLASS_IDS,
  audienceFor,
  canCarry,
  capacityClassFor,
  deliveryFeeListCents,
  driveMinutes,
  summarizeLoad,
  type LoadInputLine,
  type LoadSummary,
  type SellUnit,
  type VehicleClass,
  type VehicleType,
} from '../src';

const MAX = Number.MAX_SAFE_INTEGER;

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

/** The class table of §3.3, copied from the spec row by row. Money is in cents. */
const SPEC_TABLE: readonly {
  id: VehicleClass;
  rank: number;
  maxKg: number;
  maxLengthCm: number;
  sheets: boolean;
  maxVolumeL: number;
  feeBaseCents: number;
  feePerKmCents: number;
  labourerFeeCents: number | null;
  driverBaseCents: number;
  driverPerKmCents: number;
  speedKmh: number;
  loadMinutes: number;
  label: string;
}[] = [
  {
    id: 'car',
    rank: 0,
    maxKg: 150,
    maxLengthCm: 150,
    sheets: false,
    maxVolumeL: 350,
    feeBaseCents: 1299,
    feePerKmCents: 99,
    labourerFeeCents: null,
    driverBaseCents: 900,
    driverPerKmCents: 75,
    speedKmh: 40,
    loadMinutes: 5,
    label: 'Car',
  },
  {
    id: 'suv',
    rank: 1,
    maxKg: 350,
    maxLengthCm: 200,
    sheets: false,
    maxVolumeL: 1500,
    feeBaseCents: 1999,
    feePerKmCents: 119,
    labourerFeeCents: 3500,
    driverBaseCents: 1100,
    driverPerKmCents: 85,
    speedKmh: 40,
    loadMinutes: 10,
    label: 'SUV',
  },
  {
    id: 'pickup',
    rank: 2,
    maxKg: 700,
    maxLengthCm: 250,
    sheets: true,
    maxVolumeL: 2500,
    feeBaseCents: 2999,
    feePerKmCents: 149,
    labourerFeeCents: 3500,
    driverBaseCents: 1600,
    driverPerKmCents: 100,
    speedKmh: 38,
    loadMinutes: 15,
    label: 'Pickup truck',
  },
  {
    id: 'cargo_van',
    rank: 3,
    maxKg: 1300,
    maxLengthCm: 370,
    sheets: true,
    maxVolumeL: 9000,
    feeBaseCents: 4499,
    feePerKmCents: 179,
    labourerFeeCents: 4500,
    driverBaseCents: 2200,
    driverPerKmCents: 115,
    speedKmh: 36,
    loadMinutes: 15,
    label: 'Cargo van',
  },
  {
    id: 'box_truck',
    rank: 4,
    maxKg: 3500,
    maxLengthCm: 490,
    sheets: true,
    maxVolumeL: 22_000,
    feeBaseCents: 7999,
    feePerKmCents: 249,
    labourerFeeCents: 6000,
    driverBaseCents: 4000,
    driverPerKmCents: 150,
    speedKmh: 32,
    loadMinutes: 20,
    label: 'Box truck',
  },
  {
    id: 'flatbed',
    rank: 5,
    maxKg: 6000,
    maxLengthCm: 740,
    sheets: true,
    maxVolumeL: 30_000,
    feeBaseCents: 9999,
    feePerKmCents: 299,
    labourerFeeCents: 7500,
    driverBaseCents: 5000,
    driverPerKmCents: 175,
    speedKmh: 30,
    loadMinutes: 20,
    label: 'Flatbed',
  },
];

const CLASSES: readonly VehicleClass[] = ['car', 'suv', 'pickup', 'cargo_van', 'box_truck', 'flatbed'];

/** The class after this one, or null after the flatbed: where a load goes when it breaks one limit. */
const nextClass = (id: VehicleClass): VehicleClass | null => CLASSES[CLASSES.indexOf(id) + 1] ?? null;

type Product = Omit<LoadInputLine, 'quantity'>;

const product = (
  name: string,
  unit: SellUnit,
  weightKg: number,
  l: number,
  w: number,
  h: number,
  size: string | null = null,
): Product => ({ name, unit, size, weightKg, dimsCm: { l, w, h } });

/** Seed products (§11.4): name, sell unit, kg and l × w × h in cm per unit. */
const P = {
  stud: product('2x4x8 SPF stud, kiln-dried', 'each', 4.5, 244, 9, 4, '2 in × 4 in × 8 ft'),
  pt2x6: product('Pressure-treated 2x6, 12 ft', 'each', 14, 366, 14, 4),
  pt4x4: product('Pressure-treated 4x4 post, 8 ft', 'each', 15, 244, 9, 9),
  osb: product('OSB sheathing 7/16 in, 4×8', 'sheet', 23, 244, 122, 1.1),
  drywall: product('Drywall 1/2 in regular, 4×8', 'sheet', 25, 244, 122, 1.3),
  compound: product('All-purpose joint compound, 17 L', 'pail', 28, 30, 30, 38),
  hanger: product('Joist hanger 2x8, galvanized', 'each', 0.3, 15, 8, 5),
  deckScrews: product('Deck screws #10 × 2-1/2 in, 5 lb', 'box', 2.4, 18, 12, 8),
  cable: product('NMD90 14/2 cable, 75 m', 'roll', 7, 35, 35, 12),
  deviceBox: product('Single-gang PVC device box', 'each', 0.05, 10, 6, 6),
  batts: product('Fibreglass batts R20, 15 in (78.3 sq ft)', 'bag', 9, 120, 40, 40),
  foam: product('XPS rigid foam 2 in, 2×8 ft', 'sheet', 2.7, 244, 61, 5),
  shingles: product('Architectural shingles, bundle (32.8 sq ft)', 'bundle', 30, 100, 33, 13),
  underlayment: product('Synthetic underlayment, 10 squares', 'roll', 12, 107, 25, 25),
  mirror: product('Bevelled mirror, 24 × 36 in', 'each', 9, 91, 61, 3),
  copper: product('Copper pipe 3/4 in Type L, 12 ft', 'length', 2.5, 366, 2.2, 2.2),
  valve: product('Brass ball valve 1/2 in, sweat', 'each', 0.3, 10, 6, 6),
  // The custom special-order line of quote Q-10002 (§11.5 G).
  lvl: product('LVL beam 1-3/4 × 9-1/2 in × 14 ft (special order)', 'each', 27, 427, 24, 5),
};

const line = (quantity: number, item: Product): LoadInputLine => ({ ...item, quantity });

/** What the driver's load list shows for a line: the unit's weight and longest side. */
const shown = (quantity: number, item: Product) => ({
  name: item.name,
  quantity,
  unit: item.unit,
  size: item.size,
  weightKg: item.weightKg,
  // §1.1: the longest side, whichever field holds it.
  longestCm: Math.max(item.dimsCm.l, item.dimsCm.w, item.dimsCm.h),
});

/** One unit of something plain: 1 kg, 10 cm cube, unless a test says otherwise. */
const item = (overrides: { weightKg?: number; l?: number; w?: number; h?: number } = {}): Product =>
  product(
    'Test item',
    'each',
    overrides.weightKg ?? 1,
    overrides.l ?? 10,
    overrides.w ?? 10,
    overrides.h ?? 10,
  );

/** A 1 m cube: 1 000 L, 1 200 L with the packing factor. */
const cube = item({ l: 100, w: 100, h: 100 });

const classOf = (lines: readonly LoadInputLine[]) => summarizeLoad(lines).vehicleClass;

/** §3.3 in exact arithmetic, with the limits read from the spec table above. */
function exactLoad(lines: readonly LoadInputLine[]) {
  let weightG = 0n;
  let mm3 = 0n;
  let longestMm = 0;
  let hasSheets = false;
  for (const entry of lines) {
    const mm = (cm: number) => Math.round(cm * 10);
    weightG += BigInt(entry.quantity) * BigInt(Math.round(entry.weightKg * 1000));
    mm3 +=
      BigInt(entry.quantity) *
      BigInt(mm(entry.dimsCm.l)) *
      BigInt(mm(entry.dimsCm.w)) *
      BigInt(mm(entry.dimsCm.h));
    // §1.1: l is the longest side, then w.
    const [l = 0, w = 0] = [mm(entry.dimsCm.l), mm(entry.dimsCm.w), mm(entry.dimsCm.h)].sort((a, b) => b - a);
    longestMm = Math.max(longestMm, l);
    hasSheets = hasSheets || (l >= 2400 && w >= 1200);
  }
  const volumeL = (mm3 * 12n + 9_999_999n) / 10_000_000n;
  const fits = SPEC_TABLE.find(
    (row) =>
      weightG <= BigInt(row.maxKg) * 1000n &&
      longestMm <= row.maxLengthCm * 10 &&
      volumeL <= BigInt(row.maxVolumeL) &&
      (row.sheets || !hasSheets),
  );
  return { weightG, volumeL, vehicleClass: fits ? fits.id : null };
}

describe('VEHICLE_CLASSES (§3.3)', () => {
  it('is the class table of the spec, cell by cell', () => {
    assert.deepEqual(Object.keys(VEHICLE_CLASSES).sort(), [...CLASSES].sort());
    for (const { id, ...row } of SPEC_TABLE) assert.deepEqual(VEHICLE_CLASSES[id], row, id);
  });

  it('lists the classes from the smallest to the largest', () => {
    assert.deepEqual(VEHICLE_CLASS_IDS, CLASSES);
    assert.deepEqual(
      VEHICLE_CLASS_IDS.map((id) => VEHICLE_CLASSES[id].rank),
      [0, 1, 2, 3, 4, 5],
    );
  });

  it('includes the first 10.0 km in every base fee', () => {
    assert.equal(INCLUDED_ROAD_TENTHS, 100);
  });
});

describe('summarizeLoad: class limits (§3.3)', () => {
  it('weight: at the limit the class still fits, one gram more needs the next class', () => {
    for (const { id, maxKg } of SPEC_TABLE) {
      assert.equal(classOf([line(1, item({ weightKg: maxKg }))]), id, `${maxKg} kg`);
      assert.equal(classOf([line(1, item({ weightKg: maxKg + 0.001 }))]), nextClass(id), `${maxKg}.001 kg`);
    }
    // Spelled out for the car: 150 kg rides in a car, 150.001 kg needs an SUV.
    assert.equal(classOf([line(1, item({ weightKg: 150 }))]), 'car');
    assert.equal(classOf([line(1, item({ weightKg: 150.001 }))]), 'suv');
    assert.equal(classOf([line(1, item({ weightKg: 6000.001 }))]), null);
  });

  it('weight: the limit is on the whole load, not on one unit', () => {
    assert.equal(classOf([line(150, item({ weightKg: 1 }))]), 'car');
    assert.equal(classOf([line(151, item({ weightKg: 1 }))]), 'suv');
    assert.equal(classOf([line(3, item({ weightKg: 50 }))]), 'car');
    assert.equal(classOf([line(3, item({ weightKg: 50.001 }))]), 'suv'); // 150.003 kg
    assert.equal(classOf([line(100, item({ weightKg: 1 })), line(50, item({ weightKg: 1 }))]), 'car');
    assert.equal(classOf([line(100, item({ weightKg: 1 })), line(50, item({ weightKg: 1.001 }))]), 'suv');
  });

  it('length: at the limit the class still fits, a millimetre more needs the next class', () => {
    for (const { id, maxLengthCm } of SPEC_TABLE) {
      assert.equal(classOf([line(1, item({ l: maxLengthCm, w: 1, h: 1 }))]), id, `${maxLengthCm} cm`);
      assert.equal(
        classOf([line(1, item({ l: maxLengthCm + 0.1, w: 1, h: 1 }))]),
        nextClass(id),
        `${maxLengthCm}.1 cm`,
      );
      assert.equal(
        classOf([line(1, item({ l: maxLengthCm + 1, w: 1, h: 1 }))]),
        nextClass(id),
        `${maxLengthCm + 1} cm`,
      );
    }
    // Spelled out for the pickup: 250 cm fits its box, 251 cm needs a cargo van.
    assert.equal(classOf([line(1, item({ l: 250, w: 1, h: 1 }))]), 'pickup');
    assert.equal(classOf([line(1, item({ l: 251, w: 1, h: 1 }))]), 'cargo_van');
    assert.equal(classOf([line(1, item({ l: 741, w: 1, h: 1 }))]), null);
  });

  it('length: the longest unit decides, however few there are', () => {
    assert.equal(classOf([line(40, item()), line(1, item({ l: 370, w: 1, h: 1 }))]), 'cargo_van');
    assert.equal(classOf([line(40, item()), line(1, item({ l: 370.1, w: 1, h: 1 }))]), 'box_truck');
  });

  it('sheets: a single 4×8 sheet needs a pickup', () => {
    // Light and thin, but a sheet: no car and no SUV takes it. (At 244 cm it is also too long for
    // both, so with today's table the sheet rule and the length limit always agree.)
    const sheet = item({ weightKg: 5, l: 244, w: 122, h: 1.3 });
    const load = summarizeLoad([line(1, sheet)]);
    assert.equal(load.hasSheets, true);
    assert.equal(load.vehicleClass, 'pickup');
    assert.equal(load.weightG, 5000); // far below the 150 kg a car takes
    assert.equal(load.volumeL, 47); // 38 698 400 mm³ × 12 ÷ 10⁷ = 46.4, far below a car's 350 L
    for (const { id, sheets } of SPEC_TABLE) assert.equal(sheets, id !== 'car' && id !== 'suv', id);
  });

  it('sheets: 240 cm by 120 cm or more is a sheet, anything smaller is not', () => {
    const hasSheets = (l: number, w: number) => summarizeLoad([line(1, item({ l, w, h: 1.3 }))]).hasSheets;
    assert.equal(hasSheets(240, 120), true);
    assert.equal(hasSheets(244, 122), true);
    assert.equal(hasSheets(239.9, 120), false);
    assert.equal(hasSheets(240, 119.9), false);
    assert.equal(hasSheets(244, 61), false); // a 2×8 foam board
    assert.equal(hasSheets(366, 14), false); // a 12 ft board
    // Sides in another order are read longest first (§1.1 `l` = longest side).
    const sideways = (dims: { l: number; w: number; h: number }) => summarizeLoad([line(4, item(dims))]);
    for (const dims of [
      { l: 122, w: 244, h: 1.3 },
      { l: 1.3, w: 122, h: 244 },
      { l: 244, w: 1.3, h: 122 },
    ]) {
      const load = sideways(dims);
      assert.deepEqual([load.longestCm, load.hasSheets], [244, true], JSON.stringify(dims));
      assert.notEqual(load.vehicleClass, 'car');
      assert.deepEqual(load, sideways({ l: 244, w: 122, h: 1.3 }));
    }
    // Paint's category default 20 × 20 × 25 (§1.5) is 25 cm long.
    assert.equal(sideways({ l: 20, w: 20, h: 25 }).longestCm, 25);
    assert.equal(summarizeLoad([line(5, P.stud), line(1, P.osb)]).hasSheets, true);
    assert.equal(summarizeLoad([line(5, P.stud), line(9, P.foam)]).hasSheets, false);
  });

  it('volume: at the limit the class still fits, a litre more needs the next class', () => {
    const filler = (w: number, h: number) => item({ l: 100, w, h });
    const speck = item({ l: 1, w: 1, h: 1 }); // 1 cm³
    const cases: { id: VehicleClass; at: LoadInputLine[]; above: LoadInputLine[]; litres: number }[] = [
      // 291 500 000 mm³ → 349.8 L; 292 000 000 mm³ → 350.4 L.
      { id: 'car', at: [line(1, filler(50, 58.3))], above: [line(1, filler(50, 58.4))], litres: 350 },
      // 1 250 000 000 mm³ → exactly 1 500 L; one cm³ more → 1 500.0012 L.
      {
        id: 'suv',
        at: [line(1, item({ l: 125, w: 100, h: 100 }))],
        above: [line(1, item({ l: 125, w: 100, h: 100 })), line(1, speck)],
        litres: 1500,
      },
      // 2 083 000 000 mm³ → 2 499.6 L; 2 083 400 000 mm³ → 2 500.08 L.
      {
        id: 'pickup',
        at: [line(2, cube), line(1, filler(83, 10))],
        above: [line(2, cube), line(1, filler(83.4, 10))],
        litres: 2500,
      },
      // 7 500 000 000 mm³ → exactly 9 000 L; one cm³ more → 9 000.0012 L.
      {
        id: 'cargo_van',
        at: [line(7, cube), line(1, filler(100, 50))],
        above: [line(7, cube), line(1, filler(100, 50)), line(1, speck)],
        litres: 9000,
      },
      // 18 333 000 000 mm³ → 21 999.6 L; 18 334 000 000 mm³ → 22 000.8 L.
      {
        id: 'box_truck',
        at: [line(18, cube), line(1, filler(100, 33.3))],
        above: [line(18, cube), line(1, filler(100, 33.4))],
        litres: 22_000,
      },
      // 25 000 000 000 mm³ → exactly 30 000 L; one cm³ more → 30 000.0012 L.
      { id: 'flatbed', at: [line(25, cube)], above: [line(25, cube), line(1, speck)], litres: 30_000 },
    ];
    for (const { id, at, above, litres } of cases) {
      assert.equal(VEHICLE_CLASSES[id].maxVolumeL, litres);
      const fits = summarizeLoad(at);
      assert.equal(fits.volumeL, litres, `${id}: at the limit`);
      assert.equal(fits.vehicleClass, id, `${id}: at the limit`);
      const tooMuch = summarizeLoad(above);
      assert.equal(tooMuch.volumeL, litres + 1, `${id}: above the limit`);
      assert.equal(tooMuch.vehicleClass, nextClass(id), `${id}: above the limit`);
      // Only the volume decides in these loads: at most 27 kg, nothing longer than 125 cm.
      assert.ok(tooMuch.weightG <= 27_000 && tooMuch.longestCm <= 125 && !tooMuch.hasSheets);
    }
    // Spelled out for the pickup: 2 500 L fits, 2 501 L needs a cargo van.
    assert.equal(classOf([line(2, cube), line(1, filler(83, 10))]), 'pickup');
    assert.equal(classOf([line(2, cube), line(1, filler(83.4, 10))]), 'cargo_van');
  });

  it('takes the lowest class that meets all four limits at once', () => {
    // Light but long: 12 kg of copper pipe, 366 cm, needs a cargo van.
    assert.equal(classOf([line(4, P.copper), line(6, P.valve)]), 'cargo_van');
    // Short but heavy: 20 units of 30 kg, 600 kg, need a pickup.
    assert.equal(classOf([line(20, item({ weightKg: 30, l: 60, w: 40, h: 12 }))]), 'pickup');
    // Light and short but bulky: 5 502 L of insulation needs a cargo van.
    assert.equal(classOf([line(20, P.batts), line(10, P.foam)]), 'cargo_van');
    // Each limit points at a different class; the largest of them wins.
    assert.equal(
      classOf([
        line(1, item({ weightKg: 1400 })), // box truck by weight
        line(1, item({ l: 300, w: 1, h: 1 })), // cargo van by length
        line(1, cube), // suv by volume
      ]),
      'box_truck',
    );
    assert.equal(classOf([line(1, item({ weightKg: 100, l: 500, w: 100, h: 100 }))]), 'flatbed');
  });

  it('answers null when no single vehicle can take the load', () => {
    assert.equal(classOf([line(201, item({ weightKg: 30 }))]), null); // 6 030 kg
    assert.equal(classOf([line(1, item({ l: 800, w: 5, h: 5 }))]), null);
    assert.equal(classOf([line(26, cube)]), null); // 31 200 L
    assert.equal(classOf([line(200, item({ weightKg: 30 }))]), 'flatbed'); // exactly 6 000 kg
  });
});

describe('summarizeLoad: the worked examples (§3.11, §11.5)', () => {
  const cases: { title: string; lines: LoadInputLine[]; expected: LoadSummary }[] = [
    {
      // 6 × 25 + 28 = 178 kg. 6 × 2440·1220·13 + 300·300·380 = 266 390 400 mm³ → 319.7 L.
      title: 'V1 A · Bluestone: 178.0 kg · 7 pcs · 244 cm · sheets · 320 L → pickup',
      lines: [line(6, P.drywall), line(1, P.compound)],
      expected: {
        pieces: 7,
        weightG: 178_000,
        weightKg: 178,
        longestCm: 244,
        volumeL: 320,
        hasSheets: true,
        handlingPieces: 7, // six sheets and a 28 kg pail
        heaviestUnitKg: 28,
        heavy: false,
        vehicleClass: 'pickup',
        summary: '6 × Drywall 1/2 in regular, 4×8, 1 × All-purpose joint compound, 17 L',
        lines: [shown(6, P.drywall), shown(1, P.compound)],
      },
    },
    {
      // 20 × 4.5 + 4 × 23 = 182 kg. 20 × 2440·90·40 + 4 × 2440·1220·11 = 306 659 200 mm³ → 367.99 L.
      title: 'V1 B · Kestrel: 182.0 kg · 24 pcs · 244 cm · sheets · 368 L → pickup',
      lines: [line(20, P.stud), line(4, P.osb)],
      expected: {
        pieces: 24,
        weightG: 182_000,
        weightKg: 182,
        longestCm: 244,
        volumeL: 368,
        hasSheets: true,
        handlingPieces: 24, // 20 studs of 244 cm and 4 sheets
        heaviestUnitKg: 23,
        heavy: false,
        vehicleClass: 'pickup',
        summary: '20 × 2x4x8 SPF stud, kiln-dried, 4 × OSB sheathing 7/16 in, 4×8',
        lines: [shown(20, P.stud), shown(4, P.osb)],
      },
    },
    {
      // 24 × 0.3 + 2 × 2.4 = 12 kg. 24 × 150·80·50 + 2 × 180·120·80 = 17 856 000 mm³ → 21.4 L.
      title: 'V3 A · Boltbin: 12.0 kg, 18 cm → car',
      lines: [line(24, P.hanger), line(2, P.deckScrews)],
      expected: {
        pieces: 26,
        weightG: 12_000,
        weightKg: 12,
        longestCm: 18,
        volumeL: 22,
        hasSheets: false,
        handlingPieces: 0,
        heaviestUnitKg: 2.4,
        heavy: false,
        vehicleClass: 'car',
        summary: '24 × Joist hanger 2x8, galvanized, 2 × Deck screws #10 × 2-1/2 in, 5 lb',
        lines: [shown(24, P.hanger), shown(2, P.deckScrews)],
      },
    },
    {
      // 24 × 4.5 + 6 × 23 = 246 kg. 24 × 8 784 000 + 6 × 32 744 800 = 407 284 800 mm³ → 488.7 L.
      title: 'V3 B · Kestrel: 246.0 kg, sheets, 489 L → pickup',
      lines: [line(24, P.stud), line(6, P.osb)],
      expected: {
        pieces: 30,
        weightG: 246_000,
        weightKg: 246,
        longestCm: 244,
        volumeL: 489,
        hasSheets: true,
        handlingPieces: 30,
        heaviestUnitKg: 23,
        heavy: false, // 4 kg short of 250 kg, and no unit of 40 kg
        vehicleClass: 'pickup',
        summary: '24 × 2x4x8 SPF stud, kiln-dried, 6 × OSB sheathing 7/16 in, 4×8',
        lines: [shown(24, P.stud), shown(6, P.osb)],
      },
    },
    {
      // 3 × 7 + 20 × 0.05 = 22 kg. 3 × 350·350·120 + 20 × 100·60·60 = 51 300 000 mm³ → 61.6 L.
      title: 'V3 C · Voltway: 22.0 kg, 35 cm → car',
      lines: [line(3, P.cable), line(20, P.deviceBox)],
      expected: {
        pieces: 23,
        weightG: 22_000,
        weightKg: 22,
        longestCm: 35,
        volumeL: 62,
        hasSheets: false,
        handlingPieces: 0,
        heaviestUnitKg: 7,
        heavy: false,
        vehicleClass: 'car',
        summary: '3 × NMD90 14/2 cable, 75 m, 20 × Single-gang PVC device box',
        lines: [shown(3, P.cable), shown(20, P.deviceBox)],
      },
    },
    {
      // 20 × 9 + 10 × 2.7 = 207 kg. 20 × 1200·400·400 + 10 × 2440·610·50 = 4 584 200 000 mm³ → 5 501.04 L.
      title: 'Scenario D · Grainline: 207.0 kg, 10 pieces of 240 cm or more → cargo van',
      lines: [line(20, P.batts), line(10, P.foam)],
      expected: {
        pieces: 30,
        weightG: 207_000,
        weightKg: 207,
        longestCm: 244,
        volumeL: 5502,
        hasSheets: false, // the foam boards are 61 cm wide
        handlingPieces: 10,
        heaviestUnitKg: 9,
        heavy: false,
        vehicleClass: 'cargo_van', // too bulky for a pickup's 2 500 L
        summary: '20 × Fibreglass batts R20, 15 in (78.3 sq ft), 10 × XPS rigid foam 2 in, 2×8 ft',
        lines: [shown(20, P.batts), shown(10, P.foam)],
      },
    },
    {
      // 20 × 30 + 2 × 12 = 624 kg. 20 × 1000·330·130 + 2 × 1070·250·250 = 991 750 000 mm³ → 1 190.1 L.
      title: 'Scenario E · Slatebridge: 624.0 kg, 20 heavy pieces → pickup, heavy',
      lines: [line(20, P.shingles), line(2, P.underlayment)],
      expected: {
        pieces: 22,
        weightG: 624_000,
        weightKg: 624,
        longestCm: 107,
        volumeL: 1191,
        hasSheets: false,
        handlingPieces: 20, // the 30 kg bundles; the 12 kg rolls are not
        heaviestUnitKg: 30,
        heavy: true, // V9: an unattended site makes the labourer mandatory
        vehicleClass: 'pickup',
        summary: '20 × Architectural shingles, bundle (32.8 sq ft), 2 × Synthetic underlayment, 10 squares',
        lines: [shown(20, P.shingles), shown(2, P.underlayment)],
      },
    },
    {
      // 30 × 14 + 8 × 15 + 2 × 27 = 594 kg.
      // 30 × 3660·140·40 + 8 × 2440·90·90 + 2 × 4270·240·50 = 875 472 000 mm³ → 1 050.6 L.
      title: 'Quote Q-10002 · Kestrel: 594.0 kg, 40 handling pieces → box truck',
      lines: [line(30, P.pt2x6), line(8, P.pt4x4), line(2, P.lvl)],
      expected: {
        pieces: 40,
        weightG: 594_000,
        weightKg: 594,
        longestCm: 427,
        volumeL: 1051,
        hasSheets: false,
        handlingPieces: 40,
        heaviestUnitKg: 27,
        heavy: true,
        vehicleClass: 'box_truck', // the 427 cm beam is too long for a cargo van
        summary: '30 × Pressure-treated 2x6, 12 ft, 8 × Pressure-treated 4x4 post, 8 ft +1 more',
        lines: [shown(30, P.pt2x6), shown(8, P.pt4x4), shown(2, P.lvl)],
      },
    },
    {
      // 910·610·30 = 16 653 000 mm³ → 19.98 L.
      title: 'Scenario K · Glassmoor mirror: 9 kg → car',
      lines: [line(1, P.mirror)],
      expected: {
        pieces: 1,
        weightG: 9000,
        weightKg: 9,
        longestCm: 91,
        volumeL: 20,
        hasSheets: false,
        handlingPieces: 0,
        heaviestUnitKg: 9,
        heavy: false,
        vehicleClass: 'car',
        summary: '1 × Bevelled mirror, 24 × 36 in',
        lines: [shown(1, P.mirror)],
      },
    },
    {
      // 4 × 2.5 + 6 × 0.3 = 11.8 kg. 4 × 3660·22·22 + 6 × 100·60·60 = 9 245 760 mm³ → 11.1 L.
      title: 'V6 · Copperline (a pickup order: the load is still summarized)',
      lines: [line(4, P.copper), line(6, P.valve)],
      expected: {
        pieces: 10,
        weightG: 11_800,
        weightKg: 11.8,
        longestCm: 366,
        volumeL: 12,
        hasSheets: false,
        handlingPieces: 4, // the 12 ft pipes
        heaviestUnitKg: 2.5,
        heavy: false,
        vehicleClass: 'cargo_van',
        summary: '4 × Copper pipe 3/4 in Type L, 12 ft, 6 × Brass ball valve 1/2 in, sweat',
        lines: [shown(4, P.copper), shown(6, P.valve)],
      },
    },
  ];

  for (const { title, lines, expected } of cases) {
    it(title, () => {
      assert.deepEqual(summarizeLoad(lines), expected);
    });
  }
});

describe('summarizeLoad: weights, sizes and flags (§3.1 rule 7, §3.3)', () => {
  it('adds weight in whole grams, with no float drift', () => {
    // As floats, 0.1 + 0.2 + 0.3 is 0.6000000000000001.
    const mixed = summarizeLoad([
      line(1, item({ weightKg: 0.1 })),
      line(1, item({ weightKg: 0.2 })),
      line(1, item({ weightKg: 0.3 })),
    ]);
    assert.equal(mixed.weightG, 600);
    assert.equal(mixed.weightKg, 0.6);
    // 1 500 units of 100 g are exactly 150 kg: still a car.
    const small = item({ weightKg: 0.1, l: 1, w: 1, h: 1 });
    const many = summarizeLoad([line(1500, small)]);
    assert.equal(many.weightG, 150_000);
    assert.equal(many.vehicleClass, 'car');
    assert.equal(summarizeLoad([line(1500, small), line(1, item({ weightKg: 0.001 }))]).vehicleClass, 'suv');
    // Three decimals of a kilogram are whole grams.
    assert.equal(summarizeLoad([line(7, item({ weightKg: 0.045 }))]).weightG, 315);
    assert.equal(summarizeLoad([line(3, item({ weightKg: 18.6 }))]).weightG, 55_800);
    assert.equal(summarizeLoad([line(9999, item({ weightKg: 2999.999 }))]).weightG, 29_996_990_001);
  });

  it('shows the total weight in kg with one decimal, half-up', () => {
    const weightKg = (grams: number) => summarizeLoad([line(1, item({ weightKg: grams / 1000 }))]).weightKg;
    assert.equal(weightKg(0), 0);
    assert.equal(weightKg(49), 0);
    assert.equal(weightKg(50), 0.1);
    assert.equal(weightKg(149), 0.1);
    assert.equal(weightKg(150), 0.2);
    assert.equal(weightKg(1350), 1.4); // 1.35 kg: the half goes up
    assert.equal(weightKg(12_349), 12.3);
    assert.equal(weightKg(12_350), 12.4);
    assert.equal(weightKg(999_950), 1000);
    assert.equal(summarizeLoad([line(3, item({ weightKg: 0.45 }))]).weightKg, 1.4); // 1 350 g
  });

  it('reads `l` as the longest side of a unit, as §1.1 defines it', () => {
    // The seed pail of joint compound is listed 30 × 30 × 38 cm (§11): its longest side is 38.
    assert.equal(summarizeLoad([line(1, P.compound)]).longestCm, 38);
    assert.equal(summarizeLoad([line(1, P.compound)]).lines[0]?.longestCm, 38);
    assert.equal(summarizeLoad([line(1, item({ l: 60, w: 90, h: 5 }))]).longestCm, 90);
    // A sheet entered the wrong way round is still a sheet.
    assert.equal(summarizeLoad([line(1, item({ l: 122, w: 244, h: 1.3 }))]).hasSheets, true);
  });

  it('reports the heaviest unit and the longest unit, not totals', () => {
    const load = summarizeLoad([line(50, P.stud), line(1, P.compound), line(2, P.pt2x6)]);
    assert.equal(load.heaviestUnitKg, 28);
    assert.equal(load.longestCm, 366);
    assert.equal(
      summarizeLoad([line(3, item({ weightKg: 0.35, l: 25.5, w: 6, h: 6 }))]).heaviestUnitKg,
      0.35,
    );
    assert.equal(summarizeLoad([line(3, item({ weightKg: 0.35, l: 25.5, w: 6, h: 6 }))]).longestCm, 25.5);
  });

  it('measures volume in whole mm³ with the 1.2 packing factor, rounded up to a litre', () => {
    const volumeL = (l: number, w: number, h: number, quantity = 1) =>
      summarizeLoad([line(quantity, item({ l, w, h }))]).volumeL;
    assert.equal(volumeL(100, 100, 100), 1200); // 1 m³ is 1 000 L, 1 200 L packed
    assert.equal(volumeL(10, 10, 10), 2); // 1 L → 1.2 L
    assert.equal(volumeL(10, 10, 10, 5), 6); // exactly 6 L
    assert.equal(volumeL(10, 10, 10, 6), 8); // 7.2 L
    assert.equal(volumeL(1, 1, 1), 1); // 1 cm³: anything at all takes a litre
    assert.equal(volumeL(0.1, 0.1, 0.1), 1); // 1 mm³
    assert.equal(volumeL(100, 100, 0), 0); // a size of 0 takes no room
    assert.equal(volumeL(1.1, 2.2, 3.3, 1000), 10); // 11·22·33 mm³ × 1 000 = 7 986 000 mm³ → 9.58 L
    assert.equal(volumeL(244, 122, 1.3), 47); // one sheet of drywall: 46.4 L
    assert.equal(volumeL(244, 122, 1.3, 60), 2787); // 60 sheets: 2 786.3 L
    // The litre is rounded up once, on the whole load: 3 × 0.4 L is 2 L, not 3 × 1 L.
    assert.equal(volumeL(10, 10, 3.4, 3), 2); // 3 × 340 000 mm³ × 12 ÷ 10⁷ = 1.224 L
  });

  it('calls a load heavy from 250 kg in total, or with one unit of 40 kg or more', () => {
    const heavy = (...lines: LoadInputLine[]) => summarizeLoad(lines).heavy;
    assert.equal(heavy(line(9, item({ weightKg: 25 })), line(1, item({ weightKg: 24.999 }))), false); // 249.999 kg
    assert.equal(heavy(line(10, item({ weightKg: 25 }))), true); // 250 kg
    assert.equal(heavy(line(1, item({ weightKg: 39.999 }))), false);
    assert.equal(heavy(line(1, item({ weightKg: 40 }))), true);
    assert.equal(heavy(line(1, item({ weightKg: 40 })), line(3, item({ weightKg: 2 }))), true);
    assert.equal(heavy(line(6, item({ weightKg: 39.999 }))), false); // 239.994 kg
    assert.equal(heavy(line(7, item({ weightKg: 39.999 }))), true); // 279.993 kg
    assert.equal(heavy(), false);
  });

  it('counts handling pieces: 23 kg or more, 240 cm or more, or a sheet', () => {
    const handling = (...lines: LoadInputLine[]) => summarizeLoad(lines).handlingPieces;
    assert.equal(handling(line(3, item({ weightKg: 22.999 }))), 0);
    assert.equal(handling(line(3, item({ weightKg: 23 }))), 3);
    assert.equal(handling(line(2, item({ l: 239.9, w: 5, h: 5 }))), 0);
    assert.equal(handling(line(2, item({ l: 240, w: 5, h: 5 }))), 2);
    // A sheet is long, and a drywall sheet is heavy too: each unit still counts once.
    assert.equal(handling(line(4, item({ weightKg: 25, l: 244, w: 122, h: 1.3 }))), 4);
    assert.equal(handling(line(4, item({ weightKg: 2, l: 244, w: 122, h: 0.3 }))), 4);
    assert.equal(handling(line(5, P.hanger), line(4, P.compound), line(7, P.stud), line(2, P.cable)), 11);
    assert.equal(handling(line(9999, P.shingles)), 9999);
  });

  it('counts pieces over every line', () => {
    assert.equal(summarizeLoad([line(20, P.stud), line(4, P.osb), line(1, P.compound)]).pieces, 25);
    assert.equal(summarizeLoad([line(9999, P.hanger), line(9999, P.deviceBox)]).pieces, 19_998);
  });
});

describe('summarizeLoad: summary and lines', () => {
  it('describes an empty load', () => {
    assert.deepEqual(summarizeLoad([]), {
      pieces: 0,
      weightG: 0,
      weightKg: 0,
      longestCm: 0,
      volumeL: 0,
      hasSheets: false,
      handlingPieces: 0,
      heaviestUnitKg: 0,
      heavy: false,
      vehicleClass: 'car',
      summary: '',
      lines: [],
    });
  });

  it('names the first two lines and counts the rest', () => {
    const lines = [line(20, P.stud), line(4, P.osb), line(1, P.compound), line(2, P.cable), line(9, P.valve)];
    assert.equal(summarizeLoad(lines.slice(0, 1)).summary, '20 × 2x4x8 SPF stud, kiln-dried');
    assert.equal(
      summarizeLoad(lines.slice(0, 2)).summary,
      '20 × 2x4x8 SPF stud, kiln-dried, 4 × OSB sheathing 7/16 in, 4×8',
    );
    assert.equal(
      summarizeLoad(lines.slice(0, 3)).summary,
      '20 × 2x4x8 SPF stud, kiln-dried, 4 × OSB sheathing 7/16 in, 4×8 +1 more',
    );
    assert.equal(
      summarizeLoad(lines).summary,
      '20 × 2x4x8 SPF stud, kiln-dried, 4 × OSB sheathing 7/16 in, 4×8 +3 more',
    );
    assert.equal(summarizeLoad([line(1200, P.hanger)]).summary, '1200 × Joist hanger 2x8, galvanized');
  });

  it('keeps the first 60 lines for the driver, and every line in the totals', () => {
    const lines = Array.from({ length: 61 }, (_, index) =>
      line(index + 1, product(`Item ${index + 1}`, 'each', 0.5, 20, 10, 5)),
    );
    const load = summarizeLoad(lines);
    assert.equal(load.lines.length, 60);
    assert.deepEqual(load.lines[0], {
      name: 'Item 1',
      quantity: 1,
      unit: 'each',
      size: null,
      weightKg: 0.5,
      longestCm: 20,
    });
    assert.equal(load.lines[59]?.name, 'Item 60');
    assert.equal(load.pieces, 1891); // 1 + 2 + … + 61
    assert.equal(load.weightG, 945_500);
    assert.equal(load.volumeL, 2270); // 1 891 × 1 000 000 mm³ → 2 269.2 L
    assert.equal(load.summary, '1 × Item 1, 2 × Item 2 +59 more');
    assert.equal(summarizeLoad(lines.slice(0, 60)).lines.length, 60);
  });

  it('leaves out a line with nothing on it', () => {
    const load = summarizeLoad([
      line(0, P.drywall),
      line(2, P.deckScrews),
      line(0, P.pt2x6),
      line(3, P.valve),
    ]);
    assert.deepEqual(load, {
      pieces: 5,
      weightG: 5700,
      weightKg: 5.7,
      longestCm: 18,
      volumeL: 6, // 2 × 1 728 000 + 3 × 360 000 = 4 536 000 mm³ → 5.4 L
      hasSheets: false,
      handlingPieces: 0,
      heaviestUnitKg: 2.4,
      heavy: false,
      vehicleClass: 'car',
      summary: '2 × Deck screws #10 × 2-1/2 in, 5 lb, 3 × Brass ball valve 1/2 in, sweat',
      lines: [shown(2, P.deckScrews), shown(3, P.valve)],
    });
    assert.deepEqual(summarizeLoad([line(0, P.drywall)]), summarizeLoad([]));
  });

  it('copies the trade size and the sell unit of each line', () => {
    const [stud, osb] = summarizeLoad([line(20, P.stud), line(4, P.osb)]).lines;
    assert.equal(stud?.size, '2 in × 4 in × 8 ft');
    assert.equal(stud?.unit, 'each');
    assert.equal(osb?.size, null);
    assert.equal(osb?.unit, 'sheet');
  });

  it('does not change its input and returns fresh lines', () => {
    const lines = Object.freeze([
      Object.freeze({ ...P.stud, dimsCm: Object.freeze({ ...P.stud.dimsCm }), quantity: 20 }),
      Object.freeze({ ...P.osb, dimsCm: Object.freeze({ ...P.osb.dimsCm }), quantity: 4 }),
    ]);
    const load = summarizeLoad(lines);
    assert.equal(load.pieces, 24);
    assert.deepEqual(lines, [line(20, P.stud), line(4, P.osb)]);
    const [first] = load.lines;
    assert.ok(first);
    first.quantity = 99;
    assert.equal(lines[0]?.quantity, 20);
    assert.equal(summarizeLoad(lines).lines[0]?.quantity, 20);
  });

  it('never returns a negative zero', () => {
    const load = summarizeLoad([{ ...item({ weightKg: -0, l: -0, w: -0, h: -0 }), quantity: 2 }]);
    for (const value of [load.weightG, load.weightKg, load.longestCm, load.volumeL, load.heaviestUnitKg]) {
      assert.ok(Object.is(value, 0));
    }
    assert.ok(Object.is(load.lines[0]?.weightKg, 0));
    assert.ok(Object.is(load.lines[0]?.longestCm, 0));
    const none = summarizeLoad([{ ...item(), quantity: -0 }]);
    assert.ok(Object.is(none.pieces, 0));
    assert.deepEqual(none, summarizeLoad([]));
  });
});

describe('summarizeLoad: exactness and guards', () => {
  it('matches exact arithmetic on 400 seeded random carts', () => {
    const random = mulberry32(905);
    for (let round = 0; round < 400; round += 1) {
      const lines = Array.from({ length: 1 + below(random, 12) }, (_, index) =>
        line(
          1 + below(random, round % 4 === 0 ? 9999 : 40),
          product(
            `Item ${index}`,
            'each',
            below(random, 60_000) / 1000,
            (1 + below(random, 4000)) / 10,
            (1 + below(random, 1300)) / 10,
            (1 + below(random, 800)) / 10,
          ),
        ),
      );
      const exact = exactLoad(lines);
      const load = summarizeLoad(lines);
      assert.equal(BigInt(load.weightG), exact.weightG, `weight, round ${round}`);
      assert.equal(BigInt(load.volumeL), exact.volumeL, `volume, round ${round}`);
      assert.equal(load.vehicleClass, exact.vehicleClass, `class, round ${round}`);
    }
  });

  it('stays exact on the largest cart the rules allow: 100 lines of 9 999 units, 15 m and 3 t each', () => {
    const huge = product('Bridge girder', 'each', 3000, 1500, 1500, 1500);
    const lines = Array.from({ length: 100 }, () => line(9999, huge));
    const load = summarizeLoad(lines);
    assert.equal(load.pieces, 999_900);
    assert.equal(load.weightG, 2_999_700_000_000);
    assert.equal(load.weightKg, 2_999_700_000);
    // 999 900 × 15 000³ mm³ = 3.3746625 × 10¹⁸ mm³, far past 2^53; × 12 ÷ 10⁷ is still a whole number.
    assert.equal(load.volumeL, 4_049_595_000_000);
    assert.equal(BigInt(load.volumeL), exactLoad(lines).volumeL);
    assert.equal(load.vehicleClass, null);
    assert.equal(load.handlingPieces, 999_900);
    assert.equal(load.lines.length, 60);
  });

  it('rounds the volume up exactly on odd sizes', () => {
    // 3456 × 789 × 453 = 1 235 233 152 mm³ a unit; 19 998 units and 7 mm³ more are
    // 24 702 192 573 703 mm³ → × 12 ÷ 10⁷ = 29 642 631.09 L.
    const odd = product('Odd box', 'each', 1, 345.6, 78.9, 45.3);
    const lines = [line(9999, odd), line(9999, odd), line(7, item({ l: 0.1, w: 0.1, h: 0.1 }))];
    assert.equal(summarizeLoad(lines).volumeL, 29_642_632);
    assert.equal(BigInt(summarizeLoad(lines).volumeL), exactLoad(lines).volumeL);
  });

  it('rounds the volume up exactly where a single float sum loses the last litre', () => {
    // 14 999 × 14 997 × 14 993 = 3 372 525 464 979 mm³ a unit. 999 900 units and 1 mm³ more are
    // 3 372 188 212 432 502 101 mm³ → × 12 ÷ 10⁷ = 4 046 625 854 919.0025 L, so 4 046 625 854 920.
    // Added up as one float, the same sum comes to …919: the fraction is lost.
    const crate = product('Odd crate', 'each', 2999.999, 1499.9, 1499.7, 1499.3);
    const lines = [
      ...Array.from({ length: 100 }, () => line(9999, crate)),
      line(1, item({ weightKg: 0.001, l: 0.1, w: 0.1, h: 0.1 })),
    ];
    const load = summarizeLoad(lines);
    assert.equal(load.volumeL, 4_046_625_854_920);
    assert.equal(BigInt(load.volumeL), exactLoad(lines).volumeL);
    assert.equal(load.weightG, 2_999_699_000_101); // 999 900 × 2 999 999 g + 1 g
    assert.equal(load.weightKg, 2_999_699_000.1);
    assert.equal(load.vehicleClass, null);
  });

  it('throws instead of guessing when a number is beyond exact arithmetic', () => {
    const nothing = { weightKg: 0, l: 0, w: 0, h: 0 };
    // A size or a weight that is not a whole number of mm or g any more.
    assert.throws(() => summarizeLoad([line(1, item({ l: 1e300 }))]), RangeError);
    assert.throws(() => summarizeLoad([line(1, item({ weightKg: 1e300 }))]), RangeError);
    // One unit of 1 km × 1 km × 100 m: 10¹⁷ mm³ is past 2^53.
    assert.throws(() => summarizeLoad([line(1, item({ l: 100_000, w: 100_000, h: 10_000 }))]), RangeError);
    assert.throws(() => summarizeLoad([line(1, item({ l: 1e9, w: 1e9, h: 1e9 }))]), RangeError);
    // Totals past 2^53: the weight, the number of pieces, the volume.
    assert.throws(() => summarizeLoad([line(MAX, item({ ...nothing, weightKg: 3000 }))]), RangeError);
    assert.throws(() => summarizeLoad([line(MAX, item(nothing)), line(1, item(nothing))]), RangeError);
    assert.throws(
      () => summarizeLoad([line(MAX, item({ ...nothing, l: 1500, w: 1500, h: 1500 }))]),
      RangeError,
    );
    // Right at the edge it still answers: 2^53 − 1 weightless pieces.
    assert.equal(summarizeLoad([line(MAX, item(nothing))]).pieces, MAX);
    assert.equal(summarizeLoad([line(MAX, item({ ...nothing, weightKg: 0.001 }))]).weightG, MAX);
  });

  it('refuses a quantity that is not a non-negative whole number', () => {
    for (const quantity of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX + 1]) {
      assert.throws(() => summarizeLoad([line(quantity, item())]), RangeError, String(quantity));
    }
    assert.throws(() => summarizeLoad([line('2' as unknown as number, item())]), RangeError);
    assert.throws(() => summarizeLoad([line(1, item()), line(-3, item())]), /lines\[1\]\.quantity/);
  });

  it('refuses a weight or a size that is negative or not a number', () => {
    const bad = [-1, -0.001, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const value of bad) {
      assert.throws(() => summarizeLoad([line(1, item({ weightKg: value }))]), RangeError, `weight ${value}`);
      assert.throws(() => summarizeLoad([line(1, item({ l: value }))]), RangeError, `l ${value}`);
      assert.throws(() => summarizeLoad([line(1, item({ w: value }))]), RangeError, `w ${value}`);
      assert.throws(() => summarizeLoad([line(1, item({ h: value }))]), RangeError, `h ${value}`);
    }
    const noWeight = { ...item(), quantity: 1, weightKg: undefined as unknown as number };
    assert.throws(() => summarizeLoad([noWeight]), /lines\[0\]\.weightKg/);
    const textSize = { ...item(), quantity: 1, dimsCm: { l: '244' as unknown as number, w: 9, h: 4 } };
    assert.throws(() => summarizeLoad([textSize]), /lines\[0\]\.dimsCm\.l/);
    // Even a line with nothing on it must be well-formed.
    assert.throws(() => summarizeLoad([line(0, item({ weightKg: Number.NaN }))]), RangeError);
  });
});

describe('capacityClassFor and canCarry (§3.3)', () => {
  it('maps a declared vehicle to the class it is trusted with', () => {
    const expected: [VehicleType, VehicleClass][] = [
      ['car', 'car'],
      ['suv', 'suv'],
      ['cargo_van', 'cargo_van'],
      ['box_truck', 'box_truck'],
      ['flatbed', 'flatbed'],
      ['dump_truck', 'pickup'],
      ['other', 'car'],
    ];
    for (const [type, capacityClass] of expected) {
      assert.equal(capacityClassFor({ type, boxLengthFt: null }), capacityClass, type);
    }
  });

  it('rates a pickup by its box: 6.5 ft or more is a pickup, shorter is an SUV', () => {
    assert.equal(capacityClassFor({ type: 'pickup', boxLengthFt: 5.5 }), 'suv');
    assert.equal(capacityClassFor({ type: 'pickup', boxLengthFt: 6.5 }), 'pickup');
    assert.equal(capacityClassFor({ type: 'pickup', boxLengthFt: 8 }), 'pickup');
    assert.equal(capacityClassFor({ type: 'pickup', boxLengthFt: null }), 'suv');
  });

  it('ignores a box length on anything that is not a pickup', () => {
    assert.equal(capacityClassFor({ type: 'car', boxLengthFt: 8 }), 'car');
    assert.equal(capacityClassFor({ type: 'dump_truck', boxLengthFt: 5.5 }), 'pickup');
    assert.equal(capacityClassFor({ type: 'flatbed', boxLengthFt: 5.5 }), 'flatbed');
  });

  it('gives the seed drivers the classes of §11.1', () => {
    assert.equal(capacityClassFor({ type: 'pickup', boxLengthFt: 6.5 }), 'pickup'); // Marco, F-150
    assert.equal(capacityClassFor({ type: 'cargo_van', boxLengthFt: null }), 'cargo_van'); // Aisha, Transit
    assert.equal(capacityClassFor({ type: 'car', boxLengthFt: null }), 'car'); // Tom, Corolla
    assert.equal(capacityClassFor({ type: 'flatbed', boxLengthFt: null }), 'flatbed'); // Gurpreet, NPR
    assert.equal(capacityClassFor({ type: 'box_truck', boxLengthFt: null }), 'box_truck'); // Devon, Hino 195
    assert.equal(capacityClassFor({ type: 'suv', boxLengthFt: null }), 'suv'); // Lena, CR-V
  });

  it('refuses a vehicle type it does not know', () => {
    assert.throws(() => capacityClassFor({ type: 'scooter' as VehicleType, boxLengthFt: null }), RangeError);
  });

  it('lets a vehicle carry a job of its own class or a smaller one', () => {
    for (const [capacityRank, capacity] of CLASSES.entries()) {
      for (const [jobRank, job] of CLASSES.entries()) {
        assert.equal(canCarry(capacity, job), capacityRank >= jobRank, `${capacity} for a ${job} job`);
      }
    }
    assert.equal(canCarry('pickup', 'pickup'), true);
    assert.equal(canCarry('cargo_van', 'pickup'), true);
    assert.equal(canCarry('suv', 'pickup'), false);
    assert.equal(canCarry('car', 'flatbed'), false);
    assert.equal(canCarry('flatbed', 'car'), true);
  });

  it('refuses a class it does not know', () => {
    assert.throws(() => canCarry('van' as VehicleClass, 'car'), RangeError);
    assert.throws(() => canCarry('car', null as unknown as VehicleClass), RangeError);
    assert.throws(() => canCarry('toString' as VehicleClass, 'car'), RangeError);
  });
});

describe('deliveryFeeListCents (§3.3)', () => {
  it('prices the §3.11 trips', () => {
    assert.equal(deliveryFeeListCents('pickup', 229), 4921); // V1 Bluestone: 2 999 + 1 922
    assert.equal(deliveryFeeListCents('pickup', 260), 5383); // V1 Kestrel: 2 999 + 2 384
    assert.equal(deliveryFeeListCents('car', 389), 4160); // V3 Boltbin: 1 299 + 2 861
    assert.equal(deliveryFeeListCents('car', 304), 3319); // V3 Voltway: 1 299 + 2 020
    assert.equal(deliveryFeeListCents('car', 72), 1299); // scenario K: inside the included 10 km
    assert.equal(deliveryFeeListCents('cargo_van', 164), 5645); // scenario D: 4 499 + 1 146 (1 145.6)
    assert.equal(deliveryFeeListCents('pickup', 333), 6471); // scenario E: 2 999 + 3 472 (3 471.7)
    assert.equal(deliveryFeeListCents('box_truck', 149), 9219); // quote G: 7 999 + 1 220 (1 220.1)
  });

  it('charges the base fee alone up to 10.0 km', () => {
    for (const { id, feeBaseCents } of SPEC_TABLE) {
      for (const tenths of [0, 1, 50, 99, 100]) {
        assert.equal(deliveryFeeListCents(id, tenths), feeBaseCents, `${id} at ${tenths / 10} km`);
      }
    }
  });

  it('adds the per-km rate for each tenth of a km beyond 10.0, half-up', () => {
    // [class, 10.1 km, 10.5 km, 10.6 km, 60.0 km]. Every rate is odd, so half a km always ends in .5.
    const expected: [VehicleClass, number, number, number, number][] = [
      ['car', 1309, 1349, 1358, 6249], // 9.9 → 10, 49.5 → 50, 59.4 → 59, 50 km → 4 950
      ['suv', 2011, 2059, 2070, 7949], // 11.9 → 12, 59.5 → 60, 71.4 → 71, 5 950
      ['pickup', 3014, 3074, 3088, 10_449], // 14.9 → 15, 74.5 → 75, 89.4 → 89, 7 450
      ['cargo_van', 4517, 4589, 4606, 13_449], // 17.9 → 18, 89.5 → 90, 107.4 → 107, 8 950
      ['box_truck', 8024, 8124, 8148, 20_449], // 24.9 → 25, 124.5 → 125, 149.4 → 149, 12 450
      ['flatbed', 10_029, 10_149, 10_178, 24_949], // 29.9 → 30, 149.5 → 150, 179.4 → 179, 14 950
    ];
    for (const [id, at101, at105, at106, at600] of expected) {
      assert.equal(deliveryFeeListCents(id, 101), at101, `${id} at 10.1 km`);
      assert.equal(deliveryFeeListCents(id, 105), at105, `${id} at 10.5 km`);
      assert.equal(deliveryFeeListCents(id, 106), at106, `${id} at 10.6 km`);
      assert.equal(deliveryFeeListCents(id, 600), at600, `${id} at 60.0 km`);
    }
  });

  it('never drops when the trip gets longer or the vehicle larger', () => {
    for (const [index, id] of CLASSES.entries()) {
      for (let tenths = 0; tenths < 700; tenths += 1) {
        const fee = deliveryFeeListCents(id, tenths);
        assert.ok(fee <= deliveryFeeListCents(id, tenths + 1));
        const larger = CLASSES[index + 1];
        if (larger) assert.ok(fee < deliveryFeeListCents(larger, tenths));
      }
    }
  });

  it('refuses a distance that is not whole tenths, and a class it does not know', () => {
    for (const tenths of [-1, 22.9, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => deliveryFeeListCents('pickup', tenths), RangeError, String(tenths));
    }
    assert.throws(() => deliveryFeeListCents('pickup', MAX), RangeError);
    assert.throws(() => deliveryFeeListCents('van' as VehicleClass, 100), RangeError);
    assert.throws(() => deliveryFeeListCents(null as unknown as VehicleClass, 100), RangeError);
  });
});

describe('driveMinutes (§3.3)', () => {
  it('gives the drive times of §4.8', () => {
    assert.equal(driveMinutes('pickup', 229), 37); // 22.9 km at 38 km/h: 36.2 min
    assert.equal(driveMinutes('pickup', 260), 42); // 26.0 km: 41.05 min
  });

  it('uses the speed of the class and rounds up to a whole minute', () => {
    // 10.0 km: 600 ÷ speed.
    const at10km: [VehicleClass, number][] = [
      ['car', 15], // 40 km/h: exactly 15
      ['suv', 15],
      ['pickup', 16], // 38 km/h: 15.8
      ['cargo_van', 17], // 36 km/h: 16.7
      ['box_truck', 19], // 32 km/h: 18.75
      ['flatbed', 20], // 30 km/h: exactly 20
    ];
    for (const [id, minutes] of at10km) assert.equal(driveMinutes(id, 100), minutes, id);
    assert.equal(driveMinutes('car', 0), 0);
    assert.equal(driveMinutes('car', 1), 1); // 100 m still takes a minute
    assert.equal(driveMinutes('car', 101), 16); // 15.15
    assert.equal(driveMinutes('car', 20), 3); // exactly 3
    assert.equal(driveMinutes('car', 21), 4);
    assert.equal(driveMinutes('flatbed', 5), 1); // exactly 1
    assert.equal(driveMinutes('flatbed', 6), 2);
    assert.equal(driveMinutes('cargo_van', 164), 28); // scenario D: 27.3
    assert.equal(driveMinutes('pickup', 333), 53); // scenario E: 52.6
    assert.equal(driveMinutes('box_truck', 149), 28); // quote G: 27.9
  });

  it('is ceil(6 × tenths ÷ speed) for every class and distance up to 100 km', () => {
    for (const { id, speedKmh } of SPEC_TABLE) {
      for (let tenths = 0; tenths <= 1000; tenths += 1) {
        const expected = Number((6n * BigInt(tenths) + BigInt(speedKmh) - 1n) / BigInt(speedKmh));
        assert.equal(driveMinutes(id, tenths), expected, `${id} at ${tenths / 10} km`);
      }
    }
  });

  it('stays exact up to the last safe integer and throws past it', () => {
    const top = Math.floor(MAX / 6); // 1 501 199 875 790 165
    for (const { id, speedKmh } of SPEC_TABLE) {
      const expected = Number((6n * BigInt(top) + BigInt(speedKmh) - 1n) / BigInt(speedKmh));
      assert.equal(driveMinutes(id, top), expected, id);
      assert.throws(() => driveMinutes(id, top + 1), RangeError, id);
    }
  });

  it('refuses a distance that is not whole tenths, and a class it does not know', () => {
    for (const tenths of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => driveMinutes('car', tenths), RangeError, String(tenths));
    }
    assert.throws(() => driveMinutes('bike' as VehicleClass, 100), RangeError);
  });
});

describe('audienceFor (§2.4)', () => {
  const sorted = (audience: readonly string[]) => [...audience].sort();

  it('without a site limit: every class from the job up to the flatbed, in each city', () => {
    assert.deepEqual(sorted(audienceFor(['toronto'], 'pickup', null)), [
      'toronto:box_truck',
      'toronto:cargo_van',
      'toronto:flatbed',
      'toronto:pickup',
    ]);
    assert.deepEqual(sorted(audienceFor(['toronto'], 'car', null)), [
      'toronto:box_truck',
      'toronto:car',
      'toronto:cargo_van',
      'toronto:flatbed',
      'toronto:pickup',
      'toronto:suv',
    ]);
    assert.deepEqual(audienceFor(['brampton'], 'flatbed', null), ['brampton:flatbed']);
  });

  it('with a site limit: nothing larger than the jobsite allows', () => {
    // The Junction basement site takes a cargo van at most (§11.2).
    assert.deepEqual(sorted(audienceFor(['toronto'], 'pickup', 'cargo_van')), [
      'toronto:cargo_van',
      'toronto:pickup',
    ]);
    assert.deepEqual(audienceFor(['toronto'], 'pickup', 'pickup'), ['toronto:pickup']);
    assert.deepEqual(sorted(audienceFor(['toronto'], 'car', 'suv')), ['toronto:car', 'toronto:suv']);
    assert.deepEqual(
      sorted(audienceFor(['toronto'], 'pickup', 'flatbed')),
      sorted(audienceFor(['toronto'], 'pickup', null)),
    );
  });

  it('covers the store city and the jobsite city, each once', () => {
    // Scenario E: Slatebridge (Oakville) → Mimico (Toronto), pickup class.
    const audience = audienceFor(['oakville', 'toronto'], 'pickup', null);
    assert.deepEqual(sorted(audience), [
      'oakville:box_truck',
      'oakville:cargo_van',
      'oakville:flatbed',
      'oakville:pickup',
      'toronto:box_truck',
      'toronto:cargo_van',
      'toronto:flatbed',
      'toronto:pickup',
    ]);
    // §11.5 E: Marco (pickup), Aisha (cargo van) and Devon (box truck) see it; Tom and Gurpreet do not.
    for (const key of ['toronto:pickup', 'toronto:cargo_van', 'toronto:box_truck']) {
      assert.ok(audience.includes(key), key);
    }
    assert.ok(!audience.includes('toronto:car'));
    assert.ok(!audience.includes('brampton:flatbed'));

    const sameCity = audienceFor(['toronto', 'toronto'], 'cargo_van', null);
    assert.deepEqual(sorted(sameCity), ['toronto:box_truck', 'toronto:cargo_van', 'toronto:flatbed']);
  });

  it('only names vehicles that can carry the job', () => {
    for (const [jobRank, job] of CLASSES.entries()) {
      // A site limit below the job's own class is refused at checkout (`jobsite_vehicle_limit`).
      for (const siteMax of [null, ...CLASSES.slice(jobRank)]) {
        const audience = audienceFor(['toronto', 'vaughan'], job, siteMax);
        const top = siteMax ? CLASSES.indexOf(siteMax) : CLASSES.length - 1;
        assert.equal(audience.length, 2 * (top - jobRank + 1), `${job} job, site max ${siteMax}`);
        assert.equal(new Set(audience).size, audience.length);
        for (const key of audience) {
          const [city, capacity] = key.split(':') as [string, VehicleClass];
          assert.ok(city === 'toronto' || city === 'vaughan', key);
          assert.ok(canCarry(capacity, job), `${key} for a ${job} job`);
          if (siteMax) assert.ok(canCarry(siteMax, capacity), `${key} at a ${siteMax} site`);
        }
      }
    }
  });
});
