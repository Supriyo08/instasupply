/**
 * Settlements after short shipments and voids (§3.6), refunds and their caps (§3.7), the failed
 * delivery returned to the store, and clawbacks. The store orders are priced with `priceCheckout`
 * from the seed carts of V1–V3 (§3.11, §11), so their line discount shares are the real ones.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clawbackCents,
  priceCheckout,
  refundForLines,
  refundableCents,
  settleReturnToStore,
  settleStoreOrder,
  storeValueCents,
  subtractAmounts,
  sumAmounts,
  voidAmounts,
  type Amounts,
  type CheckoutInput,
  type LatLng,
  type OrderPayment,
  type PricedStore,
  type PricingLine,
  type PricingStoreInput,
  type SellUnit,
  type StoreOrder,
  type StoreOrderLine,
} from '../src';

// ---------- fixtures: the V1–V3 carts (§11.3, §11.4) ----------

const LESLIEVILLE: LatLng = { lat: 43.6648, lng: -79.3405 };

const STORE_PINS: Record<string, { name: string; location: LatLng; radiusKm: number }> = {
  'bluestone-drywall': {
    name: 'Bluestone Drywall & Paint',
    location: { lat: 43.7709, lng: -79.4912 },
    radiusKm: 40,
  },
  'kestrel-lumber': { name: 'Kestrel Lumber Yard', location: { lat: 43.6966, lng: -79.5752 }, radiusKm: 45 },
  'boltbin-hardware': {
    name: 'Boltbin Fasteners & Hardware',
    location: { lat: 43.7262, lng: -79.6885 },
    radiusKm: 45,
  },
  'voltway-electrical': {
    name: 'Voltway Electrical Supply',
    location: { lat: 43.6262, lng: -79.6143 },
    radiusKm: 40,
  },
};

/** Name, unit, price, kg and l × w × h cm of the products the carts use. */
const PRODUCTS: Record<string, [string, SellUnit, number, number, number, number, number]> = {
  'BDP-DW12': ['Drywall 1/2 in regular, 4×8', 'sheet', 1848, 25, 244, 122, 1.3],
  'BDP-JC17': ['All-purpose joint compound, 17 L', 'pail', 2998, 28, 30, 30, 38],
  'KLY-SPF248': ['2x4x8 SPF stud, kiln-dried', 'each', 479, 4.5, 244, 9, 4],
  'KLY-OSB716': ['OSB sheathing 7/16 in, 4×8', 'sheet', 2298, 23, 244, 122, 1.1],
  'BFH-JH28': ['Joist hanger 2x8, galvanized', 'each', 279, 0.3, 15, 8, 5],
  'BFH-DECK': ['Deck screws #10 × 2-1/2 in, 5 lb', 'box', 3498, 2.4, 18, 12, 8],
  'VES-NMD142': ['NMD90 14/2 cable, 75 m', 'roll', 11998, 7, 35, 35, 12],
  'VES-BOX': ['Single-gang PVC device box', 'each', 148, 0.05, 10, 6, 6],
};

function cartStore(storeId: string, items: readonly [string, number][]): PricingStoreInput {
  const pin = STORE_PINS[storeId];
  assert.ok(pin);
  return {
    storeId,
    store: {
      name: pin.name,
      location: pin.location,
      status: 'live',
      acceptingOrders: true,
      fulfilment: { delivery: true, pickup: true, deliveryRadiusKm: pin.radiusKm },
    },
    lines: items.map(([sku, quantity], index): PricingLine => {
      const seed = PRODUCTS[sku];
      assert.ok(seed);
      const [name, unit, unitPriceCents, weightKg, l, w, h] = seed;
      return {
        lineId: `L${index + 1}`,
        kind: 'catalog',
        productId: `${storeId}--${sku.toLowerCase()}`,
        name,
        unit,
        size: null,
        unitPriceCents,
        quantity,
        weightKg,
        dimsCm: { l, w, h },
      };
    }),
  };
}

function priced(
  stores: PricingStoreInput[],
  options: Partial<Omit<CheckoutInput, 'stores'>> = {},
): Map<string, PricedStore> {
  const result = priceCheckout({
    fulfilment: 'delivery',
    stores,
    dropoff: { location: LESLIEVILLE, receiving: 'attended', maxVehicleClass: null },
    unloadHelpStoreIds: ['kestrel-lumber'],
    promoCode: null,
    customer: { isFirstOrder: false, promoUses: {} },
    source: 'cart',
    today: '2026-11-19',
    ...options,
  });
  assert.equal(result.canPlace, true);
  return new Map(result.stores.map((store) => [store.storeId, store]));
}

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

/** V1 (first order: welcome discount, fees waived, labourer for Kestrel). */
const V1 = priced(scenarioA(), { customer: { isFirstOrder: true, promoUses: {} } });
/** V2 (repeat customer: delivery fees and the labourer charged). */
const V2 = priced(scenarioA());
/** V3 (BUILD25, free_threshold). */
const V3 = priced(scenarioB(), { promoCode: 'BUILD25' });

function pricedStore(map: Map<string, PricedStore>, storeId: string): PricedStore {
  const store = map.get(storeId);
  assert.ok(store);
  return store;
}

const amountsOf = (value: Amounts): Amounts => ({
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

/** The placed lines of a store as a store order keeps them, with fulfilled quantities (all by default). */
function linesOf(store: PricedStore, fulfilled: readonly number[] = []): StoreOrderLine[] {
  return store.lines.map((line, index) => ({
    lineId: line.lineId,
    kind: line.kind,
    productId: line.productId,
    sku: null,
    name: line.name,
    brand: null,
    unit: line.unit,
    size: line.size,
    categoryId: null,
    imageKey: null,
    imageUrl: null,
    unitPriceCents: line.unitPriceCents,
    quantity: line.quantity,
    fulfilledQty: fulfilled[index] ?? line.quantity,
    shortReason: null,
    lineCents: line.lineCents,
    discountCents: line.discountCents,
    weightKg: line.weightKg,
    dimsCm: { ...line.dimsCm },
    note: null,
  }));
}

/** A store order as `refundForLines` reads it: its lines and `current`. */
function storeOrder(
  store: PricedStore,
  fulfilled: readonly number[] = [],
): Pick<StoreOrder, 'lines' | 'current'> {
  const lines = linesOf(store, fulfilled);
  return { lines, current: settleStoreOrder(lines, store) };
}

const payment = (
  capturedCents: number,
  refundedCents: number,
  refundedByStoreOrder: Record<string, number>,
): Pick<OrderPayment, 'capturedCents' | 'refundedCents' | 'refundedByStoreOrder'> => ({
  capturedCents,
  refundedCents,
  refundedByStoreOrder,
});

// ---------- settleStoreOrder (§3.6) ----------

describe('settleStoreOrder (§3.6)', () => {
  const boltbin = pricedStore(V3, 'boltbin-hardware');

  it('V4: joist hangers 24 → 20: 13 755, 1 221 released, order current 87 970', () => {
    assert.deepEqual(amountsOf(boltbin), money(13_692, 439, 0, 0, 1_723, 14_976));
    const current = settleStoreOrder(linesOf(boltbin, [20, 2]), boltbin);
    // Items 5 580 + 6 996 = 12 576; discount mulDivHalfUp(215, 20, 24) = 179, + 224 = 403;
    // taxable 12 173 → HST 1 582.49 → 1 582; total 13 755.
    assert.deepEqual(current, money(12_576, 403, 0, 0, 1_582, 13_755));
    assert.equal(boltbin.totalCents - current.totalCents, 1_221);
    // Siblings are not touched: the order's current total is the sum of the store orders' current totals.
    const order = sumAmounts([
      current,
      pricedStore(V3, 'kestrel-lumber'),
      pricedStore(V3, 'voltway-electrical'),
    ]);
    assert.equal(order.totalCents, 87_970);
    assert.equal(storeValueCents(linesOf(boltbin, [20, 2])), 12_576);
  });

  it('nothing short: current equals placed', () => {
    for (const map of [V1, V2, V3]) {
      for (const store of map.values()) {
        assert.deepEqual(settleStoreOrder(linesOf(store), store), amountsOf(store));
      }
    }
  });

  it('every line at 0: void, the fees go too', () => {
    const kestrel = pricedStore(V2, 'kestrel-lumber');
    assert.deepEqual(settleStoreOrder(linesOf(kestrel, [0, 0]), kestrel), voidAmounts());
    assert.deepEqual(voidAmounts(), money(0, 0, 0, 0, 0, 0));
    assert.deepEqual(settleStoreOrder([], kestrel), voidAmounts());
  });

  it('fees are locked: they stay as placed, even when items fall far below $500', () => {
    // V2 Kestrel: studs 20 → 5, OSB 4 → 1. Items 2 395 + 2 298 = 4 693; fees 5 383 + 3 500 stay;
    // taxable 13 576 → HST 1 764.88 → 1 765; total 15 341.
    const kestrel = pricedStore(V2, 'kestrel-lumber');
    assert.deepEqual(
      settleStoreOrder(linesOf(kestrel, [5, 1]), kestrel),
      money(4_693, 0, 5_383, 3_500, 1_765, 15_341),
    );
    // V3 Kestrel was free_threshold: after a shortage the fee stays 0 and the labourer 3 500.
    const v3 = pricedStore(V3, 'kestrel-lumber');
    const current = settleStoreOrder(linesOf(v3, [1, 1]), v3);
    assert.deepEqual([current.deliveryFeeCents, current.unloadFeeCents], [0, 3_500]);
  });

  it('the kept discount share is rounded half-up', () => {
    // V1 Kestrel studs 20 → 10: mulDivHalfUp(583, 10, 20) = 291.5 → 292 (not 291), + 560 = 852.
    // Items 4 790 + 9 192 = 13 982; + labourer 3 500 → taxable 16 630 → HST 2 161.9 → 2 162.
    const v1 = pricedStore(V1, 'kestrel-lumber');
    assert.deepEqual(settleStoreOrder(linesOf(v1, [10, 4]), v1), money(13_982, 852, 0, 3_500, 2_162, 18_792));
    // V3 Kestrel studs 24 → 13: 369 × 13 / 24 = 199.875 → 200, + 442 = 642.
    // Items 6 227 + 13 788 = 20 015; taxable 20 015 − 642 + 3 500 = 22 873 → HST 2 973.49 → 2 973.
    const v3 = pricedStore(V3, 'kestrel-lumber');
    assert.deepEqual(settleStoreOrder(linesOf(v3, [13, 6]), v3), money(20_015, 642, 0, 3_500, 2_973, 25_846));
  });

  it('current ≤ placed in every component, for every shortage of the V1 and V3 store orders', () => {
    let checked = 0;
    for (const map of [V1, V2, V3]) {
      for (const store of map.values()) {
        const [first, second] = store.lines;
        assert.ok(first && second);
        for (let a = 0; a <= first.quantity; a += 1) {
          for (let b = 0; b <= second.quantity; b += 1) {
            const current = settleStoreOrder(linesOf(store, [a, b]), store);
            for (const field of Object.keys(current) as (keyof Amounts)[]) {
              assert.ok(
                current[field] >= 0 && current[field] <= store[field],
                `${store.storeId} ${a}/${b} ${field}`,
              );
            }
            checked += 1;
          }
        }
      }
    }
    assert.equal(checked, 7 * 2 + 21 * 5 + 7 * 2 + 21 * 5 + 25 * 3 + 25 * 7 + 4 * 21);
  });

  it('refuses a fulfilled quantity above the ordered one, and corrupt numbers', () => {
    assert.throws(() => settleStoreOrder(linesOf(boltbin, [25, 2]), boltbin), RangeError);
    assert.throws(() => settleStoreOrder(linesOf(boltbin, [1.5, 2]), boltbin), RangeError);
    assert.throws(() => settleStoreOrder(linesOf(boltbin, [-1, 2]), boltbin), RangeError);
  });
});

describe('storeValueCents (§3.6)', () => {
  it('is Σ unit price × fulfilled quantity, and equals current.itemsCents', () => {
    const kestrel = pricedStore(V1, 'kestrel-lumber');
    assert.equal(storeValueCents(linesOf(kestrel)), 18_772);
    assert.equal(storeValueCents(linesOf(kestrel, [10, 0])), 4_790);
    assert.equal(storeValueCents([]), 0);
  });

  it('a replacement is paid on catalogue prices, which the caller passes', () => {
    // Two replacement drywall sheets: the customer pays 0, Bluestone is paid 2 × 18.48.
    assert.equal(storeValueCents([{ unitPriceCents: 1_848, fulfilledQty: 2 }]), 3_696);
  });
});

// ---------- settleReturnToStore (§3.7) ----------

describe('settleReturnToStore (§3.7)', () => {
  const kestrel = pricedStore(V2, 'kestrel-lumber');

  it('site-caused failure: the items are not charged, the locked fees and their tax stay', () => {
    // 5 383 + 3 500 = 8 883 → HST 1 154.79 → 1 155; total 10 038.
    assert.deepEqual(settleReturnToStore(kestrel, true), money(0, 0, 5_383, 3_500, 1_155, 10_038));
  });

  it('driver-caused failure or fees waived by staff: void', () => {
    assert.deepEqual(settleReturnToStore(kestrel, false), voidAmounts());
  });

  it('fees waived at checkout stay waived', () => {
    assert.deepEqual(settleReturnToStore(pricedStore(V1, 'bluestone-drywall'), true), voidAmounts());
    // V1 Kestrel: only the labourer was charged: 3 500 → HST 455 → 3 955.
    assert.deepEqual(
      settleReturnToStore(pricedStore(V1, 'kestrel-lumber'), true),
      money(0, 0, 0, 3_500, 455, 3_955),
    );
  });
});

// ---------- refundForLines and its caps (§3.7) ----------

describe('refundForLines (§3.7)', () => {
  const bluestone = pricedStore(V1, 'bluestone-drywall');

  it('V5: 2 cracked drywall sheets refund 3 922 and claw back 3 326 from Bluestone', () => {
    assert.deepEqual(amountsOf(bluestone), money(14_086, 857, 0, 0, 1_720, 14_949));
    assert.deepEqual(
      bluestone.lines.map((line) => line.discountCents),
      [675, 182],
    );
    const refund = refundForLines(storeOrder(bluestone), [{ lineId: 'L1', quantity: 2 }], {
      includeDeliveryFee: false,
    });
    // Items 3 696; discount mulDivHalfUp(675, 2, 6) = 225; HST percentBps(3 471) = 451.23 → 451.
    assert.deepEqual(refund, money(3_696, 225, 0, 0, 451, 3_922));
    // Bluestone's commission is 1 000 bps: −(3 696 − 370).
    assert.equal(clawbackCents('store', refund.itemsCents, 1_000), 3_326);
  });

  it('a whole store order refunded with its fees is exactly its current amount', () => {
    for (const map of [V1, V2, V3]) {
      for (const store of map.values()) {
        const order = storeOrder(store);
        const refund = refundForLines(
          order,
          store.lines.map((line) => ({ lineId: line.lineId, quantity: line.quantity })),
          { includeDeliveryFee: true },
        );
        assert.deepEqual(refund, order.current, store.storeId);
      }
    }
    // Also after a shortage: V4 Boltbin, every supplied unit back → 13 755.
    const boltbin = pricedStore(V3, 'boltbin-hardware');
    const shorted = storeOrder(boltbin, [20, 2]);
    const refund = refundForLines(
      shorted,
      [
        { lineId: 'L1', quantity: 20 },
        { lineId: 'L2', quantity: 2 },
      ],
      { includeDeliveryFee: true },
    );
    assert.deepEqual(refund, money(12_576, 403, 0, 0, 1_582, 13_755));
  });

  it('includeDeliveryFee adds the delivery and labourer fees together, taxed with the items', () => {
    const kestrel = pricedStore(V2, 'kestrel-lumber');
    const withFees = refundForLines(storeOrder(kestrel), [{ lineId: 'L2', quantity: 1 }], {
      includeDeliveryFee: true,
    });
    // 2 298 + 5 383 + 3 500 = 11 181 → HST 1 453.53 → 1 454; total 12 635.
    assert.deepEqual(withFees, money(2_298, 0, 5_383, 3_500, 1_454, 12_635));
    const itemsOnly = refundForLines(storeOrder(kestrel), [{ lineId: 'L2', quantity: 1 }], {
      includeDeliveryFee: false,
    });
    // 2 298 → HST 298.74 → 299.
    assert.deepEqual(itemsOnly, money(2_298, 0, 0, 0, 299, 2_597));
    // The fees alone (a late delivery): 8 883 → 10 038.
    assert.deepEqual(
      refundForLines(storeOrder(kestrel), [], { includeDeliveryFee: true }),
      money(0, 0, 5_383, 3_500, 1_155, 10_038),
    );
  });

  it('a line named twice is one request for the sum; quantities of 0 refund nothing', () => {
    const twice = refundForLines(
      storeOrder(bluestone),
      [
        { lineId: 'L1', quantity: 1 },
        { lineId: 'L1', quantity: 1 },
        { lineId: 'L2', quantity: 0 },
      ],
      { includeDeliveryFee: false },
    );
    assert.deepEqual(twice, money(3_696, 225, 0, 0, 451, 3_922));
    assert.deepEqual(refundForLines(storeOrder(bluestone), [], { includeDeliveryFee: false }), voidAmounts());
  });

  it('refuses more than was supplied, an unknown line, and a quantity that is not whole', () => {
    const order = storeOrder(bluestone, [4, 1]);
    const options = { includeDeliveryFee: false };
    assert.throws(() => refundForLines(order, [{ lineId: 'L1', quantity: 5 }], options), RangeError);
    assert.throws(
      () =>
        refundForLines(
          order,
          [
            { lineId: 'L1', quantity: 3 },
            { lineId: 'L1', quantity: 2 },
          ],
          options,
        ),
      RangeError,
    );
    assert.throws(() => refundForLines(order, [{ lineId: 'L9', quantity: 1 }], options), RangeError);
    assert.throws(() => refundForLines(order, [{ lineId: 'L1', quantity: 0.5 }], options), RangeError);
    // Within the 4 supplied: fine.
    assert.equal(refundForLines(order, [{ lineId: 'L1', quantity: 4 }], options).itemsCents, 7_392);
  });

  it('before capture the refund comes off current field by field', () => {
    const order = storeOrder(bluestone);
    const refund = refundForLines(order, [{ lineId: 'L1', quantity: 2 }], { includeDeliveryFee: false });
    assert.deepEqual(subtractAmounts(order.current, refund), money(10_390, 632, 0, 0, 1_269, 11_027));
  });
});

describe('refundForLines: one issue after another on the same store order (§3.7, §5.5.7)', () => {
  const bluestone = pricedStore(V1, 'bluestone-drywall');
  const withPlaced = (store: PricedStore, fulfilled: readonly number[] = []) => {
    const order = storeOrder(store, fulfilled);
    return { ...order, placed: amountsOf(store) };
  };
  const one = (lineId: string, quantity: number) => [{ lineId, quantity }];

  it('the first refund is the §3.7 formula; the next ones come off what is left without going below 0', () => {
    // One line of 2 × 404, no discount: current 808 + 105 = 913.
    const template = linesOf(bluestone)[0];
    assert.ok(template);
    const line: StoreOrderLine = {
      ...template,
      unitPriceCents: 404,
      quantity: 2,
      fulfilledQty: 2,
      lineCents: 808,
      discountCents: 0,
    };
    const order = { lines: [line], current: money(808, 0, 0, 0, 105, 913) };
    const first = refundForLines(order, one('L1', 1), { includeDeliveryFee: false });
    assert.deepEqual(first, money(404, 0, 0, 0, 53, 457));
    const left = subtractAmounts(order.current, first);
    assert.deepEqual(left, money(404, 0, 0, 0, 52, 456));
    // The formula alone would give 53 of tax again, one more than is left.
    const second = refundForLines({ ...order, current: left }, one('L1', 1), {
      includeDeliveryFee: false,
      earlierRefunds: [{ lines: one('L1', 1), includeDeliveryFee: false }],
    });
    assert.deepEqual(second, money(404, 0, 0, 0, 52, 456));
    assert.deepEqual(subtractAmounts(left, second), voidAmounts());

    // 2 × 100 with a 1-cent discount share: the cent comes back once.
    const discounted = { ...line, unitPriceCents: 100, lineCents: 200, discountCents: 1 };
    const current = money(200, 1, 0, 0, 26, 225);
    const firstUnit = refundForLines({ lines: [discounted], current }, one('L1', 1), {
      includeDeliveryFee: false,
    });
    assert.equal(firstUnit.discountCents, 1); // mulDivHalfUp(1, 1, 2) = 0.5 → 1
    const secondUnit = refundForLines(
      { lines: [discounted], current: subtractAmounts(current, firstUnit) },
      one('L1', 1),
      { includeDeliveryFee: false, earlierRefunds: [{ lines: one('L1', 1), includeDeliveryFee: false }] },
    );
    assert.equal(secondUnit.discountCents, 0);
    assert.deepEqual(sumAmounts([firstUnit, secondUnit]), current);
  });

  it('refuses units that were already refunded, so the same sheets are not refunded or clawed back twice', () => {
    const order = withPlaced(bluestone);
    const sixSheets = { lines: one('L1', 6), includeDeliveryFee: false };
    assert.equal(refundForLines(order, sixSheets.lines, { includeDeliveryFee: false }).totalCents, 11_767);
    assert.throws(
      () => refundForLines(order, one('L1', 6), { includeDeliveryFee: false, earlierRefunds: [sixSheets] }),
      RangeError,
    );
    assert.throws(
      () => refundForLines(order, one('L1', 1), { includeDeliveryFee: false, earlierRefunds: [sixSheets] }),
      RangeError,
    );
    // V5's 2 sheets, then 2 more: 4 of the 6 in all, and the second claw-back is on its own 2 sheets.
    const v5 = { lines: one('L1', 2), includeDeliveryFee: false };
    const next = refundForLines(order, one('L1', 2), { includeDeliveryFee: false, earlierRefunds: [v5] });
    assert.equal(next.itemsCents, 3_696);
    // 4 sheets: 7 392 − mulDivHalfUp(675, 4, 6) = 450 → 6 942, HST 902 → 7 844; minus V5's 3 922.
    assert.deepEqual(next, money(3_696, 225, 0, 0, 451, 3_922));
    assert.throws(
      () =>
        refundForLines(order, one('L1', 3), {
          includeDeliveryFee: false,
          earlierRefunds: [v5, { lines: one('L1', 2), includeDeliveryFee: false }],
        }),
      RangeError,
    );
    // An earlier refund of a line the store order does not have is a corrupt record.
    assert.throws(
      () =>
        refundForLines(order, one('L1', 1), {
          includeDeliveryFee: false,
          earlierRefunds: [{ lines: one('L7', 1), includeDeliveryFee: false }],
        }),
      RangeError,
    );
  });

  it('refunds the fees once; after a refund took them before capture, they are priced from placed', () => {
    const kestrel = pricedStore(V2, 'kestrel-lumber');
    const order = withPlaced(kestrel);
    const late = refundForLines(order, [], { includeDeliveryFee: true });
    assert.deepEqual(late, money(0, 0, 5_383, 3_500, 1_155, 10_038));
    const current = subtractAmounts(order.current, late);
    const earlierRefunds = [{ lines: [], includeDeliveryFee: true }];
    // The fees asked again bring nothing more.
    const again = refundForLines({ ...order, current }, [], { includeDeliveryFee: true, earlierRefunds });
    assert.deepEqual(again, voidAmounts());
    // Without `placed`, the fees taken off `current` cannot be priced.
    assert.throws(
      () =>
        refundForLines({ lines: order.lines, current }, one('L2', 1), {
          includeDeliveryFee: false,
          earlierRefunds,
        }),
      RangeError,
    );
    const sheet = refundForLines({ ...order, current }, one('L2', 1), {
      includeDeliveryFee: false,
      earlierRefunds,
    });
    assert.equal(sheet.itemsCents, 2_298);
    assert.ok(sheet.taxCents <= current.taxCents);
  });

  it('5 000 store orders refunded unit by unit before capture: never below 0, and exactly current in all', () => {
    let seed = 20_261_120;
    const random = (): number => {
      // mulberry32
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
    const below = (limit: number): number => Math.floor(random() * limit);
    const template = linesOf(bluestone)[0];
    assert.ok(template);

    for (let run = 0; run < 5_000; run += 1) {
      const lines: StoreOrderLine[] = Array.from({ length: 1 + below(3) }, (_, index) => {
        const unitPriceCents = 1 + below(5_000);
        const quantity = 1 + below(8);
        const lineCents = unitPriceCents * quantity;
        return {
          ...template,
          lineId: `L${index + 1}`,
          unitPriceCents,
          quantity,
          fulfilledQty: below(quantity + 1),
          lineCents,
          discountCents: random() < 0.3 ? 0 : below(Math.floor(lineCents / 3) + 1),
        };
      });
      const deliveryFeeCents = random() < 0.5 ? 0 : 2_999 + below(5_000);
      const unloadFeeCents = random() < 0.5 ? 0 : 3_500;
      const items = lines.reduce((sum, line) => sum + line.lineCents, 0);
      const discount = lines.reduce((sum, line) => sum + line.discountCents, 0);
      const taxable = items - discount + deliveryFeeCents + unloadFeeCents;
      const tax = Math.round((taxable * 13) / 100);
      const placed = money(items, discount, deliveryFeeCents, unloadFeeCents, tax, taxable + tax);
      const start = settleStoreOrder(lines, placed);
      if (start.totalCents === 0) continue;

      // Every supplied unit, shuffled, in refunds of 1 to 3 units; one of them takes the fees.
      const units = lines.flatMap((line) => Array.from({ length: line.fulfilledQty }, () => line.lineId));
      for (let index = units.length - 1; index > 0; index -= 1) {
        const other = below(index + 1);
        const [a, b] = [units[index], units[other]];
        if (a !== undefined && b !== undefined) [units[index], units[other]] = [b, a];
      }
      const requests: { lines: { lineId: string; quantity: number }[]; includeDeliveryFee: boolean }[] = [];
      for (let index = 0; index < units.length;) {
        const size = 1 + below(3);
        requests.push({
          lines: units.slice(index, index + size).map((lineId) => ({ lineId, quantity: 1 })),
          includeDeliveryFee: false,
        });
        index += size;
      }
      if (requests.length === 0) requests.push({ lines: [], includeDeliveryFee: true });
      const withFee = requests[below(requests.length)];
      if (withFee) withFee.includeDeliveryFee = true;

      let current = start;
      const refunds: Amounts[] = [];
      for (const [index, request] of requests.entries()) {
        const refund = refundForLines({ lines, current, placed }, request.lines, {
          includeDeliveryFee: request.includeDeliveryFee,
          earlierRefunds: requests.slice(0, index),
        });
        current = subtractAmounts(current, refund); // throws if any field went below 0
        refunds.push(refund);
      }
      assert.deepEqual(current, voidAmounts(), `run ${run}`);
      // After capture `current` stays; the refunds still add up to it exactly, never to more.
      assert.deepEqual(sumAmounts(refunds), start, `run ${run}`);
    }
  });
});

describe('refundableCents: the caps of §3.7', () => {
  const bluestone = { id: 'IS-10001-A', current: amountsOf(pricedStore(V1, 'bluestone-drywall')) };

  it('V5 after capture: the whole store order is refundable, then what is left of it', () => {
    assert.equal(refundableCents(bluestone, payment(38_825, 0, {})), 14_949);
    assert.equal(refundableCents(bluestone, payment(38_825, 3_922, { 'IS-10001-A': 3_922 })), 11_027);
  });

  it('refunds of another store order do not count against this one, but do against the capture', () => {
    // Kestrel (IS-10001-B, 23 876) was refunded in full: 38 825 − 23 876 = 14 949 left, all of it Bluestone's.
    assert.equal(refundableCents(bluestone, payment(38_825, 23_876, { 'IS-10001-B': 23_876 })), 14_949);
    // Only 825 of the capture is left.
    assert.equal(refundableCents(bluestone, payment(38_825, 38_000, { 'IS-10001-B': 38_000 })), 825);
  });

  it('never below 0', () => {
    assert.equal(refundableCents(bluestone, payment(38_825, 14_949, { 'IS-10001-A': 14_949 })), 0);
    assert.equal(refundableCents(bluestone, payment(10_000, 10_000, {})), 0);
    assert.equal(refundableCents(bluestone, payment(0, 0, {})), 0);
  });

  it('the refund paid is the smaller of the computed refund and the cap', () => {
    const order = storeOrder(pricedStore(V1, 'bluestone-drywall'));
    const refund = refundForLines(order, [{ lineId: 'L1', quantity: 6 }], { includeDeliveryFee: false });
    // 6 sheets: 11 088 − 675 = 10 413 → HST 1 353.69 → 1 354; total 11 767.
    assert.equal(refund.totalCents, 11_767);
    const cap = refundableCents(bluestone, payment(38_825, 3_922, { 'IS-10001-A': 3_922 }));
    assert.equal(Math.min(refund.totalCents, cap), 11_027);
  });
});

describe('clawbackCents (§3.7, §3.9)', () => {
  it('store: refunded items minus the commission on them; driver: the full value; others: none', () => {
    assert.equal(clawbackCents('store', 3_696, 1_000), 3_326);
    // Kestrel at 900 bps: 9 580 − 862 (862.2) = 8 718.
    assert.equal(clawbackCents('store', 9_580, 900), 8_718);
    // Commission half-up: 5 at 1 000 bps is 0.5 → 1.
    assert.equal(clawbackCents('store', 5, 1_000), 4);
    assert.equal(clawbackCents('driver', 3_696, 1_000), 3_696);
    assert.equal(clawbackCents('platform', 3_696, 1_000), 0);
    assert.equal(clawbackCents('customer', 3_696, 1_000), 0);
    assert.equal(clawbackCents(null, 3_696, 1_000), 0);
    assert.equal(clawbackCents('store', 0, 1_000), 0);
  });

  it('refuses corrupt amounts', () => {
    assert.throws(() => clawbackCents('store', -1, 1_000), RangeError);
    assert.throws(() => clawbackCents('store', 100, 20_000), RangeError);
  });
});

describe('sumAmounts and subtractAmounts', () => {
  it('sum field by field; nothing gives all zeros', () => {
    assert.deepEqual(sumAmounts([]), voidAmounts());
    assert.deepEqual(sumAmounts([...V1.values()]), money(32_858, 2_000, 0, 3_500, 4_467, 38_825));
    assert.deepEqual(sumAmounts([...V3.values()]), money(77_930, 2_500, 0, 3_500, 10_261, 89_191));
  });

  it('released at capture is placed − current; going below 0 throws', () => {
    const boltbin = pricedStore(V3, 'boltbin-hardware');
    const current = settleStoreOrder(linesOf(boltbin, [20, 2]), boltbin);
    assert.deepEqual(subtractAmounts(boltbin, current), money(1_116, 36, 0, 0, 141, 1_221));
    assert.throws(() => subtractAmounts(current, boltbin), RangeError);
    assert.throws(() => sumAmounts([money(-1, 0, 0, 0, 0, 0)]), RangeError);
  });

  it('do not change their inputs', () => {
    const a = money(1, 2, 3, 4, 5, 6);
    const b = money(1, 1, 1, 1, 1, 1);
    subtractAmounts(a, b);
    sumAmounts([a, b]);
    assert.deepEqual([a, b], [money(1, 2, 3, 4, 5, 6), money(1, 1, 1, 1, 1, 1)]);
  });
});
