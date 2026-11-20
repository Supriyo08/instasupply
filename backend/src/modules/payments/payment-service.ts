/**
 * Card payments (docs/PLATFORM.md §9.2.1 step 4, §10.4; MARKETPLACE §3.8): authorize at checkout through the
 * journal, attach the hold to the order inside the order's transaction, capture once when the order settles
 * (or at the deadline), refund afterwards, and void a hold no order owns. Every gateway call happens with no
 * transaction open; every state change around it is a short transaction of its own, keyed by the journal row.
 */
import {
  formatMoney,
  isFinalStoreOrderStatus,
  type CardBrand,
  type CardDeclineReason,
  type Order,
  type OrderPayment,
  type PaymentEvent,
} from '@instasupply/shared';
import type { Deps } from '../../container';
import { withTransaction, type Tx } from '../../platform/db/tx';
import { ApiError, failCode } from '../../platform/http/errors';
import { enqueue } from '../../platform/outbox/outbox';
import { checkAutomaticRefunds } from '../commerce/order-aggregate';
import { notify, notifyStaff } from '../notifications/notify';
import { recordStoreOrderLedger } from '../payouts/ledger';
import {
  insertJournal,
  lockJournal,
  lockOrder,
  orderExists,
  readJournal,
  readOrder,
  savePayment,
  storeOrdersOf,
  updateJournal,
  type JournalCard,
} from './repository';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MAX_EVENTS = 30;
const MAX_ROUNDS = 6;

export const authKey = (orderId: string, attempt: number): string =>
  attempt === 1 ? `auth_${orderId}` : `auth_${orderId}_r${attempt}`;
export const voidKey = (orderId: string, attempt: number): string =>
  attempt === 1 ? `void_${orderId}` : `void_${orderId}_r${attempt}`;
export const captureKey = (orderId: string): string => `capture_${orderId}`;

/** `min(authorizedAt + 6 days, captureBefore − 6 h)` (§10.4). */
export const captureDeadline = (authorizedAt: number, captureBefore: number): number =>
  Math.min(authorizedAt + 6 * DAY_MS, captureBefore - 6 * HOUR_MS);

/**
 * Thrown inside the order's transaction when the journal row is no longer `authorized` with the attempt this
 * checkout authorized (a void is in flight, or another attempt replaced it). Not retried by withTransaction:
 * the checkout authorizes again and runs a fresh transaction.
 */
export class AuthorizationLost extends Error {
  override readonly name = 'AuthorizationLost';
}

/** The journal says an order already owns this checkout's hold: the caller answers with that order. */
export class OrderAlreadyPlaced extends Error {
  override readonly name = 'OrderAlreadyPlaced';
}

const DECLINE_MESSAGES: Record<CardDeclineReason, string> = {
  card_declined: 'Your card was declined. Choose another card.',
  insufficient_funds: 'Your card has insufficient funds. Choose another card.',
  expired_card: 'That card has expired. Choose another card.',
  processing_error: "We couldn't reach your bank. Try again or choose another card.",
};

const BRAND_LABELS: Record<CardBrand, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'Amex',
  discover: 'Discover',
  card: 'Card',
};

export const cardLabel = (card: { brand: CardBrand; last4: string } | null): string =>
  card ? `${BRAND_LABELS[card.brand]} ••${card.last4}` : 'your card';

/** At most 30 events (§10.4): the authorization stays, the oldest of the rest go. */
function withEvent(payment: OrderPayment, event: PaymentEvent): PaymentEvent[] {
  const events = [...payment.events, event];
  if (events.length <= MAX_EVENTS) return events;
  return [events[0]!, ...events.slice(events.length - (MAX_EVENTS - 1))];
}

/** The invariants of §10.4, checked before every write of a payment. */
function checkInvariants(payment: OrderPayment): OrderPayment {
  const amounts = [
    payment.authorizedCents,
    payment.capturedCents,
    payment.refundedCents,
    payment.pendingCaptureCents,
  ];
  if (amounts.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`payment of ${payment.intentRef ?? 'order'}: an amount is below 0`);
  }
  if (payment.capturedCents > payment.authorizedCents) throw new Error('captured above authorized');
  if (payment.refundedCents > payment.capturedCents) throw new Error('refunded above captured');
  if (payment.events.length > MAX_EVENTS) throw new Error('more than 30 payment events');
  return payment;
}

// ---------- authorize (§9.2.1 step 4) ----------

type Decision =
  | { kind: 'authorize'; attempt: number }
  | { kind: 'done'; attempt: number; intentRef: string; captureBefore: number }
  | { kind: 'void' }
  | { kind: 'taken' }
  | { kind: 'attached' };

/**
 * Journal + gateway, outside the transaction; throws CARD_DECLINED. A retry of the same checkout (same amount,
 * same card) reuses the attempt and its key, so it receives the same authorization; any other state of the
 * journal is first brought back to a fresh attempt. `attempt` is what the order's transaction must find.
 */
export async function authorizeOrderPayment(
  deps: Deps,
  input: {
    orderId: string;
    amountCents: number;
    customerId: string;
    card: { cardId: string; brand: CardBrand; last4: string };
  },
): Promise<{ intentRef: string; captureBefore: number; attempt: number }> {
  if (deps.gateway.mode === 'disabled') failCode('PAYMENTS_DISABLED', "Card payments aren't available yet.");
  const { orderId, amountCents, customerId } = input;
  const card: JournalCard = { cardId: input.card.cardId, brand: input.card.brand, last4: input.card.last4 };
  const provider = deps.gateway.mode === 'stripe' ? 'stripe' : 'test';

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    await insertJournal(deps.pool, {
      orderId,
      customerId,
      amountCents,
      card,
      provider,
      now: deps.clock.now(),
    });
    const decision = await withTransaction(deps, async (tx): Promise<Decision> => {
      const row = await lockJournal(tx, orderId);
      if (!row) return { kind: 'void' };
      if (row.customer_id !== customerId) return { kind: 'taken' };
      switch (row.status) {
        case 'declined':
        case 'voided':
          await updateJournal(tx, orderId, {
            status: 'pending',
            attempt: row.attempt + 1,
            amountCents,
            card,
            intentRef: null,
            captureBefore: null,
            declineReason: null,
            captureBreakdown: null,
          });
          return { kind: 'authorize', attempt: row.attempt + 1 };
        case 'void_pending':
          return { kind: 'void' };
        case 'pending':
        case 'authorized': {
          const same = row.amount_cents === amountCents && row.card.cardId === card.cardId;
          if (!same) return { kind: 'void' };
          if (row.status === 'authorized' && row.intent_ref && row.capture_before !== null) {
            return {
              kind: 'done',
              attempt: row.attempt,
              intentRef: row.intent_ref,
              captureBefore: row.capture_before,
            };
          }
          return { kind: 'authorize', attempt: row.attempt };
        }
        case 'attached':
        case 'captured':
          return { kind: 'attached' };
      }
    });

    if (decision.kind === 'taken') {
      throw new ApiError('already-exists', 'That checkout id is already in use. Start the checkout again.');
    }
    if (decision.kind === 'attached') throw new OrderAlreadyPlaced();
    if (decision.kind === 'done') return decision;
    if (decision.kind === 'void') {
      // An earlier hold for another amount or card, or a void in flight: it ends before a new attempt starts.
      await voidOrderAuthorization(deps, orderId);
      continue;
    }

    const { attempt } = decision;
    const result = await deps.gateway.authorize({
      idempotencyKey: authKey(orderId, attempt),
      amountCents,
      customerId,
      card: input.card,
    });
    const outcome = await withTransaction(deps, async (tx) => {
      const row = await lockJournal(tx, orderId);
      if (!row || row.status !== 'pending' || row.attempt !== attempt) return 'changed' as const;
      if (result.ok) {
        await updateJournal(tx, orderId, {
          status: 'authorized',
          intentRef: result.intentRef,
          captureBefore: result.captureBefore,
        });
        return 'authorized' as const;
      }
      await updateJournal(tx, orderId, { status: 'declined', declineReason: result.reason });
      return 'declined' as const;
    });
    if (outcome === 'changed') continue;
    if (!result.ok) failCode('CARD_DECLINED', DECLINE_MESSAGES[result.reason], { reason: result.reason });
    return { intentRef: result.intentRef, captureBefore: result.captureBefore, attempt };
  }
  throw new ApiError('unavailable', 'The payment service is busy. Please try again.', null, {
    retryAfterMs: 1000,
  });
}

/**
 * Inside the order's transaction (§9.2.1 "Updates", rank 15): the journal must be `authorized` with the attempt
 * this checkout authorized; then it becomes `attached`, and no void can start for it any more.
 */
export async function attachAuthorization(tx: Tx, orderId: string, attempt: number): Promise<void> {
  const row = await lockJournal(tx, orderId);
  if (!row || row.status !== 'authorized' || row.attempt !== attempt) throw new AuthorizationLost();
  await updateJournal(tx, orderId, { status: 'attached' });
}

// ---------- void (§10.4 "Void procedure") ----------

/**
 * Voids the hold of a checkout that no order owns: the payment.void handler, the orphan sweep, the synchronous
 * void after a failed checkout and the journal rules of §9.2.1. A row already `void_pending` (finalize with
 * amount 0, or a void that failed half-way) is finished whatever the order says.
 */
export async function voidOrderAuthorization(deps: Deps, orderId: string): Promise<void> {
  const claimed = await withTransaction(deps, async (tx) => {
    const row = await lockJournal(tx, orderId);
    if (!row) return null;
    if (row.status === 'void_pending') return row;
    if (row.status !== 'pending' && row.status !== 'authorized') return null;
    if (await orderExists(tx, orderId)) return null;
    await updateJournal(tx, orderId, { status: 'void_pending' });
    return row;
  });
  if (!claimed) return;
  const { attempt } = claimed;

  let intentRef = claimed.intent_ref;
  if (!intentRef) {
    // A `pending` row: the gateway may hold an authorization we never heard about. The same key returns it.
    const again = await deps.gateway.authorize({
      idempotencyKey: authKey(orderId, attempt),
      amountCents: claimed.amount_cents,
      customerId: claimed.customer_id,
      card: claimed.card,
    });
    if (again.ok) intentRef = again.intentRef;
  }
  if (intentRef) await deps.gateway.void({ idempotencyKey: voidKey(orderId, attempt), intentRef });
  await withTransaction(deps, async (tx) => {
    const row = await lockJournal(tx, orderId);
    if (row && row.status === 'void_pending' && row.attempt === attempt) {
      await updateJournal(tx, orderId, { status: 'voided', intentRef: intentRef ?? row.intent_ref });
    }
  });
}

// ---------- finalize (§10.4 "Finalize") ----------

/** The capture per store order, in letter order, clamped to the authorization from the last letters. */
function breakdownOf(
  amounts: { id: string; cents: number }[],
  authorizedCents: number,
): Record<string, number> {
  const breakdown: Record<string, number> = {};
  let excess = Math.max(0, amounts.reduce((sum, entry) => sum + entry.cents, 0) - authorizedCents);
  for (const entry of [...amounts].reverse()) {
    const cut = Math.min(entry.cents, excess);
    excess -= cut;
    breakdown[entry.id] = entry.cents - cut;
  }
  return Object.fromEntries(amounts.map((entry) => [entry.id, breakdown[entry.id] ?? 0]));
}

const sumOf = (breakdown: Record<string, number>): number =>
  Object.values(breakdown).reduce((sum, cents) => sum + cents, 0);

/** The body of the payment.finalize handler. */
export async function finalizeOrderPayment(
  deps: Deps,
  orderId: string,
  opts: { deadline?: boolean } = {},
): Promise<void> {
  const deadline = opts.deadline === true;
  const step1 = await withTransaction(deps, async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!order) return null;
    const payment = order.payment;
    if (!['authorized', 'capture_failed', 'capture_pending'].includes(payment.status) || !payment.intentRef) {
      return null;
    }
    if (payment.status === 'capture_pending') {
      const journal = await readJournal(tx, orderId);
      return {
        intentRef: payment.intentRef,
        amount: payment.pendingCaptureCents,
        breakdown: journal?.capture_breakdown ?? {},
      };
    }
    const storeOrders = await storeOrdersOf(tx, orderId);
    const settled = storeOrders.every((so) => isFinalStoreOrderStatus(so.status));
    // A retry after the deadline (a deadline capture that failed) stays in deadline mode.
    const pastDeadline = payment.captureDeadlineAt !== null && payment.captureDeadlineAt <= tx.now;
    if (!settled && !deadline && !pastDeadline) return null;
    const breakdown = breakdownOf(
      storeOrders.map((so) => ({ id: so.id, cents: so.current.totalCents })),
      payment.authorizedCents,
    );
    const amount = sumOf(breakdown);
    const journal = await lockJournal(tx, orderId);
    if (amount === 0) {
      const attempt = journal?.attempt ?? 1;
      await savePayment(
        tx,
        order,
        checkInvariants({
          ...payment,
          status: 'voided',
          pendingCaptureCents: 0,
          events: withEvent(payment, {
            type: 'void',
            amountCents: payment.authorizedCents,
            storeOrderId: null,
            issueId: null,
            ref: payment.intentRef,
            idempotencyKey: voidKey(orderId, attempt),
            reason: 'nothing to charge',
            at: tx.now,
          }),
        }),
      );
      if (journal) await updateJournal(tx, orderId, { status: 'void_pending' });
      await enqueue(tx, 'payment.void', { orderId }, { dedupeKey: `payment.void:${orderId}` });
      return null;
    }
    await savePayment(
      tx,
      order,
      checkInvariants({ ...payment, status: 'capture_pending', pendingCaptureCents: amount }),
    );
    if (journal) await updateJournal(tx, orderId, { captureBreakdown: breakdown });
    return { intentRef: payment.intentRef, amount, breakdown };
  });
  if (!step1) return;

  const result = await deps.gateway.capture({
    idempotencyKey: captureKey(orderId),
    intentRef: step1.intentRef,
    amountCents: step1.amount,
  });
  await deps.hooks.at('finalize:afterCapture');

  await withTransaction(deps, async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!order || order.payment.status !== 'capture_pending') return;
    const payment = order.payment;
    const amount = payment.pendingCaptureCents;
    if (result.ok) {
      const journal = await lockJournal(tx, orderId);
      const breakdown = journal?.capture_breakdown ?? step1.breakdown;
      let events = withEvent(payment, {
        type: 'capture',
        amountCents: amount,
        storeOrderId: null,
        issueId: null,
        ref: result.ref,
        idempotencyKey: captureKey(orderId),
        reason: null,
        at: tx.now,
      });
      const released = payment.authorizedCents - amount;
      if (released > 0) {
        events = withEvent(
          { ...payment, events },
          {
            type: 'release',
            amountCents: released,
            storeOrderId: null,
            issueId: null,
            ref: payment.intentRef ?? result.ref,
            idempotencyKey: `release_${orderId}`,
            reason: null,
            at: tx.now,
          },
        );
      }
      const saved = await savePayment(
        tx,
        order,
        checkInvariants({
          ...payment,
          status: 'captured',
          capturedCents: amount,
          capturedAt: tx.now,
          pendingCaptureCents: 0,
          capturedByStoreOrder: breakdown,
          events,
        }),
      );
      if (journal) await updateJournal(tx, orderId, { status: 'captured' });
      await checkAutomaticRefunds(tx, saved);
      await recordStoreOrderLedger(tx, orderId);
      await notify(tx, order.customerId, {
        type: 'order_update',
        title: `Order ${order.number} complete`,
        body: `Order complete · charged ${formatMoney(amount)} to ${cardLabel(payment.card)}`,
        data: { customerOrderId: orderId },
        key: `order-complete-${orderId}`,
      });
      return;
    }
    const failures = payment.events.filter((event) => event.type === 'capture_failed').length + 1;
    await savePayment(
      tx,
      order,
      checkInvariants({
        ...payment,
        status: 'capture_failed',
        events: withEvent(payment, {
          type: 'capture_failed',
          amountCents: amount,
          storeOrderId: null,
          issueId: null,
          ref: payment.intentRef ?? '',
          idempotencyKey: captureKey(orderId),
          reason: result.reason,
          at: tx.now,
        }),
      }),
    );
    await notifyStaff(tx, {
      type: 'capture_failed',
      title: `Capture failed for ${order.number}`,
      body: `Charging ${formatMoney(amount)} to ${cardLabel(payment.card)} failed (${result.reason}). It is retried every 30 minutes.`,
      data: { customerOrderId: orderId },
      key: `capture-failed-${orderId}-${failures}`,
    });
  });
}

// ---------- refund (§10.4 "Refund") ----------

const hasEvent = (order: Order, key: string): PaymentEvent | undefined =>
  order.payment.events.find((event) => event.type === 'refund' && event.idempotencyKey === key);

/** The body of payment.refund: the gateway first, then the bookkeeping once per key. */
export async function refundOrderPayment(
  deps: Deps,
  input: {
    orderId: string;
    storeOrderId: string;
    amountCents: number;
    reason: string;
    idempotencyKey: string;
    issueId: string | null;
  },
): Promise<{ ref: string }> {
  const order = await readOrder(deps.pool, input.orderId);
  if (!order || !order.payment.intentRef) return { ref: '' };
  const done = hasEvent(order, input.idempotencyKey);
  if (done) return { ref: done.ref };
  const payment = order.payment;
  if (payment.status !== 'captured' && payment.status !== 'partially_refunded') return { ref: '' };
  const amount = Math.min(input.amountCents, payment.capturedCents - payment.refundedCents);
  if (amount <= 0) return { ref: '' };

  const { ref } = await deps.gateway.refund({
    idempotencyKey: input.idempotencyKey,
    intentRef: payment.intentRef!,
    amountCents: amount,
    reason: input.reason,
  });

  await withTransaction(deps, async (tx) => {
    const locked = await lockOrder(tx, input.orderId);
    if (!locked || hasEvent(locked, input.idempotencyKey)) return;
    const current = locked.payment;
    const automatic = input.idempotencyKey.startsWith('refund_adj_');
    const bucket = automatic ? current.adjustedByStoreOrder : current.refundedByStoreOrder;
    const nextBucket = { ...bucket, [input.storeOrderId]: (bucket[input.storeOrderId] ?? 0) + amount };
    const refundedCents = current.refundedCents + amount;
    await savePayment(
      tx,
      locked,
      checkInvariants({
        ...current,
        refundedCents,
        ...(automatic ? { adjustedByStoreOrder: nextBucket } : { refundedByStoreOrder: nextBucket }),
        status: refundedCents >= current.capturedCents ? 'refunded' : 'partially_refunded',
        events: withEvent(current, {
          type: 'refund',
          amountCents: amount,
          storeOrderId: input.storeOrderId,
          issueId: input.issueId,
          ref,
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
          at: tx.now,
        }),
      }),
    );
    await notify(tx, locked.customerId, {
      type: 'refund_issued',
      title: `Refund for ${locked.number}`,
      body: `Refunded ${formatMoney(amount)} to ${cardLabel(current.card)}`,
      data: { customerOrderId: locked.id, storeOrderId: input.storeOrderId },
      key: `refund-${input.idempotencyKey}`,
    });
  });
  return { ref };
}
