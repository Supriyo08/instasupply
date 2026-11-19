/**
 * Checkout pricing (§3.2, §3.4–§3.7). One pure function prices the cart preview, checkout, `placeOrder`,
 * quotes, the seed and the tests, so the app and the server always agree to the cent (D4). Settlement
 * after a short shipment and refunds are computed here too, from the line shares fixed at placement.
 *
 * All money is whole CAD cents and goes through `money.ts`; nothing here reads a clock (`today` is an
 * input and only decides whether a promo is running).
 *
 * A cart that cannot be placed is never an exception: the reasons come back as blockers. A number that
 * cannot be a price, a quantity or an amount at all (a fraction of a cent, a negative quantity, `NaN`)
 * throws a `RangeError`, like the money functions underneath: a wrong charge must fail loudly.
 */
import type { DimsCm, SellUnit, Store } from './catalog';
import { roadTenths } from './geo';
import type { FaultParty } from './issues';
import { CURRENCY, TAX } from './market';
import type {
  Amounts,
  AppliedDiscount,
  Fulfilment,
  OrderPayment,
  Receiving,
  StoreOrder,
  StoreOrderLine,
} from './marketplace';
import { allocate, formatMoney, mulDivHalfUp, percentBps } from './money';
import type { LatLng } from './types';
import { VEHICLE_CLASSES, canCarry, deliveryFeeListCents, summarizeLoad } from './vehicles';
import type { LoadSummary, VehicleClass } from './vehicles';

// ---------- constants (§3.2) ----------

/** Ontario HST, 13 %: the same number as `TAX.rateBps`. */
export const TAX_RATE_BPS = TAX.rateBps;
/** Order items (before discounts) of at least $500.00 make every delivery fee of the order $0. */
export const FREE_DELIVERY_MIN_ITEMS_CENTS = 50_000;
/** "$0 delivery fee on your first order", with no cap. */
export const FIRST_ORDER_FREE_DELIVERY = true;
/** "$20 off your first order over $250". */
export const FIRST_ORDER_DISCOUNT_CENTS = 2_000;
export const FIRST_ORDER_DISCOUNT_MIN_ITEMS_CENTS = 25_000;
// `INCLUDED_ROAD_TENTHS` (the 10 km every base fee includes) also belongs to §3.2. It is declared in
// vehicles.ts, next to the fee table and the fee formula that use it: declared here, vehicles.ts and
// pricing.ts would have to import each other.
export const MAX_CART_LINES = 100;
export const MAX_LINE_QUANTITY = 9_999;
/** Store orders are lettered A–E. */
export const MAX_STORES_PER_ORDER = 5;
/** A dispatcher can refund at most $100.00 per action (`REFUND_LIMIT`); admins have no limit. */
export const DISPATCHER_REFUND_LIMIT_CENTS = 10_000;

export interface Promo {
  code: string;
  kind: 'fixed' | 'percent';
  /** `fixed` only. */
  valueCents?: number;
  /** `percent` only; the discount is rounded down. */
  percent?: number;
  /** `percent` only: the most the code can take off. */
  maxDiscountCents?: number;
  minItemsCents: number;
  firstOrderOnly: boolean;
  /** null: no limit. */
  maxUsesPerCustomer: number | null;
  /** Toronto dates, both inclusive. */
  startsOn: string;
  endsOn: string;
  label: string;
}

/** A promo code never stacks with the $20 welcome discount: the larger one wins (D5). */
export const PROMOS: Record<string, Promo> = {
  BUILD25: {
    code: 'BUILD25',
    kind: 'fixed',
    valueCents: 2_500,
    minItemsCents: 75_000,
    firstOrderOnly: false,
    maxUsesPerCustomer: null,
    startsOn: '2026-11-01',
    endsOn: '2027-03-31',
    label: '$25 off orders of $750+',
  },
  CREW5: {
    code: 'CREW5',
    kind: 'percent',
    percent: 5,
    maxDiscountCents: 10_000,
    minItemsCents: 100_000,
    firstOrderOnly: false,
    maxUsesPerCustomer: 1,
    startsOn: '2026-11-01',
    endsOn: '2027-03-31',
    label: '5% off $1,000+ (max $100), once per account',
  },
};

// ---------- input and result of priceCheckout (§3.4) ----------

export interface PricingLine {
  lineId: string;
  /** `custom` is a special-order line a quote adds (D16). */
  kind: 'catalog' | 'custom';
  productId: string | null;
  name: string;
  unit: SellUnit;
  size: string | null;
  unitPriceCents: number;
  quantity: number;
  /** Per sell unit. */
  weightKg: number;
  /** Per sell unit. */
  dimsCm: DimsCm;
}

export interface PricingStoreInput {
  storeId: string;
  store: Pick<Store, 'name' | 'location' | 'status' | 'acceptingOrders' | 'fulfilment'>;
  lines: PricingLine[];
}

/** Stock and time are not inputs: they are checked separately, so a price never depends on the clock. */
export interface CheckoutInput {
  fulfilment: Fulfilment;
  stores: PricingStoreInput[];
  /** Delivery only. */
  dropoff: { location: LatLng; receiving: Receiving; maxVehicleClass: VehicleClass | null } | null;
  unloadHelpStoreIds: string[];
  promoCode: string | null;
  customer: { isFirstOrder: boolean; promoUses: Record<string, number> };
  source: 'cart' | 'quote' | 'replacement';
  /** Toronto date, `YYYY-MM-DD`; only decides whether a promo is running. */
  today: string;
}

/** Why an order cannot be placed. The server throws each one upper-cased as an `ErrorCode` (§5.9). */
export type PricingErrorCode =
  | 'empty'
  | 'too_many_stores'
  | 'no_dropoff'
  | 'store_unavailable'
  | 'store_paused'
  | 'delivery_unavailable'
  | 'pickup_unavailable'
  | 'out_of_range'
  | 'too_large'
  | 'jobsite_vehicle_limit';

export interface PricingError {
  code: PricingErrorCode;
  storeId: string | null;
  message: string;
}

/** `not_better`: the code is valid, but the $20 welcome discount is at least as large; it is not used up. */
export type PromoStatus =
  'applied' | 'not_better' | 'invalid' | 'expired' | 'min_not_met' | 'first_order_only' | 'used_up';

/** One store's part of the checkout. The amounts add up to the order's, to the cent. */
export interface PricedStore extends Amounts {
  storeId: string;
  /** A, B, … in ascending `storeId` order; the store order becomes `IS-10042-A`. */
  letter: string;
  lines: (PricingLine & { lineCents: number; discountCents: number })[];
  load: LoadSummary;
  vehicleClass: VehicleClass | null;
  /** Null for pickup. */
  roadTenths: number | null;
  /** Null for pickup. */
  roadKm: number | null;
  /** The fee before any waiver, so the UI can strike it through. */
  deliveryFeeListCents: number;
  feeWaiver: 'first_order' | 'free_threshold' | 'replacement' | null;
  /** Step 6; `feeCents` is the labourer charged (`unloadFeeCents`), 0 when not selected. */
  unload: { offered: boolean; required: boolean; selected: boolean; feeCents: number };
  /** The driver must enter the hand-off code: delivery to an attended site. */
  requireCode: boolean;
  /** A store with errors is still priced for the preview, but blocks placing the order. */
  errors: PricingError[];
}

export interface PricedCheckout extends Amounts {
  currency: 'CAD';
  taxRateBps: 1300;
  stores: PricedStore[];
  itemCount: number;
  lineCount: number;
  /** None or one: a promo code never stacks with the welcome discount (D5). */
  discounts: AppliedDiscount[];
  promo: { code: string; status: PromoStatus; message: string } | null;
  freeDelivery: 'first_order' | 'free_threshold' | null;
  /** "Add $171.42 more for free delivery"; 0 when it does not apply. */
  amountToFreeDeliveryCents: number;
  amountToFirstOrderDiscountCents: number;
  canPlace: boolean;
  blockers: PricingError[];
}

// ---------- guards ----------

/**
 * A price, a quantity or an amount is a whole number of 0 or more. Anything else is corrupt data, not
 * a cart that cannot be placed, so it fails loudly instead of turning into a wrong charge. A -0 comes
 * back as 0: a database stores -0 as a float, and a rule that asks for a whole amount would refuse it.
 */
function requireWhole(label: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative whole number, got ${String(value)}`);
  }
  return value === 0 ? 0 : value;
}

/** Above 2^53 − 1 a sum or a product of whole numbers may no longer be exact: a cent could go missing. */
function requireExact(label: string, value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} is too large to stay exact`);
  return value;
}

/**
 * A store order's amounts from their four parts (§3.4 step 7). HST is charged on the items net of the
 * discount, on the delivery fee and on the labourer fee, rounded half-up once per store order
 * (§3.1 rule 8): every store's receipt is right on its own, and the order is the sum of them.
 */
function amountsFrom(
  itemsCents: number,
  discountCents: number,
  deliveryFeeCents: number,
  unloadFeeCents: number,
): Amounts {
  if (discountCents > itemsCents) {
    throw new RangeError(`a discount of ${discountCents} cannot be taken off items worth ${itemsCents}`);
  }
  const taxableCents = requireExact(
    'the taxable amount',
    itemsCents - discountCents + deliveryFeeCents + unloadFeeCents,
  );
  const taxCents = percentBps(taxableCents, TAX_RATE_BPS);
  return {
    itemsCents,
    discountCents,
    deliveryFeeCents,
    unloadFeeCents,
    taxCents,
    totalCents: requireExact('the total', taxableCents + taxCents),
  };
}

/** Splits `totalCents` over `items` in proportion to their weights (§3.1 rule 4) and hands each its share. */
function shareOut<Item, Result>(
  totalCents: number,
  items: readonly Item[],
  weightOf: (item: Item) => number,
  build: (item: Item, shareCents: number, index: number) => Result,
): Result[] {
  const shares = allocate(totalCents, items.map(weightOf));
  // `allocate` returns exactly one share per weight, so `shares[index]` always exists.
  return items.map((item, index) => build(item, shares[index]!, index));
}

// ---------- step 1: the cart, whatever order it arrives in ----------

/** Plain UTF-16 order, the same on every engine. `localeCompare` is `Intl`, which differs between them (D14). */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const isDigit = (code: number): boolean => code >= 48 && code <= 57;

/** The run of digits that starts at `from`, without leading zeros, so that two runs compare as numbers. */
function digitsAt(text: string, from: number): { digits: string; end: number } {
  let end = from;
  while (end < text.length && isDigit(text.charCodeAt(end))) end += 1;
  let start = from;
  while (start < end - 1 && text.charCodeAt(start) === 48) start += 1;
  return { digits: text.slice(start, end), end };
}

/**
 * The order of a store's lines: by line id, where a run of digits counts as a number. L2 comes before
 * L10, so lines numbered L1, L2, … stay in the order they were numbered.
 */
function compareLineIds(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(j);
    if (isDigit(x) && isDigit(y)) {
      const left = digitsAt(a, i);
      const right = digitsAt(b, j);
      if (left.digits.length !== right.digits.length) return left.digits.length - right.digits.length;
      if (left.digits !== right.digits) return compareText(left.digits, right.digits);
      i = left.end;
      j = right.end;
    } else {
      if (x !== y) return x - y;
      i += 1;
      j += 1;
    }
  }
  // One id is the start of the other: the shorter first. "L01" and "L1" differ only as plain text.
  return a.length - i - (b.length - j) || compareText(a, b);
}

/** Everything else a line says: tells apart two lines that a caller gave the same id. */
const lineKey = (line: PricingLine): string =>
  [
    line.kind,
    line.productId,
    line.name,
    line.unit,
    line.size,
    line.unitPriceCents,
    line.quantity,
    line.weightKg,
    line.dimsCm.l,
    line.dimsCm.w,
    line.dimsCm.h,
  ]
    .map(String)
    .join('\u0000');

/** The same for two entries of one store. */
const storeKey = (store: PricingStoreInput['store']): string =>
  [
    store.name,
    store.location.lat,
    store.location.lng,
    store.status,
    store.acceptingOrders,
    store.fulfilment.delivery,
    store.fulfilment.pickup,
    store.fulfilment.deliveryRadiusKm,
  ]
    .map(String)
    .join('\u0000');

interface CartStore {
  storeId: string;
  store: PricingStoreInput['store'];
  lines: PricingLine[];
}

/**
 * §3.4 step 1. Lines with a quantity of 0 are dropped, stores are put in ascending `storeId` order
 * (the order of the letters A, B, …) and each store's lines in line-id order. The result therefore
 * depends on what is in the cart, never on the order a caller listed it in: the phone and the server
 * must reach the same cents (D4), down to which line gets the odd cent of a discount.
 *
 * The spec is silent on two entries for one store: they are priced as one store order, because one
 * checkout never sends a store two orders or charges two delivery fees for it (D1). It is also silent
 * on a store whose lines are all dropped: such a store is not part of the order.
 */
function normalizeCart(stores: readonly PricingStoreInput[]): CartStore[] {
  const sorted = [...stores].sort(
    (a, b) => compareText(a.storeId, b.storeId) || compareText(storeKey(a.store), storeKey(b.store)),
  );
  const cart: CartStore[] = [];
  for (const entry of sorted) {
    const lines = entry.lines.filter((line) => line.quantity !== 0);
    const previous = cart[cart.length - 1];
    if (previous !== undefined && previous.storeId === entry.storeId) previous.lines.push(...lines);
    else cart.push({ storeId: entry.storeId, store: entry.store, lines });
  }
  for (const entry of cart) {
    entry.lines.sort((a, b) => compareLineIds(a.lineId, b.lineId) || compareText(lineKey(a), lineKey(b)));
  }
  return cart.filter((entry) => entry.lines.length > 0);
}

/** A, B, … Z, then AA, AB, …: only A–E can be placed (`too_many_stores`); the rest is for the preview. */
function letterAt(index: number): string {
  let letter = '';
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1)
    letter = String.fromCharCode(65 + (n % 26)) + letter;
  return letter;
}

// ---------- step 2: each store's items, load, distance and errors ----------

type Dropoff = NonNullable<CheckoutInput['dropoff']>;
type DraftLine = PricingLine & { lineCents: number };

/** A store after step 2: everything that does not depend on the other stores of the order. */
interface StoreDraft {
  storeId: string;
  store: PricingStoreInput['store'];
  lines: DraftLine[];
  itemsCents: number;
  load: LoadSummary;
  /** Null for pickup, and for a delivery that has no drop-off yet. */
  roadTenths: number | null;
  errors: PricingError[];
}

/** How error messages name a class: "needs a box truck", "takes an SUV at most". */
const VEHICLE_PHRASES: Record<VehicleClass, string> = {
  car: 'a car',
  suv: 'an SUV',
  pickup: 'a pickup truck',
  cargo_van: 'a cargo van',
  box_truck: 'a box truck',
  flatbed: 'a flatbed truck',
};

/** Tenths of a km as "52.3". Written by hand: number formatting through `Intl` differs between engines (D14). */
const formatKm = (tenths: number): string => `${(tenths - (tenths % 10)) / 10}.${tenths % 10}`;

const TOO_LARGE_MESSAGE = 'Too large for one delivery. Send us your list for a quote.';

/**
 * Why this store cannot be part of the order, in the order of §3.4 step 2. A store can have several
 * reasons at once; the server throws the first one (§5.5.1). The distance and site limits only
 * matter when we deliver; a load too large for any vehicle is refused either way.
 */
function storeErrors(
  storeId: string,
  store: PricingStoreInput['store'],
  load: LoadSummary,
  tenths: number | null,
  delivery: boolean,
  dropoff: Dropoff | null,
): PricingError[] {
  const errors: PricingError[] = [];
  const add = (code: PricingErrorCode, message: string): void => {
    errors.push({ code, storeId, message });
  };

  if (store.status !== 'live') add('store_unavailable', `${store.name} isn't taking orders right now`);
  if (!store.acceptingOrders) add('store_paused', `${store.name} has paused new orders`);
  if (!delivery) {
    if (!store.fulfilment.pickup) add('pickup_unavailable', `${store.name} doesn't offer pickup`);
    // §3.4 step 2 lists too_large for every fulfilment: a load no vehicle class carries goes
    // through a quote, picked up or delivered.
    if (load.vehicleClass === null) add('too_large', TOO_LARGE_MESSAGE);
    return errors;
  }

  if (!store.fulfilment.delivery) add('delivery_unavailable', `${store.name} doesn't offer delivery`);
  const radiusKm = store.fulfilment.deliveryRadiusKm;
  if (tenths !== null && tenths / 10 > radiusKm) {
    add(
      'out_of_range',
      `${store.name} delivers within ${radiusKm} km; your site is ${formatKm(tenths)} km away`,
    );
  }
  if (load.vehicleClass === null) {
    add('too_large', TOO_LARGE_MESSAGE);
  } else if (
    dropoff !== null &&
    dropoff.maxVehicleClass !== null &&
    !canCarry(dropoff.maxVehicleClass, load.vehicleClass)
  ) {
    add(
      'jobsite_vehicle_limit',
      `The load from ${store.name} needs ${VEHICLE_PHRASES[load.vehicleClass]}; ` +
        `your site takes ${VEHICLE_PHRASES[dropoff.maxVehicleClass]} at most`,
    );
  }
  return errors;
}

function draftStore(entry: CartStore, delivery: boolean, dropoff: Dropoff | null): StoreDraft {
  const { storeId, store } = entry;
  let itemsCents = 0;
  const lines = entry.lines.map((line): DraftLine => {
    const at = `priceCheckout: store ${storeId}, line ${line.lineId}`;
    const unitPriceCents = requireWhole(`${at}: unitPriceCents`, line.unitPriceCents);
    const quantity = requireWhole(`${at}: quantity`, line.quantity);
    // §3.1 rule 1: a line total is the unit price times the quantity, exactly.
    const lineCents = requireExact(`${at}: the line total`, unitPriceCents * quantity);
    itemsCents += lineCents;
    // Field by field: the result is stored and sent as plain data, so it must not carry whatever
    // else the caller's line object happens to hold, nor share its `dimsCm` with the input.
    return {
      lineId: line.lineId,
      kind: line.kind,
      productId: line.productId,
      name: line.name,
      unit: line.unit,
      size: line.size,
      unitPriceCents,
      quantity,
      weightKg: line.weightKg,
      dimsCm: { l: line.dimsCm.l, w: line.dimsCm.w, h: line.dimsCm.h },
      lineCents,
    };
  });
  requireExact(`priceCheckout: store ${storeId}: the items`, itemsCents);

  const load = summarizeLoad(lines);
  const tenths = dropoff === null ? null : roadTenths(store.location, dropoff.location);
  return {
    storeId,
    store,
    lines,
    itemsCents,
    load,
    roadTenths: tenths,
    errors: storeErrors(storeId, store, load, tenths, delivery, dropoff),
  };
}

// ---------- step 3: at most one discount ----------

interface DiscountChoice {
  cents: number;
  /** None or one. */
  discounts: AppliedDiscount[];
  promo: PricedCheckout['promo'];
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "$20", as the site writes round amounts; `formatMoney` gives "$20.00". */
const roundDollars = (cents: number): string => formatMoney(cents).replace(/\.00$/, '');

/** What a customer typed into the promo field, as codes are stored: trimmed, upper case. */
function normalizePromoCode(code: string | null | undefined): string {
  return typeof code === 'string' ? code.trim().toUpperCase() : '';
}

/**
 * Why a promo cannot be used on this order, checked in the order of §3.4 step 3; null when it can.
 * Dates are Toronto dates in `YYYY-MM-DD`, which compare correctly as text. A `today` that is not such
 * a date is outside every promo's dates: a broken date must never hand out a discount.
 */
function promoRefusal(
  promo: Promo,
  orderItems: number,
  customer: CheckoutInput['customer'],
  today: string,
): { status: 'expired' | 'first_order_only' | 'used_up' | 'min_not_met'; message: string } | null {
  const { code } = promo;
  if (!LOCAL_DATE.test(today) || today > promo.endsOn) {
    return { status: 'expired', message: `${code} has expired` };
  }
  if (today < promo.startsOn) return { status: 'expired', message: `${code} can't be used yet` };
  if (promo.firstOrderOnly && !customer.isFirstOrder) {
    return { status: 'first_order_only', message: `${code} is for first orders only` };
  }
  if (promo.maxUsesPerCustomer !== null && (customer.promoUses[code] ?? 0) >= promo.maxUsesPerCustomer) {
    return { status: 'used_up', message: `You've already used ${code}` };
  }
  if (orderItems < promo.minItemsCents) {
    const missing = formatMoney(promo.minItemsCents - orderItems);
    return { status: 'min_not_met', message: `Add ${missing} more to use ${code}` };
  }
  return null;
}

/**
 * What a usable promo takes off: a fixed amount, or a percentage rounded down (§3.1 rule 8) up to the
 * promo's cap. Never more than the items themselves.
 */
function promoDiscountCents(promo: Promo, orderItems: number): number {
  if (promo.kind === 'fixed')
    return Math.min(requireWhole(`${promo.code}: valueCents`, promo.valueCents ?? 0), orderItems);
  const scaled = orderItems * (promo.percent ?? 0);
  // The division below is exact only while `scaled` is: refuse the rest rather than misprice it.
  if (!(scaled >= 0 && scaled <= Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(
      `${promo.code}: ${String(promo.percent)} % of ${orderItems} cannot be worked out exactly`,
    );
  }
  return Math.min(Math.floor(scaled / 100), promo.maxDiscountCents ?? orderItems, orderItems);
}

/**
 * §3.4 step 3: the welcome discount or the promo code, whichever takes more off, never both (D5). On
 * a tie the welcome discount wins, so that the customer keeps the code for another order.
 */
function chooseDiscount(input: CheckoutInput, orderItems: number): DiscountChoice {
  const { customer } = input;
  // "$20 off your first order over $250". A replacement is free and is nobody's first purchase.
  const welcomeCents =
    customer.isFirstOrder &&
    input.source !== 'replacement' &&
    orderItems >= FIRST_ORDER_DISCOUNT_MIN_ITEMS_CENTS
      ? Math.min(FIRST_ORDER_DISCOUNT_CENTS, orderItems)
      : 0;
  const welcome: Pick<DiscountChoice, 'cents' | 'discounts'> =
    welcomeCents > 0
      ? {
          cents: welcomeCents,
          discounts: [
            {
              kind: 'first_order',
              code: null,
              label: `${roundDollars(FIRST_ORDER_DISCOUNT_CENTS)} off your first order`,
              cents: welcomeCents,
            },
          ],
        }
      : { cents: 0, discounts: [] };

  const typed = normalizePromoCode(input.promoCode);
  // An empty promo field is not a wrong code: there is nothing to report.
  if (typed === '') return { ...welcome, promo: null };

  const promo = findPromo(typed);
  if (promo === null) {
    return {
      ...welcome,
      promo: { code: typed, status: 'invalid', message: `${typed} isn't a valid promo code` },
    };
  }
  const { code } = promo;
  const refusal = promoRefusal(promo, orderItems, customer, input.today);
  if (refusal !== null) return { ...welcome, promo: { code, ...refusal } };

  const promoCents = promoDiscountCents(promo, orderItems);
  if (welcomeCents > 0 && welcomeCents >= promoCents) {
    const message = `Your first-order discount of ${formatMoney(welcomeCents)} applies instead; ${code} was not used`;
    return { ...welcome, promo: { code, status: 'not_better', message } };
  }
  return {
    cents: promoCents,
    discounts: [{ kind: 'promo', code, label: promo.label, cents: promoCents }],
    promo: { code, status: 'applied', message: `${code} applied: ${formatMoney(promoCents)} off` },
  };
}

// ---------- pricing (§3.4) ----------

/**
 * The promo a customer typed, or null when there is no such code. The code is trimmed and upper-cased
 * first, so "build25 " finds BUILD25. Whether it applies to a cart is `priceCheckout`'s decision.
 */
export function findPromo(code: string | null | undefined): Promo | null {
  const key = normalizePromoCode(code);
  // Own entries only: "constructor" and the like are not promo codes.
  if (key === '' || !Object.prototype.hasOwnProperty.call(PROMOS, key)) return null;
  return PROMOS[key] ?? null;
}

/**
 * The only pricing function (§3.4, steps 1–8). It never throws for a cart that cannot be placed: the
 * reasons come back as `blockers` and per-store `errors`, the cart is still priced for the preview, and
 * `canPlace` is false. Neither stock nor time is checked here (§5.5.1).
 *
 * The result does not depend on the order of `stores` or of a store's `lines`: stores come back in
 * `storeId` order with their letters, lines in line-id order (L2 before L10). It shares no object with
 * the input.
 */
export function priceCheckout(input: CheckoutInput): PricedCheckout {
  const delivery = input.fulfilment === 'delivery';
  const replacement = input.source === 'replacement';
  const dropoff = delivery ? input.dropoff : null;
  const { isFirstOrder } = input.customer;

  // Step 1: normalize, and the blockers that are about the whole cart.
  const cart = normalizeCart(input.stores);
  const blockers: PricingError[] = [];
  if (cart.length === 0) blockers.push({ code: 'empty', storeId: null, message: 'Your cart is empty' });
  if (cart.length > MAX_STORES_PER_ORDER) {
    const message = `One order can have items from up to ${MAX_STORES_PER_ORDER} stores`;
    blockers.push({ code: 'too_many_stores', storeId: null, message });
  }
  if (delivery && dropoff === null) {
    blockers.push({ code: 'no_dropoff', storeId: null, message: 'Choose a jobsite for delivery' });
  }

  // Step 2: each store on its own. A store with errors is still priced, for the preview.
  const drafts = cart.map((entry) => draftStore(entry, delivery, dropoff));
  let orderItems = 0;
  let itemCount = 0;
  let lineCount = 0;
  for (const draft of drafts) {
    orderItems += draft.itemsCents;
    itemCount += draft.load.pieces;
    lineCount += draft.lines.length;
    blockers.push(...draft.errors);
  }
  requireExact('priceCheckout: the order items', orderItems);

  // Step 3: the discount is decided on the whole order's items.
  const discount = chooseDiscount(input, orderItems);

  // Step 5: one waiver decision for every store of the order (D5). The thresholds look at the items
  // before discounts, so using a promo never costs the customer their free delivery.
  const feeWaiver: PricedStore['feeWaiver'] = !delivery
    ? null
    : replacement
      ? 'replacement'
      : isFirstOrder && FIRST_ORDER_FREE_DELIVERY
        ? 'first_order'
        : orderItems >= FREE_DELIVERY_MIN_ITEMS_CENTS
          ? 'free_threshold'
          : null;

  // Steps 4 to 7. The discount is split over the stores by their items and, inside each store, over
  // its lines; the line shares are kept so that settlements and refunds are exact later (§3.6, §3.7).
  const stores = shareOut(
    discount.cents,
    drafts,
    (draft) => draft.itemsCents,
    (draft, discountCents, index): PricedStore => {
      const { load, roadTenths: tenths, storeId } = draft;
      const vehicleClass = load.vehicleClass;

      // Step 5. The list fee is returned even when it is waived, so the UI can strike it through.
      // Without a drop-off, or with a load no vehicle takes, there is no fee to quote yet.
      const listFeeCents =
        delivery && tenths !== null && vehicleClass !== null ? deliveryFeeListCents(vehicleClass, tenths) : 0;
      const deliveryFeeCents = feeWaiver === null ? listFeeCents : 0;

      // Step 6: "Need help unloading? Add a labourer". Not offered for a car-sized load or for
      // pickup; mandatory when nobody is on site and the load is heavy (D5); free on a replacement.
      const labourerFeeCents =
        delivery && vehicleClass !== null ? VEHICLE_CLASSES[vehicleClass].labourerFeeCents : null;
      const offered = labourerFeeCents !== null;
      const required = offered && dropoff !== null && dropoff.receiving === 'unattended' && load.heavy;
      const selected = offered && (required || input.unloadHelpStoreIds.includes(storeId));
      const unloadPriceCents = labourerFeeCents !== null && !replacement ? labourerFeeCents : 0;
      const unloadFeeCents = selected ? unloadPriceCents : 0;

      return {
        storeId,
        letter: letterAt(index),
        // Step 7.
        ...amountsFrom(draft.itemsCents, discountCents, deliveryFeeCents, unloadFeeCents),
        lines: shareOut(
          discountCents,
          draft.lines,
          (line) => line.lineCents,
          (line, lineDiscountCents) => ({ ...line, discountCents: lineDiscountCents }),
        ),
        load,
        vehicleClass,
        roadTenths: tenths,
        roadKm: tenths === null ? null : tenths / 10,
        deliveryFeeListCents: listFeeCents,
        feeWaiver,
        // `feeCents` is the step 6 `unloadFeeCents`, the labourer actually charged: 0 when not selected,
        // so a stored store order never shows a charge that was not made. The price next to the offer
        // is `VEHICLE_CLASSES[vehicleClass].labourerFeeCents`.
        unload: { offered, required, selected, feeCents: unloadFeeCents },
        // An attended site gets the 4-digit hand-off code; an unattended one a photo only.
        requireCode: delivery && dropoff !== null && dropoff.receiving === 'attended',
        errors: draft.errors,
      };
    },
  );

  const freeDelivery = feeWaiver === 'replacement' ? null : feeWaiver;
  return {
    currency: CURRENCY,
    taxRateBps: TAX_RATE_BPS,
    // Order amounts are sums of the stores' amounts, tax included: the receipts add up exactly.
    ...sumAmounts(stores),
    stores,
    itemCount,
    lineCount,
    discounts: discount.discounts,
    promo: discount.promo,
    freeDelivery,
    // Step 8: the meters. "Add $171.42 more for free delivery". The formula is followed as written
    // (`freeDelivery`), so a replacement, whose fees are waived as `replacement`, still gets a meter;
    // no screen shows a replacement's meter (it is staged by staff, §5.5.7).
    amountToFreeDeliveryCents:
      delivery && !isFirstOrder && freeDelivery === null
        ? Math.max(0, FREE_DELIVERY_MIN_ITEMS_CENTS - orderItems)
        : 0,
    amountToFirstOrderDiscountCents:
      isFirstOrder && orderItems < FIRST_ORDER_DISCOUNT_MIN_ITEMS_CENTS
        ? FIRST_ORDER_DISCOUNT_MIN_ITEMS_CENTS - orderItems
        : 0,
    // Only a replacement may be worth nothing: its lines are free on purpose.
    canPlace: blockers.length === 0 && (orderItems > 0 || replacement),
    blockers,
  };
}

// ---------- settlement (§3.6) ----------

/** Nothing is charged: a store order that was rejected, cancelled, or shorted to nothing (§3.6). */
export function voidAmounts(): Amounts {
  return {
    itemsCents: 0,
    discountCents: 0,
    deliveryFeeCents: 0,
    unloadFeeCents: 0,
    taxCents: 0,
    totalCents: 0,
  };
}

const AMOUNT_FIELDS = [
  'itemsCents',
  'discountCents',
  'deliveryFeeCents',
  'unloadFeeCents',
  'taxCents',
  'totalCents',
] as const satisfies readonly (keyof Amounts)[];

/**
 * Field-by-field sum: an order's amounts are the sum of its store orders' amounts, which is why the
 * per-store receipts always add up to the order's exactly (§3.4 step 7). No parts gives all zeros.
 */
export function sumAmounts(parts: readonly Amounts[]): Amounts {
  const sum = voidAmounts();
  for (const [index, part] of parts.entries()) {
    for (const field of AMOUNT_FIELDS) {
      const value = requireWhole(`sumAmounts: parts[${index}].${field}`, part[field]);
      sum[field] = requireExact(`sumAmounts: ${field}`, sum[field] + value);
    }
  }
  return sum;
}

/**
 * Field-by-field difference `from − part`: what stays of a store order's `current` when a refund is
 * granted before the card is charged (§5.5.7), or what is released at capture (`placed − current`).
 * Throws a `RangeError` when any field would go below 0: no amount is ever negative (§3.1 rule 10).
 */
export function subtractAmounts(from: Amounts, part: Amounts): Amounts {
  const rest = voidAmounts();
  for (const field of AMOUNT_FIELDS) {
    const whole = requireWhole(`subtractAmounts: from.${field}`, from[field]);
    const taken = requireWhole(`subtractAmounts: part.${field}`, part[field]);
    if (taken > whole) {
      throw new RangeError(`subtractAmounts: ${field} would go below 0 (${whole} − ${taken})`);
    }
    rest[field] = whole - taken;
  }
  return rest;
}

/**
 * What a store order costs after a short shipment (§3.6): items and each line's discount share follow
 * the fulfilled quantities (`mulDivHalfUp(line.discountCents, fulfilledQty, quantity)`), the delivery
 * and labourer fees stay as placed, and tax and total are recomputed. When every line is down to 0 the
 * result is `voidAmounts()`. The result is never above `placed`. V4: 14 976 → 13 755.
 *
 * A store order that is rejected or cancelled before the hand-over is not settled with this: it is
 * simply `voidAmounts()`.
 */
export function settleStoreOrder(
  lines: readonly Pick<StoreOrderLine, 'unitPriceCents' | 'quantity' | 'fulfilledQty' | 'discountCents'>[],
  placed: Amounts,
): Amounts {
  let itemsCents = 0;
  let discountCents = 0;
  let supplied = false;
  for (const [index, line] of lines.entries()) {
    const at = `settleStoreOrder: lines[${index}]`;
    const unitPriceCents = requireWhole(`${at}.unitPriceCents`, line.unitPriceCents);
    const quantity = requireWhole(`${at}.quantity`, line.quantity);
    const fulfilledQty = requireWhole(`${at}.fulfilledQty`, line.fulfilledQty);
    const lineDiscountCents = requireWhole(`${at}.discountCents`, line.discountCents);
    // Quantities only ever go down (§2.1.1); more than was ordered would also charge more than was authorized.
    if (fulfilledQty > quantity) {
      throw new RangeError(`${at}.fulfilledQty is ${fulfilledQty}, above the ${quantity} ordered`);
    }
    if (fulfilledQty === 0) continue;
    supplied = true;
    itemsCents += requireExact(`${at}: the line total`, unitPriceCents * fulfilledQty);
    // The line keeps the same share of its discount as of its quantity.
    discountCents += mulDivHalfUp(lineDiscountCents, fulfilledQty, quantity);
  }
  // Nothing supplied: nothing is delivered or collected, so the fees go too.
  if (!supplied) return voidAmounts();

  // The fees are locked: they never go up, and they are not looked at again against the $500
  // free-delivery threshold when a shortage lowers the order's items.
  const current = amountsFrom(
    requireExact('settleStoreOrder: the items', itemsCents),
    discountCents,
    requireWhole('settleStoreOrder: placed.deliveryFeeCents', placed.deliveryFeeCents),
    requireWhole('settleStoreOrder: placed.unloadFeeCents', placed.unloadFeeCents),
  );
  // §3.1 rule 10. With the lines `placed` was priced from this cannot happen, so it means the two do
  // not belong together; charging more than the customer agreed to is never the answer.
  for (const field of AMOUNT_FIELDS) {
    if (current[field] > placed[field]) {
      throw new RangeError(
        `settleStoreOrder: ${field} would be ${current[field]}, above the ${String(placed[field])} placed`,
      );
    }
  }
  return current;
}

/**
 * What the store is paid on: Σ unit price × fulfilled quantity (§3.6). It equals `current.itemsCents`,
 * except on a replacement order, whose lines cost the customer 0: there the caller passes lines priced
 * from the catalogue.
 */
export function storeValueCents(
  lines: readonly Pick<StoreOrderLine, 'unitPriceCents' | 'fulfilledQty'>[],
): number {
  let valueCents = 0;
  for (const [index, line] of lines.entries()) {
    const at = `storeValueCents: lines[${index}]`;
    const unitPriceCents = requireWhole(`${at}.unitPriceCents`, line.unitPriceCents);
    const fulfilledQty = requireWhole(`${at}.fulfilledQty`, line.fulfilledQty);
    valueCents += requireExact(`${at}: the line total`, unitPriceCents * fulfilledQty);
  }
  return requireExact('storeValueCents: the value', valueCents);
}

/**
 * A failed delivery that goes back to the store (§3.7): the items are never charged. The locked
 * delivery and labourer fees, with their tax, are kept only when `keepFees` is true: the site caused
 * the failure and staff did not waive the fees (`refundDeliveryFee`). Otherwise the result is void.
 */
export function settleReturnToStore(current: Amounts, keepFees: boolean): Amounts {
  if (!keepFees) return voidAmounts();
  // The truck was sent and came back because of the site, so the trip and the labourer are still owed.
  return amountsFrom(
    0,
    0,
    requireWhole('settleReturnToStore: current.deliveryFeeCents', current.deliveryFeeCents),
    requireWhole('settleReturnToStore: current.unloadFeeCents', current.unloadFeeCents),
  );
}

// ---------- refunds (§3.7) ----------

/** Units of a store order's lines, as an issue names them (§5.5.7). */
export interface RefundLine {
  lineId: string;
  quantity: number;
}

/** A refund already granted on a store order: its lines and whether the fees went with it. */
export interface RefundRequest {
  lines: readonly RefundLine[];
  includeDeliveryFee: boolean;
}

/**
 * The refund for some units of a store order (§3.7), in the same shape as every other amount so it
 * can be taken off `current` field by field when the order is not captured yet: items at the paid unit
 * price, minus the same share of each line's discount, plus the delivery and labourer fees when
 * `includeDeliveryFee`, plus tax on all of it. V5: 2 cracked sheets → 3 922.
 *
 * `earlierRefunds` are the refunds already granted on this store order (its resolved refund issues),
 * oldest first or in any order. With them the refund is the difference between "everything refunded
 * so far, plus these units" and "everything refunded so far", both priced with the §3.7 formula, so:
 * the first refund is exactly the §3.7 formula; the refunds of a store order add up to its
 * `current.totalCents` once every supplied unit and the fees are back, and never to more; no field of
 * one refund is above what is left of that field, so `subtractAmounts(current, refund)` never throws
 * before capture; a unit is refunded once (earlier + asked ≤ `fulfilledQty`) and the fees once.
 * When an earlier refund took the fees before capture, `current` no longer has them, so `placed` must
 * be passed to price them.
 *
 * Throws a `RangeError` for a line the store order does not have or a quantity above what is left of
 * its fulfilled quantity. The result is not capped. After capture, refund the smaller of its
 * `totalCents` and `refundableCents`; before capture, take it off `current` with `subtractAmounts`.
 */
export function refundForLines(
  storeOrder: Pick<StoreOrder, 'lines' | 'current'> & Partial<Pick<StoreOrder, 'placed'>>,
  lines: readonly RefundLine[],
  options: { includeDeliveryFee: boolean; earlierRefunds?: readonly RefundRequest[] },
): Amounts {
  const earlier = options.earlierRefunds ?? [];
  const before = new Map<string, number>();
  let feesBefore = false;
  for (const [index, refund] of earlier.entries()) {
    addUnits(before, refund.lines, `refundForLines: earlierRefunds[${index}]`);
    feesBefore = feesBefore || refund.includeDeliveryFee;
  }
  const after = new Map(before);
  addUnits(after, lines, 'refundForLines: lines');
  for (const lineId of after.keys()) {
    if (!storeOrder.lines.some((line) => line.lineId === lineId)) {
      throw new RangeError(`refundForLines: the store order has no line ${lineId}`);
    }
  }

  // The fees are priced from `current`, as §3.7 says, until a refund before capture has taken them
  // off it; then `current` holds 0 and the locked fees are those of `placed` (§3.6).
  const fees = feesBefore ? storeOrder.placed : storeOrder.current;
  if (fees === undefined) {
    throw new RangeError(
      'refundForLines: an earlier refund took the fees; pass the store order with `placed`',
    );
  }
  const deliveryFeeCents = requireWhole('refundForLines: the delivery fee', fees.deliveryFeeCents);
  const unloadFeeCents = requireWhole('refundForLines: the labourer fee', fees.unloadFeeCents);

  // The §3.7 formula for a set of refunded units. It only grows as units are added (every line
  // nets unit price minus at most its discount per unit), so the difference below is never negative.
  const priced = (units: ReadonlyMap<string, number>, withFees: boolean): Amounts => {
    let itemsCents = 0;
    let discountCents = 0;
    for (const line of storeOrder.lines) {
      const quantity = units.get(line.lineId) ?? 0;
      const at = `refundForLines: line ${line.lineId}`;
      // Only what was supplied was charged, so only that can be given back, and only once.
      if (quantity > line.fulfilledQty) {
        throw new RangeError(
          `${at}: ${quantity} refunded in all, but only ${String(line.fulfilledQty)} supplied`,
        );
      }
      if (quantity === 0) continue;
      const unitPriceCents = requireWhole(`${at}: unitPriceCents`, line.unitPriceCents);
      itemsCents += requireExact(`${at}: the line total`, unitPriceCents * quantity);
      // The customer paid the unit price minus this share of the line's discount, so that is what
      // comes back: `mulDivHalfUp(line.discountCents, q, line.quantity)`.
      discountCents += mulDivHalfUp(line.discountCents, quantity, line.quantity);
    }
    // The delivery and the labourer are refunded together and whole, when staff decide so: typically
    // when the entire store order is refunded, or for a late delivery.
    return amountsFrom(
      requireExact('refundForLines: the items', itemsCents),
      discountCents,
      withFees ? deliveryFeeCents : 0,
      withFees ? unloadFeeCents : 0,
    );
  };

  return subtractAmounts(priced(after, feesBefore || options.includeDeliveryFee), priced(before, feesBefore));
}

/** Adds whole quantities per line; a line named twice is one request for the sum. */
function addUnits(units: Map<string, number>, lines: readonly RefundLine[], at: string): void {
  for (const [index, entry] of lines.entries()) {
    const quantity = requireWhole(`${at}[${index}].quantity`, entry.quantity);
    units.set(
      entry.lineId,
      requireExact(`${at}: line ${entry.lineId}`, (units.get(entry.lineId) ?? 0) + quantity),
    );
  }
}

/**
 * The most that can still be refunded for a store order after capture (§3.7): its current total minus
 * what was already refunded for it, and never more than what is left of the captured amount.
 */
export function refundableCents(
  storeOrder: Pick<StoreOrder, 'id' | 'current'>,
  payment: Pick<OrderPayment, 'capturedCents' | 'refundedCents' | 'refundedByStoreOrder'>,
): number {
  const { id } = storeOrder;
  const refundedHere = Object.prototype.hasOwnProperty.call(payment.refundedByStoreOrder, id)
    ? requireWhole(`refundableCents: refundedByStoreOrder.${id}`, payment.refundedByStoreOrder[id] ?? 0)
    : 0;
  const leftOfStoreOrder =
    requireWhole('refundableCents: current.totalCents', storeOrder.current.totalCents) - refundedHere;
  const leftOfCapture =
    requireWhole('refundableCents: capturedCents', payment.capturedCents) -
    requireWhole('refundableCents: refundedCents', payment.refundedCents);
  // Never below 0: an amount that is already over-refunded leaves nothing, not a negative refund.
  return Math.max(0, Math.min(leftOfStoreOrder, leftOfCapture));
}

/**
 * What a refund costs the party at fault, as a positive number of cents (§3.7); the ledger entry is
 * the negative of it. A store gives back the refunded items minus the commission it paid on them, a
 * driver the full item value (the driver is liable for the load), the platform and the customer
 * nothing. V5: store at fault, 3 696 refunded at 10 % → 3 696 − 370 = 3 326.
 */
export function clawbackCents(
  faultParty: FaultParty | null,
  refundedItemsCents: number,
  commissionBps: number,
): number {
  const itemsCents = requireWhole('clawbackCents: refundedItemsCents', refundedItemsCents);
  switch (faultParty) {
    case 'store': {
      // The store was paid the items minus the commission (§3.9), so that is what it gives back.
      const commissionCents = percentBps(itemsCents, commissionBps);
      if (commissionCents > itemsCents) {
        throw new RangeError(`clawbackCents: a commission of ${commissionBps} bps is more than the sale`);
      }
      return itemsCents - commissionCents;
    }
    case 'driver':
      return itemsCents;
    case 'platform':
    case 'customer':
    case null:
      return 0;
    default: {
      const unknown: never = faultParty;
      throw new RangeError(`clawbackCents: unknown fault party ${String(unknown)}`);
    }
  }
}
