/**
 * Vehicles, loads, delivery fees and driver pay (§1.3, §3.3, §3.10).
 *
 * A delivery fee is "based on distance and order size" (D5): the order's load decides the smallest
 * vehicle class that can carry it, and the class sets the customer fee, the driver's pay, the driving
 * speed used for promises and the loading time at the store.
 *
 * Weights are added in whole grams and sizes in whole millimetres (§3.1 rule 7), so the app, the
 * server and the seed pick the same vehicle and quote the same fee. Like `money.ts`, every function
 * throws a `RangeError` for a number that cannot be right (a negative quantity, a weight that is not a
 * number, a distance that is not whole tenths of a km) and when a total would leave the range where
 * JavaScript integers are exact: a wrong vehicle is a wrong charge, so it must fail loudly.
 */
import type { DimsCm, SellUnit } from './catalog';
import { isSiteCausedFailure } from './constants';
import { ceilTo25, mulDivHalfUp } from './money';
import type { FailureReasonId } from './types';

/** The class a job needs and a driver is approved for. Ordered by `VEHICLE_CLASSES[class].rank`. */
export type VehicleClass = 'car' | 'suv' | 'pickup' | 'cargo_van' | 'box_truck' | 'flatbed';

/** What a driver says they drive. `capacityClassFor` turns it into a `VehicleClass`. */
export type VehicleType =
  'car' | 'suv' | 'pickup' | 'cargo_van' | 'box_truck' | 'flatbed' | 'dump_truck' | 'other';

export type VehicleExtra = 'trailer' | 'roof_rack' | 'liftgate' | 'ramps_dolly';

/** Every declared type, in the order the onboarding chips show them (§10). */
export const VEHICLE_TYPES: readonly VehicleType[] = [
  'car',
  'suv',
  'pickup',
  'cargo_van',
  'box_truck',
  'flatbed',
  'dump_truck',
  'other',
];

/** Chip wording for what a driver declares. A class has its own label in `VEHICLE_CLASSES`. */
export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  car: 'Car/sedan',
  suv: 'SUV',
  pickup: 'Pickup',
  cargo_van: 'Cargo van',
  box_truck: 'Box truck',
  flatbed: 'Flatbed',
  dump_truck: 'Dump truck',
  other: 'Other',
};

export const VEHICLE_EXTRAS: readonly VehicleExtra[] = ['trailer', 'roof_rack', 'liftgate', 'ramps_dolly'];

export const VEHICLE_EXTRA_LABELS: Record<VehicleExtra, string> = {
  trailer: 'Trailer',
  roof_rack: 'Roof rack',
  liftgate: 'Liftgate',
  ramps_dolly: 'Ramps/dolly',
};

/** The box lengths a pickup can declare, in feet. Required for pickups: it decides their class (§3.3). */
export const PICKUP_BOX_LENGTHS_FT = [5.5, 6.5, 8] as const;

export interface DriverVehicle {
  type: VehicleType;
  make: string;
  model: string;
  year: number;
  plate: string;
  colour: string | null;
  /** Pickups only. A box shorter than 6.5 ft counts as an SUV (§3.3). */
  boxLengthFt: 5.5 | 6.5 | 8 | null;
  payloadKg: number | null;
  extras: VehicleExtra[];
  /** Set by the server or by staff, never by the driver: job offers are matched on it (D9). */
  capacityClass: VehicleClass;
}

export interface VehicleClassSpec {
  /** 0 (car) to 5 (flatbed). A vehicle can carry a job when its rank is at least the job's. */
  rank: number;
  maxKg: number;
  maxLengthCm: number;
  /** Can carry 4×8 sheets. */
  sheets: boolean;
  maxVolumeL: number;
  /** Customer delivery fee, including the first 10 km. */
  feeBaseCents: number;
  /** Customer fee per road km beyond 10 km. */
  feePerKmCents: number;
  /** "Need help unloading? Add a labourer"; null where it is not offered. */
  labourerFeeCents: number | null;
  driverBaseCents: number;
  driverPerKmCents: number;
  /** Average speed for delivery promises, route plans and tracking. */
  speedKmh: number;
  /** Minutes to load at the store. */
  loadMinutes: number;
  label: string;
}

/** The class table of §3.3. Money is in cents. */
export const VEHICLE_CLASSES: Record<VehicleClass, VehicleClassSpec> = {
  car: {
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
  suv: {
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
  pickup: {
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
  cargo_van: {
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
  box_truck: {
    rank: 4,
    maxKg: 3500,
    maxLengthCm: 490,
    sheets: true,
    maxVolumeL: 22000,
    feeBaseCents: 7999,
    feePerKmCents: 249,
    labourerFeeCents: 6000,
    driverBaseCents: 4000,
    driverPerKmCents: 150,
    speedKmh: 32,
    loadMinutes: 20,
    label: 'Box truck',
  },
  flatbed: {
    rank: 5,
    maxKg: 6000,
    maxLengthCm: 740,
    sheets: true,
    maxVolumeL: 30000,
    feeBaseCents: 9999,
    feePerKmCents: 299,
    labourerFeeCents: 7500,
    driverBaseCents: 5000,
    driverPerKmCents: 175,
    speedKmh: 30,
    loadMinutes: 20,
    label: 'Flatbed',
  },
};

/** The six classes from the smallest (car) to the largest (flatbed), by `rank`. */
export const VEHICLE_CLASS_IDS: readonly VehicleClass[] = (
  Object.keys(VEHICLE_CLASSES) as VehicleClass[]
).sort((a, b) => VEHICLE_CLASSES[a].rank - VEHICLE_CLASSES[b].rank);

/**
 * The first 10.0 km are included in every class's base fee (§3.2); the customer pays `feePerKmCents`
 * only for the road distance beyond it. In tenths of a km, like `roadTenths`.
 */
export const INCLUDED_ROAD_TENTHS = 100;

/** What `summarizeLoad` reads from an order line. Pricing, store-order and quote lines all fit. */
export interface LoadInputLine {
  name: string;
  quantity: number;
  unit: SellUnit;
  size: string | null;
  /** Per sell unit. */
  weightKg: number;
  /** Per sell unit. */
  dimsCm: DimsCm;
}

/** One row of the load list a driver sees before accepting a job. */
export interface LoadLine {
  name: string;
  quantity: number;
  unit: SellUnit;
  size: string | null;
  /** Per sell unit, like the product's `weightKg`. */
  weightKg: number;
  /** The unit's longest side: the `l` of its `dimsCm`. */
  longestCm: number;
}

export interface LoadSummary {
  pieces: number;
  /** Exact weight in whole grams: weights are never summed as floats (§3.1 rule 7). */
  weightG: number;
  /** `weightG` in kg, 1 decimal, for display. */
  weightKg: number;
  longestCm: number;
  /** Litres, with a 1.2 packing factor. */
  volumeL: number;
  /** Any 4×8 sheet: at least 240 cm by 120 cm. */
  hasSheets: boolean;
  /** Pieces that are heavy (23 kg or more), long (240 cm or more) or sheets; they earn handling pay. */
  handlingPieces: number;
  heaviestUnitKg: number;
  /**
   * 250 kg or more in total, or one unit of 40 kg or more. A heavy load at an unattended site makes
   * the labourer mandatory (D5).
   */
  heavy: boolean;
  /** Smallest class that fits. Null: too large for one delivery ("Send us your list for a quote"). */
  vehicleClass: VehicleClass | null;
  /** "20 × 2x4x8 SPF stud, 4 × OSB 7/16 in +2 more". */
  summary: string;
  /** At most 60. */
  lines: LoadLine[];
}

/** What a driver earns for one delivery. The offer is fixed at checkout and never drifts (§3.10). */
export interface DriverPayout {
  /** `baseCents + distanceCents + loadCents + handlingCents`, at least $10, rounded up to $0.25. */
  offerCents: number;
  baseCents: number;
  distanceCents: number;
  loadCents: number;
  handlingCents: number;
  /** Added by staff before a claim. */
  boostCents: number;
  /** Paid for waiting at the store beyond the 15-minute grace. */
  waitCents: number;
  /** `offerCents + boostCents + waitCents`. */
  totalCents: number;
}

// ---------- guards ----------

/** Returns the checked value, with -0 as 0: Firestore would store a -0 as a double, not an integer. */
function requireWhole(label: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative whole number, got ${String(value)}`);
  }
  return value === 0 ? 0 : value;
}

/** Instants are epoch milliseconds. A missing or broken one must not turn into pay of `NaN`. */
function requireInstant(label: string, value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`${label} must be a time in epoch milliseconds, got ${String(value)}`);
  }
}

/** Above 2^53 − 1 a sum or product of whole numbers may no longer be exact. */
function requireExact(label: string, value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} is too large to stay exact`);
  return value;
}

/**
 * The row of the class table. Classes also arrive from stored documents and claims, where the type
 * checker cannot help: an unknown one must not quietly price or pay as `NaN`.
 */
function specOf(label: string, vehicleClass: VehicleClass): VehicleClassSpec {
  if (!Object.prototype.hasOwnProperty.call(VEHICLE_CLASSES, vehicleClass)) {
    throw new RangeError(`${label}: unknown vehicle class ${String(vehicleClass)}`);
  }
  return VEHICLE_CLASSES[vehicleClass];
}

/** `n ÷ d` rounded up, for whole numbers. It stays in integer arithmetic: `%` is always exact. */
function ceilDiv(n: number, d: number): number {
  const rest = n % d;
  return (n - rest) / d + (rest === 0 ? 0 : 1);
}

// ---------- the load (§3.3) ----------

/** A 4×8 sheet measures 244 × 122 cm; anything at least 240 cm by 120 cm counts as one. In mm. */
const SHEET_MIN_LENGTH_MM = 2_400;
const SHEET_MIN_WIDTH_MM = 1_200;
/** A piece of 240 cm or more, or of 23 kg or more, takes care to load: it earns handling pay. */
const LONG_PIECE_MM = 2_400;
const HEAVY_PIECE_G = 23_000;
/** A load is heavy from 250 kg in total, or when a single unit weighs 40 kg or more. */
const HEAVY_LOAD_G = 250_000;
const HEAVY_UNIT_G = 40_000;
/** `LoadSummary.lines` keeps the first 60 lines (§1.3); the totals always cover every line. */
const MAX_LOAD_LINES = 60;
/**
 * `volumeL = ceil(Σ mm³ × 12 ÷ 10⁷)`: a litre is 10⁶ mm³, and the packing factor of 1.2 (goods never
 * stack without gaps) is × 12 ÷ 10.
 */
const PACKING_FACTOR_TIMES_10 = 12;
const VOLUME_LOT_MM3 = 10_000_000;

/**
 * Kilograms as whole grams, or centimetres as whole millimetres (§3.1 rule 7): weights have at most 3
 * decimals and sizes at most 1 (§1.1), so nothing is lost, and every sum and comparison that follows
 * runs on integers.
 */
function toWholeUnits(label: string, value: number, perUnit: number): number {
  if (typeof value !== 'number' || !(value >= 0)) {
    throw new RangeError(`${label} must be a number of 0 or more, got ${String(value)}`);
  }
  // A -0 passes the check above; `Math.max(0, -0)` is 0, so no -0 ends up in a total or a stored field.
  return Math.max(0, requireExact(label, Math.round(value * perUnit)));
}

/** The lowest-ranked class that meets all four limits: weight, length, sheets and volume (§3.3). */
function smallestClassFor(load: {
  weightG: number;
  longestMm: number;
  hasSheets: boolean;
  volumeL: number;
}): VehicleClass | null {
  for (const id of VEHICLE_CLASS_IDS) {
    const spec = VEHICLE_CLASSES[id];
    if (
      load.weightG <= spec.maxKg * 1000 &&
      load.longestMm <= spec.maxLengthCm * 10 &&
      load.volumeL <= spec.maxVolumeL &&
      (spec.sheets || !load.hasSheets)
    ) {
      return id;
    }
  }
  return null;
}

/**
 * Totals of a store order's goods and the smallest vehicle class that can carry them (§3.3). Weight
 * is added in grams and volume in mm³, so the result is the same on every device.
 *
 * `dimsCm.l` is the longest side of a unit (§1.1); the length and sheet rules read it as such. In
 * `lines`, `weightKg` and `longestCm` are per sell unit, like the fields they come from.
 */
export function summarizeLoad(lines: readonly LoadInputLine[]): LoadSummary {
  const tooLarge = 'summarizeLoad: the load';
  let pieces = 0;
  let weightG = 0;
  let heaviestUnitG = 0;
  let longestMm = 0;
  let hasSheets = false;
  let handlingPieces = 0;
  // Σ quantity × unit volume, kept in two exact parts: whole lots of 10⁷ mm³ and the mm³ left over.
  // One number would stop being exact near 9 × 10¹⁵ mm³, which a cart of valid lines can reach
  // (9 999 units of a 15 m item); such a cart must come back as "too large", not as an error.
  let volumeLots = 0;
  let volumeRestMm3 = 0;
  let lineCount = 0;
  const kept: LoadLine[] = [];

  for (const [index, line] of lines.entries()) {
    const at = `summarizeLoad: lines[${index}]`;
    const quantity = requireWhole(`${at}.quantity`, line.quantity);
    const unitG = toWholeUnits(`${at}.weightKg`, line.weightKg, 1000);
    // `l` is the longest side (§1.1), but a document saved before that was checked, or a category
    // default such as paint's 20 × 20 × 25 (§1.5), may not say so: the sides are read longest first,
    // so length and the sheet test never depend on the order they were typed in.
    const [lengthMm = 0, widthMm = 0, heightMm = 0] = [
      toWholeUnits(`${at}.dimsCm.l`, line.dimsCm.l, 10),
      toWholeUnits(`${at}.dimsCm.w`, line.dimsCm.w, 10),
      toWholeUnits(`${at}.dimsCm.h`, line.dimsCm.h, 10),
    ].sort((a, b) => b - a);
    // A line with nothing on it puts no weight, no length and no sheet on the truck. Checkout drops
    // such lines before it gets here (§3.4 step 1); the spec does not say what the load does with one.
    if (quantity === 0) continue;

    const isSheet = lengthMm >= SHEET_MIN_LENGTH_MM && widthMm >= SHEET_MIN_WIDTH_MM;
    pieces = requireExact(tooLarge, pieces + quantity);
    weightG = requireExact(tooLarge, weightG + quantity * unitG);
    heaviestUnitG = Math.max(heaviestUnitG, unitG);
    longestMm = Math.max(longestMm, lengthMm);
    hasSheets = hasSheets || isSheet;
    if (unitG >= HEAVY_PIECE_G || lengthMm >= LONG_PIECE_MM || isSheet) handlingPieces += quantity;

    const unitMm3 = requireExact(tooLarge, lengthMm * widthMm * heightMm);
    const unitRestMm3 = unitMm3 % VOLUME_LOT_MM3;
    const restMm3 = requireExact(tooLarge, volumeRestMm3 + quantity * unitRestMm3);
    volumeRestMm3 = restMm3 % VOLUME_LOT_MM3;
    volumeLots = requireExact(
      tooLarge,
      volumeLots +
        quantity * ((unitMm3 - unitRestMm3) / VOLUME_LOT_MM3) +
        (restMm3 - volumeRestMm3) / VOLUME_LOT_MM3,
    );

    lineCount += 1;
    if (kept.length < MAX_LOAD_LINES) {
      kept.push({
        name: line.name,
        quantity,
        unit: line.unit,
        size: line.size,
        weightKg: unitG / 1000,
        longestCm: lengthMm / 10,
      });
    }
  }

  // `volumeRestMm3` is below one lot, so the division is far from the limits of a float.
  const volumeL = requireExact(
    tooLarge,
    PACKING_FACTOR_TIMES_10 * volumeLots +
      Math.ceil((PACKING_FACTOR_TIMES_10 * volumeRestMm3) / VOLUME_LOT_MM3),
  );
  // One decimal, half-up, worked out in whole grams: 12 350 g → 12.4 kg.
  const restG = weightG % 100;
  const weightKg = ((weightG - restG) / 100 + (restG >= 50 ? 1 : 0)) / 10;

  const firstTwo = kept
    .slice(0, 2)
    .map((line) => `${line.quantity} × ${line.name}`)
    .join(', ');

  return {
    pieces,
    weightG,
    weightKg,
    longestCm: longestMm / 10,
    volumeL,
    hasSheets,
    handlingPieces,
    heaviestUnitKg: heaviestUnitG / 1000,
    heavy: weightG >= HEAVY_LOAD_G || heaviestUnitG >= HEAVY_UNIT_G,
    vehicleClass: smallestClassFor({ weightG, longestMm, hasSheets, volumeL }),
    summary: lineCount > 2 ? `${firstTwo} +${lineCount - 2} more` : firstTwo,
    lines: kept,
  };
}

/**
 * The class a declared vehicle is trusted with (§3.3): a pickup whose box is shorter than 6.5 ft counts
 * as an SUV, a dump truck as a pickup, `other` as a car. Staff may override it at approval.
 */
export function capacityClassFor(vehicle: Pick<DriverVehicle, 'type' | 'boxLengthFt'>): VehicleClass {
  const { type } = vehicle;
  switch (type) {
    case 'car':
    case 'suv':
    case 'cargo_van':
    case 'box_truck':
    case 'flatbed':
      return type;
    case 'pickup':
      // The pickup class promises 4×8 sheets and 2.5 m lengths; a box under 6.5 ft is rated as an SUV
      // instead, and so is a pickup with no box length on file.
      return (vehicle.boxLengthFt ?? 0) >= 6.5 ? 'pickup' : 'suv';
    case 'dump_truck':
      return 'pickup';
    case 'other':
      return 'car';
    default: {
      const unknown: never = type;
      throw new RangeError(`capacityClassFor: unknown vehicle type ${String(unknown)}`);
    }
  }
}

/** A bigger vehicle may take a smaller job, never the other way round (§3.3). */
export function canCarry(capacity: VehicleClass, job: VehicleClass): boolean {
  return specOf('canCarry', capacity).rank >= specOf('canCarry', job).rank;
}

// ---------- customer fee and drive time (§3.3 formulas) ----------

/**
 * The delivery fee before any waiver: the class's base fee plus its per-km rate for the road distance
 * beyond the included 10 km, `feeBaseCents + mulDivHalfUp(feePerKmCents, max(0, roadTenths − 100), 10)`.
 * V1: pickup, 22.9 km → 2 999 + 1 922 = 4 921.
 */
export function deliveryFeeListCents(vehicleClass: VehicleClass, roadTenths: number): number {
  const spec = specOf('deliveryFeeListCents', vehicleClass);
  const tenths = requireWhole('deliveryFeeListCents: roadTenths', roadTenths);
  const extraTenths = Math.max(0, tenths - INCLUDED_ROAD_TENTHS);
  return spec.feeBaseCents + mulDivHalfUp(spec.feePerKmCents, extraTenths, 10);
}

/**
 * Minutes to drive a road distance at the class's speed, rounded up: `ceil(6 × roadTenths / speedKmh)`.
 * Delivery promises and windows are built from it (§4.3, §4.4). Pickup class, 26.0 km → 42.
 */
export function driveMinutes(vehicleClass: VehicleClass, roadTenths: number): number {
  const spec = specOf('driveMinutes', vehicleClass);
  const tenths = requireWhole('driveMinutes: roadTenths', roadTenths);
  // Tenths of a km ÷ km/h × 60 min = 6 × tenths ÷ speed.
  return ceilDiv(requireExact('driveMinutes: roadTenths', 6 * tenths), spec.speedKmh);
}

// ---------- driver pay (§3.3, §3.10) ----------

/** No offer is below $10, however short and light the job. */
const MIN_OFFER_CENTS = 1_000;
/** The first 100 kg are part of the base pay; every started 50 kg above that adds $1. */
const LOAD_PAY_FREE_G = 100_000;
const LOAD_PAY_STEP_G = 50_000;
const LOAD_PAY_STEP_CENTS = 100;
/** 15¢ for each handling piece (heavy, long or a sheet), up to $30 per job. */
const HANDLING_PIECE_CENTS = 15;
const MAX_HANDLING_CENTS = 3_000;
/** Waiting at the store pays 25¢ a minute after the first 15 minutes, up to $15. */
const WAIT_GRACE_MIN = 15;
const WAIT_MINUTE_CENTS = 25;
const MAX_WAIT_CENTS = 1_500;
/**
 * A cancelled job pays a quarter of the offer, at least $5, once the driver has checked in at the
 * store or has held the job for 15 minutes (§3.9).
 */
const CANCELLATION_MIN_CENTS = 500;
const CANCELLATION_HELD_MS = 15 * 60_000;

/**
 * A copy of a payout with new extras. The offer and its four parts are frozen at checkout (§3.10);
 * `totalCents` is worked out again here, so it can never drift from `offerCents + boostCents + waitCents`.
 */
function payoutWith(
  label: string,
  payout: DriverPayout,
  boostCents: number,
  waitCents: number,
): DriverPayout {
  const offerCents = requireWhole(`${label}: offerCents`, payout.offerCents);
  const boost = requireWhole(`${label}: boostCents`, boostCents);
  const wait = requireWhole(`${label}: waitCents`, waitCents);
  return {
    offerCents,
    baseCents: payout.baseCents,
    distanceCents: payout.distanceCents,
    loadCents: payout.loadCents,
    handlingCents: payout.handlingCents,
    boostCents: boost,
    waitCents: wait,
    totalCents: requireExact(`${label}: totalCents`, offerCents + boost + wait),
  };
}

/**
 * What a job pays, fixed at checkout and shown to drivers before they accept (§3.3, §3.10): base and
 * distance from the class, $1 per started 50 kg above 100 kg, 15¢ per handling piece up to $30, then
 * at least $10 and rounded up to the next $0.25. `boostCents` and `waitCents` start at 0, so
 * `totalCents` equals `offerCents`. V1 Kestrel: 1 600 + 2 600 + 200 + 360 = 4 760 → 4 775.
 *
 * The four parts explain the offer; because of the minimum and the rounding they can add up to less.
 */
export function driverOffer(
  vehicleClass: VehicleClass,
  roadTenths: number,
  load: Pick<LoadSummary, 'weightG' | 'handlingPieces'>,
): DriverPayout {
  const spec = specOf('driverOffer', vehicleClass);
  const tenths = requireWhole('driverOffer: roadTenths', roadTenths);
  const weightG = requireWhole('driverOffer: load.weightG', load.weightG);
  const handlingPieces = requireWhole('driverOffer: load.handlingPieces', load.handlingPieces);

  const baseCents = spec.driverBaseCents;
  const distanceCents = mulDivHalfUp(spec.driverPerKmCents, tenths, 10);
  const loadCents = LOAD_PAY_STEP_CENTS * ceilDiv(Math.max(0, weightG - LOAD_PAY_FREE_G), LOAD_PAY_STEP_G);
  const handlingCents = Math.min(MAX_HANDLING_CENTS, HANDLING_PIECE_CENTS * handlingPieces);
  const offerCents = ceilTo25(
    Math.max(MIN_OFFER_CENTS, baseCents + distanceCents + loadCents + handlingCents),
  );
  return {
    offerCents,
    baseCents,
    distanceCents,
    loadCents,
    handlingCents,
    boostCents: 0,
    waitCents: 0,
    totalCents: offerCents,
  };
}

/**
 * The payout after staff add a boost to a job nobody has claimed (P1, §3.10). Returns a new object;
 * boosts add up and `totalCents` stays `offerCents + boostCents + waitCents`.
 */
export function withBoost(payout: DriverPayout, addCents: number): DriverPayout {
  const add = requireWhole('withBoost: addCents', addCents);
  const boosted = requireWhole('withBoost: boostCents', payout.boostCents);
  return payoutWith('withBoost', payout, boosted + add, payout.waitCents);
}

/**
 * Pay for waiting at the store (§3.10): 25¢ per whole minute after a 15-minute grace, at most $15. The
 * wait runs from the later of the driver's check-in and the promised ready time until the store hands
 * the load over. A driver who never checked in (`arrivedAt` null) gets none. All instants are epoch ms.
 * Arrived 12:45, ready by 12:50, collected 13:20 → 30 min → 375.
 */
export function waitPayCents(timing: {
  arrivedAt: number | null;
  readyBy: number;
  collectedAt: number;
}): number {
  const { arrivedAt, readyBy, collectedAt } = timing;
  requireInstant('waitPayCents: readyBy', readyBy);
  requireInstant('waitPayCents: collectedAt', collectedAt);
  // Without a check-in nobody knows when the driver reached the counter, so there is no wait to pay.
  if (arrivedAt === null) return 0;
  requireInstant('waitPayCents: arrivedAt', arrivedAt);
  // Arriving early does not start the clock: the store only promised the load for `readyBy`.
  const waitMinutes = Math.floor((collectedAt - Math.max(arrivedAt, readyBy)) / 60_000);
  return Math.min(MAX_WAIT_CENTS, WAIT_MINUTE_CENTS * Math.max(0, waitMinutes - WAIT_GRACE_MIN));
}

/** The payout with its wait pay set (computed once, at the hand-over). Returns a new object. */
export function withWaitPay(payout: DriverPayout, waitCents: number): DriverPayout {
  return payoutWith('withWaitPay', payout, payout.boostCents, waitCents);
}

/**
 * What a driver earns for a failed attempt (§3.10): the offer plus any boost when the site caused the
 * failure (`FAILURE_REASONS[…].siteCaused`), nothing when the driver did (`damaged`, `vehicle_issue`)
 * or the reason is `other` or missing (ops can review). Wait pay is not part of it.
 */
export function failurePayCents(
  payout: Pick<DriverPayout, 'offerCents' | 'boostCents'>,
  reason: FailureReasonId | null,
): number {
  const offerCents = requireWhole('failurePayCents: payout.offerCents', payout.offerCents);
  const boostCents = requireWhole('failurePayCents: payout.boostCents', payout.boostCents);
  if (!isSiteCausedFailure(reason)) return 0;
  return requireExact('failurePayCents: the pay', offerCents + boostCents);
}

/**
 * What a driver earns when a job they had accepted is cancelled (§3.9): a quarter of the offer, at
 * least $5, rounded up to $0.25, and only if they had already checked in at the store or had held the
 * job for 15 minutes or more. Otherwise, and for a job nobody had accepted, 0. Instants are epoch ms.
 * Offer 4 775 → ceilTo25(max(500, 1 194)) = 1 200.
 */
export function cancellationPayCents(
  offerCents: number,
  timing: { acceptedAt: number | null; arrivedAt: number | null; cancelledAt: number },
): number {
  const { acceptedAt, arrivedAt, cancelledAt } = timing;
  requireWhole('cancellationPayCents: offerCents', offerCents);
  requireInstant('cancellationPayCents: cancelledAt', cancelledAt);
  if (acceptedAt === null) return 0;
  requireInstant('cancellationPayCents: acceptedAt', acceptedAt);
  if (arrivedAt !== null) requireInstant('cancellationPayCents: arrivedAt', arrivedAt);

  const checkedIn = arrivedAt !== null && arrivedAt <= cancelledAt;
  const heldLongEnough = cancelledAt - acceptedAt >= CANCELLATION_HELD_MS;
  if (!checkedIn && !heldLongEnough) return 0;
  return ceilTo25(Math.max(CANCELLATION_MIN_CENTS, mulDivHalfUp(offerCents, 1, 4)));
}
