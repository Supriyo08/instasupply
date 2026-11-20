/**
 * resolveIssue (docs/PLATFORM.md §9.2.11; MARKETPLACE §2.6, §3.7, §3.9, §5.5.7): staff close a case with a refund,
 * a replacement order or no action. Locks: users(customer) → issues → orders → store_orders (→ deliveries) via
 * lockGraph, then products (the replacement's order writer), then ledger_entries.
 *
 * - Refund after capture: `refundForLines`, capped by what is left of the store order and of the capture (both
 *   less the refunds still in the outbox); `payment.refund` keyed `refund_{issueId}`; a clawback per fault.
 * - Refund before capture: the store order's `current` is reduced field by field (the customer is simply not
 *   charged) and, for a store at fault, `storeValueCents` (so the later sale entry is smaller); a driver at
 *   fault still gets the clawback entry.
 * - Replacement: the order writer with `source: 'replacement'`, the lines at 0, payment `not_required`.
 * - Always: the resolution, status `resolved`, the ledger holds released, notifications.
 */
import {
  DISPATCHER_REFUND_LIMIT_CENTS,
  formatMoney,
  percentBps,
  refundForLines,
  subtractAmounts,
  type ActorRole,
  type Amounts,
  type Issue,
  type ResolveIssueRequest,
  type ResolveIssueResponse,
  type StoreOrder,
} from '@instasupply/shared';
import type { Deps } from '../../container';
import type { Actor } from '../../platform/auth/actor';
import { lockGraph } from '../../platform/db/locks';
import { withTransaction, type Tx } from '../../platform/db/tx';
import { failCode, failedPrecondition, invalidArgument, notFound } from '../../platform/http/errors';
import { newId } from '../../platform/ids';
import { enqueue } from '../../platform/outbox/outbox';
import { projectOrderAggregate, stageMarketplaceOrder, type PlanLine } from '../commerce';
import { notify, notifyStoreMembers } from '../notifications';
import { recordClawback } from '../payouts';
import {
  catalogPrices,
  findIssue,
  lockIssue,
  pendingRefunds,
  readOrder,
  readStoreOrder,
  releaseLedgerHolds,
  resolvedRefundsOf,
  saveIssue,
  saveStoreOrderDoc,
} from './repository';

type Lines = { lineId: string; quantity: number }[];

/** The resolved lines as the issue keeps them: the next refund on this store order counts them as given back. */
function issueLines(storeOrder: StoreOrder, lines: Lines): Issue['lines'] {
  return lines.map((line) => {
    const source = storeOrder.lines.find((candidate) => candidate.lineId === line.lineId);
    if (!source) invalidArgument('Choose items from this order.', { fields: { lines: line.lineId } });
    if (line.quantity > source.fulfilledQty) {
      invalidArgument(`${source.name}: only ${source.fulfilledQty} were supplied.`, {
        fields: { lines: line.lineId },
      });
    }
    return {
      lineId: line.lineId,
      name: source.name,
      quantity: line.quantity,
      unitPriceCents: source.unitPriceCents,
    };
  });
}

function priceRefund(
  storeOrder: StoreOrder,
  lines: Lines,
  includeDeliveryFee: boolean,
  earlierRefunds: Awaited<ReturnType<typeof resolvedRefundsOf>>,
): Amounts {
  try {
    return refundForLines(storeOrder, lines, { includeDeliveryFee, earlierRefunds });
  } catch (error) {
    if (error instanceof RangeError) {
      invalidArgument('Those items were already refunded or were not supplied.', {
        fields: { lines: 'too many' },
      });
    }
    throw error;
  }
}

/**
 * Replacement lines: the issue's lines at 0 for the customer, valued for the store at the catalogue price
 * (MARKETPLACE §3.6). A store at fault is handled by recordStoreOrderLedger when the replacement settles:
 * no `sale_`, but the `commission_` on that value (PLATFORM §9.2.12).
 */
function replacementLines(storeOrder: StoreOrder, lines: Lines, prices: Map<string, number>): PlanLine[] {
  return lines.map((line): PlanLine => {
    const source = storeOrder.lines.find((candidate) => candidate.lineId === line.lineId)!;
    if (source.kind === 'catalog' && source.productId !== null) {
      return {
        kind: 'catalog',
        productId: source.productId,
        storeId: storeOrder.storeId,
        quantity: line.quantity,
        unitPriceCents: 0,
        storeUnitPriceCents: prices.get(source.productId) ?? source.unitPriceCents,
        note: `Replacement for ${storeOrder.number}`,
      };
    }
    return {
      kind: 'custom',
      storeId: storeOrder.storeId,
      quantity: line.quantity,
      name: source.name,
      unit: source.unit,
      size: source.size,
      categoryId: source.categoryId,
      unitPriceCents: 0,
      storeUnitPriceCents: source.unitPriceCents,
      weightKg: source.weightKg,
      dimsCm: source.dimsCm,
      note: `Replacement for ${storeOrder.number}`,
    };
  });
}

interface Clawback {
  payeeType: 'store' | 'driver';
  payeeId: string;
  amountCents: number;
}

/**
 * MARKETPLACE §3.7: a store at fault gives back the refunded gross items less the commission on them; a driver
 * the refunded gross items. The amounts passed are the signed ledger amounts (negative).
 */
async function writeClawbacks(tx: Tx, issue: Issue, clawbacks: readonly Clawback[]): Promise<void> {
  for (const clawback of clawbacks) {
    await recordClawback(tx, {
      issueId: issue.id,
      payeeType: clawback.payeeType,
      payeeId: clawback.payeeId,
      amountCents: clawback.amountCents,
      description: `Clawback ${issue.number} · ${issue.storeOrderNumber}`,
    });
  }
}

export async function resolveIssue(
  deps: Deps,
  actor: Actor,
  req: ResolveIssueRequest,
): Promise<ResolveIssueResponse> {
  const known = await findIssue(deps.pool, req.issueId);
  if (!known) notFound('That case does not exist.');
  if (known.status === 'resolved') failedPrecondition(`${known.number} is already resolved.`);
  if (req.faultParty === 'driver' && known.driverId === null) {
    invalidArgument('No driver handled this order.', { fields: { faultParty: 'no driver' } });
  }
  const found = await readStoreOrder(deps.pool, known.storeOrderId);
  if (!found) notFound('That order does not exist.');
  const lines: Lines =
    req.lines ?? known.lines.map((line) => ({ lineId: line.lineId, quantity: line.quantity }));
  issueLines(found.storeOrder, lines);
  if (req.kind !== 'no_action' && lines.length === 0) {
    invalidArgument('Choose the items to refund or replace.', { fields: { lines: 'required' } });
  }
  const storeAtFault = req.faultParty === 'store';
  const prices =
    req.kind === 'replacement'
      ? await catalogPrices(
          deps.pool,
          found.storeOrder.lines.flatMap((line) => (line.productId ? [line.productId] : [])),
        )
      : new Map<string, number>();
  const replacementOrderId = newId();
  const note = req.note.trim();

  return withTransaction(deps, async (tx) => {
    const graph = await lockGraph(tx, { issueIds: [req.issueId] });
    const issue = await lockIssue(tx, req.issueId);
    if (!issue) notFound('That case does not exist.');
    if (issue.status === 'resolved') failedPrecondition(`${issue.number} is already resolved.`);
    const current = await readStoreOrder(tx, issue.storeOrderId);
    const order = await readOrder(tx, issue.orderId);
    if (!current || !order) notFound('That order does not exist.');
    const storeOrder = current.storeOrder;
    const resolvedLines = issueLines(storeOrder, lines);

    let refundCents = 0;
    let refundItemsCents = 0;
    let replacement: string | null = null;

    if (req.kind === 'refund') {
      const earlier = await resolvedRefundsOf(tx, storeOrder.id);
      const refund = priceRefund(storeOrder, lines, req.refundDeliveryFee === true, earlier);
      const payment = order.payment;
      const captured = ['captured', 'partially_refunded', 'refunded'].includes(payment.status);
      if (captured) {
        const pending = await pendingRefunds(tx, order.id);
        const leftOfStoreOrder =
          storeOrder.current.totalCents -
          (payment.refundedByStoreOrder[storeOrder.id] ?? 0) -
          (pending.issueRefundsByStoreOrder.get(storeOrder.id) ?? 0);
        const leftOfCapture = payment.capturedCents - payment.refundedCents - pending.total;
        refundCents = Math.max(0, Math.min(refund.totalCents, leftOfStoreOrder, leftOfCapture));
      } else {
        refundCents = refund.totalCents;
      }
      refundItemsCents = refund.itemsCents;
      if (!actor.isAdmin && refundCents > DISPATCHER_REFUND_LIMIT_CENTS) {
        failCode(
          'REFUND_LIMIT',
          `Dispatchers can refund up to ${formatMoney(DISPATCHER_REFUND_LIMIT_CENTS)} per case. Ask an admin.`,
          { limitCents: DISPATCHER_REFUND_LIMIT_CENTS, refundCents },
        );
      }

      const clawbacks: Clawback[] = [];
      if (captured) {
        if (refundCents > 0) {
          const idempotencyKey = `refund_${issue.id}`;
          await enqueue(
            tx,
            'payment.refund',
            {
              orderId: order.id,
              storeOrderId: storeOrder.id,
              amountCents: refundCents,
              reason: `${issue.number}: ${note || 'refund'}`.slice(0, 200),
              idempotencyKey,
              issueId: issue.id,
            },
            { dedupeKey: `payment.refund:${idempotencyKey}` },
          );
        }
        if (storeAtFault && refund.itemsCents > 0) {
          clawbacks.push({
            payeeType: 'store',
            payeeId: storeOrder.storeId,
            amountCents: -(refund.itemsCents - percentBps(refund.itemsCents, current.commissionBps)),
          });
        }
      } else if (refund.totalCents > 0 || refund.itemsCents > 0) {
        // Before capture the customer is simply not charged; a store at fault is paid less at settlement.
        await saveStoreOrderDoc(tx, {
          ...storeOrder,
          current: subtractAmounts(storeOrder.current, refund),
          storeValueCents: storeAtFault
            ? Math.max(0, storeOrder.storeValueCents - refund.itemsCents)
            : storeOrder.storeValueCents,
        });
        await projectOrderAggregate(tx, graph, order.id);
      }
      if (req.faultParty === 'driver' && issue.driverId !== null && refund.itemsCents > 0) {
        clawbacks.push({ payeeType: 'driver', payeeId: issue.driverId, amountCents: -refund.itemsCents });
      }
      await writeClawbacks(tx, issue, clawbacks);
    } else if (req.kind === 'replacement') {
      const role: ActorRole = actor.role ?? 'dispatcher';
      const staged = await stageMarketplaceOrder(tx, {
        orderId: replacementOrderId,
        customerId: issue.customerId,
        source: 'replacement',
        issueId: issue.id,
        fulfilment: storeOrder.fulfilment,
        jobsiteId: storeOrder.fulfilment === 'delivery' ? (storeOrder.jobsite?.jobsiteId ?? null) : null,
        windowId: null,
        receiving: storeOrder.fulfilment === 'delivery' ? storeOrder.receiving : null,
        siteContact: storeOrder.siteContact,
        instructions: storeOrder.instructions,
        unloadHelpStoreIds: [],
        promoCode: null,
        lines: replacementLines(storeOrder, lines, prices),
        expectedTotalCents: null,
        payment: { kind: 'none' },
        hstNumber: deps.config.HST_NUMBER || null,
        placedBy: { uid: actor.uid, name: actor.name, role },
      });
      replacement = staged.orderId;
    }

    await releaseLedgerHolds(tx, issue.id);
    const saved = await saveIssue(tx, {
      ...issue,
      lines: req.kind === 'no_action' && req.lines === undefined ? issue.lines : resolvedLines,
      status: 'resolved',
      statusAt: { ...issue.statusAt, resolved: tx.now },
      assignedTo: issue.assignedTo ?? actor.uid,
      assignedName: issue.assignedTo === null ? actor.name : issue.assignedName,
      resolution: {
        kind: req.kind,
        refundCents,
        refundItemsCents,
        refundDeliveryFee: req.kind === 'refund' && req.refundDeliveryFee === true,
        returnRequired: req.returnRequired === true,
        faultParty: req.faultParty,
        replacementOrderId: replacement,
        note,
        resolvedBy: actor.uid,
        resolvedByName: actor.name,
        resolvedAt: tx.now,
      },
    });

    const outcome =
      req.kind === 'refund'
        ? `${formatMoney(refundCents)} refunded`
        : req.kind === 'replacement'
          ? 'a replacement is on its way'
          : 'no further action';
    await notify(tx, saved.customerId, {
      type: 'issue_update',
      title: `${saved.number} resolved`,
      body: `${saved.number} resolved: ${outcome}`,
      data: { issueId: saved.id, customerOrderId: replacement ?? saved.orderId },
      key: `issue-resolved-${saved.id}`,
    });
    if (storeAtFault) {
      await notifyStoreMembers(tx, saved.storeId, {
        type: 'store_issue',
        title: `${saved.number} resolved`,
        body: `${saved.number} on ${saved.storeOrderNumber} was resolved with the store at fault: ${outcome}.`,
        data: { issueId: saved.id, storeOrderId: saved.storeOrderId },
        key: `issue-store-resolved-${saved.id}`,
      });
    }
    return { refundCents, replacementOrderId: replacement };
  });
}
