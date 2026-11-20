/**
 * The checkout rules of MARKETPLACE §5.5.1 step 3, written once and run twice: by `loadCheckoutContext` on plain
 * reads before the card is authorized, and by `stageMarketplaceOrder` on the locked rows inside the transaction
 * (docs/PLATFORM.md §9.2.1). Pricing, windows and pickup times are the shared functions; this file only feeds
 * them the documents and turns their answers into the error codes of §5.9.
 */
import {
  asapWindow,
  formatAddressLine,
  localDateOf,
  pickupReady,
  priceCheckout,
  resolveWindow,
  earliestWindow,
  scheduledWindows,
  SERVICE_AREA,
  type AvailableWindow,
  type CategoryId,
  type Contact,
  type DimsCm,
  type ErrorCode,
  type Fulfilment,
  type JobsiteSnapshot,
  type PricedCheckout,
  type PricedStore,
  type PricingLine,
  type PricingStoreInput,
  type Receiving,
  type SellUnit,
  type WindowStoreInput,
} from '@instasupply/shared';
import { failCode, invalidArgument } from '../../platform/http/errors';
import type {
  CheckoutJobsite,
  CheckoutProduct,
  CheckoutStoreRecord,
  CustomerRecord,
} from './orders.repository';

/** A catalogue line: the product's own price unless a quote fixed another (D16). */
export interface CatalogPlanLine {
  kind: 'catalog';
  productId: string;
  storeId: string;
  quantity: number;
  /** A quoted unit price; the locked product's `priceCents` when absent. */
  unitPriceCents?: number;
  /** What the store is paid per unit (§3.6). Defaults to `unitPriceCents`; a replacement passes the catalogue price, or 0 when the store was at fault. */
  storeUnitPriceCents?: number;
  note?: string | null;
}

/** A special-order line of a quote: no product, no stock (D16). */
export interface CustomPlanLine {
  kind: 'custom';
  storeId: string;
  quantity: number;
  name: string;
  unit: SellUnit;
  size: string | null;
  categoryId: CategoryId | null;
  unitPriceCents: number;
  storeUnitPriceCents?: number;
  weightKg: number;
  dimsCm: DimsCm;
  note?: string | null;
}

export type PlanLine = CatalogPlanLine | CustomPlanLine;

/** What a checkout is asked to place: the cart, a quote or a replacement. */
export interface CheckoutRequest {
  customerId: string;
  source: 'cart' | 'quote' | 'replacement';
  fulfilment: Fulfilment;
  /** Required for delivery. */
  jobsiteId: string | null;
  /** `asap` or a slot id; null: the earliest window (delivery), or nothing to choose (pickup). */
  windowId: string | null;
  /** Null: the jobsite's own setting. */
  receiving: Receiving | null;
  /** Null: the jobsite's contact. */
  siteContact: Contact | null;
  instructions: string | null;
  unloadHelpStoreIds: string[];
  promoCode: string | null;
  lines: PlanLine[];
  /** The total the customer saw; null when there is nothing to compare (a replacement). */
  expectedTotalCents: number | null;
}

/** One line before pricing, with the copies a store order line keeps (MARKETPLACE §1.3 StoreOrderLine). */
export interface DraftLine {
  lineId: string;
  plan: PlanLine;
  pricing: PricingLine;
  sku: string | null;
  brand: string | null;
  categoryId: CategoryId | null;
  imageKey: string | null;
  imagePath: string | null;
  storeUnitPriceCents: number;
}

export interface StoreTimingPlan {
  readyBy: number;
  targetPickupAt: number | null;
  deliverBy: number | null;
}

export interface EvaluatedCheckout {
  priced: PricedCheckout;
  isFirstOrder: boolean;
  jobsite: JobsiteSnapshot | null;
  receiving: Receiving | null;
  siteContact: Contact | null;
  /** Delivery only. */
  window: AvailableWindow | null;
  /** Per store: ready-by, pickup and deliver-by times. */
  timings: Map<string, StoreTimingPlan>;
  /** Per store, by line id. */
  drafts: Map<string, Map<string, DraftLine>>;
  stores: Map<string, CheckoutStoreRecord>;
}

export interface CheckoutState {
  customer: CustomerRecord;
  jobsite: CheckoutJobsite | null;
  stores: Map<string, CheckoutStoreRecord>;
  products: Map<string, CheckoutProduct>;
  now: number;
}

const STORE_BLOCKERS = new Set([
  'store_unavailable',
  'store_paused',
  'delivery_unavailable',
  'pickup_unavailable',
  'out_of_range',
  'too_large',
  'jobsite_vehicle_limit',
]);

export const catalogProductIds = (lines: readonly PlanLine[]): string[] => [
  ...new Set(
    lines.filter((line): line is CatalogPlanLine => line.kind === 'catalog').map((l) => l.productId),
  ),
];

export const storeIdsOf = (lines: readonly PlanLine[]): string[] => [
  ...new Set(lines.map((line) => line.storeId)),
];

export function isInsideServiceArea(location: { lat: number; lng: number }): boolean {
  return (
    location.lat >= SERVICE_AREA.south &&
    location.lat <= SERVICE_AREA.north &&
    location.lng >= SERVICE_AREA.west &&
    location.lng <= SERVICE_AREA.east
  );
}

export function snapshotJobsite(jobsite: CheckoutJobsite): JobsiteSnapshot {
  return { ...jobsite.fields, jobsiteId: jobsite.id, addressLine: formatAddressLine(jobsite.fields) };
}

/** Lines with their copies; a product that is gone or of another store is refused before pricing. */
function draftLines(request: CheckoutRequest, state: CheckoutState): Map<string, DraftLine[]> {
  const byStore = new Map<string, DraftLine[]>();
  for (const plan of request.lines) {
    const list = byStore.get(plan.storeId) ?? [];
    const lineId = `L${list.length + 1}`;
    let draft: DraftLine;
    if (plan.kind === 'catalog') {
      const product = state.products.get(plan.productId);
      if (!product) {
        failCode('OUT_OF_STOCK', 'One of your items is no longer available.', {
          productId: plan.productId,
          available: 0,
        });
      }
      if (product.storeId !== plan.storeId) {
        invalidArgument('A cart line names the wrong store for its product.', {
          fields: { items: plan.productId },
        });
      }
      const unitPriceCents = plan.unitPriceCents ?? product.doc.priceCents;
      draft = {
        lineId,
        plan,
        pricing: {
          lineId,
          kind: 'catalog',
          productId: product.id,
          name: product.doc.name,
          unit: product.doc.unit,
          size: product.doc.size,
          unitPriceCents,
          quantity: plan.quantity,
          weightKg: product.doc.weightKg,
          dimsCm: product.doc.dimsCm,
        },
        sku: product.doc.sku,
        brand: product.doc.brand,
        categoryId: product.doc.categoryId,
        imageKey: product.doc.imageKey,
        imagePath: product.doc.imagePath,
        storeUnitPriceCents: plan.storeUnitPriceCents ?? unitPriceCents,
      };
    } else {
      draft = {
        lineId,
        plan,
        pricing: {
          lineId,
          kind: 'custom',
          productId: null,
          name: plan.name,
          unit: plan.unit,
          size: plan.size,
          unitPriceCents: plan.unitPriceCents,
          quantity: plan.quantity,
          weightKg: plan.weightKg,
          dimsCm: plan.dimsCm,
        },
        sku: null,
        brand: null,
        categoryId: plan.categoryId,
        imageKey: null,
        imagePath: null,
        storeUnitPriceCents: plan.storeUnitPriceCents ?? plan.unitPriceCents,
      };
    }
    list.push(draft);
    byStore.set(plan.storeId, list);
  }
  return byStore;
}

/** Every product listed and in stock, within its per-order maximum (OUT_OF_STOCK { productId, available }). */
function checkStock(request: CheckoutRequest, state: CheckoutState): void {
  const wanted = new Map<string, number>();
  for (const line of request.lines) {
    if (line.kind === 'catalog')
      wanted.set(line.productId, (wanted.get(line.productId) ?? 0) + line.quantity);
  }
  for (const [productId, quantity] of wanted) {
    const product = state.products.get(productId)!;
    const listed = product.listed && product.doc.active;
    if (!listed && request.source !== 'replacement') {
      failCode('OUT_OF_STOCK', `${product.doc.name} is no longer available.`, { productId, available: 0 });
    }
    const onShelf = Math.max(0, product.stockOnHand - product.reserved);
    const available = product.doc.maxPerOrder === null ? onShelf : Math.min(onShelf, product.doc.maxPerOrder);
    if (quantity > available) {
      const message =
        available === 0
          ? `${product.doc.name} is out of stock.`
          : `Only ${available} of ${product.doc.name} can be ordered right now.`;
      failCode('OUT_OF_STOCK', message, { productId, available });
    }
  }
}

function throwBlocker(priced: PricedCheckout): never {
  const blocker = priced.blockers[0]!;
  const code = blocker.code.toUpperCase() as ErrorCode;
  failCode(
    code,
    blocker.message,
    STORE_BLOCKERS.has(blocker.code) && blocker.storeId ? { storeId: blocker.storeId } : {},
  );
}

function windowStores(priced: PricedCheckout, stores: Map<string, CheckoutStoreRecord>): WindowStoreInput[] {
  return priced.stores.map((entry: PricedStore) => ({
    storeId: entry.storeId,
    store: stores.get(entry.storeId)!.store,
    vehicleClass: entry.vehicleClass!,
    roadTenths: entry.roadTenths ?? 0,
  }));
}

function windowUnavailable(inputs: WindowStoreInput[], now: number, reason: string | null): never {
  const windows = [asapWindow(inputs, now), ...scheduledWindows(inputs, now)];
  failCode('WINDOW_UNAVAILABLE', reason ?? 'That delivery time is no longer available. Choose another.', {
    windows,
  });
}

/**
 * Prices and checks a checkout against the given documents (MARKETPLACE §5.5.1 step 3 / step 5). Throws the
 * first failing rule's code; returns everything the order writer needs.
 */
export function evaluateCheckout(request: CheckoutRequest, state: CheckoutState): EvaluatedCheckout {
  const { now, customer } = state;
  const delivery = request.fulfilment === 'delivery';

  for (const storeId of storeIdsOf(request.lines)) {
    if (!state.stores.has(storeId)) {
      failCode('STORE_UNAVAILABLE', "That store isn't taking orders.", { storeId });
    }
  }
  const unknownHelp = request.unloadHelpStoreIds.filter((id) => !request.lines.some((l) => l.storeId === id));
  if (unknownHelp.length > 0) {
    invalidArgument('Labourer help can only be asked for stores in the cart.', {
      fields: { unloadHelpStoreIds: 'not in the cart' },
    });
  }

  let jobsite: JobsiteSnapshot | null = null;
  let receiving: Receiving | null = null;
  let siteContact: Contact | null = request.siteContact;
  if (delivery) {
    if (!state.jobsite)
      invalidArgument('Choose a jobsite for the delivery.', { fields: { jobsiteId: 'required' } });
    jobsite = snapshotJobsite(state.jobsite);
    receiving = request.receiving ?? jobsite.receiving;
    siteContact = request.siteContact ?? { name: jobsite.contactName, phone: jobsite.contactPhone };
  }

  const drafts = draftLines(request, state);
  checkStock(request, state);

  const isFirstOrder =
    request.source !== 'replacement' && (customer.doc.stats?.nonCancelledOrders ?? 0) === 0;
  const storesInput: PricingStoreInput[] = [...drafts.entries()].map(([storeId, lines]) => ({
    storeId,
    store: state.stores.get(storeId)!.store,
    lines: lines.map((line) => line.pricing),
  }));
  const priced = priceCheckout({
    fulfilment: request.fulfilment,
    stores: storesInput,
    dropoff:
      delivery && jobsite
        ? { location: jobsite.location, receiving: receiving!, maxVehicleClass: jobsite.maxVehicleClass }
        : null,
    unloadHelpStoreIds: request.unloadHelpStoreIds,
    promoCode: request.promoCode,
    customer: { isFirstOrder, promoUses: customer.doc.promoUses ?? {} },
    source: request.source,
    today: localDateOf(now),
  });
  if (!priced.canPlace) {
    if (priced.blockers.length > 0) throwBlocker(priced);
    failCode('EMPTY', 'Your cart is empty.');
  }

  const timings = new Map<string, StoreTimingPlan>();
  let window: AvailableWindow | null = null;
  if (delivery) {
    const inputs = windowStores(priced, state.stores);
    const option =
      request.windowId === null ? earliestWindow(inputs, now) : resolveWindow(request.windowId, inputs, now);
    if (!option || !option.available) windowUnavailable(inputs, now, option?.reason ?? null);
    window = option;
    for (const timing of option.stores) {
      timings.set(timing.storeId, {
        readyBy: timing.readyBy,
        targetPickupAt: timing.targetPickupAt,
        deliverBy: timing.deliverBy,
      });
    }
  } else {
    for (const entry of priced.stores) {
      const record = state.stores.get(entry.storeId)!;
      const promise = pickupReady(record.store, now);
      if (!promise.ok) failCode('PICKUP_UNAVAILABLE', promise.reason, { storeId: entry.storeId });
      timings.set(entry.storeId, {
        readyBy: promise.readyAt,
        targetPickupAt: null,
        deliverBy: null,
      });
    }
  }

  if (request.expectedTotalCents !== null && priced.totalCents !== request.expectedTotalCents) {
    failCode('PRICE_CHANGED', 'Prices changed since you opened checkout. Check the new total.', {
      pricing: priced,
    });
  }

  const draftMaps = new Map<string, Map<string, DraftLine>>();
  for (const [storeId, lines] of drafts)
    draftMaps.set(storeId, new Map(lines.map((line) => [line.lineId, line])));
  return {
    priced,
    isFirstOrder,
    jobsite,
    receiving,
    siteContact,
    window,
    timings,
    drafts: draftMaps,
    stores: state.stores,
  };
}
