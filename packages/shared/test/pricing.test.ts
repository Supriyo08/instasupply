/**
 * `priceCheckout` (§3.4): the worked examples V1–V9 of §3.11, built from the seed stores, jobsites and
 * products of §11.2–§11.4, the thresholds, the promo rules, every error code, quotes, replacements,
 * the letters and the allocation order, and a property test on 1 000 seeded random carts.
 *
 * Every expected number is written out from the spec (or worked out by hand in a comment), never
 * taken from the code under test.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PROMOS,
  driverOffer,
  percentBps,
  priceCheckout,
  settleStoreOrder,
  type Amounts,
  type CheckoutInput,
  type LatLng,
  type PricedCheckout,
  type PricedStore,
  type PricingErrorCode,
  type PricingLine,
  type PricingStoreInput,
  type Receiving,
  type SellUnit,
  type VehicleClass,
} from '../src';

// ---------- seed data (§11.2–§11.4) ----------

type StoreId =
  | 'kestrel-lumber'
  | 'grainline-building'
  | 'bluestone-drywall'
  | 'voltway-electrical'
  | 'copperline-plumbing'
  | 'boltbin-hardware'
  | 'glassmoor-glass'
  | 'slatebridge-masonry';

/** Name, pin and delivery radius of the live seed stores (§11.3). */
const STORES: Record<StoreId, { name: string; location: LatLng; radiusKm: number }> = {
  'kestrel-lumber': { name: 'Kestrel Lumber Yard', location: { lat: 43.6966, lng: -79.5752 }, radiusKm: 45 },
  'grainline-building': {
    name: 'Grainline Building Centre',
    location: { lat: 43.7655, lng: -79.2829 },
    radiusKm: 40,
  },
  'bluestone-drywall': {
    name: 'Bluestone Drywall & Paint',
    location: { lat: 43.7709, lng: -79.4912 },
    radiusKm: 40,
  },
  'voltway-electrical': {
    name: 'Voltway Electrical Supply',
    location: { lat: 43.6262, lng: -79.6143 },
    radiusKm: 40,
  },
  'copperline-plumbing': {
    name: 'Copperline Plumbing Depot',
    location: { lat: 43.801, lng: -79.499 },
    radiusKm: 40,
  },
  'boltbin-hardware': {
    name: 'Boltbin Fasteners & Hardware',
    location: { lat: 43.7262, lng: -79.6885 },
    radiusKm: 45,
  },
  'glassmoor-glass': {
    name: 'Glassmoor Glass & Mirror',
    location: { lat: 43.7102, lng: -79.3615 },
    radiusKm: 30,
  },
  'slatebridge-masonry': {
    name: 'Slatebridge Masonry & Roofing',
    location: { lat: 43.4441, lng: -79.688 },
    radiusKm: 45,
  },
};
const STORE_IDS = Object.keys(STORES) as StoreId[];

type SiteId = 'leslieville' | 'junction' | 'mimico' | 'danforth';

/** The jobsites of §11.2: pin, receiving and the site's vehicle limit. */
const SITES: Record<
  SiteId,
  { location: LatLng; receiving: Receiving; maxVehicleClass: VehicleClass | null }
> = {
  leslieville: { location: { lat: 43.6648, lng: -79.3405 }, receiving: 'attended', maxVehicleClass: null },
  junction: {
    location: { lat: 43.6655, lng: -79.4636 },
    receiving: 'unattended',
    maxVehicleClass: 'cargo_van',
  },
  mimico: { location: { lat: 43.6163, lng: -79.4955 }, receiving: 'attended', maxVehicleClass: null },
  danforth: { location: { lat: 43.6866, lng: -79.3127 }, receiving: 'attended', maxVehicleClass: null },
};
const SITE_IDS = Object.keys(SITES) as SiteId[];

interface SeedProduct {
  storeId: StoreId;
  name: string;
  unit: SellUnit;
  priceCents: number;
  kg: number;
  dims: readonly [number, number, number];
}

const product = (
  storeId: StoreId,
  name: string,
  unit: SellUnit,
  priceCents: number,
  kg: number,
  dims: readonly [number, number, number],
): SeedProduct => ({ storeId, name, unit, priceCents, kg, dims });

/** The §11.4 products the tests use: SKU → store, name, unit, price, kg, l × w × h cm. */
const PRODUCTS = {
  'KLY-SPF248': product('kestrel-lumber', '2x4x8 SPF stud, kiln-dried', 'each', 479, 4.5, [244, 9, 4]),
  'KLY-PT2612': product('kestrel-lumber', 'Pressure-treated 2x6, 12 ft', 'each', 1898, 14, [366, 14, 4]),
  'KLY-PT448': product('kestrel-lumber', 'Pressure-treated 4x4 post, 8 ft', 'each', 1698, 15, [244, 9, 9]),
  'KLY-OSB716': product('kestrel-lumber', 'OSB sheathing 7/16 in, 4×8', 'sheet', 2298, 23, [244, 122, 1.1]),
  'KLY-IJ916': product('kestrel-lumber', 'I-joist 9-1/2 in, 16 ft', 'each', 6498, 22, [488, 24, 6]),
  'KLY-REBAR': product('kestrel-lumber', 'Rebar 10M, 20 ft', 'length', 1298, 4.8, [610, 1.2, 1.2]),
  'KLY-CONC30': product('kestrel-lumber', 'Concrete mix, 30 kg', 'bag', 948, 30, [60, 40, 12]),
  'GBC-DW12': product(
    'grainline-building',
    'Drywall 1/2 in regular, 4×8',
    'sheet',
    1898,
    25,
    [244, 122, 1.3],
  ),
  'GBC-R20': product('grainline-building', 'Fibreglass batts R20, 15 in', 'bag', 7298, 9, [120, 40, 40]),
  'GBC-XPS2': product('grainline-building', 'XPS rigid foam 2 in, 2×8 ft', 'sheet', 3698, 2.7, [244, 61, 5]),
  'GBC-FOAM': product(
    'grainline-building',
    'Spray foam, low expansion, 340 g',
    'can',
    1198,
    0.45,
    [25, 7, 7],
  ),
  'GBC-RANGE': product('grainline-building', '30 in electric range', 'each', 89998, 68, [120, 76, 76]),
  'BDP-DW12': product('bluestone-drywall', 'Drywall 1/2 in regular, 4×8', 'sheet', 1848, 25, [244, 122, 1.3]),
  'BDP-JC17': product(
    'bluestone-drywall',
    'All-purpose joint compound, 17 L',
    'pail',
    2998,
    28,
    [30, 30, 38],
  ),
  'BDP-PRIME': product('bluestone-drywall', 'Drywall primer-sealer, 3.78 L', 'can', 4498, 5.4, [20, 20, 20]),
  'BDP-PTAPE': product('bluestone-drywall', "Painter's tape, 48 mm × 55 m", 'roll', 898, 0.2, [10, 10, 5]),
  'VES-NMD142': product('voltway-electrical', 'NMD90 14/2 cable, 75 m', 'roll', 11998, 7, [35, 35, 12]),
  'VES-BOX': product('voltway-electrical', 'Single-gang PVC device box', 'each', 148, 0.05, [10, 6, 6]),
  'VES-EMT12': product('voltway-electrical', 'EMT conduit 1/2 in, 10 ft', 'length', 998, 1.2, [305, 2, 2]),
  'CPD-CU34L': product(
    'copperline-plumbing',
    'Copper pipe 3/4 in Type L, 12 ft',
    'length',
    9698,
    2.5,
    [366, 2.2, 2.2],
  ),
  'CPD-BV12': product('copperline-plumbing', 'Brass ball valve 1/2 in, sweat', 'each', 1898, 0.3, [10, 6, 6]),
  'CPD-TOILET': product('copperline-plumbing', 'Two-piece elongated toilet', 'each', 24998, 40, [75, 45, 80]),
  'CPD-WH40': product(
    'copperline-plumbing',
    'Electric water heater, 40 gal',
    'each',
    74998,
    50,
    [150, 55, 55],
  ),
  'BFH-JH28': product('boltbin-hardware', 'Joist hanger 2x8, galvanized', 'each', 279, 0.3, [15, 8, 5]),
  'BFH-DECK': product('boltbin-hardware', 'Deck screws #10 × 2-1/2 in, 5 lb', 'box', 3498, 2.4, [18, 12, 8]),
  'BFH-NAILS': product('boltbin-hardware', 'Framing nails 3-1/4 in, 5 kg', 'box', 4298, 5, [25, 15, 12]),
  'BFH-SCR212': product(
    'boltbin-hardware',
    'Subfloor screws #9 × 2-1/2 in, 5 lb',
    'box',
    3348,
    2.4,
    [18, 12, 8],
  ),
  'BFH-ANCHOR': product(
    'boltbin-hardware',
    'Drywall anchors with screws, 50-pack',
    'pack',
    1298,
    0.4,
    [15, 10, 4],
  ),
  'BFH-BOLTS': product(
    'boltbin-hardware',
    'Hex bolts and nuts 3/8 × 4 in, 25-pack',
    'pack',
    1898,
    1.6,
    [15, 10, 6],
  ),
  'BFH-HINGE': product('boltbin-hardware', 'Door hinges 3-1/2 in, 3-pack', 'pack', 998, 0.6, [12, 10, 4]),
  'BFH-ADH': product('boltbin-hardware', 'Construction adhesive, 300 ml', 'tube', 649, 0.4, [25, 6, 6]),
  'GGM-MIRROR': product('glassmoor-glass', 'Bevelled mirror, 24 × 36 in', 'each', 8998, 9, [91, 61, 3]),
  'GGM-SHOWER': product(
    'glassmoor-glass',
    'Frameless shower door, 30 × 72 in',
    'each',
    44998,
    38,
    [183, 76, 5],
  ),
  'SMR-SHING': product(
    'slatebridge-masonry',
    'Architectural shingles, bundle',
    'bundle',
    4998,
    30,
    [100, 33, 13],
  ),
  'SMR-UNDER': product(
    'slatebridge-masonry',
    'Synthetic underlayment, 10 squares',
    'roll',
    13998,
    12,
    [107, 25, 25],
  ),
  'SMR-BLOCK': product('slatebridge-masonry', 'Concrete block 8 in', 'each', 398, 17, [39, 19, 19]),
} satisfies Record<string, SeedProduct>;

type Sku = keyof typeof PRODUCTS;
const SKUS = Object.keys(PRODUCTS) as Sku[];

/** A cart line of a seed product: SKU, quantity and, for a quote, the quoted unit price. */
type Item = readonly [sku: Sku, quantity: number, quotedCents?: number];

/** A special-order line a quote adds (D16), e.g. the LVL beam of Q-10002. */
interface CustomItem {
  custom: string;
  priceCents: number;
  quantity: number;
  kg: number;
  dims: readonly [number, number, number];
}

function toLine(item: Item | CustomItem, lineId: string): PricingLine {
  if ('custom' in item) {
    return {
      lineId,
      kind: 'custom',
      productId: null,
      name: item.custom,
      unit: 'each',
      size: null,
      unitPriceCents: item.priceCents,
      quantity: item.quantity,
      weightKg: item.kg,
      dimsCm: { l: item.dims[0], w: item.dims[1], h: item.dims[2] },
    };
  }
  const [sku, quantity, quotedCents] = item;
  const seed: SeedProduct = PRODUCTS[sku];
  return {
    lineId,
    kind: 'catalog',
    productId: `${seed.storeId}--${sku.toLowerCase()}`,
    name: seed.name,
    unit: seed.unit,
    size: null,
    unitPriceCents: quotedCents ?? seed.priceCents,
    quantity,
    weightKg: seed.kg,
    dimsCm: { l: seed.dims[0], w: seed.dims[1], h: seed.dims[2] },
  };
}

/** One store of the cart, live, delivering and offering pickup; lines are numbered L1, L2, … */
function cartStore(
  storeId: StoreId,
  items: readonly (Item | CustomItem)[],
  store: Partial<PricingStoreInput['store']> = {},
): PricingStoreInput {
  const seed = STORES[storeId];
  return {
    storeId,
    store: {
      name: seed.name,
      location: seed.location,
      status: 'live',
      acceptingOrders: true,
      fulfilment: { delivery: true, pickup: true, deliveryRadiusKm: seed.radiusKm },
      ...store,
    },
    lines: items.map((item, index) => toLine(item, `L${index + 1}`)),
  };
}

const DANA = { isFirstOrder: false, promoUses: {} };
const FIRST_ORDER = { isFirstOrder: true, promoUses: {} };

/** A delivery checkout to `site` (Leslieville by default) on Thu 2026-11-19, no promo, a repeat customer. */
function checkout(
  stores: PricingStoreInput[],
  options: Partial<Omit<CheckoutInput, 'stores'>> & { site?: SiteId } = {},
): CheckoutInput {
  const { site = 'leslieville', ...rest } = options;
  return {
    fulfilment: 'delivery',
    stores,
    dropoff: { ...SITES[site] },
    unloadHelpStoreIds: [],
    promoCode: null,
    customer: DANA,
    source: 'cart',
    today: '2026-11-19',
    ...rest,
  };
}

/** The six amounts of a store or of the order, in a fixed order for compact assertions. */
const amounts = (value: Amounts): Amounts => ({
  itemsCents: value.itemsCents,
  discountCents: value.discountCents,
  deliveryFeeCents: value.deliveryFeeCents,
  unloadFeeCents: value.unloadFeeCents,
  taxCents: value.taxCents,
  totalCents: value.totalCents,
});

const money = (
  itemsCents: number,
  discountCents: number,
  deliveryFeeCents: number,
  unloadFeeCents: number,
  taxCents: number,
  totalCents: number,
): Amounts => ({ itemsCents, discountCents, deliveryFeeCents, unloadFeeCents, taxCents, totalCents });

function storeOf(result: PricedCheckout, storeId: StoreId): PricedStore {
  const found = result.stores.find((store) => store.storeId === storeId);
  assert.ok(found, `no store ${storeId} in the result`);
  return found;
}

/** The driver offer the checkout freezes for a store (§3.3), from its class, distance and load. */
function offerFor(store: PricedStore): number {
  assert.ok(store.vehicleClass !== null && store.roadTenths !== null);
  return driverOffer(store.vehicleClass, store.roadTenths, store.load).offerCents;
}

const codes = (result: PricedCheckout): PricingErrorCode[] => result.blockers.map((error) => error.code);

// ---------- the carts of the worked examples ----------

/** V1 / V2 (seed scenario A): Bluestone 6 drywall + 1 compound; Kestrel 20 studs + 4 OSB. */
const scenarioA = (): PricingStoreInput[] => [
  cartStore('bluestone-drywall', [
    ['BDP-DW12', 6],
    ['BDP-JC17', 1],
  ]),
  cartStore('kestrel-lumber', [
    ['KLY-SPF248', 20],
    ['KLY-OSB716', 4],
  ]),
];

/** V3 (seed scenario B): Boltbin, Kestrel and Voltway. */
const scenarioB = (): PricingStoreInput[] => [
  cartStore('boltbin-hardware', [
    ['BFH-JH28', 24],
    ['BFH-DECK', 2],
  ]),
  cartStore('kestrel-lumber', [
    ['KLY-SPF248', 24],
    ['KLY-OSB716', 6],
  ]),
  cartStore('voltway-electrical', [
    ['VES-NMD142', 3],
    ['VES-BOX', 20],
  ]),
];

/** Seed scenario E: 20 shingles and 2 underlayment rolls from Slatebridge to Mimico. */
const scenarioE = (): PricingStoreInput[] => [
  cartStore('slatebridge-masonry', [
    ['SMR-SHING', 20],
    ['SMR-UNDER', 2],
  ]),
];

/** Quote Q-10002 (seed scenario G): quoted prices below list, a custom LVL beam, Boltbin at list. */
const quoteQ10002 = (): PricingStoreInput[] => [
  cartStore('kestrel-lumber', [
    ['KLY-PT2612', 30, 1798],
    ['KLY-PT448', 8, 1598],
    {
      custom: 'LVL beam 1-3/4 × 9-1/2 in × 14 ft (special order)',
      priceCents: 18_900,
      quantity: 2,
      kg: 27,
      dims: [427, 24, 5],
    },
  ]),
  cartStore('boltbin-hardware', [['BFH-DECK', 3, 3498]]),
];

// ---------- V1 to V9 ----------

describe('§3.11 worked examples', () => {
  it("V1: Dana's first order, two stores, welcome discount, free delivery, labourer for Kestrel", () => {
    const result = priceCheckout(
      checkout(scenarioA(), { customer: FIRST_ORDER, unloadHelpStoreIds: ['kestrel-lumber'] }),
    );
    const [a, b] = result.stores;
    assert.ok(a && b);
    assert.equal(result.stores.length, 2);
    assert.deepEqual(
      [a.storeId, a.letter, b.storeId, b.letter],
      ['bluestone-drywall', 'A', 'kestrel-lumber', 'B'],
    );

    // Lines and loads.
    assert.deepEqual(
      a.lines.map((line) => [line.lineCents, line.discountCents]),
      [
        [11_088, 675],
        [2_998, 182],
      ],
    );
    assert.deepEqual(
      b.lines.map((line) => [line.lineCents, line.discountCents]),
      [
        [9_580, 583],
        [9_192, 560],
      ],
    );
    assert.deepEqual(
      [a.load.weightKg, a.load.pieces, a.load.longestCm, a.load.hasSheets, a.load.volumeL, a.vehicleClass],
      [178, 7, 244, true, 320, 'pickup'],
    );
    assert.deepEqual(
      [b.load.weightKg, b.load.pieces, b.load.longestCm, b.load.hasSheets, b.load.volumeL, b.vehicleClass],
      [182, 24, 244, true, 368, 'pickup'],
    );

    // Distance and fees: list fee 2 999 + mulDivHalfUp(149, 129, 10) = 4 921; Kestrel 2 999 + 2 384.
    assert.deepEqual([a.roadTenths, a.roadKm, b.roadTenths, b.roadKm], [229, 22.9, 260, 26]);
    assert.deepEqual([a.deliveryFeeListCents, b.deliveryFeeListCents], [4_921, 5_383]);
    assert.deepEqual([a.feeWaiver, b.feeWaiver], ['first_order', 'first_order']);
    // `feeCents` is the labourer charged (step 6 `unloadFeeCents`): Bluestone's labourer is "—" in V1.
    assert.deepEqual(a.unload, { offered: true, required: false, selected: false, feeCents: 0 });
    assert.deepEqual(b.unload, { offered: true, required: false, selected: true, feeCents: 3_500 });
    assert.deepEqual([a.unload.feeCents, b.unload.feeCents], [a.unloadFeeCents, b.unloadFeeCents]);

    assert.deepEqual(amounts(a), money(14_086, 857, 0, 0, 1_720, 14_949));
    assert.deepEqual(amounts(b), money(18_772, 1_143, 0, 3_500, 2_747, 23_876));
    assert.deepEqual(amounts(result), money(32_858, 2_000, 0, 3_500, 4_467, 38_825));

    assert.deepEqual(result.discounts, [
      { kind: 'first_order', code: null, label: '$20 off your first order', cents: 2_000 },
    ]);
    assert.equal(result.promo, null);
    assert.equal(result.freeDelivery, 'first_order');
    assert.equal(result.amountToFreeDeliveryCents, 0);
    assert.equal(result.amountToFirstOrderDiscountCents, 0);
    assert.deepEqual([a.requireCode, b.requireCode], [true, true]);
    assert.deepEqual([result.itemCount, result.lineCount], [31, 4]);
    assert.deepEqual([result.currency, result.taxRateBps], ['CAD', 1300]);
    assert.equal(result.canPlace, true);
    assert.deepEqual(result.blockers, []);

    // Driver offers and commission (§3.3, §3.9): suppliers are paid on full item value.
    assert.deepEqual([offerFor(a), offerFor(b)], [4_200, 4_775]);
    assert.deepEqual([percentBps(a.itemsCents, 1000), percentBps(b.itemsCents, 900)], [1_409, 1_689]);
    assert.deepEqual([a.itemsCents - 1_409, b.itemsCents - 1_689], [12_677, 17_083]);
  });

  it('V2: the same cart for a repeat customer pays the fees and gets the free-delivery meter', () => {
    const result = priceCheckout(checkout(scenarioA(), { unloadHelpStoreIds: ['kestrel-lumber'] }));
    const a = storeOf(result, 'bluestone-drywall');
    const b = storeOf(result, 'kestrel-lumber');
    assert.deepEqual(amounts(a), money(14_086, 0, 4_921, 0, 2_471, 21_478));
    assert.deepEqual(amounts(b), money(18_772, 0, 5_383, 3_500, 3_595, 31_250));
    assert.deepEqual(amounts(result), money(32_858, 0, 10_304, 3_500, 6_066, 52_728));
    assert.deepEqual([a.feeWaiver, b.feeWaiver, result.freeDelivery], [null, null, null]);
    assert.deepEqual(result.discounts, []);
    // "Add $171.42 more for free delivery".
    assert.equal(result.amountToFreeDeliveryCents, 17_142);
    assert.equal(result.amountToFirstOrderDiscountCents, 0);
  });

  it("V3: Dana's live order with BUILD25 over three stores, every fee free_threshold", () => {
    const result = priceCheckout(
      checkout(scenarioB(), { promoCode: 'BUILD25', unloadHelpStoreIds: ['kestrel-lumber'] }),
    );
    const [a, b, c] = result.stores;
    assert.ok(a && b && c);
    assert.deepEqual(
      result.stores.map((store) => [store.letter, store.storeId]),
      [
        ['A', 'boltbin-hardware'],
        ['B', 'kestrel-lumber'],
        ['C', 'voltway-electrical'],
      ],
    );
    assert.deepEqual(
      result.stores.map((store) => [store.load.weightKg, store.load.longestCm, store.vehicleClass]),
      [
        [12, 18, 'car'],
        [246, 244, 'pickup'],
        [22, 35, 'car'],
      ],
    );
    assert.equal(b.load.hasSheets, true);
    assert.equal(b.load.volumeL, 489);
    assert.deepEqual(
      result.stores.map((store) => [store.roadKm, store.deliveryFeeListCents, store.feeWaiver]),
      [
        [38.9, 4_160, 'free_threshold'],
        [26, 5_383, 'free_threshold'],
        [30.4, 3_319, 'free_threshold'],
      ],
    );
    assert.deepEqual(
      result.stores.map((store) => store.lines.map((line) => line.discountCents)),
      [
        [215, 224],
        [369, 442],
        [1_155, 95],
      ],
    );
    assert.deepEqual(amounts(a), money(13_692, 439, 0, 0, 1_723, 14_976));
    assert.deepEqual(amounts(b), money(25_284, 811, 0, 3_500, 3_636, 31_609));
    assert.deepEqual(amounts(c), money(38_954, 1_250, 0, 0, 4_902, 42_606));
    assert.deepEqual(amounts(result), money(77_930, 2_500, 0, 3_500, 10_261, 89_191));
    assert.deepEqual(result.promo, {
      code: 'BUILD25',
      status: 'applied',
      message: 'BUILD25 applied: $25.00 off',
    });
    assert.deepEqual(result.discounts, [
      { kind: 'promo', code: 'BUILD25', label: '$25 off orders of $750+', cents: 2_500 },
    ]);
    assert.equal(result.freeDelivery, 'free_threshold');
    assert.equal(result.amountToFreeDeliveryCents, 0);
    // The labourer is not offered for the two car-sized loads.
    assert.deepEqual(
      result.stores.map((store) => store.unload),
      [
        { offered: false, required: false, selected: false, feeCents: 0 },
        { offered: true, required: false, selected: true, feeCents: 3_500 },
        { offered: false, required: false, selected: false, feeCents: 0 },
      ],
    );
    // 900 + 2 918 = 3 818 → 3 825; 1 600 + 2 600 + 300 + 450 = 4 950; 900 + 2 280 = 3 180 → 3 200.
    assert.deepEqual(result.stores.map(offerFor), [3_825, 4_950, 3_200]);
  });

  it('V3 with CREW5: min_not_met, "Add $220.70 more to use CREW5", no discount', () => {
    const result = priceCheckout(
      checkout(scenarioB(), { promoCode: 'CREW5', unloadHelpStoreIds: ['kestrel-lumber'] }),
    );
    assert.deepEqual(result.promo, {
      code: 'CREW5',
      status: 'min_not_met',
      message: 'Add $220.70 more to use CREW5',
    });
    assert.deepEqual(result.discounts, []);
    // Taxable 13 692, 28 784, 38 954 → HST 1 780, 3 742, 5 064.
    assert.deepEqual(amounts(result), money(77_930, 0, 0, 3_500, 10_586, 92_016));
  });

  it('V4: Boltbin short-ships the joist hangers 24 → 20 (fees locked, $12.21 released)', () => {
    const result = priceCheckout(
      checkout(scenarioB(), { promoCode: 'BUILD25', unloadHelpStoreIds: ['kestrel-lumber'] }),
    );
    const boltbin = storeOf(result, 'boltbin-hardware');
    const fulfilled = [20, 2];
    const current = settleStoreOrder(
      boltbin.lines.map((line, index) => ({ ...line, fulfilledQty: fulfilled[index] ?? line.quantity })),
      boltbin,
    );
    // Items 5 580 + 6 996; discount mulDivHalfUp(215, 20, 24) = 179 + 224 = 403; taxable 12 173.
    assert.deepEqual(current, money(12_576, 403, 0, 0, 1_582, 13_755));
    assert.equal(boltbin.totalCents - current.totalCents, 1_221);
    assert.equal(result.totalCents - boltbin.totalCents + current.totalCents, 87_970);
  });

  it('V6: pickup at Copperline has no fees', () => {
    const result = priceCheckout(
      checkout(
        [
          cartStore('copperline-plumbing', [
            ['CPD-CU34L', 4],
            ['CPD-BV12', 6],
          ]),
        ],
        { fulfilment: 'pickup', dropoff: null, unloadHelpStoreIds: ['copperline-plumbing'] },
      ),
    );
    const [a] = result.stores;
    assert.ok(a);
    assert.deepEqual(amounts(result), money(50_180, 0, 0, 0, 6_523, 56_703));
    assert.deepEqual(amounts(a), money(50_180, 0, 0, 0, 6_523, 56_703));
    assert.deepEqual(
      [a.roadTenths, a.roadKm, a.deliveryFeeListCents, a.feeWaiver, a.requireCode],
      [null, null, 0, null, false],
    );
    assert.deepEqual(a.unload, { offered: false, required: false, selected: false, feeCents: 0 });
    assert.deepEqual([result.freeDelivery, result.amountToFreeDeliveryCents], [null, 0]);
    assert.equal(result.canPlace, true);
  });

  it('V7: best-of rule for Sam (first order): BUILD25 beats the welcome at $760, not at $400', () => {
    // $760.00 at Bluestone: 3 × 18.48 + 19 × 29.98 + 3 × 44.98 = 55.44 + 569.62 + 134.94.
    const big = priceCheckout(
      checkout(
        [
          cartStore('bluestone-drywall', [
            ['BDP-DW12', 3],
            ['BDP-JC17', 19],
            ['BDP-PRIME', 3],
          ]),
        ],
        { site: 'danforth', customer: FIRST_ORDER, promoCode: 'BUILD25' },
      ),
    );
    assert.equal(big.itemsCents, 76_000);
    assert.deepEqual(big.promo, {
      code: 'BUILD25',
      status: 'applied',
      message: 'BUILD25 applied: $25.00 off',
    });
    assert.deepEqual(
      big.discounts.map((discount) => [discount.kind, discount.cents]),
      [['promo', 2_500]],
    );
    assert.equal(big.discountCents, 2_500);
    assert.deepEqual([big.freeDelivery, big.deliveryFeeCents], ['first_order', 0]);

    // $400.00 at Kestrel: 8 × 4.79 + 1 × 16.98 + 15 × 22.98 = 38.32 + 16.98 + 344.70.
    const small = priceCheckout(
      checkout(
        [
          cartStore('kestrel-lumber', [
            ['KLY-SPF248', 8],
            ['KLY-PT448', 1],
            ['KLY-OSB716', 15],
          ]),
        ],
        { site: 'danforth', customer: FIRST_ORDER, promoCode: 'BUILD25' },
      ),
    );
    assert.equal(small.itemsCents, 40_000);
    assert.deepEqual(small.promo, {
      code: 'BUILD25',
      status: 'min_not_met',
      message: 'Add $350.00 more to use BUILD25',
    });
    assert.deepEqual(
      small.discounts.map((discount) => [discount.kind, discount.cents]),
      [['first_order', 2_000]],
    );
    assert.equal(small.discountCents, 2_000);
    assert.equal(small.freeDelivery, 'first_order');
  });

  it('V8: driver offers from the checkout chain (scenarios D, E, quote Q-10002, Glassmoor mirror)', () => {
    // Scenario D: Grainline → Leslieville, cargo van, 16.4 km, 207.0 kg, 10 sheets ≥ 240 cm.
    const d = priceCheckout(
      checkout([
        cartStore('grainline-building', [
          ['GBC-R20', 20],
          ['GBC-XPS2', 10],
        ]),
      ]),
    );
    const grainline = storeOf(d, 'grainline-building');
    assert.deepEqual(
      [grainline.vehicleClass, grainline.roadKm, grainline.load.weightKg, grainline.load.handlingPieces],
      ['cargo_van', 16.4, 207, 10],
    );
    assert.equal(offerFor(grainline), 4_550);
    // Items 182 940 (free delivery), HST 23 782, total 206 722 (§11.5 D).
    assert.deepEqual(amounts(d), money(182_940, 0, 0, 0, 23_782, 206_722));
    assert.equal(grainline.feeWaiver, 'free_threshold');

    // Scenario E: Slatebridge → Mimico, pickup, 33.3 km, 624.0 kg, 20 heavy pieces.
    const e = priceCheckout(checkout(scenarioE(), { site: 'mimico' }));
    const slatebridge = storeOf(e, 'slatebridge-masonry');
    assert.deepEqual(
      [
        slatebridge.vehicleClass,
        slatebridge.roadKm,
        slatebridge.load.weightKg,
        slatebridge.load.handlingPieces,
      ],
      ['pickup', 33.3, 624, 20],
    );
    assert.equal(offerFor(slatebridge), 6_350);
    assert.equal(e.totalCents, 144_590);

    // Q-10002 Kestrel: box truck, 14.9 km, 594.0 kg, 40 handling pieces.
    const q = priceCheckout(checkout(quoteQ10002(), { site: 'mimico', source: 'quote' }));
    const kestrel = storeOf(q, 'kestrel-lumber');
    assert.deepEqual(
      [kestrel.vehicleClass, kestrel.roadKm, kestrel.load.weightKg, kestrel.load.handlingPieces],
      ['box_truck', 14.9, 594, 40],
    );
    assert.equal(offerFor(kestrel), 7_850);

    // Glassmoor mirror (scenario K): car, 7.2 km, 900 + 540 = 1 440 → 1 450.
    const k = priceCheckout(checkout([cartStore('glassmoor-glass', [['GGM-MIRROR', 1]])]));
    const glassmoor = storeOf(k, 'glassmoor-glass');
    assert.deepEqual([glassmoor.vehicleClass, glassmoor.roadKm], ['car', 7.2]);
    assert.equal(offerFor(glassmoor), 1_450);
    // Under 10 km the car base fee covers it all: 8 998 + 1 299, HST 1 339 → the 11 636 authorization.
    assert.deepEqual(amounts(k), money(8_998, 0, 1_299, 0, 1_339, 11_636));
  });

  it('V9: an unattended site makes the labourer mandatory for a heavy load', () => {
    const unattended = priceCheckout(
      checkout(scenarioE(), {
        site: 'mimico',
        dropoff: { ...SITES.mimico, receiving: 'unattended' },
      }),
    );
    const store = storeOf(unattended, 'slatebridge-masonry');
    assert.equal(store.load.heavy, true);
    assert.deepEqual(store.unload, { offered: true, required: true, selected: true, feeCents: 3_500 });
    assert.equal(store.requireCode, false);
    assert.deepEqual(amounts(unattended), money(127_956, 0, 0, 3_500, 17_089, 148_545));

    const attended = priceCheckout(checkout(scenarioE(), { site: 'mimico' }));
    assert.deepEqual(amounts(attended), money(127_956, 0, 0, 0, 16_634, 144_590));
    assert.deepEqual(storeOf(attended, 'slatebridge-masonry').unload, {
      offered: true,
      required: false,
      selected: false,
      feeCents: 0,
    });
  });
});

// ---------- thresholds ----------

describe('thresholds (§3.2, "at least")', () => {
  /** Boltbin carts of exactly $500.00 and $499.99 (car class, 38.9 km to Leslieville, list fee 4 160). */
  const at50000 = (): PricingStoreInput[] => [
    cartStore('boltbin-hardware', [
      ['BFH-JH28', 8],
      ['BFH-NAILS', 9],
      ['BFH-ANCHOR', 7],
    ]),
  ];
  const at49999 = (): PricingStoreInput[] => [
    cartStore('boltbin-hardware', [
      ['BFH-SCR212', 10],
      ['BFH-HINGE', 12],
      ['BFH-ADH', 7],
    ]),
  ];

  it('free delivery at 50 000 but not at 49 999', () => {
    const free = priceCheckout(checkout(at50000()));
    assert.equal(free.itemsCents, 50_000);
    assert.deepEqual(
      [free.freeDelivery, free.deliveryFeeCents, free.amountToFreeDeliveryCents],
      ['free_threshold', 0, 0],
    );
    assert.equal(storeOf(free, 'boltbin-hardware').deliveryFeeListCents, 4_160);

    const paid = priceCheckout(checkout(at49999()));
    assert.equal(paid.itemsCents, 49_999);
    assert.deepEqual(
      [paid.freeDelivery, paid.deliveryFeeCents, paid.amountToFreeDeliveryCents],
      [null, 4_160, 1],
    );
    // 49 999 + 4 160 = 54 159 → HST 7 041 → 61 200.
    assert.deepEqual(amounts(paid), money(49_999, 0, 4_160, 0, 7_041, 61_200));
  });

  it('the threshold looks at items before discounts', () => {
    // A first-order customer is already free; with a promo on a repeat order the items still count whole.
    const withPromo = priceCheckout(checkout(at50000(), { promoCode: 'BUILD25' }));
    assert.equal(withPromo.promo?.status, 'min_not_met');
    assert.equal(withPromo.freeDelivery, 'free_threshold');
  });

  /** Boltbin carts of exactly $250.00 and $249.99. */
  const at25000 = (): PricingStoreInput[] => [
    cartStore('boltbin-hardware', [
      ['BFH-JH28', 4],
      ['BFH-SCR212', 6],
      ['BFH-BOLTS', 2],
    ]),
  ];
  const at24999 = (): PricingStoreInput[] => [
    cartStore('boltbin-hardware', [
      ['BFH-JH28', 9],
      ['BFH-NAILS', 5],
      ['BFH-HINGE', 1],
    ]),
  ];

  it('welcome discount at 25 000 but not at 24 999', () => {
    const welcome = priceCheckout(checkout(at25000(), { customer: FIRST_ORDER }));
    assert.equal(welcome.itemsCents, 25_000);
    assert.deepEqual([welcome.discountCents, welcome.amountToFirstOrderDiscountCents], [2_000, 0]);
    // 25 000 − 2 000 = 23 000 → HST 2 990; first order: delivery free.
    assert.deepEqual(amounts(welcome), money(25_000, 2_000, 0, 0, 2_990, 25_990));

    const none = priceCheckout(checkout(at24999(), { customer: FIRST_ORDER }));
    assert.equal(none.itemsCents, 24_999);
    assert.deepEqual([none.discountCents, none.amountToFirstOrderDiscountCents], [0, 1]);
    assert.deepEqual(none.discounts, []);
    assert.equal(none.freeDelivery, 'first_order');
  });

  it('a repeat customer never gets the welcome discount or its meter', () => {
    const result = priceCheckout(checkout(at25000()));
    assert.deepEqual([result.discountCents, result.amountToFirstOrderDiscountCents], [0, 0]);
    assert.equal(result.amountToFreeDeliveryCents, 25_000);
  });
});

// ---------- promos ----------

/** Adds a test-only promo for the duration of `body`: the two seed promos can never tie the welcome. */
function withPromo(promo: (typeof PROMOS)[string], body: () => void): void {
  PROMOS[promo.code] = promo;
  try {
    body();
  } finally {
    delete PROMOS[promo.code];
  }
}

const testPromo = (code: string, valueCents: number, firstOrderOnly = false): (typeof PROMOS)[string] => ({
  code,
  kind: 'fixed',
  valueCents,
  minItemsCents: 0,
  firstOrderOnly,
  maxUsesPerCustomer: null,
  startsOn: '2026-01-01',
  endsOn: '2026-12-31',
  label: `${valueCents} off`,
});

describe('promo codes (§3.4 step 3)', () => {
  it('welcome vs promo: a tie keeps the welcome (not_better, code not used), one cent more applies the promo', () => {
    withPromo(testPromo('TIE20', 2_000), () => {
      const result = priceCheckout(checkout(scenarioA(), { customer: FIRST_ORDER, promoCode: 'tie20' }));
      assert.equal(result.promo?.code, 'TIE20');
      assert.equal(result.promo?.status, 'not_better');
      assert.deepEqual(
        result.discounts.map((discount) => [discount.kind, discount.code, discount.cents]),
        [['first_order', null, 2_000]],
      );
    });
    withPromo(testPromo('MORE2001', 2_001), () => {
      const result = priceCheckout(checkout(scenarioA(), { customer: FIRST_ORDER, promoCode: 'MORE2001' }));
      assert.equal(result.promo?.status, 'applied');
      assert.deepEqual(
        result.discounts.map((discount) => [discount.kind, discount.code, discount.cents]),
        [['promo', 'MORE2001', 2_001]],
      );
      // Allocated over 14 086 and 18 772: 857.9… and 1 143.1… → 858 and 1 143.
      assert.deepEqual(
        result.stores.map((store) => store.discountCents),
        [858, 1_143],
      );
    });
  });

  it('a promo that the welcome beats on a small first order is not_better', () => {
    withPromo(testPromo('FIVE', 500), () => {
      const result = priceCheckout(checkout(scenarioA(), { customer: FIRST_ORDER, promoCode: 'FIVE' }));
      assert.equal(result.promo?.status, 'not_better');
      assert.equal(result.discountCents, 2_000);
    });
  });

  it('codes are trimmed and upper-cased; an empty field reports nothing', () => {
    const trimmed = priceCheckout(checkout(scenarioB(), { promoCode: '  build25 ' }));
    assert.deepEqual(
      [trimmed.promo?.code, trimmed.promo?.status, trimmed.discountCents],
      ['BUILD25', 'applied', 2_500],
    );
    for (const promoCode of [null, '', '   ']) {
      assert.equal(priceCheckout(checkout(scenarioB(), { promoCode })).promo, null);
    }
  });

  it('invalid: an unknown code, and names of object properties', () => {
    for (const typed of ['NOPE', 'constructor', '__proto__', 'toString']) {
      const result = priceCheckout(checkout(scenarioB(), { promoCode: typed }));
      const code = typed.toUpperCase();
      assert.deepEqual(result.promo, {
        code,
        status: 'invalid',
        message: `${code} isn't a valid promo code`,
      });
      assert.equal(result.discountCents, 0);
    }
  });

  it('expired: outside startsOn..endsOn (both inclusive), or a malformed date', () => {
    const on = (today: string) => priceCheckout(checkout(scenarioB(), { promoCode: 'BUILD25', today })).promo;
    assert.equal(on('2026-11-01')?.status, 'applied');
    assert.equal(on('2027-03-31')?.status, 'applied');
    assert.deepEqual(on('2026-10-31'), {
      code: 'BUILD25',
      status: 'expired',
      message: "BUILD25 can't be used yet",
    });
    assert.deepEqual(on('2027-04-01'), {
      code: 'BUILD25',
      status: 'expired',
      message: 'BUILD25 has expired',
    });
    assert.equal(on('19/11/2026')?.status, 'expired');
    assert.equal(priceCheckout(checkout(scenarioB(), { promoCode: 'BUILD25', today: '' })).discountCents, 0);
  });

  it('first_order_only', () => {
    withPromo(testPromo('HELLO30', 3_000, true), () => {
      const repeat = priceCheckout(checkout(scenarioA(), { promoCode: 'HELLO30' }));
      assert.deepEqual(repeat.promo, {
        code: 'HELLO30',
        status: 'first_order_only',
        message: 'HELLO30 is for first orders only',
      });
      assert.equal(repeat.discountCents, 0);
      const first = priceCheckout(checkout(scenarioA(), { customer: FIRST_ORDER, promoCode: 'HELLO30' }));
      assert.deepEqual([first.promo?.status, first.discountCents], ['applied', 3_000]);
    });
  });

  it('CREW5: 5 % rounded down, capped at $100, once per account (used_up)', () => {
    // Scenario E, 127 956: 5 % = 6 397.8 → 6 397.
    const e = priceCheckout(checkout(scenarioE(), { site: 'mimico', promoCode: 'CREW5' }));
    assert.deepEqual([e.promo?.status, e.discountCents], ['applied', 6_397]);
    // (127 956 − 6 397) × 13 % = 15 802.67 → 15 803.
    assert.deepEqual(amounts(e), money(127_956, 6_397, 0, 0, 15_803, 137_362));

    // 3 ranges, 269 994: 5 % = 13 499.7 → capped at 10 000.
    const big = priceCheckout(
      checkout([cartStore('grainline-building', [['GBC-RANGE', 3]])], { promoCode: 'CREW5' }),
    );
    assert.deepEqual([big.promo?.status, big.discountCents], ['applied', 10_000]);

    const used = priceCheckout(
      checkout(scenarioE(), {
        site: 'mimico',
        promoCode: 'CREW5',
        customer: { isFirstOrder: false, promoUses: { CREW5: 1 } },
      }),
    );
    assert.deepEqual(used.promo, { code: 'CREW5', status: 'used_up', message: "You've already used CREW5" });
    assert.equal(used.discountCents, 0);

    // BUILD25 has no use limit.
    const build = priceCheckout(
      checkout(scenarioB(), {
        promoCode: 'BUILD25',
        customer: { isFirstOrder: false, promoUses: { BUILD25: 7 } },
      }),
    );
    assert.equal(build.promo?.status, 'applied');
  });

  it('the refusals are checked in the order of §3.4: expired before used_up before min_not_met', () => {
    const customer = { isFirstOrder: false, promoUses: { CREW5: 1 } };
    const expired = priceCheckout(
      checkout(scenarioB(), { promoCode: 'CREW5', customer, today: '2027-05-01' }),
    );
    assert.equal(expired.promo?.status, 'expired');
    const usedUp = priceCheckout(checkout(scenarioB(), { promoCode: 'CREW5', customer }));
    assert.equal(usedUp.promo?.status, 'used_up');
  });
});

// ---------- labourer, pickup ----------

describe('unload help (§3.4 step 6)', () => {
  const heavyCopperline = (): PricingStoreInput[] => [cartStore('copperline-plumbing', [['CPD-TOILET', 1]])];

  it('is offered for delivery only', () => {
    const pickup = priceCheckout(
      checkout(scenarioE(), {
        fulfilment: 'pickup',
        dropoff: null,
        unloadHelpStoreIds: ['slatebridge-masonry'],
      }),
    );
    assert.deepEqual(storeOf(pickup, 'slatebridge-masonry').unload, {
      offered: false,
      required: false,
      selected: false,
      feeCents: 0,
    });
    assert.equal(pickup.unloadFeeCents, 0);
  });

  it('is not offered for a car-sized load, even when asked for', () => {
    const result = priceCheckout(
      checkout(heavyCopperline(), { unloadHelpStoreIds: ['copperline-plumbing'] }),
    );
    const store = storeOf(result, 'copperline-plumbing');
    assert.equal(store.vehicleClass, 'car');
    assert.deepEqual(store.unload, { offered: false, required: false, selected: false, feeCents: 0 });
    assert.equal(result.unloadFeeCents, 0);
  });

  it('is forced at an unattended site only when the load is heavy', () => {
    // A 40 kg toilet is heavy (one unit ≥ 40 kg) but rides in a car: not offered, so not forced.
    const car = priceCheckout(checkout(heavyCopperline(), { site: 'junction' }));
    assert.equal(storeOf(car, 'copperline-plumbing').load.heavy, true);
    assert.equal(storeOf(car, 'copperline-plumbing').unload.required, false);

    // 6 drywall sheets (150 kg, pickup class) to the unattended Junction site: offered, not heavy.
    const light = priceCheckout(
      checkout([cartStore('bluestone-drywall', [['BDP-DW12', 6]])], { site: 'junction' }),
    );
    assert.deepEqual(storeOf(light, 'bluestone-drywall').unload, {
      offered: true,
      required: false,
      selected: false,
      feeCents: 0,
    });

    // 10 drywall sheets: 250 kg, heavy → required at the unattended site, $35 charged.
    const heavy = priceCheckout(
      checkout([cartStore('bluestone-drywall', [['BDP-DW12', 10]])], { site: 'junction' }),
    );
    const store = storeOf(heavy, 'bluestone-drywall');
    assert.deepEqual(store.unload, { offered: true, required: true, selected: true, feeCents: 3_500 });
    assert.equal(store.unloadFeeCents, 3_500);
  });

  it('charges a cargo van and a box truck their own labourer fee', () => {
    const q = priceCheckout(
      checkout(quoteQ10002(), { site: 'mimico', source: 'quote', unloadHelpStoreIds: ['kestrel-lumber'] }),
    );
    assert.equal(storeOf(q, 'kestrel-lumber').unloadFeeCents, 6_000);
    const d = priceCheckout(
      checkout(
        [
          cartStore('grainline-building', [
            ['GBC-R20', 20],
            ['GBC-XPS2', 10],
          ]),
        ],
        {
          unloadHelpStoreIds: ['grainline-building'],
        },
      ),
    );
    assert.equal(storeOf(d, 'grainline-building').unloadFeeCents, 4_500);
  });

  it('unloadHelpStoreIds naming a store that is not in the cart changes nothing', () => {
    const base = priceCheckout(checkout(scenarioA()));
    const extra = priceCheckout(checkout(scenarioA(), { unloadHelpStoreIds: ['glassmoor-glass'] }));
    assert.deepEqual(extra, base);
  });
});

describe('pickup (§3.4)', () => {
  it('has no delivery fee, no labourer, no hand-off code and no free-delivery meter', () => {
    const result = priceCheckout(checkout(scenarioA(), { fulfilment: 'pickup', dropoff: null }));
    // Tax per store: 14 086 → 1 831.18 → 1 831 and 18 772 → 2 440.36 → 2 440, so 4 271 (on the
    // order's 32 858 at once it would be 4 271.54 → 4 272).
    assert.deepEqual(amounts(result), money(32_858, 0, 0, 0, 4_271, 37_129));
    for (const store of result.stores) {
      assert.deepEqual(
        [
          store.deliveryFeeCents,
          store.deliveryFeeListCents,
          store.feeWaiver,
          store.roadTenths,
          store.requireCode,
        ],
        [0, 0, null, null, false],
      );
    }
    assert.equal(result.amountToFreeDeliveryCents, 0);
  });

  it('ignores a drop-off sent with a pickup order', () => {
    const result = priceCheckout(checkout(scenarioA(), { fulfilment: 'pickup' }));
    assert.deepEqual(amounts(result), money(32_858, 0, 0, 0, 4_271, 37_129));
    assert.equal(result.stores[0]?.roadTenths, null);
  });

  it('does not judge distance or the site limit: the customer brings the vehicle', () => {
    // A box-truck load for the Junction site (cargo van at most) is fine when it is picked up.
    const result = priceCheckout(
      checkout(quoteQ10002(), { site: 'junction', source: 'quote', fulfilment: 'pickup' }),
    );
    assert.equal(storeOf(result, 'kestrel-lumber').vehicleClass, 'box_truck');
    assert.deepEqual(result.blockers, []);
    assert.equal(result.canPlace, true);
    // A store that delivers within 1 km only: out_of_range is a delivery error only.
    const far = priceCheckout(
      checkout(
        [
          cartStore('boltbin-hardware', [['BFH-JH28', 2]], {
            fulfilment: { delivery: true, pickup: true, deliveryRadiusKm: 1 },
          }),
        ],
        { fulfilment: 'pickup' },
      ),
    );
    assert.deepEqual(far.blockers, []);
  });
});

// ---------- errors ----------

describe('every error code (§3.4 steps 1 and 2, §5.9)', () => {
  it('empty: no stores, or only zero-quantity lines', () => {
    for (const stores of [[], [cartStore('boltbin-hardware', [['BFH-JH28', 0]])]]) {
      const result = priceCheckout(checkout(stores));
      assert.deepEqual(result.blockers, [{ code: 'empty', storeId: null, message: 'Your cart is empty' }]);
      assert.deepEqual(amounts(result), money(0, 0, 0, 0, 0, 0));
      assert.deepEqual(
        [result.stores, result.canPlace, result.itemCount, result.lineCount],
        [[], false, 0, 0],
      );
    }
  });

  it('zero-quantity lines are dropped, the others keep their ids', () => {
    const result = priceCheckout(
      checkout([
        cartStore('boltbin-hardware', [
          ['BFH-JH28', 0],
          ['BFH-DECK', 2],
        ]),
        cartStore('glassmoor-glass', [['GGM-MIRROR', 0]]),
      ]),
    );
    assert.deepEqual(
      result.stores.map((store) => [store.letter, store.storeId, store.lines.map((line) => line.lineId)]),
      [['A', 'boltbin-hardware', ['L2']]],
    );
    assert.deepEqual([result.lineCount, result.itemCount, result.itemsCents], [1, 2, 6_996]);
  });

  it('too_many_stores: six stores are priced and lettered A–F but cannot be placed', () => {
    const six = STORE_IDS.filter((id) => id !== 'slatebridge-masonry' && id !== 'copperline-plumbing').map(
      (id) => {
        const sku = SKUS.find((candidate) => PRODUCTS[candidate].storeId === id);
        assert.ok(sku);
        return cartStore(id, [[sku, 1]]);
      },
    );
    assert.equal(six.length, 6);
    const result = priceCheckout(checkout(six));
    assert.deepEqual(codes(result), ['too_many_stores']);
    assert.equal(result.blockers[0]?.message, 'One order can have items from up to 5 stores');
    assert.deepEqual(
      result.stores.map((store) => store.letter),
      ['A', 'B', 'C', 'D', 'E', 'F'],
    );
    assert.equal(result.canPlace, false);
    assert.equal(priceCheckout(checkout(six.slice(1))).canPlace, true);
  });

  it('no_dropoff: a delivery before a jobsite is chosen is priced without fees', () => {
    const result = priceCheckout(checkout(scenarioA(), { dropoff: null }));
    assert.deepEqual(result.blockers, [
      { code: 'no_dropoff', storeId: null, message: 'Choose a jobsite for delivery' },
    ]);
    for (const store of result.stores) {
      assert.deepEqual(
        [store.roadTenths, store.roadKm, store.deliveryFeeListCents, store.requireCode],
        [null, null, 0, false],
      );
    }
    assert.deepEqual(amounts(result), money(32_858, 0, 0, 0, 4_271, 37_129));
    assert.equal(result.canPlace, false);
  });

  it('store_unavailable and store_paused', () => {
    const result = priceCheckout(
      checkout([
        cartStore('glassmoor-glass', [['GGM-MIRROR', 1]], { status: 'coming_soon' }),
        cartStore('boltbin-hardware', [['BFH-DECK', 1]], { acceptingOrders: false }),
      ]),
    );
    assert.deepEqual(result.blockers, [
      {
        code: 'store_paused',
        storeId: 'boltbin-hardware',
        message: 'Boltbin Fasteners & Hardware has paused new orders',
      },
      {
        code: 'store_unavailable',
        storeId: 'glassmoor-glass',
        message: "Glassmoor Glass & Mirror isn't taking orders right now",
      },
    ]);
    assert.deepEqual(
      storeOf(result, 'glassmoor-glass').errors.map((error) => error.code),
      ['store_unavailable'],
    );
    // Still priced for the preview.
    assert.equal(storeOf(result, 'glassmoor-glass').totalCents, 11_636);
    assert.equal(result.canPlace, false);
  });

  it('delivery_unavailable and pickup_unavailable', () => {
    const noDelivery = [
      cartStore('glassmoor-glass', [['GGM-MIRROR', 1]], {
        fulfilment: { delivery: false, pickup: true, deliveryRadiusKm: 30 },
      }),
    ];
    assert.deepEqual(priceCheckout(checkout(noDelivery)).blockers, [
      {
        code: 'delivery_unavailable',
        storeId: 'glassmoor-glass',
        message: "Glassmoor Glass & Mirror doesn't offer delivery",
      },
    ]);
    assert.equal(priceCheckout(checkout(noDelivery, { fulfilment: 'pickup', dropoff: null })).canPlace, true);

    const noPickup = [
      cartStore('glassmoor-glass', [['GGM-MIRROR', 1]], {
        fulfilment: { delivery: true, pickup: false, deliveryRadiusKm: 30 },
      }),
    ];
    assert.deepEqual(priceCheckout(checkout(noPickup, { fulfilment: 'pickup', dropoff: null })).blockers, [
      {
        code: 'pickup_unavailable',
        storeId: 'glassmoor-glass',
        message: "Glassmoor Glass & Mirror doesn't offer pickup",
      },
    ]);
    assert.equal(priceCheckout(checkout(noPickup)).canPlace, true);
  });

  it('out_of_range: Slatebridge → Leslieville is 50.3 km, beyond its 45 km', () => {
    const result = priceCheckout(checkout([cartStore('slatebridge-masonry', [['SMR-BLOCK', 10]])]));
    assert.deepEqual(result.blockers, [
      {
        code: 'out_of_range',
        storeId: 'slatebridge-masonry',
        message: 'Slatebridge Masonry & Roofing delivers within 45 km; your site is 50.3 km away',
      },
    ]);
    // Still priced: 170 kg of blocks is past a car's 150 kg, so an SUV load;
    // 1 999 + mulDivHalfUp(119, 403, 10) = 1 999 + 4 796 (4 795.7 rounded half-up).
    const store = storeOf(result, 'slatebridge-masonry');
    assert.deepEqual([store.vehicleClass, store.roadTenths, store.deliveryFeeListCents], ['suv', 503, 6_795]);
    // Exactly at the radius is in range: a radius of 50.3 km.
    const edge = priceCheckout(
      checkout([
        cartStore('slatebridge-masonry', [['SMR-BLOCK', 10]], {
          fulfilment: { delivery: true, pickup: true, deliveryRadiusKm: 50.3 },
        }),
      ]),
    );
    assert.deepEqual(edge.blockers, []);
    const below = priceCheckout(
      checkout([
        cartStore('slatebridge-masonry', [['SMR-BLOCK', 10]], {
          fulfilment: { delivery: true, pickup: true, deliveryRadiusKm: 50.2 },
        }),
      ]),
    );
    assert.deepEqual(codes(below), ['out_of_range']);
  });

  it('too_large: 300 shingle bundles (9 000 kg) fit no vehicle', () => {
    const result = priceCheckout(
      checkout([cartStore('slatebridge-masonry', [['SMR-SHING', 300]])], { site: 'mimico' }),
    );
    assert.deepEqual(result.blockers, [
      {
        code: 'too_large',
        storeId: 'slatebridge-masonry',
        message: 'Too large for one delivery. Send us your list for a quote.',
      },
    ]);
    const store = storeOf(result, 'slatebridge-masonry');
    assert.deepEqual(
      [store.vehicleClass, store.deliveryFeeListCents, store.unload.offered],
      [null, 0, false],
    );
    // 300 × 49.98 = 14 994.00, past the free-delivery threshold anyway.
    assert.deepEqual(amounts(result), money(1_499_400, 0, 0, 0, 194_922, 1_694_322));
  });

  it('too_large applies to a pickup too: §3.4 step 2 lists it for every fulfilment', () => {
    const result = priceCheckout(
      checkout([cartStore('slatebridge-masonry', [['SMR-SHING', 300]])], {
        fulfilment: 'pickup',
        dropoff: null,
      }),
    );
    assert.deepEqual(codes(result), ['too_large']);
    assert.equal(storeOf(result, 'slatebridge-masonry').vehicleClass, null);
    assert.equal(result.canPlace, false);
  });

  it('jobsite_vehicle_limit: a box-truck load for the Junction site (cargo van at most)', () => {
    const result = priceCheckout(checkout(quoteQ10002(), { site: 'junction', source: 'quote' }));
    assert.deepEqual(result.blockers, [
      {
        code: 'jobsite_vehicle_limit',
        storeId: 'kestrel-lumber',
        message: 'The load from Kestrel Lumber Yard needs a box truck; your site takes a cargo van at most',
      },
    ]);
    // A cargo-van load is fine there: scenario D's Grainline cart.
    const d = priceCheckout(
      checkout(
        [
          cartStore('grainline-building', [
            ['GBC-R20', 20],
            ['GBC-XPS2', 10],
          ]),
        ],
        { site: 'junction' },
      ),
    );
    assert.deepEqual(d.blockers, []);
  });

  it('a store can have several errors; whole-cart blockers come first', () => {
    const result = priceCheckout(
      checkout(
        [
          cartStore('slatebridge-masonry', [['SMR-SHING', 300]], {
            status: 'closed',
            acceptingOrders: false,
            fulfilment: { delivery: false, pickup: true, deliveryRadiusKm: 45 },
          }),
        ],
        { site: 'leslieville' },
      ),
    );
    assert.deepEqual(codes(result), [
      'store_unavailable',
      'store_paused',
      'delivery_unavailable',
      'out_of_range',
      'too_large',
    ]);
    const noDropoff = priceCheckout(
      checkout([...scenarioA(), ...scenarioE()].slice(0, 3), { dropoff: null }),
    );
    assert.deepEqual(codes(noDropoff), ['no_dropoff']);
  });
});

// ---------- quotes and replacements ----------

describe('quotes and replacements (§3.5)', () => {
  it('quote Q-10002: overridden unit prices and a custom line, total 129 970', () => {
    const result = priceCheckout(checkout(quoteQ10002(), { site: 'mimico', source: 'quote' }));
    const kestrel = storeOf(result, 'kestrel-lumber');
    assert.deepEqual(
      kestrel.lines.map((line) => [line.kind, line.unitPriceCents, line.lineCents]),
      [
        ['catalog', 1_798, 53_940],
        ['catalog', 1_598, 12_784],
        ['custom', 18_900, 37_800],
      ],
    );
    assert.equal(kestrel.lines[2]?.productId, null);
    assert.deepEqual(amounts(kestrel), money(104_524, 0, 0, 0, 13_588, 118_112));
    assert.deepEqual(amounts(storeOf(result, 'boltbin-hardware')), money(10_494, 0, 0, 0, 1_364, 11_858));
    assert.equal(result.totalCents, 129_970);
    assert.equal(result.freeDelivery, 'free_threshold');
    assert.equal(result.canPlace, true);
  });

  it('a replacement: lines at 0, fees waived as replacement, labourer free, no welcome, placeable', () => {
    const lines: Item[] = [['BDP-DW12', 2, 0]];
    const result = priceCheckout(
      checkout([cartStore('bluestone-drywall', lines)], {
        source: 'replacement',
        customer: FIRST_ORDER,
        unloadHelpStoreIds: ['bluestone-drywall'],
      }),
    );
    const store = storeOf(result, 'bluestone-drywall');
    assert.deepEqual(amounts(result), money(0, 0, 0, 0, 0, 0));
    assert.deepEqual(
      [store.feeWaiver, store.deliveryFeeListCents, store.vehicleClass],
      ['replacement', 4_921, 'pickup'],
    );
    assert.deepEqual(store.unload, { offered: true, required: false, selected: true, feeCents: 0 });
    assert.deepEqual(result.discounts, []);
    assert.equal(result.freeDelivery, null);
    assert.equal(result.amountToFreeDeliveryCents, 0);
    assert.equal(result.canPlace, true);
  });

  it('a cart worth $0 cannot be placed unless it is a replacement', () => {
    const free: Item[] = [['BDP-DW12', 2, 0]];
    assert.equal(
      priceCheckout(checkout([cartStore('bluestone-drywall', free)], { source: 'quote' })).canPlace,
      false,
    );
    assert.equal(priceCheckout(checkout([cartStore('bluestone-drywall', free)])).canPlace, false);
  });

  it('a replacement never gets the welcome discount, even with priced lines', () => {
    const result = priceCheckout(checkout(scenarioA(), { source: 'replacement', customer: FIRST_ORDER }));
    assert.equal(result.itemsCents, 32_858);
    assert.deepEqual([result.discountCents, result.discounts], [0, []]);
    assert.equal(result.stores[0]?.feeWaiver, 'replacement');
  });

  it('a replacement for a repeat customer gets the step 8 meter as written (freeDelivery is null)', () => {
    const result = priceCheckout(
      checkout([cartStore('bluestone-drywall', [['BDP-DW12', 2, 0]])], {
        source: 'replacement',
        customer: DANA,
      }),
    );
    assert.equal(storeOf(result, 'bluestone-drywall').feeWaiver, 'replacement');
    assert.equal(result.deliveryFeeCents, 0);
    assert.deepEqual([result.freeDelivery, result.amountToFreeDeliveryCents], [null, 50_000]);
    assert.equal(result.canPlace, true);
  });
});

// ---------- letters, allocation, determinism ----------

describe('letters and allocation order (§3.4 steps 1 and 4)', () => {
  it('letters follow storeId, whatever order the stores arrive in', () => {
    const forward = priceCheckout(checkout(scenarioB(), { promoCode: 'BUILD25' }));
    const backward = priceCheckout(checkout([...scenarioB()].reverse(), { promoCode: 'BUILD25' }));
    assert.deepEqual(backward, forward);
  });

  it('letters follow storeId, not the store name', () => {
    // Boltbin renamed "Zinc …" still sorts first by id; Voltway renamed "Alder …" still sorts last.
    const [boltbin, kestrel, voltway] = scenarioB();
    assert.ok(boltbin && kestrel && voltway);
    const renamed = [
      { ...voltway, store: { ...voltway.store, name: 'Alder Electrical' } },
      kestrel,
      { ...boltbin, store: { ...boltbin.store, name: 'Zinc Hardware' } },
    ];
    const result = priceCheckout(checkout(renamed, { promoCode: 'BUILD25' }));
    assert.deepEqual(
      result.stores.map((store) => [store.letter, store.storeId, store.discountCents]),
      [
        ['A', 'boltbin-hardware', 439],
        ['B', 'kestrel-lumber', 811],
        ['C', 'voltway-electrical', 1_250],
      ],
    );
  });

  it('lines are ordered by id with numbers compared as numbers (L2 before L10), whatever the input order', () => {
    const store = cartStore('boltbin-hardware', [
      ['BFH-JH28', 1],
      ['BFH-JH28', 1],
      ['BFH-JH28', 1],
    ]);
    const [l1, l2, l3] = store.lines;
    assert.ok(l1 && l2 && l3);
    const lines = [
      { ...l1, lineId: 'L10' },
      { ...l2, lineId: 'L2' },
      { ...l3, lineId: 'L1' },
    ];
    const result = priceCheckout(
      checkout([{ ...store, lines }], { source: 'quote', promoCode: null, customer: FIRST_ORDER }),
    );
    assert.deepEqual(
      result.stores[0]?.lines.map((line) => line.lineId),
      ['L1', 'L2', 'L10'],
    );
  });

  it('the odd cent goes to the larger remainder, ties to the earlier store and line', () => {
    // Three stores of $250.00 each (quoted lines) and BUILD25: 2 500 / 3 = 833.3 → A gets the extra cent.
    const quoted = (storeId: StoreId, sku: Sku): PricingStoreInput => cartStore(storeId, [[sku, 1, 25_000]]);
    const result = priceCheckout(
      checkout(
        [
          quoted('voltway-electrical', 'VES-BOX'),
          quoted('boltbin-hardware', 'BFH-JH28'),
          quoted('glassmoor-glass', 'GGM-MIRROR'),
        ],
        { source: 'quote', promoCode: 'BUILD25' },
      ),
    );
    assert.deepEqual(
      result.stores.map((store) => [store.letter, store.storeId, store.discountCents]),
      [
        ['A', 'boltbin-hardware', 834],
        ['B', 'glassmoor-glass', 833],
        ['C', 'voltway-electrical', 833],
      ],
    );

    // Inside one store: three equal lines share 2 000 → 667, 667, 666 in line order.
    const store = priceCheckout(
      checkout(
        [
          cartStore('boltbin-hardware', [
            ['BFH-DECK', 1, 10_000],
            ['BFH-DECK', 1, 10_000],
            ['BFH-DECK', 1, 10_000],
          ]),
        ],
        { source: 'quote', customer: FIRST_ORDER },
      ),
    );
    assert.deepEqual(
      store.stores[0]?.lines.map((line) => line.discountCents),
      [667, 667, 666],
    );
  });

  it('two entries for one store are priced as one store order', () => {
    const [bluestone, kestrel] = scenarioA();
    assert.ok(bluestone && kestrel);
    const split = priceCheckout(
      checkout([
        { ...bluestone, lines: bluestone.lines.slice(0, 1) },
        kestrel,
        { ...bluestone, lines: bluestone.lines.slice(1) },
      ]),
    );
    assert.deepEqual(split, priceCheckout(checkout(scenarioA())));
  });

  it('does not change its input and shares no object with it', () => {
    const input = checkout(scenarioB(), { promoCode: 'BUILD25', unloadHelpStoreIds: ['kestrel-lumber'] });
    const before = JSON.stringify(input);
    const result = priceCheckout(input);
    assert.equal(JSON.stringify(input), before);
    const line = result.stores[0]?.lines[0];
    assert.ok(line);
    line.dimsCm.l = 999;
    assert.equal(JSON.stringify(input), before);
  });

  it('a quantity or price that is not whole cents is corrupt data and throws a RangeError', () => {
    for (const bad of [1.5, -1, Number.NaN]) {
      const store = cartStore('boltbin-hardware', [['BFH-JH28', 1]]);
      const [line] = store.lines;
      assert.ok(line);
      assert.throws(
        () => priceCheckout(checkout([{ ...store, lines: [{ ...line, quantity: bad }] }])),
        RangeError,
      );
      assert.throws(
        () => priceCheckout(checkout([{ ...store, lines: [{ ...line, unitPriceCents: bad }] }])),
        RangeError,
      );
    }
  });
});

// ---------- property test ----------

/** Seeded PRNG (mulberry32): the same seed gives the same carts, so a failure can be replayed. */
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

const AMOUNT_FIELDS = [
  'itemsCents',
  'discountCents',
  'deliveryFeeCents',
  'unloadFeeCents',
  'taxCents',
  'totalCents',
] as const;
const CLASSES: readonly VehicleClass[] = ['car', 'suv', 'pickup', 'cargo_van', 'box_truck', 'flatbed'];

function randomCart(random: () => number): CheckoutInput {
  const below = (limit: number): number => Math.floor(random() * limit);
  const pick = <T>(list: readonly T[]): T => {
    const value = list[below(list.length)];
    assert.ok(value !== undefined);
    return value;
  };
  const shuffled = <T>(list: readonly T[]): T[] => {
    const copy = [...list];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const other = below(index + 1);
      const here = copy[index];
      const there = copy[other];
      assert.ok(here !== undefined && there !== undefined);
      copy[index] = there;
      copy[other] = here;
    }
    return copy;
  };

  const source = pick(['cart', 'cart', 'cart', 'quote', 'replacement'] as const);
  const storeIds = shuffled(STORE_IDS).slice(0, 1 + below(5));
  const stores = storeIds.map((storeId) => {
    const skus = SKUS.filter((sku) => PRODUCTS[sku].storeId === storeId);
    const items: (Item | CustomItem)[] = [];
    const count = 1 + below(4);
    for (let index = 0; index < count; index += 1) {
      const roll = random();
      // Mostly small quantities; sometimes 0 (dropped) or a very large one (too_large).
      const quantity = roll < 0.05 ? 0 : roll < 0.1 ? 100 + below(300) : 1 + below(roll < 0.5 ? 6 : 40);
      const price =
        source === 'replacement' ? 0 : source === 'quote' && random() < 0.5 ? below(60_000) : undefined;
      if (source === 'quote' && random() < 0.15) {
        items.push({
          custom: 'Special order',
          priceCents: below(50_000),
          quantity,
          kg: 1 + below(60),
          dims: [50 + below(500), 20, 10],
        });
      } else {
        items.push([pick(skus), quantity, price]);
      }
    }
    const status = random() < 0.05 ? 'coming_soon' : 'live';
    return cartStore(storeId, items, { status, acceptingOrders: random() > 0.05 });
  });

  const fulfilment = random() < 0.75 ? 'delivery' : 'pickup';
  const site = SITES[pick(SITE_IDS)];
  const dropoff =
    fulfilment === 'delivery' && random() < 0.05
      ? null
      : {
          location: site.location,
          receiving: random() < 0.4 ? ('unattended' as const) : ('attended' as const),
          maxVehicleClass: random() < 0.6 ? null : pick(CLASSES),
        };
  return {
    fulfilment,
    stores,
    dropoff,
    unloadHelpStoreIds: storeIds.filter(() => random() < 0.4),
    promoCode: pick([null, 'BUILD25', ' crew5 ', 'NOPE', '']),
    customer: { isFirstOrder: random() < 0.4, promoUses: random() < 0.3 ? { CREW5: 1 } : {} },
    source,
    today: pick(['2026-11-19', '2026-10-15', '2027-03-31', '2027-06-01']),
  };
}

function checkAmounts(label: string, value: Amounts): void {
  for (const field of AMOUNT_FIELDS) {
    assert.ok(Number.isSafeInteger(value[field]) && value[field] >= 0, `${label}.${field} = ${value[field]}`);
    assert.ok(!Object.is(value[field], -0), `${label}.${field} is -0`);
  }
}

describe('property test: 1 000 seeded random carts', () => {
  it('stores add up to the order, amounts are whole and non-negative, tax is per store, shortages never raise', () => {
    const random = mulberry32(20_261_119);
    const reversed = (input: CheckoutInput): CheckoutInput => ({
      ...input,
      stores: [...input.stores].reverse().map((store) => ({ ...store, lines: [...store.lines].reverse() })),
    });
    let placeable = 0;
    let discounted = 0;
    let heavyForced = 0;
    for (let run = 0; run < 1_000; run += 1) {
      const input = randomCart(random);
      const before = JSON.stringify(input);
      const result = priceCheckout(input);
      const label = `cart ${run}`;
      assert.equal(JSON.stringify(input), before, `${label}: input changed`);
      // Independent of the order of stores and lines.
      assert.deepEqual(priceCheckout(reversed(input)), result, `${label}: order matters`);

      checkAmounts(label, result);
      const delivery = input.fulfilment === 'delivery';
      let orderItems = 0;
      for (const [index, store] of result.stores.entries()) {
        const at = `${label} store ${store.storeId}`;
        checkAmounts(at, store);
        assert.equal(store.letter, String.fromCharCode(65 + index));
        if (index > 0) assert.ok((result.stores[index - 1]?.storeId ?? '') < store.storeId);
        // Lines: totals, discount shares that add up and never exceed the line.
        let items = 0;
        let lineDiscounts = 0;
        for (const line of store.lines) {
          assert.ok(line.quantity > 0);
          assert.equal(line.lineCents, line.unitPriceCents * line.quantity);
          assert.ok(line.discountCents >= 0 && line.discountCents <= line.lineCents, `${at}: line discount`);
          items += line.lineCents;
          lineDiscounts += line.discountCents;
        }
        assert.equal(store.itemsCents, items);
        assert.equal(store.discountCents, lineDiscounts);
        assert.ok(store.discountCents <= store.itemsCents);
        // Tax per store, half-up on the store's own taxable amount.
        const taxable =
          store.itemsCents - store.discountCents + store.deliveryFeeCents + store.unloadFeeCents;
        assert.equal(store.taxCents, Math.floor((taxable * 1300 + 5000) / 10000), `${at}: tax`);
        assert.equal(store.totalCents, taxable + store.taxCents);
        // Fees.
        if (!delivery) {
          assert.deepEqual(
            [store.deliveryFeeCents, store.deliveryFeeListCents, store.unloadFeeCents],
            [0, 0, 0],
          );
        }
        assert.equal(store.deliveryFeeCents, store.feeWaiver === null ? store.deliveryFeeListCents : 0);
        if (!store.unload.selected || input.source === 'replacement') assert.equal(store.unloadFeeCents, 0);
        assert.equal(store.unload.feeCents, store.unloadFeeCents);
        if (store.unload.required) heavyForced += 1;
        orderItems += store.itemsCents;

        // Random shortages: settling never raises any amount above what was placed.
        const settled = settleStoreOrder(
          store.lines.map((line) => ({ ...line, fulfilledQty: Math.floor(random() * (line.quantity + 1)) })),
          store,
        );
        checkAmounts(`${at} settled`, settled);
        for (const field of AMOUNT_FIELDS)
          assert.ok(settled[field] <= store[field], `${at}: settled ${field}`);
        assert.ok(settled.deliveryFeeCents === 0 || settled.deliveryFeeCents === store.deliveryFeeCents);
      }

      // The order is the sum of its stores, field by field.
      for (const field of AMOUNT_FIELDS) {
        assert.equal(
          result[field],
          result.stores.reduce((sum, store) => sum + store[field], 0),
          `${label}: Σ ${field}`,
        );
      }
      assert.equal(result.itemsCents, orderItems);
      assert.ok(result.discountCents <= result.itemsCents);
      assert.ok(result.discounts.length <= 1);
      assert.equal(result.discountCents, result.discounts[0]?.cents ?? 0);
      // The discount is split in proportion to each store's items, to within a cent.
      for (const store of result.stores) {
        if (result.itemsCents === 0) continue;
        const exact = (result.discountCents * store.itemsCents) / result.itemsCents;
        assert.ok(Math.abs(store.discountCents - exact) < 1, `${label}: allocation`);
      }
      assert.equal(
        result.canPlace,
        result.blockers.length === 0 && (result.itemsCents > 0 || input.source === 'replacement'),
      );
      if (result.canPlace) placeable += 1;
      if (result.discountCents > 0) discounted += 1;
    }
    // The generator really reaches the interesting cases.
    assert.ok(placeable > 200 && placeable < 900, `placeable ${placeable}`);
    assert.ok(discounted > 100, `discounted ${discounted}`);
    assert.ok(heavyForced > 10, `labourer forced ${heavyForced}`);
  });
});
