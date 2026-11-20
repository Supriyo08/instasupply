/**
 * The quote builder's draft (MARKETPLACE §9 builder, §5.5.6): catalogue lines with optional agreed
 * prices, special-order lines, unmatched request lines, fulfilment, window, labourers, validity and the
 * message. It autosaves to `quotes/{id}/workspace`, which the server stores as opaque JSON, so it is
 * read back through `parseDraft` and never trusted blindly. Prices come from `priceCheckout` in shared.
 */
import {
  DEFAULT_QUOTE_VALID_HOURS,
  QUOTE_VALID_HOURS,
  localDateOf,
  priceCheckout,
  type CategoryId,
  type CheckoutInput,
  type DimsCm,
  type Fulfilment,
  type PricedCheckout,
  type Product,
  type Quote,
  type QuoteLineInput,
  type QuoteValidHours,
  type Receiving,
  type SellUnit,
  type SendQuoteRequest,
  type Store,
  type WithId,
} from '@instasupply/shared';

interface LineBase {
  /** Stable id inside the draft; also the pricing line id. */
  key: string;
  /** Index of the request line this answers, or null for an extra line. */
  requestLine: number | null;
  storeId: string;
  quantity: number;
  note: string;
}

export interface CatalogDraftLine extends LineBase {
  kind: 'catalog';
  productId: string;
  /** Copies for display while the live product loads; prices always come from the live product. */
  storeName: string;
  name: string;
  sku: string | null;
  brand: string | null;
  unit: SellUnit;
  size: string | null;
  categoryId: CategoryId | null;
  imageKey: string | null;
  imageUrl: string | null;
  listPriceCents: number;
  weightKg: number;
  dimsCm: DimsCm;
  /** A price the store agreed to for this quote; null is the list price. */
  overrideCents: number | null;
}

export interface CustomDraftLine extends LineBase {
  kind: 'custom';
  name: string;
  unit: SellUnit;
  size: string | null;
  unitPriceCents: number;
  weightKg: number;
  dimsCm: DimsCm;
}

export type DraftLine = CatalogDraftLine | CustomDraftLine;

export interface BuilderDraft {
  schema: 1;
  /**
   * The offer version this draft was built against (0: no offer yet). Sent as `expectedVersion`, so a
   * newer offer sent by someone else is a `QUOTE_VERSION` refusal instead of being silently replaced
   * (PLATFORM §9, optimistic version). It moves only when the user sends, reloads or keeps the draft.
   */
  baseVersion: number;
  lines: DraftLine[];
  unmatched: { requestLine: number; reason: string }[];
  fulfilment: Fulfilment;
  receiving: Receiving;
  /** Null: the customer picks the window when accepting. */
  windowId: string | null;
  unloadHelpStoreIds: string[];
  message: string;
  validHours: QuoteValidHours;
  /** Staff only: stays in the workspace, never sent. */
  internalNote: string;
}

let counter = 0;
export function newLineKey(): string {
  counter += 1;
  return `D${Date.now().toString(36)}${counter}`;
}

/** The starting draft: the last offer when there is one, else the request's fulfilment and receiving. */
export function initialDraft(quote: Quote): BuilderDraft {
  const offer = quote.offer;
  const receiving = quote.request.jobsite?.receiving ?? 'attended';
  if (!offer) {
    return {
      schema: 1,
      baseVersion: 0,
      lines: [],
      unmatched: [],
      fulfilment: quote.request.fulfilment,
      receiving,
      windowId: null,
      unloadHelpStoreIds: [],
      message: '',
      validHours: DEFAULT_QUOTE_VALID_HOURS,
      internalNote: '',
    };
  }
  return {
    schema: 1,
    baseVersion: offer.version,
    lines: offer.lines.map((line): DraftLine => {
      if (line.kind === 'catalog' && line.productId) {
        const list = line.listPriceCents ?? line.unitPriceCents;
        return {
          kind: 'catalog',
          key: newLineKey(),
          requestLine: line.requestLine,
          storeId: line.storeId,
          storeName: line.storeName,
          productId: line.productId,
          name: line.name,
          sku: line.sku,
          brand: line.brand,
          unit: line.unit,
          size: line.size,
          categoryId: null,
          imageKey: null,
          imageUrl: null,
          listPriceCents: list,
          weightKg: line.weightKg,
          dimsCm: line.dimsCm,
          overrideCents: line.unitPriceCents === list ? null : line.unitPriceCents,
          quantity: line.quantity,
          note: line.note ?? '',
        };
      }
      return {
        kind: 'custom',
        key: newLineKey(),
        requestLine: line.requestLine,
        storeId: line.storeId,
        name: line.name,
        unit: line.unit,
        size: line.size,
        unitPriceCents: line.unitPriceCents,
        weightKg: line.weightKg,
        dimsCm: line.dimsCm,
        quantity: line.quantity,
        note: line.note ?? '',
      };
    }),
    unmatched: offer.unmatched.map((item) => ({ requestLine: item.requestLine, reason: item.reason })),
    fulfilment: offer.fulfilment,
    receiving: offer.receiving ?? receiving,
    windowId: offer.windowId,
    unloadHelpStoreIds: offer.unloadHelpStoreIds,
    message: offer.message ?? '',
    validHours: DEFAULT_QUOTE_VALID_HOURS,
    internalNote: '',
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A saved workspace, if it is a draft this builder wrote; anything else is ignored. `fallbackBase` is the
 * base version for a draft saved before drafts recorded one.
 */
export function parseDraft(raw: unknown, fallbackBase: number): BuilderDraft | null {
  if (!isRecord(raw) || raw.schema !== 1) return null;
  if (!Array.isArray(raw.lines) || !Array.isArray(raw.unmatched) || !Array.isArray(raw.unloadHelpStoreIds)) {
    return null;
  }
  const lines = raw.lines.filter(
    (line): line is DraftLine =>
      isRecord(line) &&
      (line.kind === 'catalog' || line.kind === 'custom') &&
      typeof line.key === 'string' &&
      typeof line.storeId === 'string' &&
      typeof line.quantity === 'number' &&
      isRecord(line.dimsCm),
  );
  const validHours = QUOTE_VALID_HOURS.find((hours) => hours === raw.validHours) ?? DEFAULT_QUOTE_VALID_HOURS;
  const baseVersion =
    typeof raw.baseVersion === 'number' && Number.isInteger(raw.baseVersion) && raw.baseVersion >= 0
      ? raw.baseVersion
      : fallbackBase;
  return {
    schema: 1,
    baseVersion,
    lines,
    unmatched: raw.unmatched.filter(
      (item): item is { requestLine: number; reason: string } =>
        isRecord(item) && typeof item.requestLine === 'number' && typeof item.reason === 'string',
    ),
    fulfilment: raw.fulfilment === 'pickup' ? 'pickup' : 'delivery',
    receiving: raw.receiving === 'unattended' ? 'unattended' : 'attended',
    windowId: typeof raw.windowId === 'string' ? raw.windowId : null,
    unloadHelpStoreIds: raw.unloadHelpStoreIds.filter((id): id is string => typeof id === 'string'),
    message: typeof raw.message === 'string' ? raw.message : '',
    validHours,
    internalNote: typeof raw.internalNote === 'string' ? raw.internalNote : '',
  };
}

/** A catalogue line taken from a search result. */
export function lineFromProduct(
  product: Product,
  requestLine: number | null,
  quantity: number,
): CatalogDraftLine {
  return {
    kind: 'catalog',
    key: newLineKey(),
    requestLine,
    storeId: product.storeId,
    storeName: product.storeName,
    productId: product.id,
    name: product.name,
    sku: product.sku,
    brand: product.brand,
    unit: product.unit,
    size: product.size,
    categoryId: product.categoryId,
    imageKey: product.imageKey,
    imageUrl: product.imageUrl,
    listPriceCents: product.priceCents,
    weightKg: product.weightKg,
    dimsCm: product.dimsCm,
    overrideCents: null,
    quantity,
    note: '',
  };
}

/** The offer version sent after this draft's base, if someone sent one (the draft is then stale). */
export function newerOfferVersion(draft: BuilderDraft, quote: Quote): number | null {
  const current = quote.offer?.version ?? 0;
  return current > draft.baseVersion ? current : null;
}

/**
 * Whether the customer's next order is a first order, defaulting like the server's checkout context
 * (missing stats count as no orders), so the live totals match what `sendQuote` prices.
 */
export function isFirstOrderOf(customer: { stats?: { nonCancelledOrders: number } } | null): boolean {
  return (customer?.stats?.nonCancelledOrders ?? 0) === 0;
}

/** The unit price a line is quoted at: the agreed price, else the live list price, else the copy. */
export function unitPriceOf(line: DraftLine, live: ReadonlyMap<string, Product>): number {
  if (line.kind === 'custom') return line.unitPriceCents;
  return line.overrideCents ?? live.get(line.productId)?.priceCents ?? line.listPriceCents;
}

/** The `priceCheckout` input for the draft (`source: 'quote'`, MARKETPLACE §3.5). */
export function pricingInputOf(
  draft: BuilderDraft,
  quote: Quote,
  stores: ReadonlyMap<string, WithId<Store>>,
  live: ReadonlyMap<string, Product>,
  isFirstOrder: boolean,
  now: number,
): CheckoutInput {
  const byStore = new Map<string, DraftLine[]>();
  for (const line of draft.lines) {
    if (line.quantity <= 0) continue;
    byStore.set(line.storeId, [...(byStore.get(line.storeId) ?? []), line]);
  }
  const site = quote.request.jobsite;
  return {
    fulfilment: draft.fulfilment,
    stores: [...byStore.entries()].flatMap(([storeId, lines]) => {
      const store = stores.get(storeId);
      if (!store) return [];
      return [
        {
          storeId,
          store,
          lines: lines.map((line) => ({
            lineId: line.key,
            kind: line.kind,
            productId: line.kind === 'catalog' ? line.productId : null,
            name: line.name,
            unit: line.unit,
            size: line.size,
            unitPriceCents: unitPriceOf(line, live),
            quantity: line.quantity,
            weightKg:
              line.kind === 'catalog' ? (live.get(line.productId)?.weightKg ?? line.weightKg) : line.weightKg,
            dimsCm: line.kind === 'catalog' ? (live.get(line.productId)?.dimsCm ?? line.dimsCm) : line.dimsCm,
          })),
        },
      ];
    }),
    dropoff:
      draft.fulfilment === 'delivery' && site
        ? { location: site.location, receiving: draft.receiving, maxVehicleClass: site.maxVehicleClass }
        : null,
    unloadHelpStoreIds: draft.unloadHelpStoreIds,
    promoCode: null,
    customer: { isFirstOrder, promoUses: {} },
    source: 'quote',
    today: localDateOf(now),
  };
}

export function priceDraft(input: CheckoutInput): PricedCheckout {
  return priceCheckout(input);
}

/** The `sendQuote` request for the draft. */
export function sendRequestOf(
  draft: BuilderDraft,
  quote: Quote,
  live: ReadonlyMap<string, Product>,
): SendQuoteRequest {
  const lines: QuoteLineInput[] = draft.lines
    .filter((line) => line.quantity > 0)
    .map((line) =>
      line.kind === 'catalog'
        ? {
            kind: 'catalog',
            productId: line.productId,
            quantity: line.quantity,
            unitPriceCents:
              line.overrideCents !== null && line.overrideCents !== live.get(line.productId)?.priceCents
                ? line.overrideCents
                : null,
            note: line.note.trim() || null,
            requestLine: line.requestLine,
          }
        : {
            kind: 'custom',
            storeId: line.storeId,
            name: line.name.trim(),
            unit: line.unit,
            size: line.size?.trim() || null,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            weightKg: line.weightKg,
            dimsCm: line.dimsCm,
            note: line.note.trim() || null,
            requestLine: line.requestLine,
          },
    );
  return {
    quoteId: quote.id,
    expectedVersion: draft.baseVersion,
    lines,
    unmatched: draft.unmatched.map((item) => ({
      requestLine: item.requestLine,
      text: quote.request.lines[item.requestLine]?.text ?? '',
      reason: item.reason.trim(),
    })),
    fulfilment: draft.fulfilment,
    receiving: draft.fulfilment === 'delivery' ? draft.receiving : null,
    windowId: draft.windowId,
    unloadHelpStoreIds: draft.fulfilment === 'delivery' ? draft.unloadHelpStoreIds : [],
    message: draft.message.trim() || null,
    validHours: draft.validHours,
  };
}
