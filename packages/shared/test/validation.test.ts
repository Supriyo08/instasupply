/**
 * The validators against the limits of the security rules (§6.1, §6.3) and of the callable table
 * (§5.4, §5.5), on the seed data of §11 and at every boundary.
 *
 * The rules are written out again below, as plain functions, so the two can be compared: whatever a
 * validator returns must pass the rule for the same document. A form then never accepts what the
 * server refuses.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CITY_IDS,
  SELL_UNITS,
  SERVICE_AREA,
  VEHICLE_CLASS_IDS,
  formatPhone,
  isNanpPhone,
  isOntarioPostalCode,
  isRequestId,
  isStoreId,
  isValidStore,
  maskPhone,
  normalizePhone,
  normalizePostalCode,
  summarizeLoad,
  validateDriverVehicle,
  validateIssueReport,
  validateJobsite,
  validateMaterialList,
  validateProduct,
  validateStore,
  validateStoreProfile,
  type DayHours,
  type JobsiteFields,
  type ProductInput,
  type StoreOrderLine,
  type ValidationResult,
  type Weekday,
} from '../src';

// ---------- helpers ----------

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

function valueOf<T>(result: ValidationResult<T>): T {
  if (!result.ok) assert.fail(`expected a valid value, got ${JSON.stringify(result.errors)}`);
  return result.value;
}

/** The fields a form would mark, in alphabetical order. */
function errorKeys<T>(result: ValidationResult<T>): string[] {
  return result.ok ? [] : Object.keys(result.errors).sort();
}

function messageOf<T>(result: ValidationResult<T>, key: keyof T | 'form'): string | undefined {
  return result.ok ? undefined : result.errors[key];
}

const TODAY = '2026-11-19';

// ---------- the security rules, written out (§6.1, §6.3) ----------

/** `isText(v, min, max)`: a string of `min` to `max` characters. */
const isText = (value: unknown, min: number, max: number): boolean =>
  typeof value === 'string' && value.length >= min && value.length <= max;
/** `isNanp`. */
const RULES_NANP = /^[+]1[2-9][0-9]{2}[2-9][0-9]{6}$/;
/** `isOnPostal`. */
const RULES_ON_POSTAL = /^[KLMNP][0-9][ABCEGHJ-NPRSTV-Z] [0-9][ABCEGHJ-NPRSTV-Z][0-9]$/;
/** `cityIds()`. */
const RULES_CITY_IDS = [
  'toronto',
  'mississauga',
  'brampton',
  'vaughan',
  'markham',
  'richmond_hill',
  'oakville',
  'burlington',
  'milton',
  'pickering',
  'ajax',
  'whitby',
  'oshawa',
  'newmarket',
  'aurora',
];
/** `vehicleClasses()`. */
const RULES_VEHICLE_CLASSES = ['car', 'suv', 'pickup', 'cargo_van', 'box_truck', 'flatbed'];
/** The `d.unit in [...]` list of `isValidProduct`. */
const RULES_UNITS = [
  'each',
  'pair',
  'sheet',
  'length',
  'bundle',
  'box',
  'bag',
  'pail',
  'can',
  'tube',
  'roll',
  'pack',
  'kit',
];
/** The `d.categoryId in [...]` list of `isValidProduct`. */
const RULES_CATEGORIES = [
  'adhesives',
  'fasteners',
  'tools',
  'safety',
  'wood',
  'drywall',
  'insulation',
  'masonry',
  'roofing',
  'electrical',
  'plumbing',
  'hvac',
  'doors',
  'windows',
  'glass',
  'hardware',
  'paint',
  'flooring',
  'wall-decor',
  'cleaning',
  'storage',
  'bath',
  'kitchen',
  'appliances',
  'outdoors',
];
const JOBSITE_KEYS = [
  'label',
  'line1',
  'line2',
  'city',
  'province',
  'postalCode',
  'location',
  'cityId',
  'areaLabel',
  'contactName',
  'contactPhone',
  'instructions',
  'receiving',
  'maxVehicleClass',
];

/** `inServiceArea(p)`. */
const inServiceArea = (p: { lat: number; lng: number }): boolean =>
  p.lat >= 43.25 && p.lat <= 44.15 && p.lng >= -80.0 && p.lng <= -78.75;

/** `isValidJobsite(d)` without the fields the app adds itself (`isDefault` and the timestamps). */
function jobsiteRule(d: JobsiteFields): boolean {
  return (
    Object.keys(d).every((key) => JOBSITE_KEYS.includes(key)) &&
    isText(d.label, 1, 40) &&
    isText(d.line1, 3, 160) &&
    (d.line2 === null || isText(d.line2, 1, 60)) &&
    isText(d.city, 1, 60) &&
    d.province === 'ON' &&
    (d.postalCode === null || RULES_ON_POSTAL.test(d.postalCode)) &&
    inServiceArea(d.location) &&
    RULES_CITY_IDS.includes(d.cityId) &&
    isText(d.areaLabel, 1, 80) &&
    isText(d.contactName, 1, 80) &&
    RULES_NANP.test(d.contactPhone) &&
    (d.instructions === null || isText(d.instructions, 1, 500)) &&
    ['attended', 'unattended'].includes(d.receiving) &&
    (d.maxVehicleClass === null || RULES_VEHICLE_CLASSES.includes(d.maxVehicleClass))
  );
}

/** `isValidProduct(d)` for the fields a person edits; `storeId` is the store the photo was uploaded for. */
function productRule(d: ProductInput, storeId: string): boolean {
  return (
    (d.imagePath === null || new RegExp(`^productPhotos/${storeId}/[^/]+$`).test(d.imagePath)) &&
    isText(d.name, 2, 120) &&
    isText(d.sku, 1, 40) &&
    (d.brand === null || isText(d.brand, 1, 60)) &&
    RULES_CATEGORIES.includes(d.categoryId) &&
    RULES_UNITS.includes(d.unit) &&
    (d.size === null || isText(d.size, 1, 60)) &&
    Number.isInteger(d.priceCents) &&
    d.priceCents >= 1 &&
    d.priceCents <= 10_000_000 &&
    (d.compareAtCents === null || (Number.isInteger(d.compareAtCents) && d.compareAtCents > d.priceCents)) &&
    Number.isInteger(d.stockOnHand) &&
    d.stockOnHand >= 0 &&
    d.stockOnHand <= 1_000_000 &&
    (d.maxPerOrder === null ||
      (Number.isInteger(d.maxPerOrder) && d.maxPerOrder >= 1 && d.maxPerOrder <= 9_999)) &&
    d.weightKg > 0 &&
    d.weightKg <= 3000 &&
    d.dimsCm.l > 0 &&
    d.dimsCm.l <= 1500 &&
    d.dimsCm.w > 0 &&
    d.dimsCm.h > 0 &&
    typeof d.shipEstimated === 'boolean' &&
    typeof d.active === 'boolean' &&
    typeof d.featured === 'boolean' &&
    (d.badge === null || ['new', 'bestseller', 'deal'].includes(d.badge)) &&
    isText(d.description, 0, 2000)
  );
}

// ---------- seed data (§11) ----------

const LESLIEVILLE = {
  label: 'Leslieville semi reno',
  line1: 'Pape Ave & Dundas St E',
  line2: null,
  city: 'Toronto',
  province: 'ON',
  postalCode: 'M4M 2E3',
  location: { lat: 43.6648, lng: -79.3405 },
  cityId: 'toronto',
  areaLabel: 'Leslieville · M4M',
  contactName: 'Dana Whitfield',
  contactPhone: '+14165550110',
  instructions: 'Laneway access off Pape. Stack lumber under the tarp by the garage.',
  receiving: 'attended',
  maxVehicleClass: null,
};

const JUNCTION = {
  label: 'Junction basement',
  line1: 'Dundas St W & Keele St',
  line2: null,
  city: 'Toronto',
  province: 'ON',
  postalCode: 'M6P 1Z2',
  location: { lat: 43.6655, lng: -79.4636 },
  cityId: 'toronto',
  areaLabel: 'The Junction · M6P',
  contactName: 'Luis Ortega',
  contactPhone: '+16475550141',
  instructions: 'Side door code 4410. Drywall inside the side door.',
  receiving: 'unattended',
  maxVehicleClass: 'cargo_van',
};

const KESTREL_STUD = {
  sku: 'KLY-SPF248',
  name: '2x4x8 SPF stud, kiln-dried',
  brand: null,
  categoryId: 'wood',
  familyKey: 'spf-2x4x8',
  unit: 'each',
  size: '2 in × 4 in × 8 ft',
  description: 'Kiln-dried SPF framing stud, straight and square for walls and blocking.',
  priceCents: 479,
  compareAtCents: null,
  stockOnHand: 1200,
  maxPerOrder: null,
  weightKg: 4.5,
  dimsCm: { l: 244, w: 9, h: 4 },
  shipEstimated: false,
  active: true,
  featured: true,
  badge: 'bestseller',
  imageKey: 'lumber-stud',
  imagePath: null,
};

const weekdays = (hours: DayHours): Record<Weekday, DayHours | null> => ({
  mon: hours,
  tue: hours,
  wed: hours,
  thu: hours,
  fri: hours,
  sat: null,
  sun: null,
});

/** Kestrel Lumber Yard: 06:30–18:00 on weekdays, 07:00–16:00 on Saturday, closed on Sunday. */
const KESTREL_HOURS = {
  ...weekdays({ open: '06:30', close: '18:00' }),
  sat: { open: '07:00', close: '16:00' },
};

const KESTREL = {
  name: 'Kestrel Lumber Yard',
  specialty: 'lumber_building',
  categoryIds: ['wood', 'masonry', 'outdoors', 'adhesives', 'fasteners'],
  description: 'Framing lumber, sheet goods and concrete supplies.',
  marketId: 'gta',
  cityId: 'toronto',
  areaLabel: 'Etobicoke',
  address: {
    line1: 'Dixon Rd & Martin Grove Rd',
    line2: null,
    city: 'Toronto',
    province: 'ON',
    postalCode: 'M9W 5L4',
  },
  location: { lat: 43.6966, lng: -79.5752 },
  phone: '+14165550120',
  email: 'kestrel@instasupply.test',
  photoUrl: null,
  imageKey: 'store-lumber',
  hours: KESTREL_HOURS,
  closures: [],
  fulfilment: { delivery: true, pickup: true, deliveryRadiusKm: 45 },
  prepMinutes: 25,
  sameDayCutoff: '15:00',
  status: 'live',
  acceptingOrders: true,
};

const MARCO_F150 = {
  type: 'pickup',
  make: 'Ford',
  model: 'F-150',
  year: 2021,
  plate: 'CBKX 214',
  colour: 'white',
  boxLengthFt: 6.5,
  payloadKg: null,
  extras: [],
};

/** Scenario F of §11.5. */
const FRAMING_LIST = {
  lines: [
    { text: '2x4x8 SPF studs', quantity: 60 },
    { text: '1/2 in drywall 4x8', quantity: 30 },
    { text: 'R12 batts for 2x4 walls — 8 bags', quantity: null },
    { text: 'Vapour barrier 10 × 100', quantity: 1 },
    { text: 'Joint compound 17 L', quantity: 3 },
    { text: 'Corner bead 8 ft', quantity: 12 },
  ],
  attachments: [
    {
      path: 'quoteUploads/uid-dana/4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f/framing-list.png',
      name: 'framing-list.png',
      contentType: 'image/png',
      sizeBytes: 482_113,
    },
  ],
  neededBy: { kind: 'this_week', date: null },
  fulfilment: 'delivery',
  jobsiteId: 'jobsite-junction',
  contact: { preferred: 'call', phone: '+14165550110', email: null },
  notes: null,
};

function orderLine(lineId: string, name: string, quantity: number, fulfilledQty: number): StoreOrderLine {
  return {
    lineId,
    kind: 'catalog',
    productId: null,
    sku: null,
    name,
    brand: null,
    unit: 'each',
    size: null,
    categoryId: null,
    imageKey: null,
    imageUrl: null,
    unitPriceCents: 1848,
    quantity,
    fulfilledQty,
    shortReason: fulfilledQty < quantity ? 'out_of_stock' : null,
    lineCents: 1848 * quantity,
    discountCents: 0,
    weightKg: 25,
    dimsCm: { l: 244, w: 122, h: 1.3 },
    note: null,
  };
}

/** Bluestone's part of scenario A, plus a line the store shipped short and one it could not supply. */
const BLUESTONE_ORDER = {
  lines: [
    orderLine('L1', 'Drywall 1/2 in regular, 4×8', 6, 6),
    orderLine('L2', 'All-purpose joint compound, 17 L', 1, 1),
    orderLine('L3', 'Metal corner bead, 8 ft', 24, 20),
    orderLine('L4', 'Paper drywall tape, 500 ft', 2, 0),
  ],
};

const CRACKED_SHEETS = {
  type: 'damaged',
  lines: [{ lineId: 'L1', quantity: 2 }],
  description: '2 sheets cracked at the corner',
  photoPaths: ['issuePhotos/9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d/corner.jpg'],
  preferredResolution: 'refund',
};

/** Input that is not what a validator expects at all. */
const JUNK: unknown[] = [
  undefined,
  null,
  0,
  42,
  '',
  'text',
  true,
  [],
  [1, 2, 3],
  {},
  { lines: 'x', location: 'y', hours: 7, address: [], contact: 3, neededBy: 'soon', dimsCm: 'big' },
  { label: {}, line1: [], city: 5, location: { lat: 'north', lng: null }, extras: {}, closures: 'never' },
  () => 1,
  // Objects that are not plain data: a field name such as `size` must not land on their getters.
  new Map([['label', 'x']]),
  new Set(['size']),
  new Date(0),
  Object.create(new Set(['size'])),
  Object.create(null),
];

// ---------- phones (§1.1) ----------

describe('phones', () => {
  it('accepts the three ways people write a Canadian number', () => {
    assert.equal(normalizePhone('4165550101'), '+14165550101');
    assert.equal(normalizePhone('1-416-555-0101'), '+14165550101');
    assert.equal(normalizePhone('+1 (647) 555-0199'), '+16475550199');
    assert.equal(normalizePhone('(416) 555-0110'), '+14165550110');
    assert.equal(normalizePhone('416.555.0110'), '+14165550110');
    assert.equal(normalizePhone('  +14375550144 '), '+14375550144');
  });

  it('refuses other countries and numbers that cannot exist', () => {
    assert.equal(normalizePhone('0165550101'), null); // area code starts with 0
    assert.equal(normalizePhone('+442079460958'), null); // United Kingdom
    assert.equal(normalizePhone('1165550101'), null); // area code starts with 1
    assert.equal(normalizePhone('4160550101'), null); // exchange starts with 0
    assert.equal(normalizePhone('4161550101'), null); // exchange starts with 1
    assert.equal(normalizePhone('+4165550101'), null); // a plus sign without the country code 1
    assert.equal(normalizePhone('416555010'), null); // 9 digits
    assert.equal(normalizePhone('24165550101'), null); // 11 digits that do not start with 1
    assert.equal(normalizePhone('416-555-0110 x5'), null);
    assert.equal(normalizePhone('41655501a0'), null);
    assert.equal(normalizePhone('1+4165550110'), null);
    assert.equal(normalizePhone('12'), null);
    assert.equal(normalizePhone(''), null);
    assert.equal(normalizePhone(null), null);
    assert.equal(normalizePhone(undefined), null);
  });

  it('recognises a stored number without cleaning it up', () => {
    assert.equal(isNanpPhone('+14165550110'), true);
    assert.equal(isNanpPhone('4165550110'), false);
    assert.equal(isNanpPhone('+1 416 555 0110'), false);
    assert.equal(isNanpPhone('+10165550110'), false);
    assert.equal(isNanpPhone('+442079460958'), false);
    assert.equal(isNanpPhone(4165550110), false);
    assert.equal(isNanpPhone(null), false);
  });

  it('shows and masks a number the Canadian way', () => {
    assert.equal(formatPhone('+14165550110'), '(416) 555-0110');
    assert.equal(formatPhone('647 555 0199'), '(647) 555-0199');
    assert.equal(formatPhone('+442079460958'), '+442079460958');
    assert.equal(formatPhone('  call the office '), 'call the office');
    assert.equal(formatPhone(null), '—');
    assert.equal(formatPhone(undefined), '—');
    assert.equal(formatPhone('   '), '—');
    assert.equal(maskPhone('+14165550110'), '(416) •••-0110');
    assert.equal(maskPhone('(647) 555-0199'), '(647) •••-0199');
    assert.equal(maskPhone('+442079460958'), '•••-0958');
    assert.equal(maskPhone('55501'), '•••');
    assert.equal(maskPhone(''), '—');
    assert.equal(maskPhone(null), '—');
  });

  it('normalizes 500 random numbers, however they are typed, to what the rules accept', () => {
    const random = mulberry32(20261119);
    const digit = (from: number, to: number) => String(from + Math.floor(random() * (to - from + 1)));
    const digits = (count: number) => Array.from({ length: count }, () => digit(0, 9)).join('');
    for (let round = 0; round < 500; round += 1) {
      const area = digit(2, 9) + digits(2);
      const exchange = digit(2, 9) + digits(2);
      const line = digits(4);
      const e164 = `+1${area}${exchange}${line}`;
      const typed = [
        `${area}${exchange}${line}`,
        `1${area}${exchange}${line}`,
        e164,
        `(${area}) ${exchange}-${line}`,
        `1-${area}-${exchange}-${line}`,
        `+1 ${area} ${exchange} ${line}`,
        `${area}.${exchange}.${line}`,
        ` +1 (${area}) ${exchange} - ${line} `,
      ][Math.floor(random() * 8)];
      assert.equal(normalizePhone(typed), e164, typed);
      assert.match(e164, RULES_NANP);
      assert.equal(isNanpPhone(e164), true);
      assert.equal(formatPhone(e164), `(${area}) ${exchange}-${line}`);
      assert.equal(normalizePhone(formatPhone(typed)), e164);
      assert.equal(maskPhone(typed), `(${area}) •••-${line}`);

      // The same digits with a 0 or a 1 in front of the area code or the exchange are not a number.
      const bad =
        random() < 0.5
          ? `${digit(0, 1)}${area.slice(1)}${exchange}${line}`
          : `${area}${digit(0, 1)}${exchange.slice(1)}${line}`;
      assert.equal(normalizePhone(bad), null, bad);
      assert.equal(isNanpPhone(`+1${bad}`), false, bad);
      assert.doesNotMatch(`+1${bad}`, RULES_NANP);
    }
  });
});

// ---------- postal codes (§1.1) ----------

describe('postal codes', () => {
  it('writes a code as A1A 1A1', () => {
    assert.equal(normalizePostalCode('m5v2t6'), 'M5V 2T6');
    assert.equal(normalizePostalCode('M5V 2T6'), 'M5V 2T6');
    assert.equal(normalizePostalCode('  m5v   2t6 '), 'M5V 2T6');
    assert.equal(normalizePostalCode('M5V-2T6'), 'M5V 2T6');
    assert.equal(normalizePostalCode('h2x1y4'), 'H2X 1Y4');
  });

  it('refuses what is not a postal code', () => {
    for (const bad of ['M5V 2T', 'M5V 2T66', 'MVV 2T6', '5M5 V2T', '12345', '90210-1234', 'M5V_2T6', '']) {
      assert.equal(normalizePostalCode(bad), null, bad);
    }
    assert.equal(normalizePostalCode(null), null);
    assert.equal(normalizePostalCode(undefined), null);
  });

  it('refuses D, F, I, O, Q and U in every position, and W and Z in the first', () => {
    for (const letter of ['D', 'F', 'I', 'O', 'Q', 'U']) {
      assert.equal(normalizePostalCode(`${letter}5V 2T6`), null, `${letter} first`);
      assert.equal(normalizePostalCode(`M5${letter} 2T6`), null, `${letter} third`);
      assert.equal(normalizePostalCode(`M5V 2${letter}6`), null, `${letter} fifth`);
      assert.equal(isOntarioPostalCode(`M5${letter} 2T6`), false);
    }
    assert.equal(normalizePostalCode('W5V 2T6'), null);
    assert.equal(normalizePostalCode('Z5V 2T6'), null);
    // W and Z are fine after the first letter.
    assert.equal(normalizePostalCode('m5w2z6'), 'M5W 2Z6');
  });

  it('knows Ontario by its first letter', () => {
    for (const code of ['K1A 0B1', 'L4W 1N6', 'M4M 2E3', 'N2L 3G1', 'P3E 5J1', 'm9w5l4']) {
      assert.equal(isOntarioPostalCode(code), true, code);
    }
    // Real codes of Quebec, British Columbia, Alberta, Nova Scotia, Manitoba and Yukon.
    for (const code of ['H2X 1Y4', 'V6B 1A1', 'T2P 1J9', 'B3H 4R2', 'R3C 0V8', 'Y1A 2C6']) {
      assert.equal(normalizePostalCode(code), code);
      assert.equal(isOntarioPostalCode(code), false, code);
    }
    assert.equal(isOntarioPostalCode(''), false);
    assert.equal(isOntarioPostalCode(null), false);
    assert.equal(isOntarioPostalCode(undefined), false);
  });

  it('agrees with the rules on every first and third letter', () => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const validFirst: string[] = [];
    for (const first of letters) {
      for (const third of letters) {
        const typed = `${first.toLowerCase()}4${third.toLowerCase()}2e3`;
        const stored = `${first}4${third} 2E3`;
        const normalized = normalizePostalCode(typed);
        // A code is Ontario's exactly when the rules' `isOnPostal` accepts its stored form.
        assert.equal(isOntarioPostalCode(typed), RULES_ON_POSTAL.test(stored), stored);
        if (normalized !== null) assert.equal(normalized, stored);
        if (normalized !== null && third === 'A') validFirst.push(first);
      }
    }
    assert.equal(validFirst.join(''), 'ABCEGHJKLMNPRSTVXY');
  });
});

// ---------- ids (§1.1) ----------

describe('ids', () => {
  it('accepts a lower-case UUIDv4 as a request id, and nothing else', () => {
    assert.equal(isRequestId('4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f'), true);
    assert.equal(isRequestId('00000000-0000-4000-8000-000000000000'), true);
    assert.equal(isRequestId('ffffffff-ffff-4fff-bfff-ffffffffffff'), true);
    assert.equal(isRequestId('4f1c2d3e-5a6b-1c7d-8e9f-0a1b2c3d4e5f'), false); // version 1
    assert.equal(isRequestId('4f1c2d3e-5a6b-4c7d-ce9f-0a1b2c3d4e5f'), false); // not the RFC variant
    assert.equal(isRequestId('4F1C2D3E-5A6B-4C7D-8E9F-0A1B2C3D4E5F'), false); // another document id
    assert.equal(isRequestId('4f1c2d3e5a6b4c7d8e9f0a1b2c3d4e5f'), false);
    assert.equal(isRequestId(' 4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f'), false);
    assert.equal(isRequestId('4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5g'), false);
    assert.equal(isRequestId(''), false);
    assert.equal(isRequestId(null), false);
    assert.equal(isRequestId(42), false);
  });

  it('accepts 300 generated UUIDv4s and refuses each one with a wrong version or variant', () => {
    const random = mulberry32(17);
    const hex = (count: number) =>
      Array.from({ length: count }, () => Math.floor(random() * 16).toString(16)).join('');
    for (let round = 0; round < 300; round += 1) {
      const variant = '89ab'.charAt(Math.floor(random() * 4));
      const id = `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
      assert.equal(isRequestId(id), true, id);
      assert.equal(isRequestId(`${id.slice(0, 14)}7${id.slice(15)}`), false);
      assert.equal(isRequestId(`${id.slice(0, 19)}c${id.slice(20)}`), false);
      assert.equal(isRequestId(id.slice(1)), false);
    }
  });

  it('accepts the seed stores as store ids', () => {
    const seedStores = [
      'kestrel-lumber',
      'grainline-building',
      'bluestone-drywall',
      'voltway-electrical',
      'copperline-plumbing',
      'aircrest-hvac',
      'boltbin-hardware',
      'glassmoor-glass',
      'casingcraft-doors',
      'slatebridge-masonry',
      'quietcore-insulation',
      'tapstone-bath',
      'brightrafter-lighting',
      'cabinetwell-kitchens',
    ];
    for (const id of seedStores) assert.equal(isStoreId(id), true, id);
  });

  it('keeps a store id to a 3–40 character slug that can never hold the product separator', () => {
    assert.equal(isStoreId('abc'), true);
    assert.equal(isStoreId('ab'), false);
    assert.equal(isStoreId('a'.repeat(40)), true);
    assert.equal(isStoreId('a'.repeat(41)), false);
    assert.equal(isStoreId('store-24-7'), true);
    assert.equal(isStoreId('kestrel--lumber'), false);
    assert.equal(isStoreId('-kestrel'), false);
    assert.equal(isStoreId('kestrel-'), false);
    assert.equal(isStoreId('Kestrel-Lumber'), false);
    assert.equal(isStoreId('kestrel_lumber'), false);
    assert.equal(isStoreId('kestrel lumber'), false);
    assert.equal(isStoreId('kestrel/lumber'), false);
    assert.equal(isStoreId(''), false);
    assert.equal(isStoreId(null), false);
    assert.equal(isStoreId(123), false);
  });
});

// ---------- lists the rules repeat (§6.1, §6.3) ----------

describe('lists the security rules repeat', () => {
  it('has the same cities, vehicle classes and sell units as the rules', () => {
    assert.deepEqual([...CITY_IDS], RULES_CITY_IDS);
    assert.deepEqual([...VEHICLE_CLASS_IDS], RULES_VEHICLE_CLASSES);
    assert.deepEqual([...SELL_UNITS], RULES_UNITS);
  });

  it('has the same service area as the rules', () => {
    assert.deepEqual(SERVICE_AREA, { south: 43.25, west: -80.0, north: 44.15, east: -78.75 });
  });
});

// ---------- jobsites (§6.3 isValidJobsite) ----------

describe('validateJobsite', () => {
  it('accepts the seed jobsites as they are', () => {
    assert.deepEqual(valueOf(validateJobsite(LESLIEVILLE)), LESLIEVILLE);
    assert.deepEqual(valueOf(validateJobsite(JUNCTION)), JUNCTION);
    assert.equal(jobsiteRule(valueOf(validateJobsite(LESLIEVILLE))), true);
    assert.equal(jobsiteRule(valueOf(validateJobsite(JUNCTION))), true);
  });

  it('cleans up what a person typed', () => {
    const typed = {
      label: '  Home —   Danforth ',
      line1: ' Danforth Ave &  Woodbine Ave',
      line2: '  ',
      city: 'Toronto ',
      postalCode: 'm4c1l9',
      location: { lat: '43.6866', lng: '-79.3127' },
      cityId: 'Toronto',
      areaLabel: 'Danforth · M4C',
      contactName: ' Sam  Okafor ',
      contactPhone: '(437) 555-0144',
      instructions: '',
      receiving: 'Attended',
    };
    assert.deepEqual(valueOf(validateJobsite(typed)), {
      label: 'Home — Danforth',
      line1: 'Danforth Ave & Woodbine Ave',
      line2: null,
      city: 'Toronto',
      province: 'ON',
      postalCode: 'M4C 1L9',
      location: { lat: 43.6866, lng: -79.3127 },
      cityId: 'toronto',
      areaLabel: 'Danforth · M4C',
      contactName: 'Sam Okafor',
      contactPhone: '+14375550144',
      instructions: null,
      receiving: 'attended',
      maxVehicleClass: null,
    });
  });

  it('accepts a new build that only has a pin', () => {
    const lot = { ...LESLIEVILLE, label: 'Lot 14', line1: 'Lot 14, Phase 3', postalCode: null };
    const saved = valueOf(validateJobsite(lot));
    assert.equal(saved.postalCode, null);
    assert.equal(saved.line1, 'Lot 14, Phase 3');
    assert.equal(jobsiteRule(saved), true);
    assert.equal(valueOf(validateJobsite({ ...lot, postalCode: undefined })).postalCode, null);
    assert.equal(valueOf(validateJobsite({ ...lot, postalCode: '  ' })).postalCode, null);
  });

  it('keeps line breaks in the instructions', () => {
    const saved = valueOf(
      validateJobsite({ ...LESLIEVILLE, instructions: ' Gate code 4410.\r\nStack by the garage. ' }),
    );
    assert.equal(saved.instructions, 'Gate code 4410.\nStack by the garage.');
  });

  it('marks every required field of an empty form', () => {
    assert.deepEqual(errorKeys(validateJobsite({})), [
      'areaLabel',
      'city',
      'cityId',
      'contactName',
      'contactPhone',
      'label',
      'line1',
      'location',
      'receiving',
    ]);
  });

  it('says what is wrong in words a customer understands', () => {
    assert.equal(
      messageOf(validateJobsite({ ...LESLIEVILLE, postalCode: 'H2X 1Y4' }), 'postalCode'),
      'Enter an Ontario postal code: it starts with K, L, M, N or P.',
    );
    assert.equal(
      messageOf(validateJobsite({ ...LESLIEVILLE, postalCode: 'M4M 2E' }), 'postalCode'),
      'Enter a postal code like M4M 2E3.',
    );
    assert.equal(
      messageOf(validateJobsite({ ...LESLIEVILLE, contactPhone: '+442079460958' }), 'contactPhone'),
      'Enter a Canadian or US phone number for the site contact, like (416) 555-0110.',
    );
    assert.equal(
      messageOf(validateJobsite({ ...LESLIEVILLE, province: 'QC' }), 'province'),
      'InstaSupply delivers in Ontario only.',
    );
  });

  it('holds every text to the length the rules allow', () => {
    const limits: [keyof JobsiteFields, number, number][] = [
      ['label', 1, 40],
      ['line1', 3, 160],
      ['city', 1, 60],
      ['areaLabel', 1, 80],
      ['contactName', 1, 80],
    ];
    for (const [field, min, max] of limits) {
      assert.equal(validateJobsite({ ...LESLIEVILLE, [field]: 'x'.repeat(min) }).ok, true, `${field} ${min}`);
      assert.equal(validateJobsite({ ...LESLIEVILLE, [field]: 'x'.repeat(max) }).ok, true, `${field} ${max}`);
      assert.deepEqual(errorKeys(validateJobsite({ ...LESLIEVILLE, [field]: 'x'.repeat(min - 1) })), [field]);
      assert.deepEqual(errorKeys(validateJobsite({ ...LESLIEVILLE, [field]: 'x'.repeat(max + 1) })), [field]);
    }
    // The two optional texts have no minimum: empty is "none".
    assert.equal(validateJobsite({ ...LESLIEVILLE, line2: 'x'.repeat(60) }).ok, true);
    assert.deepEqual(errorKeys(validateJobsite({ ...LESLIEVILLE, line2: 'x'.repeat(61) })), ['line2']);
    assert.equal(validateJobsite({ ...LESLIEVILLE, instructions: 'x'.repeat(500) }).ok, true);
    assert.deepEqual(errorKeys(validateJobsite({ ...LESLIEVILLE, instructions: 'x'.repeat(501) })), [
      'instructions',
    ]);
  });

  it('keeps the pin inside the service area, edges included', () => {
    const at = (lat: number, lng: number) => validateJobsite({ ...LESLIEVILLE, location: { lat, lng } });
    assert.equal(at(43.25, -80).ok, true);
    assert.equal(at(44.15, -78.75).ok, true);
    assert.equal(at(43.25, -78.75).ok, true);
    assert.equal(at(44.15, -80).ok, true);
    assert.deepEqual(errorKeys(at(43.2499, -79.4)), ['location']);
    assert.deepEqual(errorKeys(at(44.1501, -79.4)), ['location']);
    assert.deepEqual(errorKeys(at(43.7, -80.0001)), ['location']);
    assert.deepEqual(errorKeys(at(43.7, -78.7499)), ['location']);
    // Latitude and longitude the wrong way round.
    assert.deepEqual(errorKeys(at(-79.3405, 43.6648)), ['location']);
    assert.deepEqual(errorKeys(validateJobsite({ ...LESLIEVILLE, location: null })), ['location']);
    assert.deepEqual(errorKeys(validateJobsite({ ...LESLIEVILLE, location: { lat: 43.7 } })), ['location']);
  });

  it('takes the largest vehicle from the six classes only', () => {
    for (const vehicleClass of RULES_VEHICLE_CLASSES) {
      assert.equal(
        valueOf(validateJobsite({ ...LESLIEVILLE, maxVehicleClass: vehicleClass })).maxVehicleClass,
        vehicleClass,
      );
    }
    // A dump truck is something a driver declares, not a class a site can be limited to.
    assert.deepEqual(errorKeys(validateJobsite({ ...LESLIEVILLE, maxVehicleClass: 'dump_truck' })), [
      'maxVehicleClass',
    ]);
    assert.deepEqual(errorKeys(validateJobsite({ ...LESLIEVILLE, cityId: 'hamilton' })), ['cityId']);
    assert.deepEqual(errorKeys(validateJobsite({ ...LESLIEVILLE, receiving: 'sometimes' })), ['receiving']);
  });

  it('agrees with the rules on 400 random jobsites, field by field', () => {
    // For every field: values the rules accept (after clean-up), then values they refuse.
    const choices: Record<keyof JobsiteFields, [valid: unknown[], invalid: unknown[]]> = {
      label: [
        ['Leslieville semi reno', 'A', 'x'.repeat(40), '  Padded   name '],
        ['', '   ', 'x'.repeat(41), 42, null],
      ],
      line1: [
        ['Pape Ave & Dundas St E', 'Lot', 'y'.repeat(160)],
        ['ab', '', 'y'.repeat(161), undefined],
      ],
      line2: [
        [null, undefined, '', 'Unit 4', 'z'.repeat(60)],
        ['z'.repeat(61), 12],
      ],
      city: [
        ['Toronto', 'c'.repeat(60)],
        ['', 'c'.repeat(61), null],
      ],
      province: [
        ['ON', undefined, null, ' on '],
        ['QC', 'Ontario', 7],
      ],
      postalCode: [
        [null, '', 'M4M 2E3', 'm6p1z2', 'L4W 1N6'],
        ['H2X 1Y4', 'M4M 2E', 'D4M 2E3', 123],
      ],
      location: [
        [
          { lat: 43.6648, lng: -79.3405 },
          { lat: 43.25, lng: -80 },
          { lat: 44.15, lng: -78.75 },
          { lat: '43.7', lng: '-79.4' },
        ],
        [null, { lat: 43.2499, lng: -79.4 }, { lat: 43.7, lng: -78.7499 }, { lat: 'x', lng: 1 }, 'pin'],
      ],
      cityId: [
        ['toronto', 'richmond_hill', 'aurora'],
        ['hamilton', '', null],
      ],
      areaLabel: [
        ['Leslieville · M4M', 'a'.repeat(80)],
        ['', 'a'.repeat(81)],
      ],
      contactName: [
        ['Dana Whitfield', 'n'.repeat(80)],
        ['', 'n'.repeat(81)],
      ],
      contactPhone: [
        ['+1 416 555 0110', '(647) 555-0141', '4375550144'],
        ['', '0165550101', '+442079460958', 4165550110],
      ],
      instructions: [
        [null, '', 'Side door code 4410.', 'i'.repeat(500), 'Line one\nLine two'],
        ['i'.repeat(501), 5],
      ],
      receiving: [
        ['attended', 'unattended'],
        ['', 'sometimes', null],
      ],
      maxVehicleClass: [
        [null, undefined, '', 'cargo_van', 'flatbed'],
        ['dump_truck', 'other', 3],
      ],
    };
    const fields = Object.keys(choices) as (keyof JobsiteFields)[];
    const random = mulberry32(6_3);
    const pick = (list: unknown[]): unknown => list[Math.floor(random() * list.length)];
    let accepted = 0;
    for (let round = 0; round < 400; round += 1) {
      const input: Record<string, unknown> = {};
      const wrong: string[] = [];
      for (const field of fields) {
        const [valid, invalid] = choices[field];
        // Roughly one jobsite in three has nothing wrong with it.
        const bad = random() < 0.08;
        input[field] = pick(bad ? invalid : valid);
        if (bad) wrong.push(field);
      }
      const result = validateJobsite(input);
      assert.deepEqual(errorKeys(result), wrong.sort(), JSON.stringify(input));
      if (result.ok) {
        accepted += 1;
        assert.equal(jobsiteRule(result.value), true, JSON.stringify(result.value));
      }
    }
    // 0.92 to the power of 14 fields is 31 %: about 124 of 400. This seed gives 127.
    assert.equal(accepted, 127);
  });
});

// ---------- products (§6.3 isValidProduct) ----------

describe('validateProduct', () => {
  it('accepts a seed listing as it is', () => {
    const saved = valueOf(validateProduct(KESTREL_STUD));
    assert.deepEqual(saved, KESTREL_STUD);
    assert.equal(productRule(saved, 'kestrel-lumber'), true);
  });

  it('fills weight and size from the category when a supplier row has none', () => {
    const row = {
      sku: 'BDP-DW12',
      name: 'Drywall 1/2 in regular, 4×8',
      categoryId: 'drywall',
      unit: 'sheet',
      priceCents: 1848,
      stockOnHand: 900,
    };
    const saved = valueOf(validateProduct(row));
    assert.deepEqual(saved, {
      sku: 'BDP-DW12',
      name: 'Drywall 1/2 in regular, 4×8',
      brand: null,
      categoryId: 'drywall',
      familyKey: null,
      unit: 'sheet',
      size: null,
      description: '',
      priceCents: 1848,
      compareAtCents: null,
      stockOnHand: 900,
      maxPerOrder: null,
      weightKg: 25,
      dimsCm: { l: 244, w: 122, h: 1.3 },
      shipEstimated: true,
      active: true,
      featured: false,
      badge: null,
      imageKey: null,
      imagePath: null,
    });
    assert.equal(productRule(saved, 'bluestone-drywall'), true);
  });

  it('marks shipping as estimated when either number came from the category, or the supplier says so', () => {
    const base = { ...KESTREL_STUD, shipEstimated: false };
    assert.equal(valueOf(validateProduct(base)).shipEstimated, false);
    const noWeight = valueOf(validateProduct({ ...base, weightKg: null }));
    assert.equal(noWeight.weightKg, 10); // the Wood default
    assert.deepEqual(noWeight.dimsCm, { l: 244, w: 9, h: 4 });
    assert.equal(noWeight.shipEstimated, true);
    const noSize = valueOf(validateProduct({ ...base, dimsCm: { l: '', w: null } }));
    assert.equal(noSize.weightKg, 4.5);
    assert.deepEqual(noSize.dimsCm, { l: 244, w: 9, h: 4 });
    assert.equal(noSize.shipEstimated, true);
    assert.equal(valueOf(validateProduct({ ...base, shipEstimated: true })).shipEstimated, true);
    // Without a category there is no default to fall back on.
    assert.deepEqual(
      errorKeys(validateProduct({ ...base, categoryId: 'timber', weightKg: null, dimsCm: null })),
      ['categoryId', 'dimsCm', 'weightKg'],
    );
    // A size with a side missing is a mistake, not a request for the default.
    assert.deepEqual(errorKeys(validateProduct({ ...base, dimsCm: { l: 244, w: 9 } })), ['dimsCm']);
  });

  it('never hands out the category default itself', () => {
    const first = valueOf(validateProduct({ ...KESTREL_STUD, dimsCm: null }));
    first.dimsCm.l = 1;
    assert.deepEqual(valueOf(validateProduct({ ...KESTREL_STUD, dimsCm: null })).dimsCm, {
      l: 244,
      w: 9,
      h: 4,
    });
  });

  it('reads an import row, where everything is text', () => {
    const row = {
      sku: ' cpd-cu34l ',
      name: 'Copper pipe 3/4 in Type L, 12 ft',
      brand: '',
      categoryId: 'Plumbing',
      unit: 'LENGTH',
      size: '3/4 in × 12 ft',
      priceCents: '9698',
      compareAtCents: '',
      stockOnHand: '60',
      maxPerOrder: '20',
      weightKg: '2.5',
      dimsCm: { l: '366', w: '2.2', h: '2.2' },
      active: 'yes',
      featured: 'no',
    };
    assert.deepEqual(valueOf(validateProduct(row)), {
      sku: 'cpd-cu34l',
      name: 'Copper pipe 3/4 in Type L, 12 ft',
      brand: null,
      categoryId: 'plumbing',
      familyKey: null,
      unit: 'length',
      size: '3/4 in × 12 ft',
      description: '',
      priceCents: 9698,
      compareAtCents: null,
      stockOnHand: 60,
      maxPerOrder: 20,
      weightKg: 2.5,
      dimsCm: { l: 366, w: 2.2, h: 2.2 },
      shipEstimated: false,
      active: true,
      featured: false,
      badge: null,
      imageKey: null,
      imagePath: null,
    });
  });

  it('stores weight to the gram and size to the millimetre', () => {
    const saved = valueOf(
      validateProduct({ ...KESTREL_STUD, weightKg: 4.5004, dimsCm: { l: 243.84, w: 8.89, h: 3.81 } }),
    );
    assert.equal(saved.weightKg, 4.5);
    assert.deepEqual(saved.dimsCm, { l: 243.8, w: 8.9, h: 3.8 });
    // 0.4 g and 0.4 mm round to nothing, and nothing is not a weight or a size.
    assert.deepEqual(errorKeys(validateProduct({ ...KESTREL_STUD, weightKg: 0.0004 })), ['weightKg']);
    assert.deepEqual(errorKeys(validateProduct({ ...KESTREL_STUD, dimsCm: { l: 244, w: 0.04, h: 4 } })), [
      'dimsCm',
    ]);
  });

  it('holds every number to the limit the rules allow', () => {
    const accepts = (change: Record<string, unknown>) => {
      const result = validateProduct({ ...KESTREL_STUD, ...change });
      assert.equal(result.ok, true, JSON.stringify(change));
      assert.equal(productRule(valueOf(result), 'kestrel-lumber'), true, JSON.stringify(change));
    };
    const refuses = (change: Record<string, unknown>, field: string) => {
      assert.deepEqual(
        errorKeys(validateProduct({ ...KESTREL_STUD, ...change })),
        [field],
        JSON.stringify(change),
      );
    };

    accepts({ priceCents: 1 });
    accepts({ priceCents: 10_000_000 });
    refuses({ priceCents: 0 }, 'priceCents');
    refuses({ priceCents: 10_000_001 }, 'priceCents');
    refuses({ priceCents: 4.79 }, 'priceCents');
    refuses({ priceCents: '$4.79' }, 'priceCents');
    refuses({ priceCents: null }, 'priceCents');

    accepts({ compareAtCents: 480 });
    refuses({ compareAtCents: 479 }, 'compareAtCents');
    refuses({ compareAtCents: 100 }, 'compareAtCents');
    refuses({ compareAtCents: 599.5 }, 'compareAtCents');

    accepts({ stockOnHand: 0 });
    accepts({ stockOnHand: 1_000_000 });
    refuses({ stockOnHand: -1 }, 'stockOnHand');
    refuses({ stockOnHand: 1_000_001 }, 'stockOnHand');
    refuses({ stockOnHand: 12.5 }, 'stockOnHand');
    refuses({ stockOnHand: '' }, 'stockOnHand');

    accepts({ maxPerOrder: 1 });
    accepts({ maxPerOrder: 9_999 });
    refuses({ maxPerOrder: 0 }, 'maxPerOrder');
    refuses({ maxPerOrder: 10_000 }, 'maxPerOrder');

    accepts({ weightKg: 0.001 });
    accepts({ weightKg: 3000 });
    refuses({ weightKg: 0 }, 'weightKg');
    refuses({ weightKg: -4.5 }, 'weightKg');
    refuses({ weightKg: 3000.001 }, 'weightKg');
    refuses({ weightKg: 'heavy' }, 'weightKg');

    accepts({ dimsCm: { l: 0.1, w: 0.1, h: 0.1 } });
    accepts({ dimsCm: { l: 1500, w: 122, h: 1.3 } });
    refuses({ dimsCm: { l: 1500.1, w: 122, h: 1.3 } }, 'dimsCm');
    refuses({ dimsCm: { l: 0, w: 122, h: 1.3 } }, 'dimsCm');
    refuses({ dimsCm: { l: 244, w: 0, h: 1.3 } }, 'dimsCm');
    refuses({ dimsCm: { l: 244, w: 122, h: -1 } }, 'dimsCm');
    // The rules limit the length only; a pail is taller than it is long (30 × 30 × 38).
    accepts({ dimsCm: { l: 30, w: 30, h: 38 } });
  });

  it('stores the sides longest first, so the load rules see a sheet as a sheet (§1.1, §3.3)', () => {
    const sheet = (dims: Record<string, unknown>) =>
      valueOf(validateProduct({ ...KESTREL_STUD, unit: 'sheet', weightKg: 25, dimsCm: dims }));
    for (const typed of [
      { l: 244, w: 122, h: 1.3 },
      { l: 122, w: 244, h: 1.3 },
      { l: 1.3, w: 122, h: 244 },
      { l: '1.3', w: '244', h: '122' },
    ]) {
      const saved = sheet(typed).dimsCm;
      assert.deepEqual(saved, { l: 244, w: 122, h: 1.3 }, JSON.stringify(typed));
      const load = summarizeLoad([
        { name: 'Drywall 1/2 in 4x8', quantity: 4, unit: 'sheet', size: null, weightKg: 25, dimsCm: saved },
      ]);
      assert.deepEqual([load.longestCm, load.hasSheets, load.vehicleClass], [244, true, 'pickup']);
    }
    assert.deepEqual(sheet({ l: 30, w: 30, h: 38 }).dimsCm, { l: 38, w: 30, h: 30 });
    // The 1 500 cm cap is on the longest side, whichever box it was typed in.
    assert.deepEqual(errorKeys(validateProduct({ ...KESTREL_STUD, dimsCm: { l: 1, w: 5000, h: 1 } })), [
      'dimsCm',
    ]);
    assert.deepEqual(errorKeys(validateProduct({ ...KESTREL_STUD, dimsCm: { l: 1, w: 1, h: 1500.1 } })), [
      'dimsCm',
    ]);
    assert.deepEqual(sheet({ l: 1, w: 1500, h: 1 }).dimsCm, { l: 1500, w: 1, h: 1 });
    // A category default is stored the same way: paint's 20 × 20 × 25 (§1.5) becomes 25 × 20 × 20.
    const paint = valueOf(
      validateProduct({ ...KESTREL_STUD, categoryId: 'paint', unit: 'each', dimsCm: null }),
    );
    assert.deepEqual(paint.dimsCm, { l: 25, w: 20, h: 20 });
  });

  it('holds every text to the length the rules allow', () => {
    const ok = (change: Record<string, unknown>) =>
      assert.equal(
        productRule(valueOf(validateProduct({ ...KESTREL_STUD, ...change })), 'kestrel-lumber'),
        true,
      );
    const refuses = (change: Record<string, unknown>, field: string) =>
      assert.deepEqual(
        errorKeys(validateProduct({ ...KESTREL_STUD, ...change })),
        [field],
        JSON.stringify(change),
      );

    ok({ name: 'xx' });
    ok({ name: 'x'.repeat(120) });
    refuses({ name: 'x' }, 'name');
    refuses({ name: 'x'.repeat(121) }, 'name');
    ok({ sku: '9' });
    ok({ sku: 'S'.repeat(40) });
    refuses({ sku: 'S'.repeat(41) }, 'sku');
    refuses({ sku: '' }, 'sku');
    // A SKU of signs only would give every such product the same id.
    refuses({ sku: '#-/' }, 'sku');
    ok({ brand: 'b'.repeat(60) });
    refuses({ brand: 'b'.repeat(61) }, 'brand');
    ok({ size: 's'.repeat(60) });
    refuses({ size: 's'.repeat(61) }, 'size');
    ok({ description: '' });
    ok({ description: 'd'.repeat(2000) });
    refuses({ description: 'd'.repeat(2001) }, 'description');
    refuses({ description: 17 }, 'description');
    refuses({ categoryId: 'lumber' }, 'categoryId');
    refuses({ unit: 'kg' }, 'unit');
    refuses({ badge: 'hot' }, 'badge');
    refuses({ active: 'maybe' }, 'active');
  });

  it('takes a photo only from the product photo folder of a store', () => {
    const photo = (imagePath: unknown) => validateProduct({ ...KESTREL_STUD, imagePath });
    const saved = valueOf(photo('productPhotos/kestrel-lumber/stud-01.jpg'));
    assert.equal(saved.imagePath, 'productPhotos/kestrel-lumber/stud-01.jpg');
    assert.equal(productRule(saved, 'kestrel-lumber'), true);
    assert.deepEqual(errorKeys(photo('productPhotos/kestrel-lumber/a/stud.jpg')), ['imagePath']);
    assert.deepEqual(errorKeys(photo('productPhotos/kestrel-lumber/')), ['imagePath']);
    assert.deepEqual(errorKeys(photo('storePhotos/kestrel-lumber/front.jpg')), ['imagePath']);
    assert.deepEqual(errorKeys(photo('https://example.com/stud.jpg')), ['imagePath']);
  });

  it("with the store id, takes a photo only from that store's folder (§6.4)", () => {
    const photo = (imagePath: string) => validateProduct({ ...KESTREL_STUD, imagePath }, 'kestrel-lumber');
    assert.equal(photo('productPhotos/kestrel-lumber/stud-01.jpg').ok, true);
    assert.deepEqual(errorKeys(photo('productPhotos/grainline-building/stud-01.jpg')), ['imagePath']);
    assert.deepEqual(errorKeys(photo('productPhotos/kestrel-lumber-2/stud-01.jpg')), ['imagePath']);
  });

  it('reads numbers typed in decimal only, and never returns -0', () => {
    assert.deepEqual(errorKeys(validateProduct({ ...KESTREL_STUD, priceCents: '0x1F' })), ['priceCents']);
    assert.deepEqual(errorKeys(validateProduct({ ...KESTREL_STUD, stockOnHand: '0b11' })), ['stockOnHand']);
    assert.deepEqual(errorKeys(validateProduct({ ...KESTREL_STUD, stockOnHand: '0o7' })), ['stockOnHand']);
    for (const zero of [-0, '-0', '0', ' +0 ']) {
      const saved = valueOf(validateProduct({ ...KESTREL_STUD, stockOnHand: zero }));
      assert.ok(Object.is(saved.stockOnHand, 0), String(zero));
      assert.equal(productRule(saved, 'kestrel-lumber'), true, String(zero));
    }
    assert.equal(valueOf(validateProduct({ ...KESTREL_STUD, stockOnHand: ' 1e3 ' })).stockOnHand, 1000);
  });

  it('marks every required field of an empty form', () => {
    assert.deepEqual(errorKeys(validateProduct({})), [
      'categoryId',
      'dimsCm',
      'name',
      'priceCents',
      'sku',
      'stockOnHand',
      'unit',
      'weightKg',
    ]);
  });
});

// ---------- stores (§5.4) ----------

describe('validateStoreProfile', () => {
  it('returns only what was sent', () => {
    assert.deepEqual(valueOf(validateStoreProfile({ acceptingOrders: false }, TODAY)), {
      acceptingOrders: false,
    });
    assert.deepEqual(valueOf(validateStoreProfile({}, TODAY)), {});
    assert.deepEqual(
      valueOf(validateStoreProfile({ prepMinutes: undefined, sameDayCutoff: '15:30' }, TODAY)),
      {
        sameDayCutoff: '15:30',
      },
    );
  });

  it('drops what a store may not change itself', () => {
    const patch = { name: 'Kestrel Mega Yard', status: 'live', address: {}, rating: 5, prepMinutes: 30 };
    assert.deepEqual(valueOf(validateStoreProfile(patch, TODAY)), { prepMinutes: 30 });
    // The radius is set by ops; the two switches are the store's.
    assert.deepEqual(
      valueOf(validateStoreProfile({ fulfilment: { pickup: false, deliveryRadiusKm: 60 } }, TODAY)),
      {
        fulfilment: { pickup: false },
      },
    );
  });

  it('cleans up a whole profile', () => {
    const patch = {
      description: '  Framing lumber and sheet goods.\r\nOpen early. ',
      phone: '416-555-0120',
      email: ' Kestrel@InstaSupply.test ',
      hours: KESTREL_HOURS,
      closures: ['2026-12-24', '2026-11-27', '2026-12-24'],
      prepMinutes: '25',
      sameDayCutoff: ' 15:00 ',
      acceptingOrders: true,
      fulfilment: { delivery: true, pickup: true },
      photoPath: 'storePhotos/kestrel-lumber/front.jpg',
      loadingNotes: 'Dock 2, ring the bell.',
      alertPhone: '(416) 555-0120',
    };
    assert.deepEqual(valueOf(validateStoreProfile(patch, TODAY)), {
      description: 'Framing lumber and sheet goods.\nOpen early.',
      phone: '+14165550120',
      email: 'kestrel@instasupply.test',
      hours: KESTREL_HOURS,
      closures: ['2026-11-27', '2026-12-24'],
      prepMinutes: 25,
      sameDayCutoff: '15:00',
      acceptingOrders: true,
      fulfilment: { delivery: true, pickup: true },
      photoPath: 'storePhotos/kestrel-lumber/front.jpg',
      loadingNotes: 'Dock 2, ring the bell.',
      alertPhone: '+14165550120',
    });
    // With the store id (as `updateStoreProfile` passes it), the photo must be in that store's folder.
    assert.equal(validateStoreProfile(patch, TODAY, 'kestrel-lumber').ok, true);
    assert.deepEqual(
      errorKeys(
        validateStoreProfile({ photoPath: 'storePhotos/other-store/x.jpg' }, TODAY, 'kestrel-lumber'),
      ),
      ['photoPath'],
    );
  });

  it('lets a store clear what is optional, but not its phone', () => {
    const cleared = { email: null, photoPath: null, loadingNotes: '', alertPhone: null, description: '' };
    assert.deepEqual(valueOf(validateStoreProfile(cleared, TODAY)), {
      description: '',
      email: null,
      photoPath: null,
      loadingNotes: null,
      alertPhone: null,
    });
    assert.deepEqual(errorKeys(validateStoreProfile({ phone: null }, TODAY)), ['phone']);
    assert.deepEqual(errorKeys(validateStoreProfile({ phone: '+442079460958' }, TODAY)), ['phone']);
    assert.deepEqual(errorKeys(validateStoreProfile({ alertPhone: '0165550101' }, TODAY)), ['alertPhone']);
    assert.deepEqual(errorKeys(validateStoreProfile({ email: 'kestrel@' }, TODAY)), ['email']);
  });

  it('wants hours, or closed, for every day, and a day that closes after it opens', () => {
    const hours = (change: Record<string, unknown>) =>
      validateStoreProfile({ hours: { ...KESTREL_HOURS, ...change } }, TODAY);
    assert.equal(hours({}).ok, true);
    assert.equal(hours({ sun: { open: '10:00', close: '16:00' } }).ok, true);
    assert.equal(hours({ mon: { open: '00:00', close: '23:59' } }).ok, true);
    assert.equal(
      messageOf(hours({ sat: { open: '16:00', close: '07:00' } }), 'hours'),
      'Saturday: the closing time must be after the opening time.',
    );
    assert.equal(
      messageOf(hours({ fri: { open: '08:00', close: '08:00' } }), 'hours'),
      'Friday: the closing time must be after the opening time.',
    );
    assert.equal(
      messageOf(hours({ tue: { open: '7:00', close: '18:00' } }), 'hours'),
      'Tuesday: use 24-hour times like 07:00 and 17:30.',
    );
    assert.equal(
      messageOf(hours({ wed: { open: '07:00', close: '24:00' } }), 'hours'),
      'Wednesday: use 24-hour times like 07:00 and 17:30.',
    );
    assert.equal(
      messageOf(hours({ thu: { open: '07:00' } }), 'hours'),
      'Thursday: use 24-hour times like 07:00 and 17:30.',
    );
    assert.equal(
      messageOf(hours({ sun: undefined }), 'hours'),
      'Set the hours for Sunday, or mark it closed.',
    );
    assert.equal(
      messageOf(validateStoreProfile({ hours: 'always' }, TODAY), 'hours'),
      'Set the hours for Monday, or mark it closed.',
    );
    // A store may be closed all week, for instance while it moves.
    const closed = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
    assert.deepEqual(valueOf(validateStoreProfile({ hours: closed }, TODAY)), { hours: closed });
  });

  it('takes up to 60 closure dates, none of them in the past', () => {
    const closed = (dates: unknown) => validateStoreProfile({ closures: dates }, TODAY);
    assert.deepEqual(valueOf(closed(['2026-11-27'])), { closures: ['2026-11-27'] });
    assert.deepEqual(valueOf(closed([TODAY])), { closures: [TODAY] });
    assert.deepEqual(valueOf(closed([])), { closures: [] });
    assert.equal(messageOf(closed(['2026-11-18']), 'closures'), 'A closure date cannot be in the past.');
    assert.equal(messageOf(closed(['2025-12-24']), 'closures'), 'A closure date cannot be in the past.');
    assert.equal(messageOf(closed(['2027-02-29']), 'closures'), 'Write each closure date like 2026-12-24.');
    assert.equal(messageOf(closed(['24/12/2026']), 'closures'), 'Write each closure date like 2026-12-24.');
    assert.equal(messageOf(closed([20261224]), 'closures'), 'Write each closure date like 2026-12-24.');
    assert.equal(
      messageOf(closed('2026-12-24'), 'closures'),
      'List the dates the store is closed, like 2026-12-24.',
    );
    // 60 different days from 1 December on: 31 in December and 29 in January.
    const days = Array.from({ length: 61 }, (_, index) =>
      index < 31
        ? `2026-12-${String(index + 1).padStart(2, '0')}`
        : `2027-01-${String(index - 30).padStart(2, '0')}`,
    );
    assert.equal(valueOf(closed(days.slice(0, 60))).closures?.length, 60);
    assert.equal(messageOf(closed(days), 'closures'), 'A store can list up to 60 closure dates.');
    // A date listed twice counts once.
    assert.equal(valueOf(closed([...days.slice(0, 60), '2026-12-01'])).closures?.length, 60);
  });

  it('holds prep time to 5–240 minutes and the cut-off to a clock time', () => {
    const prep = (prepMinutes: unknown) => validateStoreProfile({ prepMinutes }, TODAY);
    assert.deepEqual(valueOf(prep(5)), { prepMinutes: 5 });
    assert.deepEqual(valueOf(prep(240)), { prepMinutes: 240 });
    assert.deepEqual(errorKeys(prep(4)), ['prepMinutes']);
    assert.deepEqual(errorKeys(prep(241)), ['prepMinutes']);
    assert.deepEqual(errorKeys(prep(25.5)), ['prepMinutes']);
    assert.deepEqual(errorKeys(prep(null)), ['prepMinutes']);
    const cutoff = (sameDayCutoff: unknown) => validateStoreProfile({ sameDayCutoff }, TODAY);
    assert.deepEqual(valueOf(cutoff('00:00')), { sameDayCutoff: '00:00' });
    assert.deepEqual(valueOf(cutoff('23:59')), { sameDayCutoff: '23:59' });
    assert.deepEqual(errorKeys(cutoff('3 pm')), ['sameDayCutoff']);
    assert.deepEqual(errorKeys(cutoff('15:60')), ['sameDayCutoff']);
    assert.deepEqual(errorKeys(cutoff(900)), ['sameDayCutoff']);
  });

  it('checks the switches and the photo folder', () => {
    assert.deepEqual(errorKeys(validateStoreProfile({ acceptingOrders: 'later' }, TODAY)), [
      'acceptingOrders',
    ]);
    assert.deepEqual(errorKeys(validateStoreProfile({ fulfilment: { delivery: 'sometimes' } }, TODAY)), [
      'fulfilment',
    ]);
    assert.deepEqual(errorKeys(validateStoreProfile({ fulfilment: null }, TODAY)), ['fulfilment']);
    assert.deepEqual(
      errorKeys(validateStoreProfile({ photoPath: 'productPhotos/kestrel-lumber/x.jpg' }, TODAY)),
      ['photoPath'],
    );
    assert.deepEqual(errorKeys(validateStoreProfile({ loadingNotes: 'n'.repeat(501) }, TODAY)), [
      'loadingNotes',
    ]);
    assert.deepEqual(errorKeys(validateStoreProfile({ description: 'd'.repeat(2001) }, TODAY)), [
      'description',
    ]);
  });

  it('refuses a caller that does not know what day it is', () => {
    assert.throws(() => validateStoreProfile({}, 'today'), RangeError);
    assert.throws(() => validateStoreProfile({}, '2026-02-30'), RangeError);
    assert.throws(() => validateStoreProfile({}, ''), RangeError);
  });
});

describe('validateStore', () => {
  it('accepts a seed store as it is', () => {
    assert.deepEqual(valueOf(validateStore(KESTREL)), KESTREL);
    assert.equal(isValidStore(KESTREL), true);
  });

  it('cleans up what ops typed in the wizard', () => {
    const typed = {
      ...KESTREL,
      name: '  Kestrel   Lumber Yard ',
      categoryIds: ['outdoors', 'wood', 'wood', 'adhesives'],
      address: { line1: 'Dixon Rd & Martin Grove Rd', city: 'Toronto', postalCode: 'm9w5l4' },
      location: { lat: '43.6966', lng: '-79.5752' },
      phone: '(416) 555-0120',
      email: '',
      closures: ['2026-11-27', '2025-12-24'],
      fulfilment: { delivery: 'yes', pickup: 'no', deliveryRadiusKm: '45' },
      prepMinutes: '25',
      status: 'Live',
    };
    assert.deepEqual(valueOf(validateStore(typed)), {
      ...KESTREL,
      // The order ops chose, each category once.
      categoryIds: ['outdoors', 'wood', 'adhesives'],
      email: null,
      // An existing store keeps its history: a past closure is fine here.
      closures: ['2025-12-24', '2026-11-27'],
      fulfilment: { delivery: true, pickup: false, deliveryRadiusKm: 45 },
    });
  });

  it('holds the delivery radius to 1–60 km', () => {
    const radius = (deliveryRadiusKm: unknown) =>
      validateStore({ ...KESTREL, fulfilment: { delivery: true, pickup: true, deliveryRadiusKm } });
    assert.equal(radius(1).ok, true);
    assert.equal(radius(60).ok, true);
    assert.equal(radius(12.5).ok, true);
    assert.equal(messageOf(radius(0.9), 'fulfilment'), 'Set a delivery radius of 1 to 60 km.');
    assert.equal(messageOf(radius(60.1), 'fulfilment'), 'Set a delivery radius of 1 to 60 km.');
    assert.equal(messageOf(radius(undefined), 'fulfilment'), 'Set a delivery radius of 1 to 60 km.');
    assert.equal(
      messageOf(
        validateStore({ ...KESTREL, fulfilment: { delivery: true, deliveryRadiusKm: 45 } }),
        'fulfilment',
      ),
      'Choose whether the store delivers and whether it offers pickup.',
    );
  });

  it('wants a full Ontario address and a pin in the service area', () => {
    const address = (change: Record<string, unknown>) =>
      validateStore({ ...KESTREL, address: { ...KESTREL.address, ...change } });
    assert.equal(messageOf(address({ postalCode: null }), 'address'), 'Enter the postal code, like M9W 5L4.');
    assert.equal(
      messageOf(address({ postalCode: 'H2X 1Y4' }), 'address'),
      'Enter an Ontario postal code: it starts with K, L, M, N or P.',
    );
    assert.equal(
      messageOf(address({ line1: 'x' }), 'address'),
      'Enter the street address or the lot, in 3 to 160 characters.',
    );
    assert.equal(messageOf(address({ province: 'BC' }), 'address'), 'InstaSupply delivers in Ontario only.');
    assert.deepEqual(errorKeys(validateStore({ ...KESTREL, address: 'Dixon Rd' })), ['address']);
    // Latitude and longitude typed the wrong way round.
    assert.deepEqual(errorKeys(validateStore({ ...KESTREL, location: { lat: -79.5752, lng: 43.6966 } })), [
      'location',
    ]);
  });

  it('refuses what is not in the lists', () => {
    assert.deepEqual(errorKeys(validateStore({ ...KESTREL, specialty: 'bakery' })), ['specialty']);
    assert.deepEqual(errorKeys(validateStore({ ...KESTREL, categoryIds: ['wood', 'fruits'] })), [
      'categoryIds',
    ]);
    assert.deepEqual(errorKeys(validateStore({ ...KESTREL, categoryIds: 'wood' })), ['categoryIds']);
    assert.deepEqual(errorKeys(validateStore({ ...KESTREL, status: 'paused' })), ['status']);
    assert.deepEqual(errorKeys(validateStore({ ...KESTREL, marketId: 'gva' })), ['marketId']);
    assert.deepEqual(errorKeys(validateStore({ ...KESTREL, cityId: 'hamilton' })), ['cityId']);
    assert.deepEqual(errorKeys(validateStore({ ...KESTREL, name: 'K' })), ['name']);
    assert.deepEqual(errorKeys(validateStore({ ...KESTREL, name: 'K'.repeat(81) })), ['name']);
    assert.deepEqual(
      errorKeys(validateStore({ ...KESTREL, photoUrl: 'storePhotos/kestrel-lumber/front.jpg' })),
      ['photoUrl'],
    );
    assert.deepEqual(errorKeys(validateStore({ ...KESTREL, closures: null })), ['closures']);
    assert.deepEqual(errorKeys(validateStore({ ...KESTREL, prepMinutes: 4, sameDayCutoff: '25:00' })), [
      'prepMinutes',
      'sameDayCutoff',
    ]);
    assert.equal(isValidStore({ ...KESTREL, status: 'paused' }), false);
    assert.equal(isValidStore(null), false);
  });

  it('marks every field of an empty wizard', () => {
    assert.deepEqual(errorKeys(validateStore({})), [
      'acceptingOrders',
      'address',
      'areaLabel',
      'categoryIds',
      'cityId',
      'closures',
      'fulfilment',
      'hours',
      'location',
      'marketId',
      'name',
      'phone',
      'prepMinutes',
      'sameDayCutoff',
      'specialty',
      'status',
    ]);
  });
});

// ---------- drivers (§5.4 registerDriver) ----------

describe('validateDriverVehicle', () => {
  it('accepts the seed vehicles', () => {
    assert.deepEqual(valueOf(validateDriverVehicle(MARCO_F150, TODAY)), MARCO_F150);
    const transit = {
      type: 'cargo_van',
      make: 'Ford',
      model: 'Transit 250',
      year: 2022,
      plate: 'DMRT 538',
      colour: 'white',
      boxLengthFt: null,
      payloadKg: null,
      extras: [],
    };
    assert.deepEqual(valueOf(validateDriverVehicle(transit, TODAY)), transit);
    const hino = {
      type: 'box_truck',
      make: 'Hino',
      model: '195',
      year: 2020,
      plate: 'AM 52038',
      colour: null,
      boxLengthFt: null,
      payloadKg: 3400,
      extras: ['liftgate'],
    };
    assert.deepEqual(valueOf(validateDriverVehicle(hino, TODAY)), hino);
  });

  it('cleans up what a driver typed', () => {
    const typed = {
      type: 'SUV',
      make: ' Honda ',
      model: 'CR-V',
      year: '2020',
      plate: ' cnlt  902 ',
      colour: '',
      payloadKg: '',
      extras: null,
    };
    assert.deepEqual(valueOf(validateDriverVehicle(typed, TODAY)), {
      type: 'suv',
      make: 'Honda',
      model: 'CR-V',
      year: 2020,
      plate: 'CNLT 902',
      colour: null,
      boxLengthFt: null,
      payloadKg: null,
      extras: [],
    });
  });

  it('takes a model year from 1995 to next year', () => {
    const year = (value: unknown, today = TODAY) =>
      validateDriverVehicle({ ...MARCO_F150, year: value }, today);
    assert.equal(year(1995).ok, true);
    assert.equal(year(2027).ok, true);
    assert.equal(messageOf(year(1994), 'year'), 'Enter the model year, from 1995 to 2027.');
    assert.equal(messageOf(year(2028), 'year'), 'Enter the model year, from 1995 to 2027.');
    assert.deepEqual(errorKeys(year(2021.5)), ['year']);
    assert.deepEqual(errorKeys(year('new')), ['year']);
    // On New Year's Day the following year's models become valid.
    assert.equal(year(2028, '2026-12-31').ok, false);
    assert.equal(year(2028, '2027-01-01').ok, true);
  });

  it('takes a plate of 2 to 10 letters and numbers', () => {
    const plate = (value: unknown) => validateDriverVehicle({ ...MARCO_F150, plate: value }, TODAY);
    assert.equal(valueOf(plate('ab')).plate, 'AB');
    assert.equal(valueOf(plate('AK 41927')).plate, 'AK 41927');
    assert.equal(valueOf(plate('ABCDE12345')).plate, 'ABCDE12345');
    assert.equal(valueOf(plate('abc-123')).plate, 'ABC-123');
    assert.deepEqual(errorKeys(plate('A')), ['plate']);
    assert.deepEqual(errorKeys(plate('ABCDE123456')), ['plate']);
    assert.deepEqual(errorKeys(plate('AB#12')), ['plate']);
    assert.deepEqual(errorKeys(plate('')), ['plate']);
    assert.deepEqual(errorKeys(plate(214)), ['plate']);
  });

  it('wants a box length for a pickup, and for a pickup only', () => {
    const box = (type: string, boxLengthFt: unknown) =>
      validateDriverVehicle({ ...MARCO_F150, type, boxLengthFt }, TODAY);
    for (const feet of [5.5, 6.5, 8]) assert.equal(valueOf(box('pickup', feet)).boxLengthFt, feet);
    assert.equal(valueOf(box('pickup', '6.5')).boxLengthFt, 6.5);
    assert.equal(
      messageOf(box('pickup', null), 'boxLengthFt'),
      'Choose the box length of the pickup: 5.5, 6.5 or 8 ft.',
    );
    assert.deepEqual(errorKeys(box('pickup', 7)), ['boxLengthFt']);
    assert.deepEqual(errorKeys(box('pickup', 6)), ['boxLengthFt']);
    // The form kept the pickup's box when the driver switched to an SUV: it is cleared, not reported.
    assert.equal(valueOf(box('suv', 6.5)).boxLengthFt, null);
    assert.equal(valueOf(box('flatbed', 'long')).boxLengthFt, null);
    assert.equal(valueOf(box('dump_truck', null)).boxLengthFt, null);
  });

  it('checks the payload and the extras', () => {
    const changed = (change: Record<string, unknown>) =>
      validateDriverVehicle({ ...MARCO_F150, ...change }, TODAY);
    assert.equal(valueOf(changed({ payloadKg: 680 })).payloadKg, 680);
    assert.equal(valueOf(changed({ payloadKg: '907.2' })).payloadKg, 907.2);
    assert.deepEqual(errorKeys(changed({ payloadKg: 0 })), ['payloadKg']);
    assert.deepEqual(errorKeys(changed({ payloadKg: -5 })), ['payloadKg']);
    assert.deepEqual(errorKeys(changed({ payloadKg: 'a lot' })), ['payloadKg']);
    // Each extra once.
    assert.deepEqual(valueOf(changed({ extras: ['liftgate', 'trailer', 'liftgate'] })).extras, [
      'liftgate',
      'trailer',
    ]);
    assert.deepEqual(
      valueOf(changed({ extras: ['trailer', 'roof_rack', 'liftgate', 'ramps_dolly'] })).extras,
      ['trailer', 'roof_rack', 'liftgate', 'ramps_dolly'],
    );
    assert.deepEqual(errorKeys(changed({ extras: ['winch'] })), ['extras']);
    assert.deepEqual(errorKeys(changed({ extras: 'trailer' })), ['extras']);
    assert.deepEqual(errorKeys(changed({ type: 'bike' })), ['type']);
    assert.deepEqual(errorKeys(changed({ make: '', model: 'm'.repeat(41), colour: 'c'.repeat(31) })), [
      'colour',
      'make',
      'model',
    ]);
  });

  it('marks every required field of an empty form', () => {
    // The box length is only asked for once the type is a pickup.
    assert.deepEqual(errorKeys(validateDriverVehicle({}, TODAY)), ['make', 'model', 'plate', 'type', 'year']);
    assert.throws(() => validateDriverVehicle(MARCO_F150, '19 Nov 2026'), RangeError);
  });
});

// ---------- material lists (§5.5.6) ----------

describe('validateMaterialList', () => {
  it('accepts the seed list as it is', () => {
    assert.deepEqual(valueOf(validateMaterialList(FRAMING_LIST)), FRAMING_LIST);
  });

  it('cleans up what the customer typed and drops the empty rows', () => {
    const typed = {
      lines: [
        { text: '  2x4x8   SPF studs ', quantity: '60' },
        { text: '', quantity: null },
        { text: 'Joint compound 17 L', quantity: '' },
        {},
      ],
      neededBy: { kind: 'ASAP', date: '2026-11-27' },
      fulfilment: 'Pickup',
      contact: { preferred: 'whatsapp', phone: '416 555 0110', email: ' Dana@Whitfield.test ' },
      notes: ' Call before you come. ',
    };
    assert.deepEqual(valueOf(validateMaterialList(typed)), {
      lines: [
        { text: '2x4x8 SPF studs', quantity: 60 },
        { text: 'Joint compound 17 L', quantity: null },
      ],
      attachments: [],
      // Only "pick a date" carries a date.
      neededBy: { kind: 'asap', date: null },
      fulfilment: 'pickup',
      jobsiteId: null,
      contact: { preferred: 'whatsapp', phone: '+14165550110', email: 'dana@whitfield.test' },
      notes: 'Call before you come.',
    });
  });

  it('takes up to 60 lines of 2–120 characters with a quantity of 1–99 999 or none', () => {
    const lines = (list: unknown) => validateMaterialList({ ...FRAMING_LIST, lines: list });
    const many = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ text: `Item ${index + 1}`, quantity: 1 }));
    assert.equal(valueOf(lines(many(60))).lines.length, 60);
    assert.equal(
      messageOf(lines(many(61)), 'lines'),
      'A list can have up to 60 items. Attach a file for a longer one.',
    );
    assert.equal(lines([{ text: 'xx', quantity: 1 }]).ok, true);
    assert.equal(lines([{ text: 'x'.repeat(120), quantity: 99_999 }]).ok, true);
    assert.equal(
      messageOf(
        lines([
          { text: 'Studs', quantity: 5 },
          { text: 'x', quantity: 1 },
        ]),
        'lines',
      ),
      'Item 2: describe it in 2 to 120 characters.',
    );
    assert.equal(
      messageOf(lines([{ text: 'x'.repeat(121), quantity: 1 }]), 'lines'),
      'Item 1: describe it in 2 to 120 characters.',
    );
    for (const quantity of [0, 100_000, 2.5, -3, 'many']) {
      assert.equal(
        messageOf(lines([{ text: 'Studs', quantity }]), 'lines'),
        'Item 1: the quantity must be a whole number from 1 to 99,999, or empty.',
        String(quantity),
      );
    }
    // A quantity without a description is a mistake, not an empty row.
    assert.equal(
      messageOf(lines([{ text: '', quantity: 4 }]), 'lines'),
      'Item 1: describe it in 2 to 120 characters.',
    );
    assert.deepEqual(errorKeys(lines('2x4x8 studs')), ['lines']);
  });

  it('takes up to 5 files under 15 MB of the types the Storage rules allow', () => {
    const [file] = FRAMING_LIST.attachments;
    const files = (list: unknown) => validateMaterialList({ ...FRAMING_LIST, attachments: list });
    assert.equal(valueOf(files(Array.from({ length: 5 }, () => file))).attachments.length, 5);
    assert.equal(
      messageOf(files(Array.from({ length: 6 }, () => file)), 'attachments'),
      'Attach up to 5 files.',
    );
    assert.equal(files([{ ...file, sizeBytes: 15 * 1024 * 1024 - 1 }]).ok, true);
    assert.equal(
      messageOf(files([{ ...file, sizeBytes: 15 * 1024 * 1024 }]), 'attachments'),
      'File 1: it must be smaller than 15 MB.',
    );
    assert.equal(
      messageOf(files([{ ...file, sizeBytes: 0 }]), 'attachments'),
      'File 1: it must be smaller than 15 MB.',
    );
    for (const contentType of [
      'image/jpeg',
      'image/heic',
      'application/pdf',
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ]) {
      assert.equal(files([{ ...file, contentType }]).ok, true, contentType);
    }
    for (const contentType of ['application/zip', 'text/html', 'video/mp4', 'application/pdfx', '']) {
      assert.equal(
        messageOf(files([file, { ...file, contentType }]), 'attachments'),
        'File 2: use a photo, a PDF or a spreadsheet.',
        contentType,
      );
    }
    assert.equal(
      messageOf(files([{ ...file, path: 'issuePhotos/abc/framing-list.png' }]), 'attachments'),
      'File 1: upload it again.',
    );
    assert.equal(
      messageOf(files([{ ...file, path: 'quoteUploads/uid-dana/framing-list.png' }]), 'attachments'),
      'File 1: upload it again.',
    );
    // With the caller's uid and the request id, a file must be in that request's folder (§5.5.6):
    // another customer's upload, or one made for another request, is refused.
    const owner = { uid: 'uid-dana', requestId: '4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f' };
    assert.equal(validateMaterialList(FRAMING_LIST, owner).ok, true);
    for (const path of [
      'quoteUploads/OTHER_UID/4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f/plan.pdf',
      'quoteUploads/uid-dana/0a1b2c3d-5a6b-4c7d-8e9f-4f1c2d3e4e5f/plan.pdf',
      'quoteUploads/uid-dana-2/4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f/plan.pdf',
    ]) {
      assert.equal(
        messageOf(
          validateMaterialList({ ...FRAMING_LIST, attachments: [{ ...file, path }] }, owner),
          'attachments',
        ),
        'File 1: upload it again.',
        path,
      );
    }
    assert.equal(
      messageOf(files([{ ...file, name: '' }]), 'attachments'),
      'File 1: its name can have up to 200 characters.',
    );
    assert.deepEqual(errorKeys(files('framing-list.png')), ['attachments']);
  });

  it('needs at least one line or one file', () => {
    const empty = validateMaterialList({
      ...FRAMING_LIST,
      lines: [{ text: ' ', quantity: null }],
      attachments: [],
    });
    assert.deepEqual(errorKeys(empty), ['form']);
    assert.equal(messageOf(empty, 'form'), 'Add at least one item, or attach your list.');
    // A photo of the list is enough, and so is one typed line.
    assert.equal(validateMaterialList({ ...FRAMING_LIST, lines: [] }).ok, true);
    assert.equal(validateMaterialList({ ...FRAMING_LIST, attachments: [] }).ok, true);
    // The other mistakes are still reported next to it.
    assert.deepEqual(errorKeys(validateMaterialList({ fulfilment: 'pickup' })), [
      'contact',
      'form',
      'neededBy',
    ]);
  });

  it('wants a date only for "pick a date"', () => {
    const needed = (neededBy: unknown) => validateMaterialList({ ...FRAMING_LIST, neededBy });
    assert.deepEqual(valueOf(needed({ kind: 'date', date: '2026-11-27' })).neededBy, {
      kind: 'date',
      date: '2026-11-27',
    });
    assert.equal(
      messageOf(needed({ kind: 'date', date: null }), 'neededBy'),
      'Pick the date you need the materials by.',
    );
    assert.equal(
      messageOf(needed({ kind: 'date', date: '2026-11-31' }), 'neededBy'),
      'Pick the date you need the materials by.',
    );
    assert.equal(
      messageOf(needed({ kind: 'date', date: 'Friday' }), 'neededBy'),
      'Pick the date you need the materials by.',
    );
    assert.deepEqual(valueOf(needed({ kind: 'this_week', date: '2026-11-27' })).neededBy, {
      kind: 'this_week',
      date: null,
    });
    assert.deepEqual(errorKeys(needed({ kind: 'someday' })), ['neededBy']);
    assert.deepEqual(errorKeys(needed(null)), ['neededBy']);
  });

  it('needs a jobsite for delivery, not for pickup', () => {
    assert.equal(
      messageOf(validateMaterialList({ ...FRAMING_LIST, jobsiteId: null }), 'jobsiteId'),
      'Choose the jobsite to deliver to.',
    );
    assert.equal(
      messageOf(validateMaterialList({ ...FRAMING_LIST, jobsiteId: '  ' }), 'jobsiteId'),
      'Choose the jobsite to deliver to.',
    );
    assert.equal(
      valueOf(validateMaterialList({ ...FRAMING_LIST, fulfilment: 'pickup', jobsiteId: null })).jobsiteId,
      null,
    );
    assert.equal(
      valueOf(validateMaterialList({ ...FRAMING_LIST, fulfilment: 'pickup' })).jobsiteId,
      'jobsite-junction',
    );
    assert.deepEqual(
      errorKeys(validateMaterialList({ ...FRAMING_LIST, jobsiteId: 'users/dana/jobsites/x' })),
      ['jobsiteId'],
    );
    assert.deepEqual(errorKeys(validateMaterialList({ ...FRAMING_LIST, fulfilment: 'courier' })), [
      'fulfilment',
    ]);
  });

  it('needs a phone to call, or an email when email is preferred', () => {
    const contact = (value: unknown) => validateMaterialList({ ...FRAMING_LIST, contact: value });
    assert.equal(
      messageOf(contact({ preferred: 'call', phone: null, email: 'dana@whitfield.test' }), 'contact'),
      'Enter the phone number we should reach you at.',
    );
    assert.equal(
      messageOf(contact({ preferred: 'whatsapp', phone: '', email: null }), 'contact'),
      'Enter the phone number we should reach you at.',
    );
    assert.equal(
      messageOf(contact({ preferred: 'email', phone: '+14165550110', email: null }), 'contact'),
      'Enter the email address we should send the quote to.',
    );
    assert.deepEqual(
      valueOf(contact({ preferred: 'email', phone: null, email: 'Dana@Whitfield.test' })).contact,
      {
        preferred: 'email',
        phone: null,
        email: 'dana@whitfield.test',
      },
    );
    assert.equal(
      messageOf(contact({ preferred: 'call', phone: '+442079460958', email: null }), 'contact'),
      'Enter a Canadian or US phone number, like (416) 555-0110.',
    );
    assert.equal(
      messageOf(contact({ preferred: 'email', phone: null, email: 'dana@' }), 'contact'),
      'Enter a valid email address.',
    );
    assert.equal(
      messageOf(contact({ preferred: 'fax', phone: '+14165550110', email: null }), 'contact'),
      'Choose how we should reach you: call, WhatsApp or email.',
    );
    assert.deepEqual(errorKeys(validateMaterialList({ ...FRAMING_LIST, notes: 'n'.repeat(1001) })), [
      'notes',
    ]);
    assert.equal(validateMaterialList({ ...FRAMING_LIST, notes: 'n'.repeat(1000) }).ok, true);
  });
});

// ---------- issues (§5.5.7) ----------

describe('validateIssueReport', () => {
  it('accepts the seed report as it is', () => {
    assert.deepEqual(valueOf(validateIssueReport(CRACKED_SHEETS, BLUESTONE_ORDER)), CRACKED_SHEETS);
  });

  it('takes lines of this store order, each once, up to what was supplied', () => {
    const lines = (list: unknown) => validateIssueReport({ ...CRACKED_SHEETS, lines: list }, BLUESTONE_ORDER);
    assert.equal(lines([{ lineId: 'L1', quantity: 6 }]).ok, true);
    assert.equal(
      lines([
        { lineId: 'L1', quantity: '6' },
        { lineId: 'L2', quantity: 1 },
      ]).ok,
      true,
    );
    assert.equal(
      messageOf(lines([{ lineId: 'L1', quantity: 7 }]), 'lines'),
      'Drywall 1/2 in regular, 4×8: choose a quantity from 1 to 6.',
    );
    assert.equal(
      messageOf(lines([{ lineId: 'L1', quantity: 0 }]), 'lines'),
      'Drywall 1/2 in regular, 4×8: choose a quantity from 1 to 6.',
    );
    assert.equal(
      messageOf(lines([{ lineId: 'L2', quantity: 2 }]), 'lines'),
      'All-purpose joint compound, 17 L: the quantity can only be 1.',
    );
    // 20 of 24 corner beads were supplied and charged: the other 4 cannot be reported.
    assert.equal(lines([{ lineId: 'L3', quantity: 20 }]).ok, true);
    assert.equal(
      messageOf(lines([{ lineId: 'L3', quantity: 21 }]), 'lines'),
      'Metal corner bead, 8 ft: choose a quantity from 1 to 20.',
    );
    assert.equal(
      messageOf(lines([{ lineId: 'L4', quantity: 1 }]), 'lines'),
      'Paper drywall tape, 500 ft was not supplied, so you were not charged for it.',
    );
    assert.equal(messageOf(lines([{ lineId: 'L9', quantity: 1 }]), 'lines'), 'Choose items from this order.');
    assert.equal(
      messageOf(
        lines([
          { lineId: 'L1', quantity: 1 },
          { lineId: 'L1', quantity: 2 },
        ]),
        'lines',
      ),
      'List each item once.',
    );
    assert.equal(
      messageOf(lines([{ lineId: 'L1', quantity: 1.5 }]), 'lines'),
      'Drywall 1/2 in regular, 4×8: choose a quantity from 1 to 6.',
    );
    assert.deepEqual(errorKeys(lines('L1')), ['lines']);
  });

  it('leaves out the units earlier issues already refunded (§3.7: a unit is refunded once)', () => {
    const report = (list: unknown, refunded: { lineId: string; quantity: number }[]) =>
      validateIssueReport({ ...CRACKED_SHEETS, lines: list }, BLUESTONE_ORDER, undefined, refunded);
    // V5 refunded 2 of the 6 sheets: 4 are left to report.
    const v5 = [{ lineId: 'L1', quantity: 2 }];
    assert.equal(report([{ lineId: 'L1', quantity: 4 }], v5).ok, true);
    assert.equal(
      messageOf(report([{ lineId: 'L1', quantity: 5 }], v5), 'lines'),
      'Drywall 1/2 in regular, 4×8: choose a quantity from 1 to 4.',
    );
    // Two earlier refunds of the same line add up: 2 + 3, 1 left.
    assert.equal(
      messageOf(report([{ lineId: 'L1', quantity: 2 }], [...v5, { lineId: 'L1', quantity: 3 }]), 'lines'),
      'Drywall 1/2 in regular, 4×8: the quantity can only be 1.',
    );
    assert.equal(
      messageOf(report([{ lineId: 'L1', quantity: 1 }], [{ lineId: 'L1', quantity: 6 }]), 'lines'),
      'Drywall 1/2 in regular, 4×8 was already refunded.',
    );
    // Another line is untouched, and no refunds is the plain rule.
    assert.equal(report([{ lineId: 'L2', quantity: 1 }], [{ lineId: 'L1', quantity: 6 }]).ok, true);
    assert.equal(report([{ lineId: 'L1', quantity: 6 }], []).ok, true);
  });

  it('takes a description of 10 to 1 000 characters', () => {
    const described = (description: unknown) =>
      validateIssueReport({ ...CRACKED_SHEETS, description }, BLUESTONE_ORDER);
    assert.equal(described('x'.repeat(10)).ok, true);
    assert.equal(described('x'.repeat(1000)).ok, true);
    assert.deepEqual(errorKeys(described('x'.repeat(9))), ['description']);
    assert.deepEqual(errorKeys(described('x'.repeat(1001))), ['description']);
    // White space around the text does not count.
    assert.deepEqual(errorKeys(described(`   ${'x'.repeat(9)}   `)), ['description']);
    assert.equal(
      valueOf(described(' Two sheets cracked.\nOne corner crushed. ')).description,
      'Two sheets cracked.\nOne corner crushed.',
    );
  });

  it('needs a photo of a damaged or a wrong item, and takes up to 6', () => {
    const report = (type: string, photoPaths: unknown) =>
      validateIssueReport({ ...CRACKED_SHEETS, type, photoPaths }, BLUESTONE_ORDER);
    const photo = (index: number) => `issuePhotos/9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d/photo-${index}.jpg`;
    const photos = (count: number) => Array.from({ length: count }, (_, index) => photo(index));
    for (const type of ['damaged', 'wrong_item']) {
      assert.equal(
        messageOf(report(type, []), 'photoPaths'),
        'Add at least one photo of the damaged or wrong item.',
        type,
      );
      assert.equal(report(type, photos(1)).ok, true, type);
    }
    for (const type of ['missing_item', 'short_quantity', 'late', 'other']) {
      assert.deepEqual(valueOf(report(type, [])).photoPaths, [], type);
      assert.deepEqual(valueOf(report(type, undefined)).photoPaths, [], type);
    }
    assert.equal(valueOf(report('damaged', photos(6))).photoPaths.length, 6);
    assert.equal(messageOf(report('damaged', photos(7)), 'photoPaths'), 'Add up to 6 photos.');
    // The same photo twice is one photo.
    assert.deepEqual(valueOf(report('late', [photo(1), photo(1)])).photoPaths, [photo(1)]);
    assert.deepEqual(errorKeys(report('late', ['proofs/abc/photo.jpg'])), ['photoPaths']);
    assert.deepEqual(errorKeys(report('late', ['issuePhotos/photo.jpg'])), ['photoPaths']);
    assert.deepEqual(errorKeys(report('late', [42])), ['photoPaths']);
    assert.deepEqual(errorKeys(report('late', 'photo.jpg')), ['photoPaths']);
  });

  it("with the issue id, takes photos only from that issue's folder (§5.5.7)", () => {
    const issueId = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';
    assert.equal(validateIssueReport(CRACKED_SHEETS, BLUESTONE_ORDER, issueId).ok, true);
    const elsewhere = { ...CRACKED_SHEETS, photoPaths: ['issuePhotos/SOMEONE-ELSES-ISSUE/a.jpg'] };
    assert.deepEqual(errorKeys(validateIssueReport(elsewhere, BLUESTONE_ORDER, issueId)), ['photoPaths']);
    // Without the id only the shape is checked (a form that has not made the id yet).
    assert.equal(validateIssueReport(elsewhere, BLUESTONE_ORDER).ok, true);
  });

  it('refuses a type or a resolution that is not in the lists', () => {
    assert.deepEqual(
      errorKeys(validateIssueReport({ ...CRACKED_SHEETS, type: 'too_expensive' }, BLUESTONE_ORDER)),
      ['type'],
    );
    assert.deepEqual(
      errorKeys(
        validateIssueReport({ ...CRACKED_SHEETS, preferredResolution: 'store_credit' }, BLUESTONE_ORDER),
      ),
      ['preferredResolution'],
    );
    assert.deepEqual(errorKeys(validateIssueReport({}, BLUESTONE_ORDER)), [
      'description',
      'preferredResolution',
      'type',
    ]);
  });
});

// ---------- untrusted input ----------

describe('validators and untrusted input', () => {
  it('never throw, whatever they are given', () => {
    for (const junk of JUNK) {
      assert.equal(validateJobsite(junk).ok, false);
      assert.equal(validateProduct(junk).ok, false);
      assert.equal(validateStore(junk).ok, false);
      assert.equal(isValidStore(junk), false);
      assert.equal(validateDriverVehicle(junk, TODAY).ok, false);
      assert.equal(validateMaterialList(junk).ok, false);
      assert.equal(validateIssueReport(junk, BLUESTONE_ORDER).ok, false);
      // A change request with nothing the contract knows changes nothing; it is not an error.
      assert.equal(typeof validateStoreProfile(junk, TODAY).ok, 'boolean');
    }
  });

  it('do not change what they are given', () => {
    const jobsite = JSON.parse(JSON.stringify({ ...LESLIEVILLE, label: '  padded  ' })) as Record<
      string,
      unknown
    >;
    const product = JSON.parse(
      JSON.stringify({ ...KESTREL_STUD, dimsCm: { l: '243.84', w: 9, h: 4 } }),
    ) as Record<string, unknown>;
    const store = JSON.parse(
      JSON.stringify({ ...KESTREL, closures: ['2026-12-24', '2026-11-27'] }),
    ) as Record<string, unknown>;
    const list = JSON.parse(JSON.stringify(FRAMING_LIST)) as Record<string, unknown>;
    const before = JSON.stringify([jobsite, product, store, list]);
    validateJobsite(jobsite);
    validateProduct(product);
    validateStore(store);
    validateStoreProfile(store, TODAY);
    validateMaterialList(list);
    assert.equal(JSON.stringify([jobsite, product, store, list]), before);
  });
});
