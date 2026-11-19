/**
 * Problem reports on a completed store order (§1.3, §2.6): damaged, wrong, missing or short items, or
 * a late delivery. Staff resolve each one with a refund, a replacement order or no action.
 */
import type { StoreOrder } from './marketplace';
import { transitionTargets, type MachineActor, type TransitionRule } from './status';
import type { TimestampLike } from './types';

export type IssueType = 'damaged' | 'wrong_item' | 'missing_item' | 'short_quantity' | 'late' | 'other';
export type IssueStatus = 'open' | 'in_review' | 'resolved';

/** Who pays for the fix: a store or driver at fault gets a clawback, the platform or the customer none. */
export type FaultParty = 'store' | 'driver' | 'platform' | 'customer';

/** `issues/{issueId}`: the id comes from the client, so a retry never opens a second case (D17). */
export interface Issue {
  id: string;
  /** `CASE-10001`. */
  number: string;
  customerId: string;
  customerName: string;
  orderId: string;
  orderNumber: string;
  storeOrderId: string;
  storeOrderNumber: string;
  storeId: string;
  storeName: string;
  deliveryId: string | null;
  driverId: string | null;
  type: IssueType;
  /** The affected lines of the store order, with the affected quantity. */
  lines: { lineId: string; name: string; quantity: number; unitPriceCents: number }[];
  description: string;
  /** Under `issuePhotos/{issueId}/`. */
  photoPaths: string[];
  preferredResolution: 'replacement' | 'refund' | 'return';
  status: IssueStatus;
  statusAt: Partial<Record<IssueStatus, TimestampLike>>;
  /** Staff aim to resolve the case by then. */
  slaDueAt: TimestampLike;
  assignedTo: string | null;
  assignedName: string | null;
  resolution: {
    kind: 'refund' | 'replacement' | 'no_action';
    refundCents: number;
    refundItemsCents: number;
    refundDeliveryFee: boolean;
    returnRequired: boolean;
    faultParty: FaultParty | null;
    replacementOrderId: string | null;
    note: string;
    resolvedBy: string;
    resolvedByName: string;
    resolvedAt: TimestampLike;
  } | null;
  /** When the store order was completed: the report window counts from here. */
  completedAt: TimestampLike;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

/** A customer can report a problem for this long after the store order was completed (§2.6). */
export const ISSUE_WINDOW_HOURS = 48;

// ---------- the issue machine (§2.6) ----------

/** One row of §2.6: open → in_review when staff pick it up, open or in_review → resolved by `resolveIssue`. */
export type IssueTransition = TransitionRule<IssueStatus>;

/** The §2.6 machine as rows. Only `reportIssue` creates an issue, and nothing reopens a resolved one. */
export const ISSUE_TRANSITIONS: readonly IssueTransition[] = [
  // Staff pick the case up when they assign it: a client write the rules allow, not a callable.
  { from: ['open'], to: 'in_review', actors: ['staff'], entryPoints: ['direct_write'] },
  // Refund, replacement or no action. A case nobody picked up can be resolved directly.
  { from: ['open', 'in_review'], to: 'resolved', actors: ['staff'], entryPoints: ['resolveIssue'] },
];

/** Whether an actor may move an issue from `from` to `to` (§2.6). Only staff move issues. */
export function canIssueTransition(from: IssueStatus, to: IssueStatus, actor: MachineActor): boolean {
  return transitionTargets(ISSUE_TRANSITIONS, from, actor).includes(to);
}

const ISSUE_WINDOW_MS = ISSUE_WINDOW_HOURS * 60 * 60 * 1000;

/**
 * Whether a problem can still be reported for a store order: it was delivered or picked up, and no more
 * than `ISSUE_WINDOW_HOURS` have passed since `completedAt` (`ISSUE_WINDOW_CLOSED`). The rule of one
 * open issue per store order needs the issues themselves, so `reportIssue` checks it.
 */
export function canReportIssue(storeOrder: Pick<StoreOrder, 'status' | 'completedAt'>, now: number): boolean {
  // A rejected or cancelled store order was never supplied or charged: there is nothing to report.
  const completed = storeOrder.status === 'delivered' || storeOrder.status === 'picked_up';
  return completed && storeOrder.completedAt != null && now - storeOrder.completedAt <= ISSUE_WINDOW_MS;
}
