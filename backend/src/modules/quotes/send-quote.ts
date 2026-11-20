/**
 * sendQuote (docs/PLATFORM.md §9.2.10; MARKETPLACE §5.5.6, D16): staff answer a material list with an offer built
 * from catalogue listings (with optional agreed prices) and special-order lines. The offer is priced and its
 * window resolved by the checkout's own context (`loadCheckoutContext`, source `quote`) before the transaction;
 * under the quote lock the status and the offer version are checked again (`QUOTE_VERSION`).
 */
import {
  canQuoteTransition,
  formatDateTimeET,
  formatMoney,
  type OkResponse,
  type Quote,
  type QuoteLine,
  type QuoteOffer,
  type SendQuoteRequest,
} from '@instasupply/shared';
import type { Deps } from '../../container';
import type { Actor } from '../../platform/auth/actor';
import { withTransaction, type Tx } from '../../platform/db/tx';
import { failCode, failedPrecondition, invalidArgument, notFound } from '../../platform/http/errors';
import { enqueue } from '../../platform/outbox/outbox';
import { loadCheckoutContext, type PlanLine } from '../commerce';
import { notify } from '../notifications';
import { findQuote, lockQuote, readQuoteProducts, readStoreNames, saveQuote } from './repository';

const HOUR_MS = 3_600_000;

/** Status and version, checked on a plain read first and again under the lock. */
function checkSendable(quote: Quote, expectedVersion: number): void {
  if (!canQuoteTransition(quote.status, 'quoted', 'staff')) {
    failedPrecondition(`Quote ${quote.number} is ${quote.status.replace('_', ' ')} and can't be sent.`);
  }
  const current = quote.offer?.version ?? 0;
  if (current !== expectedVersion) {
    failCode(
      'QUOTE_VERSION',
      'Someone else sent this quote in the meantime. Reload it and check the offer.',
      {
        version: current,
      },
    );
  }
}

interface BuiltLines {
  plan: PlanLine[];
  lines: QuoteLine[];
}

async function buildLines(deps: Deps, req: SendQuoteRequest): Promise<BuiltLines> {
  const productIds = req.lines.flatMap((line) => (line.kind === 'catalog' ? [line.productId] : []));
  const customStoreIds = req.lines.flatMap((line) => (line.kind === 'custom' ? [line.storeId] : []));
  const [products, stores] = await Promise.all([
    readQuoteProducts(deps.pool, productIds),
    readStoreNames(deps.pool, customStoreIds),
  ]);
  const plan: PlanLine[] = [];
  const lines: QuoteLine[] = [];
  for (const [index, line] of req.lines.entries()) {
    const lineId = `L${index + 1}`;
    if (line.kind === 'catalog') {
      const product = products.get(line.productId);
      if (!product || !product.listed) {
        failCode('OUT_OF_STOCK', `${product?.name ?? 'A product'} is not listed any more.`, {
          productId: line.productId,
          available: 0,
        });
      }
      const unitPriceCents = line.unitPriceCents ?? product.priceCents;
      // An override is a price the store agreed to; the store is paid that price (storeValueCents).
      plan.push({
        kind: 'catalog',
        productId: product.id,
        storeId: product.storeId,
        quantity: line.quantity,
        unitPriceCents,
        storeUnitPriceCents: unitPriceCents,
        note: line.note,
      });
      lines.push({
        lineId,
        kind: 'catalog',
        productId: product.id,
        storeId: product.storeId,
        storeName: product.storeName,
        sku: product.sku,
        name: product.name,
        brand: product.brand,
        unit: product.unit,
        size: product.size,
        quantity: line.quantity,
        listPriceCents: product.priceCents,
        unitPriceCents,
        weightKg: product.weightKg,
        dimsCm: product.dimsCm,
        note: line.note,
        requestLine: line.requestLine,
      });
    } else {
      const store = stores.get(line.storeId);
      if (!store || store.status !== 'live') {
        failCode('STORE_UNAVAILABLE', "That store isn't taking orders.", { storeId: line.storeId });
      }
      plan.push({
        kind: 'custom',
        storeId: line.storeId,
        quantity: line.quantity,
        name: line.name,
        unit: line.unit,
        size: line.size,
        categoryId: null,
        unitPriceCents: line.unitPriceCents,
        storeUnitPriceCents: line.unitPriceCents,
        weightKg: line.weightKg,
        dimsCm: line.dimsCm,
        note: line.note,
      });
      lines.push({
        lineId,
        kind: 'custom',
        productId: null,
        storeId: line.storeId,
        storeName: store.name,
        sku: null,
        name: line.name,
        brand: null,
        unit: line.unit,
        size: line.size,
        quantity: line.quantity,
        listPriceCents: null,
        unitPriceCents: line.unitPriceCents,
        weightKg: line.weightKg,
        dimsCm: line.dimsCm,
        note: line.note,
        requestLine: line.requestLine,
      });
    }
  }
  return { plan, lines };
}

/** The customer's message, and an SMS when they asked to be called or messaged. */
async function tellCustomer(tx: Tx, quote: Quote, offer: QuoteOffer): Promise<void> {
  const total = formatMoney(offer.pricing.totalCents);
  const until = formatDateTimeET(offer.validUntil, tx.now);
  await notify(tx, quote.customerId, {
    type: 'quote_update',
    title: `Your quote ${quote.number} is ready`,
    body: `Your quote ${quote.number} is ready · ${total} · valid until ${until}`,
    data: { quoteId: quote.id },
    key: `quote-sent-${quote.id}-v${offer.version}`,
  });
  const contact = quote.request.contact;
  if (contact.preferred !== 'email' && contact.phone) {
    await enqueue(
      tx,
      'sms.send',
      {
        to: contact.phone,
        body: `InstaSupply: your quote ${quote.number} is ready · ${total} · valid until ${until}. Open the InstaSupply app to review it.`,
        purpose: 'other',
        sensitive: false,
      },
      { dedupeKey: `sms:quote-sent-${quote.id}-v${offer.version}` },
    );
  }
}

export async function sendQuote(deps: Deps, actor: Actor, req: SendQuoteRequest): Promise<OkResponse> {
  const quote = await findQuote(deps.pool, req.quoteId);
  if (!quote) notFound('That quote does not exist.');
  checkSendable(quote, req.expectedVersion);

  const jobsiteId = quote.request.jobsite?.jobsiteId ?? null;
  if (req.fulfilment === 'delivery' && jobsiteId === null) {
    invalidArgument('This list has no jobsite to deliver to. Quote it for pickup.', {
      fields: { fulfilment: 'no jobsite' },
    });
  }
  const { plan, lines } = await buildLines(deps, req);
  const now = deps.clock.now();
  // Priced exactly as the checkout will price the accepted quote: the customer's current first-order status,
  // every blocker, the window re-resolved.
  const context = await loadCheckoutContext(deps, {
    customerId: quote.customerId,
    source: 'quote',
    fulfilment: req.fulfilment,
    jobsiteId: req.fulfilment === 'delivery' ? jobsiteId : null,
    windowId: req.fulfilment === 'delivery' ? req.windowId : null,
    receiving: req.fulfilment === 'delivery' ? req.receiving : null,
    siteContact: null,
    instructions: null,
    unloadHelpStoreIds: req.fulfilment === 'delivery' ? req.unloadHelpStoreIds : [],
    promoCode: null,
    lines: plan,
    expectedTotalCents: null,
    cardId: null,
    now,
  });

  await withTransaction(
    deps,
    async (tx) => {
      const locked = await lockQuote(tx, req.quoteId);
      if (!locked) notFound('That quote does not exist.');
      checkSendable(locked, req.expectedVersion);
      const version = req.expectedVersion + 1;
      const validUntil = tx.now + req.validHours * HOUR_MS;
      const offer: QuoteOffer = {
        version,
        lines,
        unmatched: req.unmatched,
        fulfilment: req.fulfilment,
        receiving: req.fulfilment === 'delivery' ? (req.receiving ?? context.receiving) : null,
        windowId: req.fulfilment === 'delivery' ? req.windowId : null,
        windowLabel:
          req.fulfilment === 'delivery' && req.windowId !== null ? (context.window?.label ?? null) : null,
        unloadHelpStoreIds: req.fulfilment === 'delivery' ? req.unloadHelpStoreIds : [],
        pricing: context.priced,
        message: req.message,
        validUntil,
        sentBy: actor.uid,
        sentByName: actor.name,
        sentAt: tx.now,
      };
      const saved = await saveQuote(tx, {
        ...locked,
        status: 'quoted',
        statusAt: { ...locked.statusAt, quoted: tx.now },
        offer,
        offerValidUntil: validUntil,
        offerHistory: [
          ...locked.offerHistory,
          { version, totalCents: context.priced.totalCents, sentAt: tx.now },
        ],
        assignedTo: locked.assignedTo ?? actor.uid,
        assignedName: locked.assignedTo === null ? actor.name : locked.assignedName,
        closeReason: null,
      });
      await tellCustomer(tx, saved, offer);
    },
    { now },
  );
  return { ok: true };
}
