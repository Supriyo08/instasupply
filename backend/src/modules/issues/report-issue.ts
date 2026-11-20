/**
 * reportIssue (docs/PLATFORM.md §9.2.11; MARKETPLACE §2.6, §5.5.7): a customer reports a problem with a delivered
 * or picked-up store order within 48 hours of `completedAt`, one open issue per store order. The issue id comes
 * from the client, so a retry answers the same case (D17). Photos are checked against their `files` rows first.
 * Locks: users(customer) → (issue insert) → orders → store_orders → ledger_entries.
 */
import {
  canReportIssue,
  pluralize,
  validateIssueReport,
  type Issue,
  type ReportIssueRequest,
  type ReportIssueResponse,
  type StoreOrder,
} from '@instasupply/shared';
import type { Deps } from '../../container';
import type { Actor } from '../../platform/auth/actor';
import { lockRows } from '../../platform/db/locks';
import { nextNumber } from '../../platform/db/sequences';
import { withTransaction } from '../../platform/db/tx';
import { ApiError, failCode, invalidArgument, notFound, permissionDenied } from '../../platform/http/errors';
import { requireReadyFile } from '../../platform/storage/files.service';
import { notifyStaff, notifyStoreMembers } from '../notifications';
import {
  deliveryDriverId,
  findIssue,
  holdStoreLedger,
  insertIssue,
  openIssueOf,
  readStoreOrder,
  resolvedRefundsOf,
  saveStoreOrderDoc,
} from './repository';

export const ISSUE_SLA_MS = 4 * 3_600_000;

const TYPE_TEXT: Record<Issue['type'], string> = {
  damaged: 'Damaged items',
  wrong_item: 'Wrong item',
  missing_item: 'Missing items',
  short_quantity: 'Short quantity',
  late: 'Late delivery',
  other: 'Problem',
};

function answerOf(issue: Issue, uid: string): ReportIssueResponse {
  if (issue.customerId !== uid) throw new ApiError('already-exists', 'That issue id is already in use.');
  return { issueId: issue.id, number: issue.number };
}

/** The checks that need the store order: window, one open issue, lines; run before and under the lock. */
async function checkReport(
  db: Parameters<typeof openIssueOf>[0],
  storeOrder: StoreOrder,
  req: ReportIssueRequest,
  now: number,
) {
  if (!canReportIssue(storeOrder, now)) {
    failCode('ISSUE_WINDOW_CLOSED', 'Problems can be reported up to 48 hours after delivery or pickup.');
  }
  if (await openIssueOf(db, storeOrder.id)) {
    failCode('ISSUE_ALREADY_OPEN', 'There is already an open case for this order. We are on it.');
  }
  const refunded = (await resolvedRefundsOf(db, storeOrder.id)).flatMap((refund) => refund.lines);
  const { issueId: _i, storeOrderId: _s, ...form } = req;
  const checked = validateIssueReport(form, storeOrder, req.issueId, refunded);
  if (!checked.ok) {
    const fields = Object.fromEntries(
      Object.entries(checked.errors).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    invalidArgument(Object.values(fields)[0] ?? 'Check the report and try again.', { fields });
  }
  return checked.value;
}

export async function reportIssue(
  deps: Deps,
  actor: Actor,
  req: ReportIssueRequest,
): Promise<ReportIssueResponse> {
  const existing = await findIssue(deps.pool, req.issueId);
  if (existing) return answerOf(existing, actor.uid);

  const found = await readStoreOrder(deps.pool, req.storeOrderId);
  if (!found) notFound('That order does not exist.');
  if (found.storeOrder.customerId !== actor.uid) permissionDenied();
  const form = await checkReport(deps.pool, found.storeOrder, req, deps.clock.now());
  for (const path of form.photoPaths) {
    await requireReadyFile(deps.pool, path, {
      purpose: 'issue_photo',
      scopeId: req.issueId,
      uploadedBy: actor.uid,
    });
  }
  const driverId = found.storeOrder.deliveryId
    ? await deliveryDriverId(deps.pool, found.storeOrder.deliveryId)
    : null;

  const issue = await withTransaction(deps, async (tx) => {
    const so0 = found.storeOrder;
    await lockRows(tx, 'users', [actor.uid]);
    await lockRows(tx, 'orders', [so0.orderId]);
    await lockRows(tx, 'store_orders', [so0.id]);
    const again = await findIssue(tx, req.issueId);
    if (again) return again;
    const current = await readStoreOrder(tx, so0.id);
    if (!current) notFound('That order does not exist.');
    const storeOrder = current.storeOrder;
    const checked = await checkReport(tx, storeOrder, req, tx.now);

    const now = tx.now;
    const number = `CASE-${await nextNumber(tx, 'issue')}`;
    const draft: Issue = {
      id: req.issueId,
      number,
      customerId: storeOrder.customerId,
      customerName: storeOrder.customerName,
      orderId: storeOrder.orderId,
      orderNumber: storeOrder.orderNumber,
      storeOrderId: storeOrder.id,
      storeOrderNumber: storeOrder.number,
      storeId: storeOrder.storeId,
      storeName: storeOrder.storeName,
      deliveryId: storeOrder.deliveryId,
      driverId,
      type: checked.type,
      lines: checked.lines.map((line) => {
        const source = storeOrder.lines.find((candidate) => candidate.lineId === line.lineId)!;
        return {
          lineId: line.lineId,
          name: source.name,
          quantity: line.quantity,
          unitPriceCents: source.unitPriceCents,
        };
      }),
      description: checked.description,
      photoPaths: checked.photoPaths,
      preferredResolution: checked.preferredResolution,
      status: 'open',
      statusAt: { open: now },
      slaDueAt: now + ISSUE_SLA_MS,
      assignedTo: null,
      assignedName: null,
      resolution: null,
      completedAt: storeOrder.completedAt ?? now,
      createdAt: now,
      updatedAt: now,
    };
    if (!(await insertIssue(tx, draft))) {
      const raced = await findIssue(tx, req.issueId);
      if (raced) return raced;
      failCode('ISSUE_ALREADY_OPEN', 'There is already an open case for this order. We are on it.');
    }
    await saveStoreOrderDoc(tx, { ...storeOrder, issueCount: storeOrder.issueCount + 1 });
    await holdStoreLedger(tx, draft.id, storeOrder.id);

    const what = TYPE_TEXT[draft.type];
    const items = draft.lines.reduce((sum, line) => sum + line.quantity, 0);
    const detail = items > 0 ? ` · ${pluralize(items, 'item')}` : '';
    await notifyStaff(tx, {
      type: 'issue_new',
      title: `New case ${number}`,
      body: `${what} on ${storeOrder.number} (${storeOrder.storeName})${detail} · ${draft.customerName}`,
      data: { issueId: draft.id, storeOrderId: storeOrder.id, customerOrderId: storeOrder.orderId },
      key: `issue-new-${draft.id}`,
    });
    await notifyStoreMembers(tx, storeOrder.storeId, {
      type: 'store_issue',
      title: `${what} reported on ${storeOrder.number}`,
      body: `The customer reported: ${what.toLowerCase()}${detail}. InstaSupply support will follow up.`,
      data: { issueId: draft.id, storeOrderId: storeOrder.id },
      key: `issue-store-${draft.id}`,
    });
    return draft;
  });
  return answerOf(issue, actor.uid);
}
