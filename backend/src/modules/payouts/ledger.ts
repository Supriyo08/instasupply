/**
 * The ledger writers of docs/PLATFORM.md §9.1 (MARKETPLACE §3.9): every dollar owed to a store or a driver is
 * an append-only entry with a deterministic id, written with `ON CONFLICT (id) DO NOTHING` inside the caller's
 * transaction, so a retried command or a second projection can never count the same money twice.
 *
 * | Entry                              | Payee  | Amount                                                        |
 * | `sale_{storeOrderId}`              | store  | + storeValueCents (0, skipped, for a store-fault replacement) |
 * | `commission_{storeOrderId}`        | store  | − percentBps(storeValueCents, commissionBps)                  |
 * | `delivery_{deliveryId}_{attempt}`  | driver | + payout.totalCents                                           |
 * | `failed_{deliveryId}_{attempt}`    | driver | + offer + boost for a site-caused failure                     |
 * | `cancel_{deliveryId}`              | driver | cancellation pay after check-in or ≥ 15 min held              |
 * | `clawback_{issueId}`               | either | − what the refund costs the party at fault                    |
 *
 * `attempt = delivery.attempts + 1`. New store entries of a store order with an open issue carry
 * `heldForIssueId`, so the payout run skips them until the issue resolves.
 */
import {
  cancellationPayCents,
  DEFAULT_COMMISSION_BPS,
  failurePayCents,
  percentBps,
  type Delivery,
  type LedgerEntry,
  type LedgerKind,
  type WithId,
} from '@instasupply/shared';
import type { Tx } from '../../platform/db/tx';
import {
  faultPartyOf,
  insertLedgerEntry,
  issueRefsOf,
  openIssueOf,
  settledStoreOrdersOf,
} from './repository';

interface EntryFields {
  id: string;
  kind: LedgerKind;
  payeeType: 'store' | 'driver';
  payeeId: string;
  amountCents: number;
  description: string;
  orderId?: string | null;
  storeOrderId?: string | null;
  deliveryId?: string | null;
  issueId?: string | null;
  heldForIssueId?: string | null;
}

function entry(tx: Tx, fields: EntryFields): WithId<LedgerEntry> {
  return {
    id: fields.id,
    payeeType: fields.payeeType,
    payeeId: fields.payeeId,
    kind: fields.kind,
    amountCents: fields.amountCents,
    orderId: fields.orderId ?? null,
    storeOrderId: fields.storeOrderId ?? null,
    deliveryId: fields.deliveryId ?? null,
    issueId: fields.issueId ?? null,
    description: fields.description.slice(0, 200),
    payoutId: null,
    heldForIssueId: fields.heldForIssueId ?? null,
    createdAt: tx.now,
  };
}

const percentText = (bps: number): string => `${Number((bps / 100).toFixed(2))} %`;

/**
 * Sale and commission of every delivered or picked-up store order of the order. Called when the payment is
 * captured, and when a replacement order (payment `not_required`) settles (§9.2.12). A replacement whose
 * original issue put the store at fault pays the store nothing (`sale_` is 0 and skipped) but still costs
 * the commission. Repeated calls write nothing.
 */
export async function recordStoreOrderLedger(tx: Tx, orderId: string): Promise<void> {
  for (const so of await settledStoreOrdersOf(tx, orderId)) {
    const bps = so.commission_bps ?? DEFAULT_COMMISSION_BPS;
    const value = so.doc.storeValueCents;
    const storeAtFault =
      so.order_source === 'replacement' &&
      so.order_issue_id !== null &&
      (await faultPartyOf(tx, so.order_issue_id)) === 'store';
    const held = await openIssueOf(tx, so.id);
    const common = {
      payeeType: 'store' as const,
      payeeId: so.doc.storeId,
      orderId,
      storeOrderId: so.id,
      heldForIssueId: held,
    };
    const sale = storeAtFault ? 0 : value;
    if (sale > 0) {
      await insertLedgerEntry(
        tx,
        entry(tx, {
          ...common,
          id: `sale_${so.id}`,
          kind: 'sale',
          amountCents: sale,
          description:
            so.order_source === 'replacement' ? `Replacement ${so.doc.number}` : `Sale ${so.doc.number}`,
        }),
      );
    }
    const commission = percentBps(value, bps);
    if (commission > 0) {
      await insertLedgerEntry(
        tx,
        entry(tx, {
          ...common,
          id: `commission_${so.id}`,
          kind: 'commission',
          amountCents: -commission,
          description: `Commission ${percentText(bps)} on ${so.doc.number}`,
        }),
      );
    }
  }
}

/**
 * Driver pay for one delivery change (called by `applyDeliveryEffects` in every delivery transaction):
 * delivered → the payout total; failed for a site-caused reason → offer + boost; cancelled after a claim →
 * the cancellation pay when the driver had checked in or held the job for 15 minutes. Only the transition
 * into the status writes; the deterministic ids make a repeat harmless anyway.
 */
export async function recordDeliveryLedger(tx: Tx, before: Delivery | null, after: Delivery): Promise<void> {
  if (before?.status === after.status) return;
  const payout = after.payout;
  if (!payout) return;
  const attempt = after.attempts + 1;
  const refs = {
    orderId: after.sourceOrderId ?? null,
    storeOrderId: after.storeOrderId,
    deliveryId: after.id,
  };

  if (after.status === 'delivered' && after.driverId) {
    if (payout.totalCents <= 0) return;
    await insertLedgerEntry(
      tx,
      entry(tx, {
        ...refs,
        id: `delivery_${after.id}_${attempt}`,
        kind: 'delivery',
        payeeType: 'driver',
        payeeId: after.driverId,
        amountCents: payout.totalCents,
        description: `Delivery ${after.orderId}`,
      }),
    );
    return;
  }

  if (after.status === 'failed' && after.driverId) {
    const pay = failurePayCents(payout, after.failure?.reason ?? null);
    if (pay <= 0) return;
    await insertLedgerEntry(
      tx,
      entry(tx, {
        ...refs,
        id: `failed_${after.id}_${attempt}`,
        kind: 'failed_attempt',
        payeeType: 'driver',
        payeeId: after.driverId,
        amountCents: pay,
        description: `Failed attempt ${after.orderId} (${after.failure?.reason ?? 'unknown'})`,
      }),
    );
    return;
  }

  if (after.status === 'cancelled') {
    // Cancellation pay is for a claimed job cancelled while the goods are still at the store (§3.9, §3.10).
    // A return to store after a failure (failed → cancelled) was handed over: its pay is the failure pay.
    const handedOver =
      before?.status === 'failed' || after.pickedUpAt != null || after.pickup?.collectedAt != null;
    if (handedOver) return;
    // stageDeliveryCancellation keeps the driver on the document so this entry can be written.
    const driverId = after.driverId ?? before?.driverId ?? null;
    if (!driverId) return;
    const pay = cancellationPayCents(payout.offerCents, {
      acceptedAt: after.acceptedAt ?? null,
      arrivedAt: after.pickup?.arrivedAt ?? null,
      cancelledAt: after.cancelledAt ?? tx.now,
    });
    if (pay <= 0) return;
    await insertLedgerEntry(
      tx,
      entry(tx, {
        ...refs,
        id: `cancel_${after.id}`,
        kind: 'cancellation',
        payeeType: 'driver',
        payeeId: driverId,
        amountCents: pay,
        description: `Cancellation pay ${after.orderId}`,
      }),
    );
  }
}

/**
 * `clawback_{issueId}`: what a refund costs the party at fault (MARKETPLACE §3.7, `clawbackCents` in shared).
 * `amountCents` is that cost; the entry is always its negative, whatever sign the caller passes. 0 writes
 * nothing. The entry is never held: the issue that would hold it is being resolved in this transaction.
 */
export async function recordClawback(
  tx: Tx,
  input: {
    issueId: string;
    payeeType: 'store' | 'driver';
    payeeId: string;
    amountCents: number;
    description: string;
  },
): Promise<void> {
  const cost = Math.abs(Math.round(input.amountCents));
  if (cost === 0) return;
  const refs = await issueRefsOf(tx, input.issueId);
  await insertLedgerEntry(
    tx,
    entry(tx, {
      id: `clawback_${input.issueId}`,
      kind: 'clawback',
      payeeType: input.payeeType,
      payeeId: input.payeeId,
      amountCents: -cost,
      description: input.description,
      orderId: refs?.order_id ?? null,
      storeOrderId: refs?.store_order_id ?? null,
      deliveryId: refs?.delivery_id ?? null,
      issueId: input.issueId,
    }),
  );
}
