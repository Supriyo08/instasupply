/**
 * State machines (§2): the delivery machine with its §2.3 changes, the store-order table (§2.1), the
 * derived order status and headline (§2.2), and the quote and issue tables (§2.5, §2.6).
 *
 * Every table is checked cell by cell against a copy written out here from the spec, so a wrong cell
 * fails by name ("staff, pickup: ready → out_for_delivery should be refused").
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DELIVERY_STATUSES,
  FINAL_STORE_ORDER_STATUSES,
  ISSUE_TRANSITIONS,
  ISSUE_WINDOW_HOURS,
  ORDER_OPEN_STATUSES,
  ORDER_STATUS_BY_STORE_ORDER,
  ORDER_STATUS_META,
  ORDER_STATUSES,
  QUOTE_STATUSES,
  QUOTE_TRANSITIONS,
  STATUS_META,
  STORE_ORDER_META,
  STORE_ORDER_STATUSES,
  STORE_ORDER_TRANSITIONS,
  allowedQuoteTransitions,
  allowedStoreOrderTransitions,
  allowedTransitions,
  canIssueTransition,
  canQuoteTransition,
  canReportIssue,
  canStoreOrderTransition,
  canTransition,
  customerLabelFor,
  driverPhaseFor,
  isFinalQuoteStatus,
  isFinalStoreOrderStatus,
  isOrderOpen,
  isOrderSettled,
  isQuoteOfferExpired,
  orderHeadline,
  orderNeedsAttention,
  orderStatusFromStoreOrders,
  primaryDriverAction,
  requiresPickup,
  storeOrderCustomerLabel,
  supportThreadId,
  trackingPhaseFor,
  transitionTargets,
  type Delivery,
  type DeliveryStatus,
  type DriverPhase,
  type Fulfilment,
  type IssueStatus,
  type MachineActor,
  type Order,
  type OrderStatus,
  type QuoteStatus,
  type StoreOrderColumn,
  type StoreOrderStatus,
  type StoreOrderSummary,
  type SupportThreadKind,
  type TrackingPhase,
  type TransitionActor,
  type TransitionRule,
} from '../src';

// ---------- helpers ----------

/** The members of a union, in the order written. The compiler refuses the object when one is missing. */
const membersOf = <Member extends string>(all: Record<Member, true>) => Object.keys(all) as Member[];

const ACTORS = membersOf<MachineActor>({
  customer: true,
  supplier: true,
  driver: true,
  staff: true,
  system: true,
});
const DELIVERY_ACTORS = membersOf<TransitionActor>({ driver: true, staff: true, system: true });
const FULFILMENTS = membersOf<Fulfilment>({ delivery: true, pickup: true });

const DELIVERY = membersOf<DeliveryStatus>({
  unassigned: true,
  assigned: true,
  accepted: true,
  picked_up: true,
  in_transit: true,
  arrived: true,
  delivered: true,
  failed: true,
  cancelled: true,
});
const STORE_ORDER = membersOf<StoreOrderStatus>({
  new: true,
  accepted: true,
  preparing: true,
  ready: true,
  out_for_delivery: true,
  delivered: true,
  picked_up: true,
  failed: true,
  rejected: true,
  cancelled: true,
});
const ORDER = membersOf<OrderStatus>({
  placed: true,
  confirmed: true,
  preparing: true,
  ready: true,
  on_the_way: true,
  completed: true,
  cancelled: true,
});
const QUOTE = membersOf<QuoteStatus>({
  submitted: true,
  in_review: true,
  quoted: true,
  accepted: true,
  declined: true,
  expired: true,
  cancelled: true,
});
const ISSUE = membersOf<IssueStatus>({ open: true, in_review: true, resolved: true });

/** An expected table: for each status, the statuses it may move to. A status left out has no moves. */
type Moves<Status extends string> = Partial<Record<Status, readonly Status[]>>;

/** Checks every (from, to) cell against the expected table and returns the wrong cells by name. */
function wrongCells<Status extends string>(
  name: string,
  cells: { from: readonly Status[]; to: readonly Status[] },
  expected: Moves<Status>,
  can: (from: Status, to: Status) => boolean,
): string[] {
  const wrong: string[] = [];
  for (const from of cells.from) {
    for (const to of cells.to) {
      const allowed = (expected[from] ?? []).includes(to);
      if (can(from, to) !== allowed) {
        wrong.push(`${name}: ${from} → ${to} should be ${allowed ? 'allowed' : 'refused'}`);
      }
    }
  }
  return wrong;
}

/** A row as the tables of §2 print it: "new, accepted → cancelled | customer | cancelOrder". */
function printRow<Status extends string>(row: TransitionRule<Status> & { fulfilment?: Fulfilment }): string {
  const cells = [`${row.from.join(', ')} → ${row.to}`, row.actors.join(', '), row.entryPoints.join(', ')];
  if (row.fulfilment) cells.push(`${row.fulfilment} only`);
  return cells.join(' | ');
}

/** Every status that can be reached from `start` by following the moves of any actor. */
function reachable<Status extends string>(start: Status, movesFrom: (from: Status) => Status[]): Status[] {
  const seen = [start];
  for (let index = 0; index < seen.length; index += 1) {
    const from = seen[index];
    if (from === undefined) break;
    for (const to of movesFrom(from)) if (!seen.includes(to)) seen.push(to);
  }
  return seen;
}

/** Freezes a fixture all the way down: a function that changes its input then throws. */
function frozen<Value>(value: Value): Value {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}

/** Thu 2026-11-19 12:25 in Toronto (17:25 UTC): the moment of the spec's worked examples. */
const NOON = Date.UTC(2026, 10, 19, 17, 25);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// ---------- reading a table ----------

describe('transitionTargets', () => {
  type Light = 'red' | 'amber' | 'green';
  const rules: readonly TransitionRule<Light>[] = [
    { from: ['red'], to: 'green', actors: ['system'], entryPoints: ['direct_write'] },
    { from: ['red', 'green'], to: 'amber', actors: ['system', 'staff'], entryPoints: ['direct_write'] },
    { from: ['red'], to: 'green', actors: ['system', 'staff'], entryPoints: ['direct_write'] },
  ];
  frozen(rules);

  it('lists the targets in table order, each one once', () => {
    assert.deepEqual(transitionTargets(rules, 'red', 'system'), ['green', 'amber']);
    assert.deepEqual(transitionTargets(rules, 'red', 'staff'), ['amber', 'green']);
    assert.deepEqual(transitionTargets(rules, 'green', 'staff'), ['amber']);
  });

  it('answers nothing for an actor or a status without a row', () => {
    assert.deepEqual(transitionTargets(rules, 'amber', 'system'), []);
    assert.deepEqual(transitionTargets(rules, 'red', 'customer'), []);
    assert.deepEqual(transitionTargets([], 'red', 'system'), []);
  });
});

// ---------- deliveries (§2.3) ----------

type Pickup = NonNullable<Delivery['pickup']>;

/** The store leg of a marketplace delivery as checkout writes it: not ready, and nobody there yet. */
const PICKUP: Pickup = {
  storeId: 'kestrel-lumber',
  storeName: 'Kestrel Lumber Yard',
  address: 'Kipling Ave & Rexdale Blvd, Etobicoke',
  location: { lat: 43.7169, lng: -79.5696 },
  phone: '+14165550120',
  loadingNotes: null,
  readyBy: NOON + 25 * MINUTE,
  ready: false,
  readyAt: null,
  arrivedAt: null,
  collectedAt: null,
  pickupCode: '4831',
};
const READY_NOT_THERE: Pickup = { ...PICKUP, ready: true, readyAt: NOON + 24 * MINUTE };
const AT_COUNTER: Pickup = { ...PICKUP, arrivedAt: NOON + 20 * MINUTE };
const AT_COUNTER_READY: Pickup = { ...AT_COUNTER, ready: true, readyAt: NOON + 24 * MINUTE };
const COLLECTED: Pickup = { ...AT_COUNTER_READY, collectedAt: NOON + 30 * MINUTE };
const UNCOLLECTED = frozen([PICKUP, READY_NOT_THERE, AT_COUNTER, AT_COUNTER_READY]);
frozen(COLLECTED);

/** A manual delivery, or a marketplace delivery after the store confirmed the collection. */
const DELIVERY_MOVES: Record<TransitionActor, Moves<DeliveryStatus>> = {
  driver: {
    assigned: ['accepted', 'unassigned'],
    accepted: ['picked_up', 'in_transit', 'failed', 'unassigned'],
    picked_up: ['in_transit', 'failed'],
    in_transit: ['arrived', 'delivered', 'failed', 'picked_up'],
    arrived: ['delivered', 'failed', 'in_transit'],
  },
  staff: {
    unassigned: ['assigned', 'cancelled'],
    assigned: ['unassigned', 'assigned', 'delivered', 'failed', 'cancelled'],
    accepted: ['unassigned', 'assigned', 'delivered', 'failed', 'cancelled'],
    picked_up: ['unassigned', 'assigned', 'delivered', 'failed', 'cancelled'],
    in_transit: ['unassigned', 'assigned', 'delivered', 'failed', 'cancelled'],
    arrived: ['unassigned', 'assigned', 'delivered', 'failed', 'cancelled'],
    failed: ['unassigned', 'assigned', 'cancelled', 'picked_up'],
  },
  system: {
    unassigned: ['accepted', 'cancelled'],
    assigned: ['cancelled'],
    accepted: ['picked_up', 'cancelled'],
    picked_up: ['cancelled'],
    in_transit: ['cancelled'],
    arrived: ['cancelled'],
  },
};

/** A marketplace delivery whose load is still at the store can only be in one of these statuses. */
const BEFORE_COLLECTION: readonly DeliveryStatus[] = ['unassigned', 'assigned', 'accepted'];

/** What each actor may do with it: the store's PIN check is the only way past `accepted`. */
const UNCOLLECTED_MOVES: Record<TransitionActor, Moves<DeliveryStatus>> = {
  driver: {
    assigned: ['accepted', 'unassigned'],
    accepted: ['unassigned'],
  },
  staff: {
    unassigned: ['assigned', 'cancelled'],
    assigned: ['unassigned', 'assigned', 'cancelled'],
    accepted: ['unassigned', 'assigned', 'cancelled'],
  },
  system: {
    unassigned: ['accepted', 'cancelled'],
    assigned: ['cancelled'],
    accepted: ['picked_up', 'cancelled'],
  },
};

/** Statuses that say the load has left the store. */
const PAST_THE_COUNTER: readonly DeliveryStatus[] = [
  'picked_up',
  'in_transit',
  'arrived',
  'delivered',
  'failed',
];

/** "Any open status": the delivery still needs a driver or is with one. */
const STILL_OPEN: readonly DeliveryStatus[] = [
  'unassigned',
  'assigned',
  'accepted',
  'picked_up',
  'in_transit',
  'arrived',
];

/** A driver has the job, or had it until it ended. */
const WITH_A_DRIVER: readonly DeliveryStatus[] = [
  'accepted',
  'picked_up',
  'in_transit',
  'arrived',
  'delivered',
  'failed',
];

describe('delivery machine', () => {
  it('lets drivers move forward but not skip to delivered from assigned', () => {
    assert.ok(canTransition('assigned', 'accepted', 'driver'));
    assert.ok(canTransition('in_transit', 'delivered', 'driver'));
    assert.ok(!canTransition('assigned', 'delivered', 'driver'));
    assert.ok(!canTransition('delivered', 'in_transit', 'driver'));
  });

  it('only lets staff cancel', () => {
    assert.ok(canTransition('in_transit', 'cancelled', 'staff'));
    assert.ok(!canTransition('in_transit', 'cancelled', 'driver'));
    assert.ok(!canTransition('delivered', 'cancelled', 'staff'));
  });

  it('exposes one primary action per active status of a manual delivery', () => {
    const accept = primaryDriverAction({ status: 'assigned', pickup: null });
    assert.equal(accept?.kind, 'status');
    assert.equal(accept?.to, 'accepted');
    assert.equal(primaryDriverAction({ status: 'arrived', pickup: null })?.requiresProof, true);
    assert.equal(primaryDriverAction({ status: 'delivered', pickup: null }), null);
  });

  it('keeps its nine statuses', () => {
    assert.deepEqual([...DELIVERY_STATUSES], DELIVERY);
  });

  it('matches the table for every (from, to, actor) of a manual or collected delivery', () => {
    const wrong: string[] = [];
    let cells = 0;
    for (const actor of DELIVERY_ACTORS) {
      for (const ctx of [undefined, {}, { requiresPickup: false }]) {
        const name = `${actor}, ctx ${JSON.stringify(ctx)}`;
        const can = (from: DeliveryStatus, to: DeliveryStatus) => canTransition(from, to, actor, ctx);
        wrong.push(...wrongCells(name, { from: DELIVERY, to: DELIVERY }, DELIVERY_MOVES[actor], can));
        cells += DELIVERY.length * DELIVERY.length;
      }
    }
    assert.deepEqual(wrong, []);
    assert.equal(cells, 3 * 3 * 81);
  });

  it('matches the table for every (from, to, actor) while the load is still at the store', () => {
    const wrong: string[] = [];
    let cells = 0;
    for (const actor of DELIVERY_ACTORS) {
      const can = (from: DeliveryStatus, to: DeliveryStatus) =>
        canTransition(from, to, actor, { requiresPickup: true });
      wrong.push(
        ...wrongCells(
          `${actor}, uncollected`,
          { from: BEFORE_COLLECTION, to: DELIVERY },
          UNCOLLECTED_MOVES[actor],
          can,
        ),
      );
      cells += BEFORE_COLLECTION.length * DELIVERY.length;
    }
    assert.deepEqual(wrong, []);
    assert.equal(cells, 3 * 3 * 9);
  });

  it('lets nobody but the store PIN check move an uncollected load past the counter', () => {
    for (const from of DELIVERY) {
      for (const to of DELIVERY) {
        for (const actor of ['driver', 'staff'] as const) {
          const expected = canTransition(from, to, actor) && !PAST_THE_COUNTER.includes(to);
          const actual = canTransition(from, to, actor, { requiresPickup: true });
          assert.equal(actual, expected, `${actor}: ${from} → ${to}`);
        }
        // The system actor is the claim, the PIN check and the cascades: the pickup does not limit it.
        assert.equal(
          canTransition(from, to, 'system', { requiresPickup: true }),
          canTransition(from, to, 'system'),
          `system: ${from} → ${to}`,
        );
      }
    }
  });

  it('refuses accepted → in_transit to a driver until the store has confirmed the collection', () => {
    const uncollected = { requiresPickup: requiresPickup({ pickup: PICKUP }) };
    assert.deepEqual(uncollected, { requiresPickup: true });
    assert.equal(canTransition('accepted', 'in_transit', 'driver', uncollected), false);
    assert.equal(canTransition('accepted', 'picked_up', 'driver', uncollected), false);
    assert.equal(canTransition('accepted', 'failed', 'driver', uncollected), false);
    assert.deepEqual(allowedTransitions('accepted', 'driver', uncollected), ['unassigned']);
    // After the PIN check the driver carries on as on a manual delivery.
    const collected = { requiresPickup: requiresPickup({ pickup: COLLECTED }) };
    assert.deepEqual(collected, { requiresPickup: false });
    assert.equal(canTransition('picked_up', 'in_transit', 'driver', collected), true);
    // A manual delivery keeps the old moves from `accepted`.
    assert.equal(canTransition('accepted', 'in_transit', 'driver'), true);
    assert.equal(canTransition('accepted', 'picked_up', 'driver'), true);
  });

  it('lets a driver release an accepted job and decline an assigned one', () => {
    assert.equal(canTransition('accepted', 'unassigned', 'driver'), true);
    assert.equal(canTransition('accepted', 'unassigned', 'driver', { requiresPickup: true }), true);
    assert.equal(canTransition('assigned', 'unassigned', 'driver', { requiresPickup: true }), true);
    assert.equal(canTransition('assigned', 'accepted', 'driver', { requiresPickup: true }), true);
    // Once the load is on the truck it is the driver's: it cannot be handed back.
    for (const from of ['picked_up', 'in_transit', 'arrived'] as const) {
      assert.equal(canTransition(from, 'unassigned', 'driver'), false, from);
    }
  });

  it('gives the system actor the claim, the PIN check and the cancellation of any open delivery', () => {
    assert.equal(canTransition('unassigned', 'accepted', 'system'), true);
    assert.equal(canTransition('accepted', 'picked_up', 'system'), true);
    assert.equal(canTransition('accepted', 'picked_up', 'system', { requiresPickup: true }), true);
    for (const from of DELIVERY) {
      assert.equal(canTransition(from, 'cancelled', 'system'), STILL_OPEN.includes(from), from);
    }
    for (const from of ['delivered', 'failed', 'cancelled'] as const) {
      assert.deepEqual(allowedTransitions(from, 'system'), [], from);
    }
    // Nothing else: the system never assigns, accepts an assignment, delivers or fails a delivery.
    assert.equal(canTransition('assigned', 'accepted', 'system'), false);
    assert.equal(canTransition('unassigned', 'assigned', 'system'), false);
    assert.equal(canTransition('picked_up', 'delivered', 'system'), false);
    assert.equal(canTransition('in_transit', 'failed', 'system'), false);
  });

  it('lets staff re-attempt a failed delivery, but not complete or fail an uncollected one', () => {
    assert.equal(canTransition('failed', 'picked_up', 'staff'), true);
    assert.equal(canTransition('failed', 'picked_up', 'driver'), false);
    assert.equal(canTransition('accepted', 'picked_up', 'staff'), false);
    for (const from of ['assigned', 'accepted'] as const) {
      assert.equal(canTransition(from, 'delivered', 'staff'), true, from);
      assert.equal(canTransition(from, 'delivered', 'staff', { requiresPickup: true }), false, from);
      assert.equal(canTransition(from, 'failed', 'staff', { requiresPickup: true }), false, from);
      assert.equal(canTransition(from, 'unassigned', 'staff', { requiresPickup: true }), true, from);
      assert.equal(canTransition(from, 'assigned', 'staff', { requiresPickup: true }), true, from);
    }
  });

  it('answers allowedTransitions and canTransition from the same table', () => {
    for (const actor of DELIVERY_ACTORS) {
      for (const ctx of [{}, { requiresPickup: true }]) {
        for (const from of DELIVERY) {
          const allowed = allowedTransitions(from, actor, ctx);
          assert.equal(new Set(allowed).size, allowed.length, `${actor} ${from}: a status is listed twice`);
          for (const to of DELIVERY) {
            assert.equal(
              allowed.includes(to),
              canTransition(from, to, actor, ctx),
              `${actor}: ${from} → ${to}`,
            );
          }
        }
      }
    }
  });
});

describe('requiresPickup', () => {
  it('is true from checkout until the store confirms the collection', () => {
    for (const pickup of UNCOLLECTED) assert.equal(requiresPickup({ pickup }), true);
    assert.equal(requiresPickup({ pickup: COLLECTED }), false);
  });

  it('is false for a manual delivery, which has no store leg', () => {
    assert.equal(requiresPickup({ pickup: null }), false);
  });
});

describe('primaryDriverAction', () => {
  const statusChange = (label: string, to: DeliveryStatus, requiresProof = false) => ({
    kind: 'status',
    label,
    to,
    requiresProof,
    disabled: false,
  });

  it('walks a manual delivery through its statuses', () => {
    const action = (status: DeliveryStatus) => primaryDriverAction({ status, pickup: null });
    assert.deepEqual(action('assigned'), statusChange('Accept job', 'accepted'));
    assert.deepEqual(action('accepted'), statusChange('Mark as picked up', 'picked_up'));
    assert.deepEqual(action('picked_up'), statusChange('Start trip to site', 'in_transit'));
    assert.deepEqual(action('in_transit'), statusChange("I've arrived", 'arrived'));
    assert.deepEqual(action('arrived'), statusChange('Complete delivery', 'delivered', true));
  });

  it('sends the driver of a marketplace delivery through the store counter', () => {
    const action = (pickup: Pickup) => primaryDriverAction({ status: 'accepted', pickup });
    assert.deepEqual(
      primaryDriverAction({ status: 'assigned', pickup: PICKUP }),
      statusChange('Accept job', 'accepted'),
    );
    assert.deepEqual(action(PICKUP), {
      kind: 'check_in',
      label: "I'm at the store",
      to: null,
      requiresProof: false,
      disabled: false,
    });
    // Ready before the driver gets there: the driver still checks in first.
    assert.equal(action(READY_NOT_THERE)?.kind, 'check_in');
    assert.deepEqual(action(AT_COUNTER), {
      kind: 'wait',
      label: 'Waiting for the store',
      to: null,
      requiresProof: false,
      disabled: true,
    });
    assert.deepEqual(action(AT_COUNTER_READY), {
      kind: 'show_pin',
      label: 'Show pickup PIN',
      to: null,
      requiresProof: false,
      disabled: false,
    });
  });

  it('is the same after the collection as on a manual delivery', () => {
    for (const status of ['picked_up', 'in_transit', 'arrived'] as const) {
      assert.deepEqual(
        primaryDriverAction({ status, pickup: COLLECTED }),
        primaryDriverAction({ status, pickup: null }),
        status,
      );
    }
    assert.equal(
      primaryDriverAction({ status: 'picked_up', pickup: COLLECTED })?.label,
      'Start trip to site',
    );
  });

  it("has nothing to offer when the delivery is not the driver's to move", () => {
    for (const pickup of [null, PICKUP, COLLECTED]) {
      for (const status of ['unassigned', 'delivered', 'failed', 'cancelled'] as const) {
        assert.equal(primaryDriverAction({ status, pickup }), null, status);
      }
    }
  });

  it('only offers a status change that the machine allows the driver', () => {
    const offered: string[] = [];
    const check = (status: DeliveryStatus, pickup: Pickup | null) => {
      const action = primaryDriverAction({ status, pickup });
      if (action?.kind !== 'status') return;
      const ctx = { requiresPickup: requiresPickup({ pickup }) };
      assert.equal(canTransition(status, action.to, 'driver', ctx), true, `${status} → ${action.to}`);
      offered.push(`${status} → ${action.to}`);
    };
    for (const status of DELIVERY) check(status, null);
    for (const status of BEFORE_COLLECTION) for (const pickup of UNCOLLECTED) check(status, pickup);
    for (const status of PAST_THE_COUNTER) check(status, COLLECTED);
    assert.deepEqual(offered, [
      // manual
      'assigned → accepted',
      'accepted → picked_up',
      'picked_up → in_transit',
      'in_transit → arrived',
      'arrived → delivered',
      // marketplace, before the collection: accepting is the only status change (4 pickup states)
      'assigned → accepted',
      'assigned → accepted',
      'assigned → accepted',
      'assigned → accepted',
      // marketplace, after the collection
      'picked_up → in_transit',
      'in_transit → arrived',
      'arrived → delivered',
    ]);
  });
});

describe('customerLabelFor', () => {
  it('keeps the labels of a manual delivery', () => {
    const expected: Record<DeliveryStatus, string> = {
      unassigned: 'Order received',
      assigned: 'Driver assigned',
      accepted: 'Driver assigned',
      picked_up: 'Package picked up',
      in_transit: 'On the way',
      arrived: 'Driver has arrived',
      delivered: 'Delivered',
      failed: 'Delivery attempt failed',
      cancelled: 'Cancelled',
    };
    for (const status of DELIVERY) {
      assert.equal(customerLabelFor(status, 'manual'), expected[status], status);
      assert.equal(STATUS_META[status].customerLabel, expected[status], status);
    }
  });

  it('names the store leg and the jobsite on a marketplace delivery', () => {
    const expected: Record<DeliveryStatus, string> = {
      unassigned: 'Order received',
      assigned: 'Driver assigned',
      accepted: 'Driver heading to the store',
      picked_up: 'Loaded at the store',
      in_transit: 'On the way to your site',
      arrived: 'Driver at your site',
      delivered: 'Delivered',
      failed: 'Delivery attempt failed',
      cancelled: 'Cancelled',
    };
    for (const status of DELIVERY) {
      assert.equal(customerLabelFor(status, 'marketplace'), expected[status], status);
    }
  });
});

describe('driver and tracking phases', () => {
  it('maps a delivery to the phase the supplier board shows', () => {
    const expected: Record<DeliveryStatus, DriverPhase | null> = {
      unassigned: null,
      assigned: 'assigned',
      accepted: 'to_store',
      picked_up: 'loaded',
      in_transit: 'to_site',
      arrived: 'at_site',
      delivered: 'delivered',
      failed: 'problem',
      cancelled: null,
    };
    for (const status of DELIVERY) {
      // Only `accepted` looks at the check-in: there is no "at store" status.
      const atCounter = status === 'accepted' ? 'at_store' : expected[status];
      assert.equal(driverPhaseFor({ status, pickup: PICKUP }), expected[status], status);
      assert.equal(driverPhaseFor({ status, pickup: READY_NOT_THERE }), expected[status], status);
      assert.equal(driverPhaseFor({ status, pickup: AT_COUNTER }), atCounter, status);
      assert.equal(driverPhaseFor({ status, pickup: AT_COUNTER_READY }), atCounter, status);
      assert.equal(driverPhaseFor({ status, pickup: null }), expected[status], status);
    }
  });

  it('maps a delivery to the phase the tracking page shows', () => {
    const expected: Record<DeliveryStatus, TrackingPhase> = {
      unassigned: 'finding_driver',
      assigned: 'driver_assigned',
      accepted: 'to_store',
      picked_up: 'loaded',
      in_transit: 'to_site',
      arrived: 'at_site',
      delivered: 'delivered',
      failed: 'problem',
      cancelled: 'cancelled',
    };
    for (const status of DELIVERY) {
      const atCounter = status === 'accepted' ? 'at_store' : expected[status];
      // A manual delivery has no store to head to.
      const manual = status === 'accepted' ? 'driver_assigned' : expected[status];
      assert.equal(trackingPhaseFor({ status, pickup: PICKUP }), expected[status], status);
      assert.equal(trackingPhaseFor({ status, pickup: AT_COUNTER }), atCounter, status);
      assert.equal(trackingPhaseFor({ status, pickup: null }), manual, status);
    }
  });

  it('shows the store and the customer the same phase once a driver has the job', () => {
    for (const pickup of [...UNCOLLECTED, COLLECTED]) {
      for (const status of WITH_A_DRIVER) {
        assert.equal(trackingPhaseFor({ status, pickup }), driverPhaseFor({ status, pickup }), status);
      }
    }
  });
});

// ---------- store orders (§2.1) ----------

/** §2.1 by actor, for a delivery order. */
const DELIVERY_ORDER_MOVES: Record<MachineActor, Moves<StoreOrderStatus>> = {
  customer: {
    new: ['cancelled'],
    accepted: ['cancelled'],
  },
  supplier: {
    new: ['accepted', 'rejected'],
    accepted: ['cancelled', 'preparing', 'ready'],
    preparing: ['cancelled', 'ready'],
    ready: ['cancelled', 'preparing', 'out_for_delivery'],
  },
  driver: {
    out_for_delivery: ['delivered', 'failed'],
  },
  staff: {
    new: ['accepted', 'rejected', 'cancelled'],
    accepted: ['cancelled', 'preparing', 'ready'],
    preparing: ['cancelled', 'ready'],
    ready: ['cancelled', 'preparing', 'out_for_delivery'],
    out_for_delivery: ['delivered', 'failed'],
    failed: ['out_for_delivery', 'cancelled'],
  },
  system: {
    new: ['rejected'],
  },
};

/** The same table for a pickup order: only what happens to a `ready` order differs. */
const STORE_ORDER_MOVES: Record<Fulfilment, Record<MachineActor, Moves<StoreOrderStatus>>> = {
  delivery: DELIVERY_ORDER_MOVES,
  pickup: {
    customer: DELIVERY_ORDER_MOVES.customer,
    // The store hands the goods to the customer, not to a driver.
    supplier: { ...DELIVERY_ORDER_MOVES.supplier, ready: ['cancelled', 'preparing', 'picked_up'] },
    driver: DELIVERY_ORDER_MOVES.driver,
    staff: { ...DELIVERY_ORDER_MOVES.staff, ready: ['cancelled', 'preparing', 'picked_up'] },
    // A pickup nobody collects is cancelled when its hold runs out.
    system: { new: ['rejected'], ready: ['cancelled'] },
  },
};

const DELIVERY_ORDER = { fulfilment: 'delivery' } as const;
const PICKUP_ORDER = { fulfilment: 'pickup' } as const;

describe('store-order machine', () => {
  it('has ten statuses, four of them final', () => {
    assert.deepEqual([...STORE_ORDER_STATUSES], STORE_ORDER);
    assert.deepEqual([...FINAL_STORE_ORDER_STATUSES], ['delivered', 'picked_up', 'rejected', 'cancelled']);
    for (const status of STORE_ORDER) {
      const final = ['delivered', 'picked_up', 'rejected', 'cancelled'].includes(status);
      assert.equal(isFinalStoreOrderStatus(status), final, status);
    }
  });

  it('reads like the table of §2.1, row by row', () => {
    assert.deepEqual(STORE_ORDER_TRANSITIONS.map(printRow), [
      'new → accepted | supplier, staff | acceptStoreOrder',
      'new → rejected | supplier, staff | rejectStoreOrder',
      'new → rejected | system | escalateStoreOrders',
      'new, accepted → cancelled | customer | cancelOrder',
      'accepted, preparing, ready → cancelled | supplier | rejectStoreOrder',
      'new, accepted, preparing, ready → cancelled | staff | rejectStoreOrder',
      'accepted → preparing | supplier, staff | updateStoreOrderStatus',
      'accepted, preparing → ready | supplier, staff | updateStoreOrderStatus',
      'ready → preparing | supplier, staff | updateStoreOrderStatus',
      'ready → out_for_delivery | supplier, staff | completePickup | delivery only',
      'ready → picked_up | supplier, staff | completePickup | pickup only',
      'ready → cancelled | system | expirePickupHolds | pickup only',
      'out_for_delivery → delivered | driver, staff | completeDelivery, updateDeliveryStatus',
      'out_for_delivery → failed | driver, staff | updateDeliveryStatus',
      'failed → out_for_delivery | staff | resolveFailedDelivery',
      'failed → cancelled | staff | resolveFailedDelivery',
    ]);
  });

  it('matches the table for every (from, to, actor) and both fulfilments', () => {
    const wrong: string[] = [];
    let cells = 0;
    for (const fulfilment of FULFILMENTS) {
      for (const actor of ACTORS) {
        const can = (from: StoreOrderStatus, to: StoreOrderStatus) =>
          canStoreOrderTransition(from, to, actor, { fulfilment });
        wrong.push(
          ...wrongCells(
            `${actor}, ${fulfilment}`,
            { from: STORE_ORDER, to: STORE_ORDER },
            STORE_ORDER_MOVES[fulfilment][actor],
            can,
          ),
        );
        cells += STORE_ORDER.length * STORE_ORDER.length;
      }
    }
    assert.deepEqual(wrong, []);
    assert.equal(cells, 2 * 5 * 100);
  });

  it('lists the allowed moves in table order', () => {
    for (const fulfilment of FULFILMENTS) {
      for (const actor of ACTORS) {
        for (const from of STORE_ORDER) {
          assert.deepEqual(
            allowedStoreOrderTransitions(from, actor, { fulfilment }),
            STORE_ORDER_MOVES[fulfilment][actor][from] ?? [],
            `${actor}, ${fulfilment}, from ${from}`,
          );
        }
      }
    }
  });

  it('hands a ready order to a driver or to the customer, never to the wrong one', () => {
    for (const actor of ['supplier', 'staff'] as const) {
      assert.equal(canStoreOrderTransition('ready', 'out_for_delivery', actor, DELIVERY_ORDER), true);
      assert.equal(canStoreOrderTransition('ready', 'picked_up', actor, DELIVERY_ORDER), false);
      assert.equal(canStoreOrderTransition('ready', 'picked_up', actor, PICKUP_ORDER), true);
      assert.equal(canStoreOrderTransition('ready', 'out_for_delivery', actor, PICKUP_ORDER), false);
    }
  });

  it('lets a customer cancel only until the store starts preparing', () => {
    for (const fulfilment of FULFILMENTS) {
      assert.deepEqual(
        STORE_ORDER.filter((from) => canStoreOrderTransition(from, 'cancelled', 'customer', { fulfilment })),
        ['new', 'accepted'],
      );
    }
  });

  it('rejects a new order for a store, and cancels one the store had accepted', () => {
    assert.equal(canStoreOrderTransition('new', 'rejected', 'supplier', DELIVERY_ORDER), true);
    assert.equal(canStoreOrderTransition('new', 'cancelled', 'supplier', DELIVERY_ORDER), false);
    for (const from of ['accepted', 'preparing', 'ready'] as const) {
      assert.equal(canStoreOrderTransition(from, 'cancelled', 'supplier', DELIVERY_ORDER), true, from);
      assert.equal(canStoreOrderTransition(from, 'rejected', 'supplier', DELIVERY_ORDER), false, from);
    }
    // Staff may do either from `new`: the table cannot say which one `rejectStoreOrder` picks.
    assert.equal(canStoreOrderTransition('new', 'rejected', 'staff', DELIVERY_ORDER), true);
    assert.equal(canStoreOrderTransition('new', 'cancelled', 'staff', DELIVERY_ORDER), true);
  });

  it('auto-rejects only a new order and expires only a pickup hold', () => {
    assert.equal(canStoreOrderTransition('new', 'rejected', 'system', DELIVERY_ORDER), true);
    assert.equal(canStoreOrderTransition('new', 'rejected', 'system', PICKUP_ORDER), true);
    assert.equal(canStoreOrderTransition('accepted', 'rejected', 'system', DELIVERY_ORDER), false);
    assert.equal(canStoreOrderTransition('ready', 'cancelled', 'system', PICKUP_ORDER), true);
    assert.equal(canStoreOrderTransition('ready', 'cancelled', 'system', DELIVERY_ORDER), false);
  });

  it('leaves a failed delivery to staff: re-attempt or return to the store', () => {
    const moves = (actor: MachineActor) => allowedStoreOrderTransitions('failed', actor, DELIVERY_ORDER);
    assert.deepEqual(moves('staff'), ['out_for_delivery', 'cancelled']);
    for (const actor of ['customer', 'supplier', 'driver', 'system'] as const) {
      assert.deepEqual(moves(actor), [], actor);
    }
  });

  it('never moves a final status, and always leaves a way out of the others', () => {
    for (const fulfilment of FULFILMENTS) {
      for (const from of STORE_ORDER) {
        const moves = ACTORS.flatMap((actor) => allowedStoreOrderTransitions(from, actor, { fulfilment }));
        assert.equal(moves.length === 0, isFinalStoreOrderStatus(from), `${fulfilment}: ${from}`);
      }
    }
  });

  it('reaches every delivery status on a delivery order and none of them on a pickup order', () => {
    const movesOf = (fulfilment: Fulfilment) => (from: StoreOrderStatus) =>
      ACTORS.flatMap((actor) => allowedStoreOrderTransitions(from, actor, { fulfilment }));
    assert.deepEqual(
      reachable<StoreOrderStatus>('new', movesOf('delivery')).sort(),
      STORE_ORDER.filter((status) => status !== 'picked_up').sort(),
    );
    assert.deepEqual(reachable<StoreOrderStatus>('new', movesOf('pickup')).sort(), [
      'accepted',
      'cancelled',
      'new',
      'picked_up',
      'preparing',
      'ready',
      'rejected',
    ]);
  });

  it('writes each cell of the table only once', () => {
    const cells = STORE_ORDER_TRANSITIONS.flatMap((row) =>
      row.from.flatMap((from) =>
        row.actors.flatMap((actor) =>
          (row.fulfilment ? [row.fulfilment] : FULFILMENTS).map(
            (fulfilment) => `${from} → ${row.to} by ${actor} (${fulfilment})`,
          ),
        ),
      ),
    );
    assert.equal(new Set(cells).size, cells.length);
    assert.equal(STORE_ORDER_TRANSITIONS.length, 16);
  });
});

describe('store-order labels', () => {
  it('uses the supplier board words of §2.1', () => {
    const expected: Record<StoreOrderStatus, string> = {
      new: 'New',
      accepted: 'Accepted',
      preparing: 'Preparing',
      ready: 'Ready',
      out_for_delivery: 'Out for delivery',
      delivered: 'Delivered',
      picked_up: 'Picked up',
      failed: 'Delivery failed',
      rejected: 'Rejected',
      cancelled: 'Cancelled',
    };
    for (const status of STORE_ORDER) assert.equal(STORE_ORDER_META[status].label, expected[status], status);
  });

  it('tells the customer what is happening at each store', () => {
    const delivery: Record<StoreOrderStatus, string> = {
      new: 'Waiting for Kestrel Lumber Yard to confirm',
      accepted: 'Confirmed',
      preparing: 'Being prepared',
      ready: 'Packed — finding a driver',
      out_for_delivery: 'On the way',
      delivered: 'Delivered',
      picked_up: 'Picked up',
      failed: "Delivery issue — we're on it",
      rejected: 'Not available',
      cancelled: 'Cancelled',
    };
    const expected: Record<Fulfilment, Record<StoreOrderStatus, string>> = {
      delivery,
      pickup: { ...delivery, ready: 'Ready for pickup' },
    };
    for (const fulfilment of FULFILMENTS) {
      for (const status of STORE_ORDER) {
        assert.equal(
          storeOrderCustomerLabel({ status, fulfilment, storeName: 'Kestrel Lumber Yard' }),
          expected[fulfilment][status],
          `${fulfilment} ${status}`,
        );
      }
    }
  });

  it('keeps the two templates in the table and fills them in the label', () => {
    assert.equal(STORE_ORDER_META.new.customerLabel, 'Waiting for {store} to confirm');
    assert.equal(STORE_ORDER_META.ready.customerLabel, 'Packed — finding a driver');
    // A store name is text, never a replacement pattern.
    assert.equal(
      storeOrderCustomerLabel({ status: 'new', fulfilment: 'pickup', storeName: 'Nuts $& Bolts $1' }),
      'Waiting for Nuts $& Bolts $1 to confirm',
    );
  });

  it('puts each status in its lane of the supplier board, a failed delivery with those on the road', () => {
    const expected: Record<StoreOrderStatus, StoreOrderColumn> = {
      new: 'new',
      accepted: 'accepted',
      preparing: 'preparing',
      ready: 'ready',
      out_for_delivery: 'out_for_delivery',
      delivered: 'done',
      picked_up: 'done',
      failed: 'out_for_delivery',
      rejected: 'done',
      cancelled: 'done',
    };
    for (const status of STORE_ORDER) {
      assert.equal(STORE_ORDER_META[status].column, expected[status], status);
      // Everything final is done, and nothing else is.
      assert.equal(STORE_ORDER_META[status].column === 'done', isFinalStoreOrderStatus(status), status);
    }
  });

  it('colours a status by what it asks for', () => {
    assert.equal(STORE_ORDER_META.new.tone, 'warning');
    assert.equal(STORE_ORDER_META.failed.tone, 'danger');
    assert.equal(STORE_ORDER_META.rejected.tone, 'danger');
    assert.equal(STORE_ORDER_META.delivered.tone, 'success');
    assert.equal(STORE_ORDER_META.picked_up.tone, 'success');
    assert.equal(STORE_ORDER_META.cancelled.tone, 'neutral');
  });
});

// ---------- a store order and its delivery move together (§2.3 "Coupling") ----------

interface CoupledMove {
  event: string;
  /** The delivery's move, who makes it, and whether the load is still at the store when it happens. */
  delivery: { from: DeliveryStatus; to: DeliveryStatus; actor: TransitionActor; atStore: boolean };
  storeOrder: { from: StoreOrderStatus; to: StoreOrderStatus; actor: MachineActor };
}

/** One transaction each: both tables have to allow their half, or the callable could never commit. */
const COUPLED_MOVES: CoupledMove[] = [
  {
    event: 'the store types the driver PIN',
    delivery: { from: 'accepted', to: 'picked_up', actor: 'system', atStore: true },
    storeOrder: { from: 'ready', to: 'out_for_delivery', actor: 'supplier' },
  },
  {
    event: 'staff confirm the collection with an override',
    delivery: { from: 'accepted', to: 'picked_up', actor: 'system', atStore: true },
    storeOrder: { from: 'ready', to: 'out_for_delivery', actor: 'staff' },
  },
  {
    event: 'the driver drops off with proof',
    delivery: { from: 'arrived', to: 'delivered', actor: 'driver', atStore: false },
    storeOrder: { from: 'out_for_delivery', to: 'delivered', actor: 'driver' },
  },
  {
    event: 'staff record the drop-off',
    delivery: { from: 'in_transit', to: 'delivered', actor: 'staff', atStore: false },
    storeOrder: { from: 'out_for_delivery', to: 'delivered', actor: 'staff' },
  },
  {
    event: 'the driver cannot deliver at the site',
    delivery: { from: 'arrived', to: 'failed', actor: 'driver', atStore: false },
    storeOrder: { from: 'out_for_delivery', to: 'failed', actor: 'driver' },
  },
  {
    event: 'the vehicle breaks down right after loading',
    delivery: { from: 'picked_up', to: 'failed', actor: 'driver', atStore: false },
    storeOrder: { from: 'out_for_delivery', to: 'failed', actor: 'driver' },
  },
  {
    event: 'staff record the failure',
    delivery: { from: 'in_transit', to: 'failed', actor: 'staff', atStore: false },
    storeOrder: { from: 'out_for_delivery', to: 'failed', actor: 'staff' },
  },
  {
    event: 'staff send a failed delivery out again',
    delivery: { from: 'failed', to: 'picked_up', actor: 'staff', atStore: false },
    storeOrder: { from: 'failed', to: 'out_for_delivery', actor: 'staff' },
  },
  {
    event: 'staff send a failed delivery back to the store',
    delivery: { from: 'failed', to: 'cancelled', actor: 'staff', atStore: false },
    storeOrder: { from: 'failed', to: 'cancelled', actor: 'staff' },
  },
  {
    event: 'the store rejects before any driver has the job',
    delivery: { from: 'unassigned', to: 'cancelled', actor: 'system', atStore: true },
    storeOrder: { from: 'new', to: 'rejected', actor: 'supplier' },
  },
  {
    event: 'the store never answers',
    delivery: { from: 'unassigned', to: 'cancelled', actor: 'system', atStore: true },
    storeOrder: { from: 'new', to: 'rejected', actor: 'system' },
  },
  {
    event: 'the customer cancels after a driver claimed the job',
    delivery: { from: 'accepted', to: 'cancelled', actor: 'system', atStore: true },
    storeOrder: { from: 'accepted', to: 'cancelled', actor: 'customer' },
  },
  {
    event: 'the store cancels with the driver at the counter',
    delivery: { from: 'accepted', to: 'cancelled', actor: 'system', atStore: true },
    storeOrder: { from: 'ready', to: 'cancelled', actor: 'supplier' },
  },
  {
    event: 'staff cancel a job dispatch had assigned',
    delivery: { from: 'assigned', to: 'cancelled', actor: 'system', atStore: true },
    storeOrder: { from: 'preparing', to: 'cancelled', actor: 'staff' },
  },
];

describe('store order and delivery coupling', () => {
  it('allows both halves of every coupled move', () => {
    for (const { event, delivery, storeOrder } of COUPLED_MOVES) {
      const ctx = { requiresPickup: delivery.atStore };
      assert.equal(
        canTransition(delivery.from, delivery.to, delivery.actor, ctx),
        true,
        `delivery: ${event}`,
      );
      assert.equal(
        canStoreOrderTransition(storeOrder.from, storeOrder.to, storeOrder.actor, DELIVERY_ORDER),
        true,
        `store order: ${event}`,
      );
    }
  });

  it('keeps the store order where it is when a job changes hands before collection', () => {
    // Claim, assignment, decline, release and unassign only move the delivery (§2.3 "projection").
    const atStore = { requiresPickup: true };
    assert.equal(canTransition('unassigned', 'accepted', 'system', atStore), true);
    assert.equal(canTransition('unassigned', 'assigned', 'staff', atStore), true);
    assert.equal(canTransition('assigned', 'unassigned', 'driver', atStore), true);
    assert.equal(canTransition('accepted', 'unassigned', 'driver', atStore), true);
    assert.equal(canTransition('accepted', 'unassigned', 'staff', atStore), true);
    // Nothing in the store-order table is a driver's move until the load is out for delivery.
    for (const from of ['new', 'accepted', 'preparing', 'ready'] as const) {
      assert.deepEqual(allowedStoreOrderTransitions(from, 'driver', DELIVERY_ORDER), [], from);
    }
  });
});

// ---------- order status (§2.2) ----------

/** The status of an order with a single store order: the table of §2.2. */
const ORDER_STATUS_OF: Record<StoreOrderStatus, OrderStatus> = {
  new: 'placed',
  accepted: 'confirmed',
  preparing: 'preparing',
  ready: 'ready',
  out_for_delivery: 'on_the_way',
  delivered: 'completed',
  picked_up: 'completed',
  failed: 'ready',
  rejected: 'cancelled',
  cancelled: 'cancelled',
};

const ORDER_CODES: Record<string, OrderStatus> = {
  PL: 'placed',
  CO: 'confirmed',
  PR: 'preparing',
  RE: 'ready',
  OW: 'on_the_way',
  DN: 'completed',
  CA: 'cancelled',
};

/** The status of an order with two store orders. Rows and columns follow the store-order status list. */
const PAIRS = `
  status             new acc pre rea out del pic fai rej can
  new                PL  PL  PL  PL  PL  PL  PL  PL  PL  PL
  accepted           PL  CO  CO  CO  CO  CO  CO  CO  CO  CO
  preparing          PL  CO  PR  PR  PR  PR  PR  PR  PR  PR
  ready              PL  CO  PR  RE  RE  RE  RE  RE  RE  RE
  out_for_delivery   PL  CO  PR  RE  OW  OW  OW  RE  OW  OW
  delivered          PL  CO  PR  RE  OW  DN  DN  RE  DN  DN
  picked_up          PL  CO  PR  RE  OW  DN  DN  RE  DN  DN
  failed             PL  CO  PR  RE  RE  RE  RE  RE  RE  RE
  rejected           PL  CO  PR  RE  OW  DN  DN  RE  CA  CA
  cancelled          PL  CO  PR  RE  OW  DN  DN  RE  CA  CA
`;

/** From the slowest to the furthest along. `cancelled` is not on this line: it means nothing is left. */
const PROGRESS: readonly OrderStatus[] = [
  'placed',
  'confirmed',
  'preparing',
  'ready',
  'on_the_way',
  'completed',
];

function summary(status: StoreOrderStatus, fulfilment: Fulfilment, index: number): StoreOrderSummary {
  const letter = 'ABCDE'.charAt(index);
  return {
    storeOrderId: `3f2b8c1e-7a4d-4e6f-9b1a-2c5d8e7f6a90-${letter}`,
    number: `IS-10042-${letter}`,
    letter,
    storeId: 'kestrel-lumber',
    storeName: 'Kestrel Lumber Yard',
    fulfilment,
    status,
    itemCount: 24,
    itemsSummary: '20 × 2x4x8 SPF stud, 4 × OSB 7/16 in',
    currentTotalCents: 21_164,
    deliverBy: fulfilment === 'delivery' ? NOON + 85 * MINUTE : null,
    readyAt: null,
    holdUntil: null,
    trackingToken: null,
    pickupCode: null,
    driverFirstName: null,
    updatedAt: NOON,
  };
}

/** An order as the aggregate leaves it: the summaries, and the status derived from them. */
function orderOf(
  statuses: readonly StoreOrderStatus[],
  fulfilment: Fulfilment = 'delivery',
): Pick<Order, 'status' | 'storeOrders'> {
  return frozen({
    status: orderStatusFromStoreOrders(statuses),
    storeOrders: statuses.map((status, index) => summary(status, fulfilment, index)),
  });
}

describe('order status', () => {
  it('has seven statuses, five of them open', () => {
    assert.deepEqual([...ORDER_STATUSES], ORDER);
    assert.deepEqual([...ORDER_OPEN_STATUSES], ['placed', 'confirmed', 'preparing', 'ready', 'on_the_way']);
    for (const status of ORDER) {
      assert.equal(isOrderOpen(status), status !== 'completed' && status !== 'cancelled', status);
    }
  });

  it('has a badge word and colour for every status', () => {
    assert.deepEqual(ORDER_STATUS_META, {
      placed: { label: 'Placed', tone: 'warning' },
      confirmed: { label: 'Confirmed', tone: 'info' },
      preparing: { label: 'Preparing', tone: 'info' },
      ready: { label: 'Ready', tone: 'brand' },
      on_the_way: { label: 'On the way', tone: 'brand' },
      completed: { label: 'Completed', tone: 'success' },
      cancelled: { label: 'Cancelled', tone: 'neutral' },
    });
    // The colour of an order is the colour of the store-order status it stands for.
    for (const status of STORE_ORDER.filter((each) => each !== 'failed' && each !== 'rejected')) {
      assert.equal(ORDER_STATUS_META[ORDER_STATUS_OF[status]].tone, STORE_ORDER_META[status].tone, status);
    }
  });

  it('holds the rank table of §2.2', () => {
    assert.deepEqual(ORDER_STATUS_BY_STORE_ORDER, {
      new: { rank: 0, orderStatus: 'placed' },
      accepted: { rank: 1, orderStatus: 'confirmed' },
      preparing: { rank: 2, orderStatus: 'preparing' },
      ready: { rank: 3, orderStatus: 'ready' },
      failed: { rank: 3, orderStatus: 'ready' },
      out_for_delivery: { rank: 4, orderStatus: 'on_the_way' },
      delivered: { rank: 5, orderStatus: 'completed' },
      picked_up: { rank: 5, orderStatus: 'completed' },
    });
  });

  it('follows its only store order', () => {
    for (const status of STORE_ORDER) {
      assert.equal(orderStatusFromStoreOrders(frozen([status])), ORDER_STATUS_OF[status], status);
    }
  });

  it('is cancelled when no store order is left', () => {
    assert.equal(orderStatusFromStoreOrders([]), 'cancelled');
    assert.equal(orderStatusFromStoreOrders(['rejected']), 'cancelled');
    assert.equal(orderStatusFromStoreOrders(['cancelled', 'rejected', 'cancelled']), 'cancelled');
  });

  it('takes the status of the slower store order of every pair', () => {
    const rows = PAIRS.trim()
      .split('\n')
      .slice(1)
      .map((line) => line.trim().split(/\s+/));
    assert.deepEqual(
      rows.map((row) => row[0]),
      STORE_ORDER,
    );
    let cells = 0;
    for (const [rowIndex, first] of STORE_ORDER.entries()) {
      for (const [columnIndex, second] of STORE_ORDER.entries()) {
        const code = rows[rowIndex]?.[columnIndex + 1] ?? 'nothing';
        const expected = ORDER_CODES[code];
        assert.ok(expected, `the grid has "${code}" for ${first} + ${second}`);
        assert.equal(orderStatusFromStoreOrders([first, second]), expected, `${first} + ${second}`);
        cells += 1;
      }
    }
    assert.equal(cells, 100);
  });

  it('takes the status of the slowest store order of every triple', () => {
    let cells = 0;
    for (const first of STORE_ORDER) {
      for (const second of STORE_ORDER) {
        for (const third of STORE_ORDER) {
          const alone = [first, second, third].map((status) => ORDER_STATUS_OF[status]);
          const expected = PROGRESS.find((status) => alone.includes(status)) ?? 'cancelled';
          const actual = orderStatusFromStoreOrders(frozen([first, second, third]));
          assert.equal(actual, expected, `${first} + ${second} + ${third}`);
          cells += 1;
        }
      }
    }
    assert.equal(cells, 1000);
  });

  it('reads the examples of a three-store order', () => {
    assert.equal(orderStatusFromStoreOrders(['new', 'new', 'new']), 'placed');
    assert.equal(orderStatusFromStoreOrders(['accepted', 'new', 'ready']), 'placed');
    assert.equal(orderStatusFromStoreOrders(['accepted', 'rejected', 'ready']), 'confirmed');
    assert.equal(orderStatusFromStoreOrders(['delivered', 'preparing', 'out_for_delivery']), 'preparing');
    assert.equal(orderStatusFromStoreOrders(['delivered', 'ready', 'out_for_delivery']), 'ready');
    assert.equal(orderStatusFromStoreOrders(['delivered', 'failed', 'out_for_delivery']), 'ready');
    assert.equal(orderStatusFromStoreOrders(['delivered', 'cancelled', 'out_for_delivery']), 'on_the_way');
    assert.equal(orderStatusFromStoreOrders(['delivered', 'cancelled', 'delivered']), 'completed');
    assert.equal(orderStatusFromStoreOrders(['picked_up', 'picked_up', 'rejected']), 'completed');
  });

  it('is settled once every store order is final, and a failed delivery is not', () => {
    for (const first of STORE_ORDER) {
      for (const second of STORE_ORDER) {
        const expected = isFinalStoreOrderStatus(first) && isFinalStoreOrderStatus(second);
        assert.equal(isOrderSettled(frozen([first, second])), expected, `${first} + ${second}`);
        // A settled order is over: completed or cancelled, never anything in between.
        const open = isOrderOpen(orderStatusFromStoreOrders([first, second]));
        assert.equal(open, !expected, `${first} + ${second}`);
      }
    }
    assert.equal(isOrderSettled(['delivered', 'failed']), false);
    assert.equal(isOrderSettled(['delivered', 'rejected', 'cancelled']), true);
    assert.equal(isOrderSettled(['picked_up']), true);
    // No store order to wait for: the same answer as the status, which is then `cancelled`.
    assert.equal(isOrderSettled([]), true);
  });

  it('needs attention when a delivery failed or a store is late to accept', () => {
    const fine = { status: 'new', acceptOverdue: false } as const;
    assert.equal(orderNeedsAttention([]), false);
    assert.equal(orderNeedsAttention([fine, { status: 'out_for_delivery', acceptOverdue: false }]), false);
    assert.equal(orderNeedsAttention([fine, { status: 'failed', acceptOverdue: false }]), true);
    assert.equal(orderNeedsAttention([fine, { status: 'new', acceptOverdue: true }]), true);
    assert.equal(orderNeedsAttention(frozen([{ status: 'failed', acceptOverdue: true }])), true);
    for (const status of STORE_ORDER) {
      assert.equal(orderNeedsAttention([{ status, acceptOverdue: false }]), status === 'failed', status);
    }
  });
});

describe('orderHeadline', () => {
  it('says "Cancelled" for a cancelled order', () => {
    assert.equal(orderHeadline(orderOf(['cancelled'])), 'Cancelled');
    assert.equal(orderHeadline(orderOf(['rejected', 'cancelled'])), 'Cancelled');
  });

  it('says "Completed", and how many stores dropped out', () => {
    assert.equal(orderHeadline(orderOf(['delivered'])), 'Completed');
    assert.equal(orderHeadline(orderOf(['delivered', 'delivered'])), 'Completed');
    assert.equal(orderHeadline(orderOf(['picked_up', 'picked_up'], 'pickup')), 'Completed');
    assert.equal(orderHeadline(orderOf(['delivered', 'cancelled'])), 'Completed · 1 store cancelled');
    assert.equal(orderHeadline(orderOf(['rejected', 'delivered'])), 'Completed · 1 store cancelled');
    assert.equal(
      orderHeadline(orderOf(['delivered', 'rejected', 'cancelled'])),
      'Completed · 2 stores cancelled',
    );
  });

  it('puts a failed delivery before everything that is still moving', () => {
    assert.equal(orderHeadline(orderOf(['failed'])), "Delivery issue — we're on it");
    assert.equal(orderHeadline(orderOf(['delivered', 'failed'])), "Delivery issue — we're on it");
    assert.equal(
      orderHeadline(orderOf(['out_for_delivery', 'failed', 'new', 'ready'])),
      "Delivery issue — we're on it",
    );
  });

  it('counts the deliveries that arrived while one is on the way', () => {
    assert.equal(orderHeadline(orderOf(['out_for_delivery'])), 'On the way · 0 of 1 delivered');
    assert.equal(orderHeadline(orderOf(['out_for_delivery', 'delivered'])), 'On the way · 1 of 2 delivered');
    assert.equal(
      orderHeadline(orderOf(['delivered', 'out_for_delivery', 'delivered'])),
      'On the way · 2 of 3 delivered',
    );
    // A store that dropped out is not a delivery the customer is waiting for.
    assert.equal(
      orderHeadline(orderOf(['delivered', 'out_for_delivery', 'rejected', 'cancelled'])),
      'On the way · 1 of 2 delivered',
    );
    // It comes before the stores that are still packing or have not answered.
    assert.equal(
      orderHeadline(orderOf(['new', 'out_for_delivery', 'ready', 'preparing'])),
      'On the way · 0 of 4 delivered',
    );
  });

  it('says "Ready for pickup" as soon as one pickup store order is ready', () => {
    assert.equal(orderHeadline(orderOf(['ready'], 'pickup')), 'Ready for pickup');
    assert.equal(orderHeadline(orderOf(['new', 'ready', 'preparing'], 'pickup')), 'Ready for pickup');
    assert.equal(orderHeadline(orderOf(['picked_up', 'ready'], 'pickup')), 'Ready for pickup');
    // A delivery order that is ready waits for a driver, not for the customer.
    assert.equal(orderHeadline(orderOf(['new', 'ready'], 'delivery')), 'Waiting for 1 store to confirm');
  });

  it('counts the stores that have not confirmed yet', () => {
    assert.equal(orderHeadline(orderOf(['new'])), 'Waiting for 1 store to confirm');
    assert.equal(orderHeadline(orderOf(['new', 'new'])), 'Waiting for 2 stores to confirm');
    assert.equal(
      orderHeadline(orderOf(['new', 'accepted', 'new', 'ready', 'new'])),
      'Waiting for 3 stores to confirm',
    );
    assert.equal(orderHeadline(orderOf(['new', 'rejected'])), 'Waiting for 1 store to confirm');
    assert.equal(orderHeadline(orderOf(['new', 'preparing'], 'pickup')), 'Waiting for 1 store to confirm');
  });

  it('says "Ready — finding a driver" when everything still open is ready', () => {
    assert.equal(orderHeadline(orderOf(['ready'])), 'Ready — finding a driver');
    assert.equal(orderHeadline(orderOf(['ready', 'ready'])), 'Ready — finding a driver');
    assert.equal(orderHeadline(orderOf(['ready', 'cancelled'])), 'Ready — finding a driver');
    // A store order that is already delivered does not make the others any less ready.
    assert.equal(orderHeadline(orderOf(['delivered', 'ready'])), 'Ready — finding a driver');
  });

  it('says "Preparing your order" otherwise', () => {
    assert.equal(orderHeadline(orderOf(['accepted'])), 'Preparing your order');
    assert.equal(orderHeadline(orderOf(['preparing'])), 'Preparing your order');
    assert.equal(orderHeadline(orderOf(['ready', 'preparing'])), 'Preparing your order');
    assert.equal(orderHeadline(orderOf(['delivered', 'accepted'])), 'Preparing your order');
    assert.equal(orderHeadline(orderOf(['accepted', 'preparing'], 'pickup')), 'Preparing your order');
    assert.equal(orderHeadline(orderOf(['picked_up', 'preparing'], 'pickup')), 'Preparing your order');
    // An open order whose store orders are missing: the headline claims nothing it cannot know.
    assert.equal(orderHeadline({ status: 'placed', storeOrders: [] }), 'Preparing your order');
  });

  it('agrees with the order status for every order of one to three stores', () => {
    const forms = [
      'Cancelled',
      'Completed( · [12] stores? cancelled)?',
      "Delivery issue — we're on it",
      'On the way · [012] of [123] delivered',
      'Ready for pickup',
      'Waiting for [123] stores? to confirm',
      'Ready — finding a driver',
      'Preparing your order',
    ];
    const anyHeadline = new RegExp(`^(${forms.join('|')})$`);
    let orders = 0;
    const check = (statuses: StoreOrderStatus[]) => {
      for (const fulfilment of FULFILMENTS) {
        // A pickup order has no delivery, and nobody collects a delivery order at the counter.
        const impossible: readonly StoreOrderStatus[] =
          fulfilment === 'pickup' ? ['out_for_delivery', 'delivered', 'failed'] : ['picked_up'];
        if (statuses.some((status) => impossible.includes(status))) continue;
        const order = orderOf(statuses, fulfilment);
        const headline = orderHeadline(order);
        const name = `${fulfilment}: ${statuses.join(' + ')} reads "${headline}"`;
        assert.match(headline, anyHeadline, name);
        assert.equal(headline === 'Cancelled', order.status === 'cancelled', name);
        assert.equal(headline.startsWith('Completed'), order.status === 'completed', name);
        if (order.status === 'on_the_way') assert.ok(headline.startsWith('On the way · '), name);
        // "All remaining ready" is the moment the order itself is `ready` with nothing failed or on the road.
        const waitingForDriver =
          fulfilment === 'delivery' &&
          order.status === 'ready' &&
          !statuses.includes('failed') &&
          !statuses.includes('out_for_delivery');
        assert.equal(headline === 'Ready — finding a driver', waitingForDriver, name);
        orders += 1;
      }
    };
    for (const first of STORE_ORDER) {
      check([first]);
      for (const second of STORE_ORDER) {
        check([first, second]);
        for (const third of STORE_ORDER) check([first, second, third]);
      }
    }
    // A delivery order uses 9 of the statuses and a pickup order 7: 9 + 81 + 729 and 7 + 49 + 343.
    assert.equal(orders, 819 + 399);
  });
});

// ---------- quotes (§2.5) ----------

const QUOTE_MOVES: Record<MachineActor, Moves<QuoteStatus>> = {
  customer: {
    submitted: ['declined'],
    in_review: ['declined'],
    quoted: ['accepted', 'declined', 'in_review'],
    expired: ['in_review'],
  },
  supplier: {},
  driver: {},
  staff: {
    submitted: ['in_review', 'quoted', 'cancelled'],
    in_review: ['quoted', 'cancelled'],
    quoted: ['quoted'],
    expired: ['quoted'],
  },
  system: {
    quoted: ['expired'],
  },
};

describe('quote machine', () => {
  it('has seven statuses', () => {
    assert.deepEqual([...QUOTE_STATUSES], QUOTE);
  });

  it('reads like the table of §2.5, row by row', () => {
    assert.deepEqual(QUOTE_TRANSITIONS.map(printRow), [
      'submitted → in_review | staff | direct_write',
      'submitted, in_review, quoted, expired → quoted | staff | sendQuote',
      'quoted → accepted | customer | acceptQuote',
      'submitted, in_review, quoted → declined | customer | closeQuote',
      'submitted, in_review → cancelled | staff | closeQuote',
      'quoted → expired | system | expireQuotes',
      'quoted, expired → in_review | customer | reopenQuote',
    ]);
  });

  it('matches the table for every (from, to, actor)', () => {
    const wrong: string[] = [];
    let cells = 0;
    for (const actor of ACTORS) {
      const can = (from: QuoteStatus, to: QuoteStatus) => canQuoteTransition(from, to, actor);
      wrong.push(...wrongCells(actor, { from: QUOTE, to: QUOTE }, QUOTE_MOVES[actor], can));
      cells += QUOTE.length * QUOTE.length;
    }
    assert.deepEqual(wrong, []);
    assert.equal(cells, 5 * 49);
  });

  it('lists the allowed moves in table order', () => {
    for (const actor of ACTORS) {
      for (const from of QUOTE) {
        const expected = QUOTE_MOVES[actor][from] ?? [];
        assert.deepEqual(allowedQuoteTransitions(from, actor), expected, `${actor}, from ${from}`);
      }
    }
  });

  it('lets staff send a new offer over an open or expired one, but not over a closed quote', () => {
    assert.equal(canQuoteTransition('quoted', 'quoted', 'staff'), true);
    assert.equal(canQuoteTransition('expired', 'quoted', 'staff'), true);
    for (const from of ['accepted', 'declined', 'cancelled'] as const) {
      assert.equal(canQuoteTransition(from, 'quoted', 'staff'), false, from);
    }
    // Once an offer is out, staff cannot withdraw it: the customer answers or the offer runs out.
    assert.equal(canQuoteTransition('quoted', 'cancelled', 'staff'), false);
    assert.equal(canQuoteTransition('expired', 'cancelled', 'staff'), false);
  });

  it('lets the customer accept only an open offer', () => {
    assert.deepEqual(
      QUOTE.filter((from) => canQuoteTransition(from, 'accepted', 'customer')),
      ['quoted'],
    );
    assert.equal(canQuoteTransition('expired', 'accepted', 'customer'), false);
    assert.equal(canQuoteTransition('expired', 'in_review', 'customer'), true);
    assert.equal(canQuoteTransition('expired', 'declined', 'customer'), false);
  });

  it('is final once accepted, declined or cancelled', () => {
    for (const status of QUOTE) {
      const final = ['accepted', 'declined', 'cancelled'].includes(status);
      assert.equal(isFinalQuoteStatus(status), final, status);
      const moves = ACTORS.flatMap((actor) => allowedQuoteTransitions(status, actor));
      assert.equal(moves.length === 0, final, status);
    }
  });

  it('can reach every status from a submitted list', () => {
    const all = reachable<QuoteStatus>('submitted', (from) =>
      ACTORS.flatMap((actor) => allowedQuoteTransitions(from, actor)),
    );
    assert.deepEqual([...all].sort(), [...QUOTE].sort());
  });
});

describe('isQuoteOfferExpired', () => {
  const validUntil = NOON + 48 * HOUR;

  it('expires a quoted offer at the instant the expiry job would', () => {
    const quote = frozen({ status: 'quoted', offerValidUntil: validUntil } as const);
    assert.equal(isQuoteOfferExpired(quote, NOON), false);
    assert.equal(isQuoteOfferExpired(quote, validUntil - 1), false);
    assert.equal(isQuoteOfferExpired(quote, validUntil), true);
    assert.equal(isQuoteOfferExpired(quote, validUntil + 1), true);
  });

  it('is true for a quote the job already expired, whatever the clock says', () => {
    assert.equal(isQuoteOfferExpired({ status: 'expired', offerValidUntil: validUntil }, NOON), true);
    assert.equal(isQuoteOfferExpired({ status: 'expired', offerValidUntil: null }, NOON), true);
  });

  it('is false when there is no open offer to run out', () => {
    for (const status of ['submitted', 'in_review', 'accepted', 'declined', 'cancelled'] as const) {
      const old = { status, offerValidUntil: validUntil };
      assert.equal(isQuoteOfferExpired(old, validUntil + HOUR), false, status);
      assert.equal(isQuoteOfferExpired({ status, offerValidUntil: null }, NOON), false, status);
    }
    assert.equal(isQuoteOfferExpired({ status: 'quoted', offerValidUntil: null }, NOON), false);
  });
});

// ---------- issues (§2.6) ----------

const ISSUE_MOVES: Record<MachineActor, Moves<IssueStatus>> = {
  customer: {},
  supplier: {},
  driver: {},
  staff: {
    open: ['in_review', 'resolved'],
    in_review: ['resolved'],
  },
  system: {},
};

describe('issue machine', () => {
  it('reads like §2.6, row by row', () => {
    assert.deepEqual(ISSUE_TRANSITIONS.map(printRow), [
      'open → in_review | staff | direct_write',
      'open, in_review → resolved | staff | resolveIssue',
    ]);
  });

  it('matches the table for every (from, to, actor): only staff move an issue', () => {
    const wrong: string[] = [];
    let cells = 0;
    for (const actor of ACTORS) {
      const can = (from: IssueStatus, to: IssueStatus) => canIssueTransition(from, to, actor);
      wrong.push(...wrongCells(actor, { from: ISSUE, to: ISSUE }, ISSUE_MOVES[actor], can));
      cells += ISSUE.length * ISSUE.length;
    }
    assert.deepEqual(wrong, []);
    assert.equal(cells, 5 * 9);
  });

  it('never reopens a resolved issue', () => {
    for (const actor of ACTORS) {
      for (const to of ISSUE)
        assert.equal(canIssueTransition('resolved', to, actor), false, `${actor}: ${to}`);
    }
  });
});

describe('canReportIssue', () => {
  const completedAt = NOON;
  const windowMs = 48 * HOUR;

  it('is open for 48 hours after a delivery or a pickup', () => {
    assert.equal(ISSUE_WINDOW_HOURS, 48);
    for (const status of ['delivered', 'picked_up'] as const) {
      const storeOrder = frozen({ status, completedAt });
      assert.equal(canReportIssue(storeOrder, completedAt), true, status);
      assert.equal(canReportIssue(storeOrder, completedAt + HOUR), true, status);
      assert.equal(canReportIssue(storeOrder, completedAt + windowMs - 1), true, status);
      assert.equal(canReportIssue(storeOrder, completedAt + windowMs), true, status);
      assert.equal(canReportIssue(storeOrder, completedAt + windowMs + 1), false, status);
      assert.equal(canReportIssue(storeOrder, completedAt + 72 * HOUR), false, status);
    }
  });

  it('is closed for a store order that was not completed', () => {
    for (const status of STORE_ORDER) {
      const completed = status === 'delivered' || status === 'picked_up';
      assert.equal(canReportIssue({ status, completedAt }, completedAt + HOUR), completed, status);
      assert.equal(canReportIssue({ status, completedAt: null }, completedAt + HOUR), false, status);
    }
  });
});

// ---------- support threads (D11) ----------

describe('supportThreadId', () => {
  it('is the uid for a customer and store_{storeId} for a store', () => {
    assert.equal(supportThreadId('customer', 'uid_dana_whitfield'), 'uid_dana_whitfield');
    assert.equal(supportThreadId('store', 'kestrel-lumber'), 'store_kestrel-lumber');
  });

  it('refuses a kind it does not know instead of guessing an id', () => {
    const unknown = 'driver' as SupportThreadKind;
    assert.throws(() => supportThreadId(unknown, 'uid_marco'), /Unknown support thread kind: driver/);
  });
});
