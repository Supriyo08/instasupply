/**
 * Material lists and quotes (§1.3, §2.5). A customer sends a list; staff answer with an offer built
 * from catalogue listings and special-order lines, priced by the same function as checkout (D16).
 * Accepting the offer places an order at the quoted prices.
 */
import type { DimsCm, SellUnit } from './catalog';
import type { Fulfilment, JobsiteSnapshot, Receiving } from './marketplace';
import type { PricedCheckout } from './pricing';
import { transitionTargets, type MachineActor, type TransitionRule } from './status';
import type { TimestampLike } from './types';

export type QuoteStatus =
  'submitted' | 'in_review' | 'quoted' | 'accepted' | 'declined' | 'expired' | 'cancelled';

/** A file under `quoteUploads/{uid}/{requestId}/`. */
export interface QuoteAttachment {
  path: string;
  name: string;
  contentType: string;
  sizeBytes: number;
}

/** What the customer asked for. */
export interface QuoteRequest {
  lines: { text: string; quantity: number | null }[];
  attachments: QuoteAttachment[];
  /** `date` is a Toronto date and only set for kind `date`. */
  neededBy: { kind: 'asap' | 'this_week' | 'date'; date: string | null };
  fulfilment: Fulfilment;
  jobsite: JobsiteSnapshot | null;
  contact: { preferred: 'call' | 'whatsapp' | 'email'; phone: string | null; email: string | null };
  notes: string | null;
}

export interface QuoteLine {
  lineId: string;
  /** `custom`: a special order that is not in the catalogue (an LVL beam). */
  kind: 'catalog' | 'custom';
  productId: string | null;
  storeId: string;
  storeName: string;
  sku: string | null;
  name: string;
  brand: string | null;
  unit: SellUnit;
  size: string | null;
  quantity: number;
  /** The catalogue price when the line was quoted; null for custom lines. */
  listPriceCents: number | null;
  /** The quoted price: a price the store agreed to, and the price the store is paid on. */
  unitPriceCents: number;
  weightKg: number;
  dimsCm: DimsCm;
  note: string | null;
  /** Index of the request line this answers. */
  requestLine: number | null;
}

/** The latest offer sent to the customer. */
export interface QuoteOffer {
  /** +1 on every send; the customer accepts a specific version. */
  version: number;
  lines: QuoteLine[];
  /** Request lines staff could not source, with the reason. */
  unmatched: { requestLine: number; text: string; reason: string }[];
  fulfilment: Fulfilment;
  receiving: Receiving | null;
  windowId: string | null;
  windowLabel: string | null;
  unloadHelpStoreIds: string[];
  /** The price snapshot at the moment of sending. */
  pricing: PricedCheckout;
  message: string | null;
  validUntil: TimestampLike;
  sentBy: string;
  sentByName: string;
  sentAt: TimestampLike;
}

/** `quotes/{quoteId}`: the id is the client's `requestId`, so a retry never creates a second quote (D17). */
export interface Quote {
  id: string;
  /** `Q-10001`. */
  number: string;
  customerId: string;
  customerName: string;
  companyName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  request: QuoteRequest;
  status: QuoteStatus;
  statusAt: Partial<Record<QuoteStatus, TimestampLike>>;
  /** The promise: an answer within 30 minutes of support hours. */
  respondBy: TimestampLike;
  assignedTo: string | null;
  assignedName: string | null;
  offer: QuoteOffer | null;
  offerValidUntil: TimestampLike | null;
  offerHistory: { version: number; totalCents: number; sentAt: TimestampLike }[];
  /** The order created when the customer accepted. */
  orderId: string | null;
  closeReason: string | null;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

// ---------- the quote machine (§2.5) ----------

export const QUOTE_STATUSES: readonly QuoteStatus[] = [
  'submitted',
  'in_review',
  'quoted',
  'accepted',
  'declined',
  'expired',
  'cancelled',
];

/** One row of the §2.5 table. Creating a quote (`submitMaterialList`) is not a row: it has no `from`. */
export type QuoteTransition = TransitionRule<QuoteStatus>;

/** The §2.5 table, one row per row of the spec and in the same order. */
export const QUOTE_TRANSITIONS: readonly QuoteTransition[] = [
  // Staff open the list or assign it to themselves: a client write the rules allow, not a callable.
  { from: ['submitted'], to: 'in_review', actors: ['staff'], entryPoints: ['direct_write'] },
  // Every send is a new offer version, also over an offer that is still open or has run out.
  {
    from: ['submitted', 'in_review', 'quoted', 'expired'],
    to: 'quoted',
    actors: ['staff'],
    entryPoints: ['sendQuote'],
  },
  // Accepting places the order at the quoted prices and links it to the quote.
  { from: ['quoted'], to: 'accepted', actors: ['customer'], entryPoints: ['acceptQuote'] },
  {
    from: ['submitted', 'in_review', 'quoted'],
    to: 'declined',
    actors: ['customer'],
    entryPoints: ['closeQuote'],
  },
  // For example "can't source it". Once an offer is out, only the customer or the clock ends it.
  { from: ['submitted', 'in_review'], to: 'cancelled', actors: ['staff'], entryPoints: ['closeQuote'] },
  // `offerValidUntil` has passed.
  { from: ['quoted'], to: 'expired', actors: ['system'], entryPoints: ['expireQuotes'] },
  // "Request changes" on an open offer, "Get a fresh quote" on one that ran out.
  { from: ['quoted', 'expired'], to: 'in_review', actors: ['customer'], entryPoints: ['reopenQuote'] },
];

/** The statuses an actor may move a quote to from `from` (§2.5). */
export function allowedQuoteTransitions(from: QuoteStatus, actor: MachineActor): QuoteStatus[] {
  return transitionTargets(QUOTE_TRANSITIONS, from, actor);
}

/**
 * Whether an actor may move a quote from `from` to `to` (§2.5). Sending a new offer is quoted → quoted
 * for staff. The entry point still checks the offer version and that the offer has not run out.
 */
export function canQuoteTransition(from: QuoteStatus, to: QuoteStatus, actor: MachineActor): boolean {
  return allowedQuoteTransitions(from, actor).includes(to);
}

/** True for a status no row leads out of: accepted, declined, cancelled. An expired quote can be reopened. */
export function isFinalQuoteStatus(status: QuoteStatus): boolean {
  return !QUOTE_TRANSITIONS.some((rule) => rule.from.includes(status));
}

/**
 * True when a quoted offer can no longer be accepted: `offerValidUntil` has passed. The `expireQuotes`
 * job only runs every 15 minutes, so the app and `acceptQuote` (`QUOTE_EXPIRED`) ask this instead of
 * waiting for the status to change.
 */
export function isQuoteOfferExpired(quote: Pick<Quote, 'status' | 'offerValidUntil'>, now: number): boolean {
  if (quote.status === 'expired') return true;
  // The same test as the `expireQuotes` job (`offerValidUntil ≤ now`, §5.7), so the app never offers
  // "Accept" on a quote the job is about to expire. Other statuses have no open offer to run out.
  return quote.status === 'quoted' && quote.offerValidUntil != null && quote.offerValidUntil <= now;
}
