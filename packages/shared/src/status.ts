/**
 * The delivery state machine (§2.3) and the words every other machine shares: actors, transition rows
 * and badge tones. A delivery is one trip from a store to a jobsite, or a manual delivery created by
 * dispatch. Callables enforce these tables; triggers never move a document (D7).
 *
 * The store-order, order, quote and issue machines live in `marketplace.ts`, `quotes.ts` and
 * `issues.ts`.
 */
import type { ScheduledJobName } from './api';
import type { CallableName } from './constants';
import type { DriverPhase } from './marketplace';
import type { Delivery, DeliveryStatus, TrackingPhase } from './types';

export type StatusTone = 'neutral' | 'info' | 'brand' | 'warning' | 'success' | 'danger';

/**
 * Who moves a delivery. `system` covers the moves made on a delivery by another callable's transaction
 * (a driver claiming a job, a store confirming the pickup, a store order being cancelled) and by
 * schedules; the audit event still names the person who caused it (§2.3).
 */
export type TransitionActor = 'driver' | 'staff' | 'system';

/**
 * Who moves a store order, a quote or an issue (§2): `supplier` is a member of the store, `staff` an
 * admin or dispatcher, `system` a schedule or a cascade.
 */
export type MachineActor = 'customer' | 'supplier' | 'driver' | 'staff' | 'system';

/** Where a transition is made: a callable, a scheduled job, or a client write the rules allow. */
export type EntryPoint = CallableName | ScheduledJobName | 'direct_write';

/** One row of a transition table in §2: these actors may move a document from any of `from` to `to`. */
export interface TransitionRule<Status extends string> {
  from: readonly Status[];
  to: Status;
  actors: readonly MachineActor[];
  entryPoints: readonly EntryPoint[];
}

/**
 * Reads a transition table of §2: the statuses `actor` may move a document to from `from`, in table
 * order, each one once. The store-order, quote and issue helpers all answer through this function, so
 * a rule is written in exactly one place: its row.
 */
export function transitionTargets<Status extends string>(
  rules: readonly TransitionRule<Status>[],
  from: Status,
  actor: MachineActor,
): Status[] {
  const targets: Status[] = [];
  for (const rule of rules) {
    if (rule.from.includes(from) && rule.actors.includes(actor) && !targets.includes(rule.to)) {
      targets.push(rule.to);
    }
  }
  return targets;
}

/** What `canTransition` needs to know about the delivery besides its status. */
export interface TransitionContext {
  /**
   * The load is still at the store: `requiresPickup(delivery)`. Until the store confirms the pickup
   * with the driver's PIN, nobody can move the delivery past `accepted`; the driver can only release it.
   */
  requiresPickup?: boolean;
}

export const DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  'unassigned',
  'assigned',
  'accepted',
  'picked_up',
  'in_transit',
  'arrived',
  'delivered',
  'failed',
  'cancelled',
];

/** Statuses where a driver owns the delivery and still has work to do. */
export const ACTIVE_STATUSES: readonly DeliveryStatus[] = [
  'assigned',
  'accepted',
  'picked_up',
  'in_transit',
  'arrived',
];

/** Everything that still needs attention (including unassigned work). */
export const OPEN_STATUSES: readonly DeliveryStatus[] = ['unassigned', ...ACTIVE_STATUSES];

export const TERMINAL_STATUSES: readonly DeliveryStatus[] = ['delivered', 'failed', 'cancelled'];

/** Statuses where the customer can watch the driver approach. */
export const LIVE_TRACKING_STATUSES: readonly DeliveryStatus[] = ['in_transit', 'arrived'];

export const STATUS_META: Record<
  DeliveryStatus,
  { label: string; description: string; tone: StatusTone; customerLabel: string }
> = {
  unassigned: {
    label: 'Unassigned',
    description: 'Waiting for a driver',
    tone: 'warning',
    customerLabel: 'Order received',
  },
  assigned: {
    label: 'Assigned',
    description: 'Waiting for the driver to accept',
    tone: 'info',
    customerLabel: 'Driver assigned',
  },
  accepted: {
    label: 'Accepted',
    description: 'Driver accepted the delivery',
    tone: 'info',
    customerLabel: 'Driver assigned',
  },
  picked_up: {
    label: 'Picked up',
    description: 'Package is with the driver',
    tone: 'brand',
    customerLabel: 'Package picked up',
  },
  in_transit: {
    label: 'On the way',
    description: 'Driver is heading to the customer',
    tone: 'brand',
    customerLabel: 'On the way',
  },
  arrived: {
    label: 'Arrived',
    description: 'Driver is at the drop-off location',
    tone: 'brand',
    customerLabel: 'Driver has arrived',
  },
  delivered: {
    label: 'Delivered',
    description: 'Delivered to the customer',
    tone: 'success',
    customerLabel: 'Delivered',
  },
  failed: {
    label: 'Failed',
    description: 'Delivery attempt failed',
    tone: 'danger',
    customerLabel: 'Delivery attempt failed',
  },
  cancelled: {
    label: 'Cancelled',
    description: 'Cancelled by dispatch',
    tone: 'neutral',
    customerLabel: 'Cancelled',
  },
};

/** Steps shown in progress trackers (driver app, tracking page). */
export const PROGRESS_STEPS: readonly DeliveryStatus[] = [
  'assigned',
  'picked_up',
  'in_transit',
  'arrived',
  'delivered',
];

type DeliveryTransitions = Partial<Record<DeliveryStatus, readonly DeliveryStatus[]>>;

const DRIVER_TRANSITIONS: DeliveryTransitions = {
  // "unassigned" from "assigned" means the driver declined the job.
  assigned: ['accepted', 'unassigned'],
  // "unassigned" from "accepted" is a release: the driver gives the job back, with a reason from
  // DECLINE_REASONS. A marketplace job then returns to the job board (§2.4) and pays nothing (§3.10).
  accepted: ['picked_up', 'in_transit', 'failed', 'unassigned'],
  picked_up: ['in_transit', 'failed'],
  // "picked_up" from "in_transit" parks the trip when the driver switches to another stop.
  in_transit: ['arrived', 'delivered', 'failed', 'picked_up'],
  arrived: ['delivered', 'failed', 'in_transit'],
};

const STAFF_TRANSITIONS: DeliveryTransitions = {
  unassigned: ['assigned', 'cancelled'],
  assigned: ['unassigned', 'assigned', 'delivered', 'failed', 'cancelled'],
  accepted: ['unassigned', 'assigned', 'delivered', 'failed', 'cancelled'],
  picked_up: ['unassigned', 'assigned', 'delivered', 'failed', 'cancelled'],
  in_transit: ['unassigned', 'assigned', 'delivered', 'failed', 'cancelled'],
  arrived: ['unassigned', 'assigned', 'delivered', 'failed', 'cancelled'],
  // "picked_up" from "failed" is a re-attempt: the goods are still on the truck (§2.3).
  failed: ['unassigned', 'assigned', 'cancelled', 'picked_up'],
};

// The moves another callable's transaction makes on a delivery (§2.3, D7): a driver claims the job from
// the board (`claimJob`), the store confirms the collection with the driver's PIN (`completePickup`),
// or the store order is rejected or cancelled and takes its delivery with it. "Any open status" may be
// cancelled this way; in practice it happens before collection, because the store-order table has no
// cancellation once the load is out for delivery.
const SYSTEM_TRANSITIONS: DeliveryTransitions = {
  unassigned: ['accepted', 'cancelled'],
  assigned: ['cancelled'],
  accepted: ['picked_up', 'cancelled'],
  picked_up: ['cancelled'],
  in_transit: ['cancelled'],
  arrived: ['cancelled'],
};

const DELIVERY_TRANSITIONS: Record<TransitionActor, DeliveryTransitions> = {
  driver: DRIVER_TRANSITIONS,
  staff: STAFF_TRANSITIONS,
  system: SYSTEM_TRANSITIONS,
};

/**
 * Statuses that say the load has left the store. While a delivery still requires its pickup, a driver
 * or staff cannot move it to any of them: custody starts at the counter, when the store types the
 * driver's PIN (D8), and that move is the `system` actor's (`completePickup`). What is left for the
 * driver from `accepted` is the release, and for staff unassigning, reassigning and cancelling.
 */
const BLOCKED_UNTIL_COLLECTED: readonly DeliveryStatus[] = [
  'picked_up',
  'in_transit',
  'arrived',
  'delivered',
  'failed',
];

/**
 * The statuses an actor may move a delivery to (§2.3). Marketplace rules that depend on more than the
 * status and `requiresPickup` stay in the callables: on a marketplace delivery staff use
 * `completePickup`, the store-order actions and `resolveFailedDelivery` instead of setting
 * `picked_up`, `cancelled` or leaving `failed` here, and cannot unassign after collection.
 */
export function allowedTransitions(
  from: DeliveryStatus,
  actor: TransitionActor,
  ctx: TransitionContext = {},
): readonly DeliveryStatus[] {
  const targets = DELIVERY_TRANSITIONS[actor][from] ?? [];
  if (!ctx.requiresPickup || actor === 'system') return targets;
  return targets.filter((to) => !BLOCKED_UNTIL_COLLECTED.includes(to));
}

export function canTransition(
  from: DeliveryStatus,
  to: DeliveryStatus,
  actor: TransitionActor,
  ctx?: TransitionContext,
): boolean {
  return allowedTransitions(from, actor, ctx).includes(to);
}

export function isActiveStatus(status: DeliveryStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export function isOpenStatus(status: DeliveryStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

export function isTerminalStatus(status: DeliveryStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function statusLabel(status: DeliveryStatus): string {
  return STATUS_META[status]?.label ?? status;
}

interface DriverActionBase {
  label: string;
  /** Shown greyed out: there is nothing for the driver to do yet. */
  disabled: boolean;
}

/**
 * The one button a driver sees for a delivery (§2.3).
 * - `status`: a plain status change to `to`, or the proof-of-delivery flow when `requiresProof`.
 * - `check_in`: "I'm at the store" (`checkInAtStore`).
 * - `wait`: "Waiting for the store", disabled until the store marks the order ready.
 * - `show_pin`: "Show pickup PIN"; the store types it in, and that moves the delivery.
 */
export type DriverAction =
  | (DriverActionBase & { kind: 'status'; to: DeliveryStatus; requiresProof: boolean })
  | (DriverActionBase & { kind: 'check_in' | 'wait' | 'show_pin'; to: null; requiresProof: false });

/**
 * True while a delivery's load is still at the store: it has a pickup block and the store has not
 * confirmed the collection (`pickup.collectedAt` is null). Manual deliveries have no pickup block.
 */
export function requiresPickup(delivery: Pick<Delivery, 'pickup'>): boolean {
  return delivery.pickup != null && delivery.pickup.collectedAt == null;
}

function statusAction(label: string, to: DeliveryStatus, requiresProof = false): DriverAction {
  return { kind: 'status', label, to, requiresProof, disabled: false };
}

function storeAction(kind: 'check_in' | 'wait' | 'show_pin', label: string): DriverAction {
  // Waiting is the only step with nothing to press: the store has to finish packing first.
  return { kind, label, to: null, requiresProof: false, disabled: kind === 'wait' };
}

/**
 * The single primary action a driver sees (§2.3): assigned "Accept job"; accepted with a pickup and
 * not yet at the store "I'm at the store" (`check_in`); at the store, order not ready "Waiting for the
 * store" (`wait`, disabled); at the store and ready "Show pickup PIN" (`show_pin`); accepted on a
 * manual delivery "Mark as picked up"; picked_up "Start trip to site"; in_transit "I've arrived";
 * arrived "Complete delivery" (proof). Null when there is nothing to do.
 */
export function primaryDriverAction(delivery: Pick<Delivery, 'status' | 'pickup'>): DriverAction | null {
  switch (delivery.status) {
    case 'assigned':
      return statusAction('Accept job', 'accepted');
    case 'accepted': {
      const pickup = delivery.pickup;
      // No store counter to go through (a manual delivery): the driver says when the load is on board.
      if (pickup == null) return statusAction('Mark as picked up', 'picked_up');
      // On a marketplace delivery the driver never sets `picked_up`: the store does, by typing the
      // driver's PIN (D8). So the driver checks in, waits until the order is packed, then shows the PIN.
      if (pickup.arrivedAt == null) return storeAction('check_in', "I'm at the store");
      return pickup.ready
        ? storeAction('show_pin', 'Show pickup PIN')
        : storeAction('wait', 'Waiting for the store');
    }
    case 'picked_up':
      return statusAction('Start trip to site', 'in_transit');
    case 'in_transit':
      return statusAction("I've arrived", 'arrived');
    case 'arrived':
      // Completing needs proof (drop-off photo, hand-off code), so the app opens that flow instead.
      return statusAction('Complete delivery', 'delivered', true);
    case 'unassigned':
    case 'delivered':
    case 'failed':
    case 'cancelled':
      return null;
  }
}

// Marketplace wording for the leg to the store and the trip to the jobsite (§2.3). Statuses that are
// not listed, and every manual delivery, keep the label in STATUS_META.
const MARKETPLACE_CUSTOMER_LABELS: Partial<Record<DeliveryStatus, string>> = {
  accepted: 'Driver heading to the store',
  picked_up: 'Loaded at the store',
  in_transit: 'On the way to your site',
  arrived: 'Driver at your site',
};

/**
 * What the customer reads for a delivery status (§2.3). Marketplace: accepted "Driver heading to the
 * store", picked_up "Loaded at the store", in_transit "On the way to your site", arrived "Driver at
 * your site"; every other case, and every manual delivery, keeps `STATUS_META[status].customerLabel`.
 */
export function customerLabelFor(status: DeliveryStatus, kind: Delivery['kind']): string {
  const marketplaceLabel = kind === 'marketplace' ? MARKETPLACE_CUSTOMER_LABELS[status] : undefined;
  return marketplaceLabel ?? STATUS_META[status]?.customerLabel ?? status;
}

/**
 * Where the driver is, as the supplier's board shows it (§2.3 "Phase mapping"): assigned → `assigned`;
 * accepted → `to_store`, or `at_store` once `pickup.arrivedAt` is set; picked_up → `loaded`;
 * in_transit → `to_site`; arrived → `at_site`; delivered → `delivered`; failed → `problem`. Null for
 * unassigned and cancelled: the store order then shows no driver.
 */
export function driverPhaseFor(delivery: Pick<Delivery, 'status' | 'pickup'>): DriverPhase | null {
  switch (delivery.status) {
    case 'unassigned':
    case 'cancelled':
      return null;
    case 'assigned':
      return 'assigned';
    case 'accepted':
      // There is no "at store" status: the check-in time is what says the driver is at the counter (D8).
      return delivery.pickup?.arrivedAt != null ? 'at_store' : 'to_store';
    case 'picked_up':
      return 'loaded';
    case 'in_transit':
      return 'to_site';
    case 'arrived':
      return 'at_site';
    case 'delivered':
      return 'delivered';
    case 'failed':
      return 'problem';
  }
}

/**
 * The phase the public tracking page shows: the same mapping as `driverPhaseFor`, with unassigned →
 * `finding_driver`, assigned → `driver_assigned` and cancelled → `cancelled`. An accepted manual
 * delivery has no store leg and stays `driver_assigned`.
 */
export function trackingPhaseFor(delivery: Pick<Delivery, 'status' | 'pickup'>): TrackingPhase {
  switch (delivery.status) {
    case 'unassigned':
      return 'finding_driver';
    case 'assigned':
      return 'driver_assigned';
    case 'accepted':
      if (delivery.pickup == null) return 'driver_assigned';
      return delivery.pickup.arrivedAt != null ? 'at_store' : 'to_store';
    case 'picked_up':
      return 'loaded';
    case 'in_transit':
      return 'to_site';
    case 'arrived':
      return 'at_site';
    case 'delivered':
      return 'delivered';
    case 'failed':
      return 'problem';
    case 'cancelled':
      return 'cancelled';
  }
}

/** Timestamp field stamped on the delivery when it enters a status. */
export const STATUS_TIMESTAMP_FIELD: Partial<Record<DeliveryStatus, string>> = {
  assigned: 'assignedAt',
  accepted: 'acceptedAt',
  picked_up: 'pickedUpAt',
  in_transit: 'startedAt',
  arrived: 'arrivedAt',
  delivered: 'deliveredAt',
  failed: 'failedAt',
  cancelled: 'cancelledAt',
};

/** Index of a status within PROGRESS_STEPS (accepted counts as assigned). */
export function progressIndex(status: DeliveryStatus): number {
  const normalized = status === 'accepted' ? 'assigned' : status;
  return PROGRESS_STEPS.indexOf(normalized);
}
