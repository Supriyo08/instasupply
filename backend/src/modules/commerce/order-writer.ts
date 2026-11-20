/**
 * stageMarketplaceOrder (docs/PLATFORM.md §9.1, §9.2.1 "Transaction"; MARKETPLACE §5.5.1 step 5): the one order
 * writer for checkout, accepted quotes and replacements. Inside the caller's transaction it locks the customer
 * (rank 1) and the catalogue products (rank 10), re-validates and re-prices on the locked rows, takes the order
 * number, inserts the order, its store orders and their deliveries, reserves stock, counts the order on the
 * customer, attaches the card hold, and runs the store-order effects and the notifications.
 */
import {
  formatAddressLine,
  formatMoney,
  localDateOf,
  storeRespondBy,
  type ActorRole,
  type Amounts,
  type CardBrand,
  type DeliveryWindow,
  type Order,
  type OrderPayment,
  type PlaceOrderResponse,
  type PricedStore,
  type StoreOrder,
  type StoreOrderLine,
  type StoreOrderPrivateMeta,
} from '@instasupply/shared';
import { lockGraph } from '../../platform/db/locks';
import { nextNumber } from '../../platform/db/sequences';
import type { Tx } from '../../platform/db/tx';
import { ApiError, notFound } from '../../platform/http/errors';
import { newId } from '../../platform/ids';
import { mediaUrl } from '../../platform/storage/files.service';
import { touchJobsite } from '../account';
import { stageMarketplaceDelivery } from '../deliveries';
import { notify, notifyStaff } from '../notifications/notify';
import { attachAuthorization, authKey, captureDeadline, cardLabel } from '../payments/payment-service';
import {
  applyStoreOrderEffects,
  insertStoreOrder,
  stagePickupCode,
  stageStockReserve,
  type StoreUnitPriceMeta,
} from '../store-orders';
import {
  catalogProductIds,
  evaluateCheckout,
  storeIdsOf,
  type CheckoutRequest,
  type EvaluatedCheckout,
} from './checkout';
import { summaryOf } from './order-aggregate';
import {
  findOrder,
  insertOrder,
  lockCustomer,
  lockProducts,
  patchCustomerDoc,
  readJobsite,
  readStores,
  saveOrder,
  type CheckoutStoreRecord,
  type CustomerRecord,
} from './orders.repository';

/** Who placed the order: the customer, or a staff member for a replacement. */
export interface OrderPlacer {
  uid: string;
  name: string;
  role: ActorRole;
}

export type PlanPayment =
  | {
      kind: 'card';
      card: { cardId: string; brand: CardBrand; last4: string };
      intentRef: string;
      captureBefore: number;
      /** The journal attempt that authorized this hold; the transaction attaches exactly that one. */
      attempt: number;
    }
  | { kind: 'none' };

/** placeOrder, acceptQuote and replacements build one of these (MARKETPLACE §5.5.1, §5.5.6, §5.5.7). */
export interface MarketplaceOrderPlan extends CheckoutRequest {
  /** The client's checkoutId (D17). */
  orderId: string;
  quoteId?: string | null;
  issueId?: string | null;
  payment: PlanPayment;
  /** HST registration printed on the receipt (`config.HST_NUMBER`). */
  hstNumber?: string | null;
  /** publicOrigin of the request, for the line image copies. */
  origin?: string | null;
  /** Default: the customer. */
  placedBy?: OrderPlacer;
  /** A test hold point, awaited right after the locks (`placeOrder:locked`, §12.3). */
  onLocked?: () => Promise<void>;
}

export interface StagedOrder {
  orderId: string;
  number: string;
  totalCents: number;
  storeOrders: PlaceOrderResponse['storeOrders'];
  /** False when the order already existed (a retry or a concurrent call with the same id): nothing was written. */
  created: boolean;
  order: Order;
}

export const toPlaceOrderResponse = (
  staged: Pick<StagedOrder, 'orderId' | 'number' | 'totalCents' | 'storeOrders'>,
): PlaceOrderResponse => ({
  orderId: staged.orderId,
  number: staged.number,
  totalCents: staged.totalCents,
  storeOrders: staged.storeOrders,
});

export function stagedFromOrder(order: Order, created: boolean): StagedOrder {
  return {
    orderId: order.id,
    number: order.number,
    totalCents: order.placed.totalCents,
    storeOrders: order.storeOrders.map((so) => ({
      storeOrderId: so.storeOrderId,
      number: so.number,
      storeId: so.storeId,
    })),
    created,
    order,
  };
}

const amountsOf = (entry: Amounts): Amounts => ({
  itemsCents: entry.itemsCents,
  discountCents: entry.discountCents,
  deliveryFeeCents: entry.deliveryFeeCents,
  unloadFeeCents: entry.unloadFeeCents,
  taxCents: entry.taxCents,
  totalCents: entry.totalCents,
});

/** "20 × 2x4x8 SPF stud, 4 × OSB 7/16 in +2 more" over every line of the order. */
function summarize(lines: readonly { quantity: number; name: string }[]): string {
  const head = lines
    .slice(0, 2)
    .map((line) => `${line.quantity} × ${line.name}`)
    .join(', ');
  return lines.length > 2 ? `${head} +${lines.length - 2} more` : head;
}

function buildPayment(plan: MarketplaceOrderPlan, totalCents: number, now: number): OrderPayment {
  const empty = {
    capturedCents: 0,
    refundedCents: 0,
    pendingCaptureCents: 0,
    capturedByStoreOrder: {},
    refundedByStoreOrder: {},
    adjustedByStoreOrder: {},
    capturedAt: null,
  };
  if (plan.payment.kind === 'none') {
    return {
      ...empty,
      method: 'none',
      provider: 'test',
      intentRef: null,
      card: null,
      status: 'not_required',
      authorizedCents: 0,
      authorizedAt: null,
      captureDeadlineAt: null,
      events: [],
    };
  }
  const { card, intentRef, captureBefore, attempt } = plan.payment;
  return {
    ...empty,
    method: 'card',
    provider: 'test',
    intentRef,
    card,
    status: 'authorized',
    authorizedCents: totalCents,
    authorizedAt: now,
    captureDeadlineAt: captureDeadline(now, captureBefore),
    events: [
      {
        type: 'authorize',
        amountCents: totalCents,
        storeOrderId: null,
        issueId: null,
        ref: intentRef,
        idempotencyKey: authKey(plan.orderId, attempt),
        reason: null,
        at: now,
      },
    ],
  };
}

interface BuiltStoreOrder {
  storeOrder: StoreOrder;
  meta: StoreOrderPrivateMeta;
  priced: PricedStore;
  record: CheckoutStoreRecord;
}

function buildStoreOrder(
  plan: MarketplaceOrderPlan,
  evaluated: EvaluatedCheckout,
  order: Order,
  priced: PricedStore,
  placer: OrderPlacer,
  now: number,
): BuiltStoreOrder {
  const record = evaluated.stores.get(priced.storeId)!;
  const drafts = evaluated.drafts.get(priced.storeId)!;
  const timing = evaluated.timings.get(priced.storeId)!;
  const lines: StoreOrderLine[] = priced.lines.map((line) => {
    const draft = drafts.get(line.lineId)!;
    return {
      lineId: line.lineId,
      kind: line.kind,
      productId: line.productId,
      sku: draft.sku,
      name: line.name,
      brand: draft.brand,
      unit: line.unit,
      size: line.size,
      categoryId: draft.categoryId,
      imageKey: draft.imageKey,
      imageUrl: plan.origin && draft.imagePath ? mediaUrl(plan.origin, draft.imagePath) : null,
      unitPriceCents: line.unitPriceCents,
      quantity: line.quantity,
      fulfilledQty: line.quantity,
      shortReason: null,
      lineCents: line.lineCents,
      discountCents: line.discountCents,
      weightKg: line.weightKg,
      dimsCm: line.dimsCm,
      note: draft.plan.note ?? null,
    };
  });
  const storeValueCents = priced.lines.reduce(
    (sum, line) => sum + drafts.get(line.lineId)!.storeUnitPriceCents * line.quantity,
    0,
  );
  const amounts = amountsOf(priced);
  const id = `${order.id}-${priced.letter}`;
  const storeOrder: StoreOrder = {
    id,
    number: `${order.number}-${priced.letter}`,
    letter: priced.letter,
    orderId: order.id,
    orderNumber: order.number,
    source: order.source,
    storeId: priced.storeId,
    storeName: record.store.name,
    storeAddressLine: formatAddressLine(record.store.address),
    storeLocation: record.store.location,
    storePhone: record.store.phone,
    customerId: order.customerId,
    customerName: order.customerName,
    companyName: order.companyName,
    customerPhone: order.customerPhone,
    fulfilment: order.fulfilment,
    jobsite: order.jobsite,
    receiving: order.receiving,
    siteContact: order.siteContact,
    instructions: order.instructions,
    window: order.window,
    timing: {
      respondBy: storeRespondBy(record.store, now),
      readyBy: timing.readyBy,
      readyByDate: localDateOf(timing.readyBy),
      targetPickupAt: timing.targetPickupAt,
      deliverBy: timing.deliverBy,
    },
    lines,
    lineCount: lines.length,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    itemsSummary: priced.load.summary,
    load: priced.load,
    vehicleClass: priced.vehicleClass,
    roadKm: priced.roadKm,
    unload: priced.unload,
    deliveryFeeListCents: priced.deliveryFeeListCents,
    feeWaiver: priced.feeWaiver,
    placed: amounts,
    current: amounts,
    storeValueCents,
    status: 'new',
    statusAt: { new: now },
    version: 0,
    history: [
      {
        status: 'new',
        at: now,
        actorId: placer.uid,
        actorName: placer.name,
        actorRole: placer.role,
        note: null,
      },
    ],
    deliveryId: null,
    driver: null,
    driverSyncedAt: null,
    pickup: { readyAt: null, holdUntil: null, collectedAt: null, collectedBy: null },
    rejectReason: null,
    cancelReason: null,
    cancelledBy: null,
    reminderSentAt: null,
    acceptOverdue: false,
    issueCount: 0,
    rated: false,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const meta: StoreOrderPrivateMeta & StoreUnitPriceMeta = {
    pickupCode: null,
    pickupCodeIssuedTo: null,
    codeAttempts: 0,
    commissionBps: record.settings.commissionBps ?? 1000,
    alertSmsSentAt: null,
    // A replacement's lines cost the customer 0: its store value after a shortage needs the store's price
    // of each line (§3.6), kept privately here for stageStoreOrderTransition.
    ...(order.source === 'replacement'
      ? {
          storeUnitPriceCents: Object.fromEntries(
            priced.lines.map((line) => [line.lineId, drafts.get(line.lineId)!.storeUnitPriceCents]),
          ),
        }
      : {}),
  };
  return { storeOrder, meta, priced, record };
}

function buildOrder(
  plan: MarketplaceOrderPlan,
  evaluated: EvaluatedCheckout,
  customer: CustomerRecord,
  number: string,
  now: number,
): Order {
  const { priced } = evaluated;
  const window: DeliveryWindow | null = evaluated.window
    ? {
        id: evaluated.window.id,
        kind: evaluated.window.kind,
        date: evaluated.window.date,
        startAt: evaluated.window.startAt,
        endAt: evaluated.window.endAt,
        label: evaluated.window.label,
      }
    : null;
  const allLines = priced.stores.flatMap((entry) => entry.lines);
  return {
    id: plan.orderId,
    number,
    source: plan.source,
    quoteId: plan.quoteId ?? null,
    issueId: plan.issueId ?? null,
    customerId: customer.id,
    customerName: customer.displayName,
    companyName: customer.doc.companyName ?? null,
    customerPhone: customer.phoneNumber ?? evaluated.siteContact?.phone ?? '',
    fulfilment: plan.fulfilment,
    jobsite: evaluated.jobsite,
    receiving: evaluated.receiving,
    siteContact: evaluated.siteContact,
    window,
    instructions: plan.instructions,
    storeOrderIds: priced.stores.map((entry) => `${plan.orderId}-${entry.letter}`),
    storeCount: priced.stores.length,
    lineCount: priced.lineCount,
    itemCount: priced.itemCount,
    itemsSummary: summarize(allLines),
    placed: {
      ...amountsOf(priced),
      discounts: priced.discounts,
      promoCode: priced.promo?.status === 'applied' ? priced.promo.code : null,
      freeDelivery: priced.freeDelivery,
    },
    current: amountsOf(priced),
    payment: buildPayment(plan, priced.totalCents, now),
    storeOrders: [],
    status: 'placed',
    statusAt: { placed: now },
    needsAttention: false,
    isFirstOrder: evaluated.isFirstOrder,
    countsTowardFirstOrder: plan.source !== 'replacement',
    hstNumber: plan.hstNumber ? plan.hstNumber : null,
    cancelReason: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** placeOrder, acceptQuote, replacements. */
export async function stageMarketplaceOrder(tx: Tx, plan: MarketplaceOrderPlan): Promise<StagedOrder> {
  const now = tx.now;
  const customer = await lockCustomer(tx, plan.customerId);
  if (!customer || customer.role !== 'customer') notFound('That customer account does not exist.');
  const productIds = catalogProductIds(plan.lines);
  const products = await lockProducts(tx, productIds);
  if (plan.onLocked) await plan.onLocked();

  // A concurrent call with the same checkoutId committed first: answer with its order, write nothing.
  const existing = await findOrder(tx, plan.orderId);
  if (existing) {
    if (existing.customerId !== customer.id) {
      throw new ApiError('already-exists', 'That checkout id is already in use. Start the checkout again.');
    }
    return stagedFromOrder(existing, false);
  }

  const stores = await readStores(tx, storeIdsOf(plan.lines));
  let jobsite = null;
  if (plan.fulfilment === 'delivery' && plan.jobsiteId !== null) {
    jobsite = await readJobsite(tx, plan.jobsiteId);
    if (!jobsite || jobsite.userId !== customer.id)
      notFound('That jobsite no longer exists. Choose another one.');
  }
  const evaluated = evaluateCheckout(plan, { customer, jobsite, stores, products, now });

  const number = `IS-${await nextNumber(tx, 'order')}`;
  let order = buildOrder(plan, evaluated, customer, number, now);
  await insertOrder(tx, order);

  const placer: OrderPlacer = plan.placedBy ?? {
    uid: customer.id,
    name: customer.displayName,
    role: 'customer',
  };
  const built: BuiltStoreOrder[] = [];
  const summaries = [];
  for (const priced of evaluated.priced.stores) {
    const entry = buildStoreOrder(plan, evaluated, order, priced, placer, now);
    // The delivery id is chosen first, so the store order is inserted with it (the delivery references the
    // store order, so it can only be inserted after it).
    const deliveryId = order.fulfilment === 'delivery' ? newId() : null;
    if (deliveryId) entry.storeOrder = { ...entry.storeOrder, deliveryId };
    await insertStoreOrder(tx, entry.storeOrder, entry.meta);
    let trackingToken: string | null = null;
    let pickupCode: string | null = null;
    if (deliveryId === null) {
      pickupCode = await stagePickupCode(tx, entry.storeOrder.id, 'customer');
    } else {
      const staged = await stageMarketplaceDelivery(tx, {
        deliveryId,
        storeOrder: entry.storeOrder,
        priced: { roadTenths: priced.roadTenths },
        store: { ...entry.record.store, id: priced.storeId },
        settings: { loadingNotes: entry.record.settings.loadingNotes ?? null },
        actor: placer,
      });
      trackingToken = staged.trackingToken;
    }
    built.push(entry);
    summaries.push(summaryOf(entry.storeOrder, { trackingToken, pickupCode }));
  }

  const reserve = new Map<string, number>();
  for (const line of plan.lines) {
    if (line.kind === 'catalog')
      reserve.set(line.productId, (reserve.get(line.productId) ?? 0) + line.quantity);
  }
  await stageStockReserve(
    tx,
    [...reserve.entries()].map(([productId, quantity]) => ({ productId, quantity })),
  );

  if (plan.source !== 'replacement') {
    const stats = {
      nonCancelledOrders: (customer.doc.stats?.nonCancelledOrders ?? 0) + 1,
      completedOrders: customer.doc.stats?.completedOrders ?? 0,
      lastOrderAt: now,
    };
    const patch: Record<string, unknown> = { stats };
    const promo = order.placed.discounts.find((discount) => discount.kind === 'promo')?.code ?? null;
    if (promo) {
      const uses = { ...(customer.doc.promoUses ?? {}) };
      uses[promo] = (uses[promo] ?? 0) + 1;
      patch.promoUses = uses;
    }
    await patchCustomerDoc(tx, customer, patch);
  }
  if (jobsite) await touchJobsite(tx, jobsite.id);
  if (plan.payment.kind === 'card') await attachAuthorization(tx, plan.orderId, plan.payment.attempt);

  order = await saveOrder(tx, { ...order, storeOrders: summaries });

  const graph = await lockGraph(tx, { orderIds: [order.id], productIds, withOffers: true });
  for (const entry of built) await applyStoreOrderEffects(tx, graph, null, entry.storeOrder);

  if (plan.source !== 'replacement') {
    const stores = order.storeCount === 1 ? '1 store' : `${order.storeCount} stores`;
    const held =
      order.payment.card !== null
        ? ` · ${formatMoney(order.placed.totalCents)} held on ${cardLabel(order.payment.card)}`
        : '';
    await notify(tx, order.customerId, {
      type: 'order_placed',
      title: `Order ${order.number} placed`,
      body: `Order ${order.number} placed · ${stores}${held}`,
      data: { customerOrderId: order.id },
      key: `order-placed-${order.id}`,
    });
  }
  await notifyStaff(tx, {
    type: 'order_placed',
    title: `New order ${order.number}`,
    body: `${order.customerName} · ${order.storeCount} store${order.storeCount === 1 ? '' : 's'} · ${formatMoney(order.placed.totalCents)}`,
    data: { customerOrderId: order.id },
    silent: true,
    key: `order-placed-staff-${order.id}`,
  });

  return stagedFromOrder(order, true);
}
