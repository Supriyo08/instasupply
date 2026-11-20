/**
 * Payouts and support workflow (docs/PLATFORM.md §12.4, MARKETPLACE §13.3, owner `money-comms`):
 *
 * - the ledger writers of §9.1: sale and commission per settled store order (V1: Kestrel 18 772 at 9 % →
 *   17 083, Bluestone 14 086 at 10 % → 12 677), the replacement-ledger case of §9.2.12 (store not at fault →
 *   `sale_` and `commission_`; store at fault → `commission_` only), delivery, failed-attempt and
 *   cancellation pay (V1 4 775, V8 1 200), clawbacks (V5 −3 326), holds for an open issue; each written once;
 * - `runDailyPayouts`: nets entries, carries negatives over, skips held entries, a rerun with the same `now`
 *   creates nothing, a run interrupted after the payout insert is finished by the next run without paying
 *   twice, a definite refusal fails the payout and releases its entries, `stripe` mode skips payees without
 *   an account; the §12.3 case "payout run twice" (repeat and hold point `payouts:afterPayoutInsert`);
 * - support messages update summaries and unread counters and notify staff, the customer and every active
 *   store member; idempotent message ids; message pages;
 * - the `suggest` rate limit of `suggestStore`.
 *
 * Orders, store orders and issues are written straight into the tables with the keys the ledger reads, so
 * this file tests the money module on its own data.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import type {
  Delivery,
  FaultParty,
  LedgerBalance,
  LedgerEntry,
  Page,
  Payout,
  StoreOrderStatus,
  SupportMessage,
  SupportThread,
  WithId,
} from '@instasupply/shared';
import { withTransaction, type Tx } from '../../src/platform/db/tx';
import { ApiError } from '../../src/platform/http/errors';
import {
  recordClawback,
  recordDeliveryLedger,
  recordStoreOrderLedger,
  runDailyPayouts,
  runKeyOf,
} from '../../src/modules/payouts';
import {
  newAdmin,
  newCustomer,
  newDispatcher,
  newDriver,
  newSupplier,
  type ActorClient,
} from '../support/actors';
import { HOUR, MINUTE } from '../support/clock';
import { createTestContext, type TestContext } from '../support/database';
import { createAccount, createStore } from '../support/fixtures';
import { command, expectError, expectOk } from '../support/http';
import { hold, race, withTimeout } from '../support/race';

// ---------- fixtures ----------

let serial = 20000;

interface StoreOrderSpec {
  storeId: string;
  storeValueCents: number;
  commissionBps?: number;
  status?: StoreOrderStatus;
}

interface SettledOrder {
  orderId: string;
  number: string;
  storeOrderIds: string[];
}

async function insertSettledOrder(
  ctx: TestContext,
  input: {
    customerId: string;
    source?: 'cart' | 'quote' | 'replacement';
    issueId?: string | null;
    storeOrders: StoreOrderSpec[];
  },
): Promise<SettledOrder> {
  serial += 1;
  const now = ctx.clock.now();
  const orderId = randomUUID();
  const number = `IS-${serial}`;
  const source = input.source ?? 'cart';
  const total = input.storeOrders.reduce((sum, so) => sum + so.storeValueCents, 0);
  await ctx.pool.query(
    `INSERT INTO orders (id, doc, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $3)`,
    [
      orderId,
      JSON.stringify({
        number,
        customerId: input.customerId,
        source,
        issueId: input.issueId ?? null,
        status: 'completed',
        needsAttention: false,
        payment: { status: source === 'replacement' ? 'not_required' : 'captured' },
        current: { totalCents: source === 'replacement' ? 0 : total },
      }),
      new Date(now),
    ],
  );
  const storeOrderIds: string[] = [];
  for (const [index, so] of input.storeOrders.entries()) {
    const letter = 'ABCDE'[index]!;
    const id = `${orderId}-${letter}`;
    storeOrderIds.push(id);
    await ctx.pool.query(
      `INSERT INTO store_orders (id, doc, meta, created_at, updated_at) VALUES ($1, $2::jsonb, $3::jsonb, $4, $4)`,
      [
        id,
        JSON.stringify({
          number: `${number}-${letter}`,
          orderId,
          storeId: so.storeId,
          customerId: input.customerId,
          status: so.status ?? 'delivered',
          fulfilment: 'delivery',
          version: 6,
          timing: { respondBy: now, readyBy: now, readyByDate: '2026-11-19' },
          acceptOverdue: false,
          storeValueCents: so.storeValueCents,
          statusAt: { new: now - 600_000, accepted: now - 300_000 },
        }),
        JSON.stringify({
          pickupCode: null,
          pickupCodeIssuedTo: null,
          codeAttempts: 0,
          commissionBps: so.commissionBps ?? 1000,
          alertSmsSentAt: null,
        }),
        new Date(now),
      ],
    );
  }
  return { orderId, number, storeOrderIds };
}

/** An issue on a store order; `faultParty` set means it is resolved with that fault. */
async function insertIssue(
  ctx: TestContext,
  input: {
    customerId: string;
    storeId: string;
    orderId: string;
    storeOrderId: string;
    status?: 'open' | 'in_review' | 'resolved';
    faultParty?: FaultParty | null;
  },
): Promise<string> {
  serial += 1;
  const id = randomUUID();
  const now = ctx.clock.now();
  const status = input.status ?? (input.faultParty !== undefined ? 'resolved' : 'open');
  await ctx.pool.query(
    `INSERT INTO issues (id, doc, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $3)`,
    [
      id,
      JSON.stringify({
        number: `CASE-${serial}`,
        customerId: input.customerId,
        storeId: input.storeId,
        orderId: input.orderId,
        storeOrderId: input.storeOrderId,
        deliveryId: null,
        status,
        slaDueAt: now + 3_600_000,
        resolution:
          input.faultParty === undefined ? null : { kind: 'replacement', faultParty: input.faultParty },
      }),
      new Date(now),
    ],
  );
  return id;
}

/** A complete marketplace Delivery document (not stored: the ledger writer only reads the object). */
function deliveryDoc(overrides: Partial<Delivery> = {}): Delivery {
  const now = 1795109100000;
  return {
    id: randomUUID(),
    kind: 'marketplace',
    storeOrderId: null,
    storeId: 'kestrel-lumber',
    pickup: {
      storeId: 'kestrel-lumber',
      storeName: 'Kestrel Lumber Yard',
      address: 'Dixon Rd & Martin Grove Rd, Toronto',
      location: { lat: 43.6966, lng: -79.5752 },
      phone: '+14165550120',
      loadingNotes: null,
      readyBy: now,
      ready: true,
      readyAt: now,
      arrivedAt: null,
      collectedAt: null,
      pickupCode: null,
    },
    load: null,
    vehicleClass: 'pickup',
    tripKm: 26,
    cityIds: ['toronto'],
    receiving: 'attended',
    requirePhoto: true,
    unload: null,
    payout: {
      offerCents: 4775,
      baseCents: 1600,
      distanceCents: 2600,
      loadCents: 200,
      handlingCents: 360,
      boostCents: 0,
      waitCents: 0,
      totalCents: 4775,
    },
    offerStatus: 'claimed',
    offerOpensAt: null,
    releasedBy: {},
    orderId: 'IS-10001-B',
    customer: { name: 'Site Contact', phone: '+14165550110' },
    address: 'Pape Ave & Dundas St E, Toronto',
    location: { lat: 43.6648, lng: -79.3405 },
    addressNotes: null,
    notes: null,
    packageCount: 24,
    priority: 'high',
    requireCode: true,
    windowStart: null,
    windowEnd: now + 3_600_000,
    driverId: null,
    driverName: null,
    status: 'accepted',
    attempts: 0,
    sourceOrderId: null,
    customerId: null,
    proof: null,
    failure: null,
    createdBy: 'system',
    updatedBy: null,
    createdAt: now,
    updatedAt: now,
    acceptedAt: now,
    ...overrides,
  };
}

/** Runs `fn` in a transaction at the fake clock. */
const inTx = <T>(ctx: TestContext, fn: (tx: Tx) => Promise<T>): Promise<T> => withTransaction(ctx.deps, fn);

interface LedgerRowView {
  id: string;
  payee_type: string;
  payee_id: string;
  kind: string;
  amount_cents: number;
  payout_id: string | null;
  held_for_issue_id: string | null;
}

async function ledgerRows(ctx: TestContext, payeeId?: string): Promise<LedgerRowView[]> {
  const { rows } = await ctx.pool.query<LedgerRowView>(
    `SELECT id, payee_type, payee_id, kind, amount_cents, payout_id, held_for_issue_id FROM ledger_entries
      WHERE ($1::text IS NULL OR payee_id = $1) ORDER BY id`,
    [payeeId ?? null],
  );
  return rows;
}

interface NotificationView {
  user_id: string;
  type: string;
  title: string;
  body: string;
  dedupe_key: string | null;
  push_status: string;
}

async function notificationsOf(ctx: TestContext, filter: { type?: string; key?: string } = {}) {
  const { rows } = await ctx.pool.query<NotificationView>(
    `SELECT user_id, type, title, body, dedupe_key, push_status FROM notifications
      WHERE ($1::text IS NULL OR type = $1) AND ($2::text IS NULL OR dedupe_key = $2) ORDER BY created_at, id`,
    [filter.type ?? null, filter.key ?? null],
  );
  return rows;
}

const entryIds = (rows: LedgerRowView[]): string[] => rows.map((row) => row.id);
const byId = (rows: LedgerRowView[]): Map<string, LedgerRowView> => new Map(rows.map((row) => [row.id, row]));

async function payoutRows(ctx: TestContext): Promise<{ id: string; status: string }[]> {
  const { rows } = await ctx.pool.query<{ id: string; status: string }>(
    `SELECT id, status FROM payouts ORDER BY id`,
  );
  return rows;
}

async function payoutStatus(ctx: TestContext, id: string): Promise<string | null> {
  const { rows } = await ctx.pool.query<{ status: string }>(`SELECT status FROM payouts WHERE id = $1`, [id]);
  return rows[0]?.status ?? null;
}

// ---------- ledger ----------

describe('ledger entries (MARKETPLACE §3.9, PLATFORM §9.1)', () => {
  let ctx: TestContext;
  let customer: ActorClient;
  before(async () => {
    ctx = await createTestContext();
    customer = await newCustomer(ctx);
    await createStore(ctx, { id: 'bluestone-drywall', name: 'Bluestone Drywall & Paint' });
    await createStore(ctx, { id: 'kestrel-lumber', name: 'Kestrel Lumber Yard', commissionBps: 900 });
  });
  after(() => ctx.close());

  test('V1: sale and commission per delivered store order, written once', async () => {
    const order = await insertSettledOrder(ctx, {
      customerId: customer.uid,
      storeOrders: [
        { storeId: 'bluestone-drywall', storeValueCents: 14_086, commissionBps: 1000 },
        { storeId: 'kestrel-lumber', storeValueCents: 18_772, commissionBps: 900 },
      ],
    });
    await inTx(ctx, (tx) => recordStoreOrderLedger(tx, order.orderId));
    await inTx(ctx, (tx) => recordStoreOrderLedger(tx, order.orderId));
    const [a, b] = order.storeOrderIds as [string, string];
    const rows = byId(await ledgerRows(ctx));
    assert.equal(rows.get(`sale_${a}`)?.amount_cents, 14_086);
    assert.equal(rows.get(`commission_${a}`)?.amount_cents, -1_409);
    assert.equal(rows.get(`sale_${b}`)?.amount_cents, 18_772);
    assert.equal(rows.get(`commission_${b}`)?.amount_cents, -1_689);
    const bluestone = await ledgerRows(ctx, 'bluestone-drywall');
    assert.equal(bluestone.length, 2, 'a second call writes nothing');
    assert.equal(
      bluestone.reduce((sum, row) => sum + row.amount_cents, 0),
      12_677,
    );
    assert.equal(
      (await ledgerRows(ctx, 'kestrel-lumber')).reduce((sum, row) => sum + row.amount_cents, 0),
      17_083,
    );
  });

  test('only delivered and picked-up store orders are counted', async () => {
    const order = await insertSettledOrder(ctx, {
      customerId: customer.uid,
      storeOrders: [
        { storeId: 'bluestone-drywall', storeValueCents: 5_000, status: 'picked_up' },
        { storeId: 'kestrel-lumber', storeValueCents: 7_000, status: 'rejected' },
      ],
    });
    await inTx(ctx, (tx) => recordStoreOrderLedger(tx, order.orderId));
    const ids = entryIds(await ledgerRows(ctx));
    assert.ok(ids.includes(`sale_${order.storeOrderIds[0]}`));
    assert.ok(!ids.includes(`sale_${order.storeOrderIds[1]}`));
  });

  test('replacement ledger (§9.2.12): store not at fault → sale and commission; at fault → commission only', async () => {
    const original = await insertSettledOrder(ctx, {
      customerId: customer.uid,
      storeOrders: [{ storeId: 'bluestone-drywall', storeValueCents: 3_696 }],
    });
    const storeFault = await insertIssue(ctx, {
      customerId: customer.uid,
      storeId: 'bluestone-drywall',
      orderId: original.orderId,
      storeOrderId: original.storeOrderIds[0]!,
      faultParty: 'store',
    });
    const platformFault = await insertIssue(ctx, {
      customerId: customer.uid,
      storeId: 'bluestone-drywall',
      orderId: original.orderId,
      storeOrderId: original.storeOrderIds[0]!,
      faultParty: 'platform',
    });
    const atFault = await insertSettledOrder(ctx, {
      customerId: customer.uid,
      source: 'replacement',
      issueId: storeFault,
      storeOrders: [{ storeId: 'bluestone-drywall', storeValueCents: 3_696 }],
    });
    const notAtFault = await insertSettledOrder(ctx, {
      customerId: customer.uid,
      source: 'replacement',
      issueId: platformFault,
      storeOrders: [{ storeId: 'bluestone-drywall', storeValueCents: 3_696 }],
    });
    await inTx(ctx, async (tx) => {
      await recordStoreOrderLedger(tx, atFault.orderId);
      await recordStoreOrderLedger(tx, notAtFault.orderId);
    });
    const rows = byId(await ledgerRows(ctx));
    assert.equal(rows.has(`sale_${atFault.storeOrderIds[0]}`), false, 'no sale when the store was at fault');
    assert.equal(rows.get(`commission_${atFault.storeOrderIds[0]}`)?.amount_cents, -370);
    assert.equal(rows.get(`sale_${notAtFault.storeOrderIds[0]}`)?.amount_cents, 3_696);
    assert.equal(rows.get(`commission_${notAtFault.storeOrderIds[0]}`)?.amount_cents, -370);
  });

  test('an open issue holds the new entries of its store order', async () => {
    const order = await insertSettledOrder(ctx, {
      customerId: customer.uid,
      storeOrders: [{ storeId: 'kestrel-lumber', storeValueCents: 10_000, commissionBps: 900 }],
    });
    const issueId = await insertIssue(ctx, {
      customerId: customer.uid,
      storeId: 'kestrel-lumber',
      orderId: order.orderId,
      storeOrderId: order.storeOrderIds[0]!,
    });
    await inTx(ctx, (tx) => recordStoreOrderLedger(tx, order.orderId));
    const rows = byId(await ledgerRows(ctx));
    assert.equal(rows.get(`sale_${order.storeOrderIds[0]}`)?.held_for_issue_id, issueId);
    assert.equal(rows.get(`commission_${order.storeOrderIds[0]}`)?.held_for_issue_id, issueId);
  });

  test('driver pay: delivered once per attempt, site-caused failures, cancellation after check-in', async () => {
    const driverId = randomUUID();
    const delivered = deliveryDoc({ driverId, status: 'delivered' });
    const accepted = { ...delivered, status: 'in_transit' as const };
    await inTx(ctx, (tx) => recordDeliveryLedger(tx, accepted, delivered));
    await inTx(ctx, (tx) => recordDeliveryLedger(tx, accepted, delivered));
    await inTx(ctx, (tx) => recordDeliveryLedger(tx, delivered, delivered));

    const siteFailed = deliveryDoc({
      driverId,
      status: 'failed',
      failure: { reason: 'no_one_on_site', note: null },
      payout: { ...deliveryDoc().payout!, boostCents: 500, totalCents: 5_275 },
    });
    await inTx(ctx, (tx) => recordDeliveryLedger(tx, { ...siteFailed, status: 'arrived' }, siteFailed));
    // The re-attempt is attempt 2: its delivery entry has its own id.
    const reattempted = { ...siteFailed, status: 'delivered' as const, attempts: 1, failure: null };
    await inTx(ctx, (tx) => recordDeliveryLedger(tx, { ...reattempted, status: 'arrived' }, reattempted));

    const driverFailed = deliveryDoc({
      driverId,
      status: 'failed',
      failure: { reason: 'vehicle_issue', note: null },
    });
    await inTx(ctx, (tx) =>
      recordDeliveryLedger(tx, { ...driverFailed, status: 'in_transit' }, driverFailed),
    );

    // V8: cancelled after check-in on a 4 775 offer → 1 200; cancelled 5 minutes after accepting → nothing.
    const now = ctx.clock.now();
    const checkedIn = deliveryDoc({
      driverId,
      status: 'cancelled',
      acceptedAt: now - 5 * MINUTE,
      cancelledAt: now,
      pickup: { ...deliveryDoc().pickup!, arrivedAt: now - 2 * MINUTE },
    });
    await inTx(ctx, (tx) => recordDeliveryLedger(tx, { ...checkedIn, status: 'accepted' }, checkedIn));
    const early = deliveryDoc({
      driverId,
      status: 'cancelled',
      acceptedAt: now - 5 * MINUTE,
      cancelledAt: now,
    });
    await inTx(ctx, (tx) => recordDeliveryLedger(tx, { ...early, status: 'accepted' }, early));
    const manual = deliveryDoc({ driverId, status: 'delivered', kind: 'manual', payout: null });
    await inTx(ctx, (tx) => recordDeliveryLedger(tx, { ...manual, status: 'arrived' }, manual));

    const rows = byId(await ledgerRows(ctx, driverId));
    assert.deepEqual(
      [...rows.keys()].sort(),
      [
        `cancel_${checkedIn.id}`,
        `delivery_${delivered.id}_1`,
        `delivery_${siteFailed.id}_2`,
        `failed_${siteFailed.id}_1`,
      ].sort(),
    );
    assert.equal(rows.get(`delivery_${delivered.id}_1`)?.amount_cents, 4_775);
    assert.equal(rows.get(`failed_${siteFailed.id}_1`)?.amount_cents, 5_275, 'offer + boost');
    assert.equal(rows.get(`cancel_${checkedIn.id}`)?.amount_cents, 1_200);
    assert.equal(rows.get(`delivery_${delivered.id}_1`)?.kind, 'delivery');
  });

  test('V5: a clawback is the negative of the cost, once, never held', async () => {
    const order = await insertSettledOrder(ctx, {
      customerId: customer.uid,
      storeOrders: [{ storeId: 'bluestone-drywall', storeValueCents: 14_086 }],
    });
    const issueId = await insertIssue(ctx, {
      customerId: customer.uid,
      storeId: 'bluestone-drywall',
      orderId: order.orderId,
      storeOrderId: order.storeOrderIds[0]!,
    });
    const input = {
      issueId,
      payeeType: 'store' as const,
      payeeId: 'bluestone-drywall',
      amountCents: 3_326,
      description: 'Clawback CASE-10001',
    };
    await inTx(ctx, (tx) => recordClawback(tx, input));
    await inTx(ctx, (tx) => recordClawback(tx, { ...input, amountCents: -3_326 }));
    const row = byId(await ledgerRows(ctx)).get(`clawback_${issueId}`);
    assert.equal(row?.amount_cents, -3_326);
    assert.equal(row?.kind, 'clawback');
    assert.equal(row?.held_for_issue_id, null);
    await inTx(ctx, (tx) => recordClawback(tx, { ...input, issueId: randomUUID(), amountCents: 0 }));
    assert.equal((await ledgerRows(ctx)).filter((r) => r.kind === 'clawback').length, 1, '0 writes nothing');
  });
});

// ---------- the daily run ----------

/** Unpaid entries for a payee, written with the ledger's own insert through recordClawback-like rows. */
async function addEntry(
  ctx: TestContext,
  payeeType: 'store' | 'driver',
  payeeId: string,
  amountCents: number,
  opts: { held?: string | null; id?: string } = {},
): Promise<string> {
  const id = opts.id ?? `adjustment_${randomUUID()}`;
  await ctx.pool.query(
    `INSERT INTO ledger_entries (id, payee_type, payee_id, kind, amount_cents, description, held_for_issue_id,
                                 created_at)
     VALUES ($1, $2, $3, $4, $5, 'test entry', $6, $7)`,
    [
      id,
      payeeType,
      payeeId,
      amountCents >= 0 ? 'adjustment' : 'clawback',
      amountCents,
      opts.held ?? null,
      new Date(ctx.clock.now()),
    ],
  );
  return id;
}

describe('runDailyPayouts (MARKETPLACE §3.9, PLATFORM §9.5)', () => {
  let ctx: TestContext;
  let owner: ActorClient & { storeId: string };
  let storeStaff: ActorClient;
  let driver: ActorClient;
  before(async () => {
    ctx = await createTestContext();
    owner = await newSupplier(ctx, { store: { id: 'kestrel-lumber', name: 'Kestrel Lumber Yard' } });
    storeStaff = await newSupplier(ctx, { storeId: owner.storeId, storeRole: 'staff' });
    driver = await newDriver(ctx);
    await newDispatcher(ctx);
    await createStore(ctx, { id: 'negative-store', name: 'Negative Store' });
  });
  after(() => ctx.close());

  test('nets entries, carries negatives over, skips held entries; the transfer pays and notifies', async () => {
    const now = ctx.clock.now();
    const storeEntries = [
      await addEntry(ctx, 'store', owner.storeId, 18_772),
      await addEntry(ctx, 'store', owner.storeId, -1_689),
    ];
    const held = await addEntry(ctx, 'store', owner.storeId, 9_999, { held: randomUUID() });
    const driverEntry = await addEntry(ctx, 'driver', driver.uid, 4_775);
    await addEntry(ctx, 'store', 'negative-store', 1_000);
    await addEntry(ctx, 'store', 'negative-store', -3_326);

    const result = await ctx.runJob('runDailyPayouts', now);
    assert.deepEqual(result, {
      payees: 3,
      payouts: 2,
      carriedOver: 1,
      skippedNoAccount: 0,
      resumed: 0,
      errors: 0,
    });
    const runKey = runKeyOf(now);
    assert.equal(runKey, '20261119-1225');
    const storePayoutId = `store_${owner.storeId}_${runKey}`;
    const driverPayoutId = `driver_${driver.uid}_${runKey}`;

    const rows = byId(await ledgerRows(ctx));
    for (const id of storeEntries) assert.equal(rows.get(id)?.payout_id, storePayoutId);
    assert.equal(rows.get(held)?.payout_id, null, 'held entries are skipped');
    assert.equal(rows.get(driverEntry)?.payout_id, driverPayoutId);
    for (const row of await ledgerRows(ctx, 'negative-store'))
      assert.equal(row.payout_id, null, 'carried over');

    const pending = await expectOk(owner.get<WithId<Payout>>(`/payouts/${storePayoutId}`));
    assert.equal(pending.status, 'pending');
    assert.equal(pending.netCents, 17_083);
    assert.equal(pending.creditsCents, 18_772);
    assert.equal(pending.debitsCents, 1_689);
    assert.equal(pending.periodDate, '2026-11-19');
    assert.deepEqual([...pending.entryIds].sort(), [...storeEntries].sort());

    await ctx.drainOutbox();
    const transfers = ctx.gateway.of('transfer');
    assert.deepEqual(
      transfers.map((call) => call.input.idempotencyKey).sort(),
      [`payout_${driverPayoutId}`, `payout_${storePayoutId}`].sort(),
    );
    assert.equal(transfers.find((t) => t.input.payeeType === 'store')?.input.amountCents, 17_083);
    const paid = await expectOk(owner.get<WithId<Payout>>(`/payouts/${storePayoutId}`));
    assert.equal(paid.status, 'paid');
    assert.match(paid.reference ?? '', /^test_tr_/);
    assert.equal(paid.paidAt, now);

    const sent = await notificationsOf(ctx, { type: 'payout_sent' });
    assert.deepEqual(
      sent.map((n) => n.user_id).sort(),
      [driver.uid, owner.uid].sort(),
      'owners and the driver only',
    );
    assert.ok(!sent.some((n) => n.user_id === storeStaff.uid));
    assert.equal(sent.find((n) => n.user_id === owner.uid)?.title, 'Payout $170.83 for Thu, Nov 19');
    assert.equal(sent.find((n) => n.user_id === owner.uid)?.dedupe_key, `payout-${storePayoutId}`);

    const balance = await expectOk(owner.get<LedgerBalance>('/ledger/balance'));
    assert.deepEqual(balance, {
      payeeType: 'store',
      payeeId: owner.storeId,
      unpaidCents: 0,
      unpaidCount: 0,
      heldCents: 9_999,
      heldCount: 1,
      lastPaidAt: now,
    });
    const unpaid = await expectOk(
      owner.get<Page<WithId<LedgerEntry>>>('/ledger-entries?unpaid=true&held=true'),
    );
    assert.deepEqual(
      unpaid.items.map((e) => e.id),
      [held],
    );
  });

  test('a rerun with the same now creates nothing and transfers nothing again', async () => {
    const now = ctx.clock.now();
    const before = (await payoutRows(ctx)).length;
    const transfers = ctx.gateway.of('transfer').length;
    const result = await ctx.runJob('runDailyPayouts', now);
    assert.equal(result.payouts, 0);
    await ctx.drainOutbox();
    assert.equal((await payoutRows(ctx)).length, before);
    assert.equal(ctx.gateway.of('transfer').length, transfers);
  });

  test('a run interrupted after the payout insert is finished by the next run without paying twice', async () => {
    ctx.clock.advance(HOUR);
    const now = ctx.clock.now();
    const entry = await addEntry(ctx, 'driver', driver.uid, 2_000);
    const first = await ctx.runJob('runDailyPayouts', now);
    assert.equal(first.payouts, 1);
    const payoutId = `driver_${driver.uid}_${runKeyOf(now)}`;
    // The instance died before the transfer ran and its outbox row is lost.
    await ctx.pool.query(`DELETE FROM outbox WHERE event = 'payout.transfer' AND status = 'pending'`);

    ctx.clock.advance(DAY_MS);
    const second = await ctx.runJob('runDailyPayouts', ctx.clock.now());
    assert.equal(second.resumed, 1);
    assert.equal(second.payouts, 0, 'the stamped entry is not counted again');
    await ctx.drainOutbox();
    // A third run resumes nothing: the payout is paid.
    assert.equal((await ctx.runJob('runDailyPayouts', ctx.clock.now())).resumed, 0);
    await ctx.drainOutbox();

    const calls = ctx.gateway
      .of('transfer')
      .filter((call) => call.input.idempotencyKey === `payout_${payoutId}`);
    assert.equal(calls.length, 1, 'one transfer');
    assert.equal(byId(await ledgerRows(ctx)).get(entry)?.payout_id, payoutId);
    assert.equal(await payoutStatus(ctx, payoutId), 'paid');
  });

  test('a definite refusal fails the payout, releases its entries for the next run and alerts staff', async () => {
    ctx.clock.advance(DAY_MS);
    const now = ctx.clock.now();
    const entry = await addEntry(ctx, 'driver', driver.uid, 3_100);
    const original = ctx.gateway.transfer.bind(ctx.gateway);
    ctx.gateway.transfer = async () => {
      throw new ApiError('failed-precondition', 'The account was closed.');
    };
    try {
      assert.equal((await ctx.runJob('runDailyPayouts', now)).payouts, 1);
      await ctx.drainOutbox();
    } finally {
      ctx.gateway.transfer = original;
    }
    const payoutId = `driver_${driver.uid}_${runKeyOf(now)}`;
    assert.equal(await payoutStatus(ctx, payoutId), 'failed');
    assert.equal(byId(await ledgerRows(ctx)).get(entry)?.payout_id, null, 'released');
    assert.ok((await notificationsOf(ctx, { key: `payout-failed-${payoutId}` })).length > 0, 'staff alerted');

    ctx.clock.advance(DAY_MS);
    const next = await ctx.runJob('runDailyPayouts', ctx.clock.now());
    assert.equal(next.payouts, 1);
    await ctx.drainOutbox();
    const repaid = `driver_${driver.uid}_${runKeyOf(ctx.clock.now())}`;
    assert.equal(byId(await ledgerRows(ctx)).get(entry)?.payout_id, repaid);
  });

  test('payout run twice at once (§12.3): one payout per payee, every entry stamped once, one transfer', async () => {
    await race({
      times: 25,
      setup: async (round) => {
        ctx.clock.advance(MINUTE);
        const payee = `race-${round}-${randomUUID().slice(0, 8)}`;
        const ids = [
          await addEntry(ctx, 'driver', payee, 1_000),
          await addEntry(ctx, 'driver', payee, 2_500),
          await addEntry(ctx, 'driver', payee, -500),
        ];
        return { payee, ids, now: ctx.clock.now() };
      },
      run: (state) => [
        () => runDailyPayouts(ctx.deps, state.now),
        () => runDailyPayouts(ctx.deps, state.now),
      ],
      check: async (results, state) => {
        assert.equal(
          results.reduce((sum, r) => sum + r.errors, 0),
          0,
        );
        const { rows } = await ctx.pool.query<{ id: string; net_cents: number }>(
          `SELECT id, net_cents FROM payouts WHERE payee_id = $1`,
          [state.payee],
        );
        assert.equal(rows.length, 1);
        assert.equal(rows[0]!.net_cents, 3_000);
        const stamped = await ledgerRows(ctx, state.payee);
        assert.ok(stamped.every((row) => row.payout_id === rows[0]!.id));
        await ctx.drainOutbox();
        const transfers = ctx.gateway
          .of('transfer')
          .filter((call) => call.input.idempotencyKey === `payout_${rows[0]!.id}`);
        assert.equal(transfers.length, 1);
      },
    });
  });

  test('payout run twice, held at payouts:afterPayoutInsert: the second run waits and creates nothing', async () => {
    ctx.clock.advance(MINUTE);
    const now = ctx.clock.now();
    const payee = `held-${randomUUID().slice(0, 8)}`;
    await addEntry(ctx, 'driver', payee, 4_200);
    const gate = hold(ctx, 'payouts:afterPayoutInsert');
    const first = runDailyPayouts(ctx.deps, now);
    await gate.reached();
    const second = runDailyPayouts(ctx.deps, now);
    // The second run reaches the entry lock and waits for the first transaction.
    await new Promise((resolve) => setTimeout(resolve, 200));
    gate.release();
    const [a, b] = await withTimeout(Promise.all([first, second]), 10_000, 'the runs did not finish');
    assert.equal(a.errors + b.errors, 0);
    const { rows } = await ctx.pool.query(`SELECT id FROM payouts WHERE payee_id = $1`, [payee]);
    assert.equal(rows.length, 1);
  });
});

const DAY_MS = 24 * HOUR;

describe('runDailyPayouts in stripe mode: a payee without a payout account carries over', () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await createTestContext();
    await newDispatcher(ctx);
    await createStore(ctx, { id: 'no-account-store', name: 'No Account' });
    await ctx.pool.query(
      `UPDATE stores SET settings = settings - 'payoutAccount' WHERE id = 'no-account-store'`,
    );
  });
  after(() => ctx.close());

  test('skippedNoAccount and one staff alert per run', async () => {
    // The configuration refuses PAYMENTS_MODE=stripe until the Stripe gateway exists (§11.1), so the job body
    // is called with a stripe configuration directly.
    const deps = { ...ctx.deps, config: { ...ctx.deps.config, PAYMENTS_MODE: 'stripe' as const } };
    const entry = await addEntry(ctx, 'store', 'no-account-store', 5_000);
    const now = ctx.clock.now();
    const result = await runDailyPayouts(deps, now);
    assert.equal(result.skippedNoAccount, 1);
    assert.equal(result.payouts, 0);
    assert.equal(byId(await ledgerRows(ctx)).get(entry)?.payout_id, null);
    await runDailyPayouts(deps, now);
    const alerts = await notificationsOf(ctx, { key: `payout-skipped-${runKeyOf(now)}` });
    assert.equal(alerts.length, 1, 'one alert per staff member per run');
  });
});

// ---------- support ----------

describe('support threads (MARKETPLACE D11, PLATFORM §9.4 onSupportMessageCreated)', () => {
  let ctx: TestContext;
  let customer: ActorClient;
  let dispatcher: ActorClient;
  let admin: ActorClient;
  let owner: ActorClient & { storeId: string };
  let storeStaff: ActorClient;
  let suspendedMember: string;
  before(async () => {
    ctx = await createTestContext();
    customer = await newCustomer(ctx, {
      displayName: 'Dana Whitfield',
      doc: { companyName: 'Whitfield Renovations' },
    });
    dispatcher = await newDispatcher(ctx, { displayName: 'Riley Chen' });
    admin = await newAdmin(ctx, { displayName: 'Morgan Lee' });
    owner = await newSupplier(ctx, { store: { id: 'kestrel-lumber', name: 'Kestrel Lumber Yard' } });
    storeStaff = await newSupplier(ctx, { storeId: owner.storeId, storeRole: 'staff' });
    suspendedMember = (
      await createAccount(ctx, {
        role: 'supplier',
        storeId: owner.storeId,
        storeRole: 'staff',
        status: 'suspended',
      })
    ).uid;
  });
  after(() => ctx.close());

  const post = (actor: ActorClient, threadId: string, text: string, id: string = randomUUID()) =>
    actor.post<SupportMessage>(`/support-threads/${threadId}/messages`, { id, text, context: null });

  test('a customer message creates the thread, counts as unread for staff and notifies staff', async () => {
    const id = randomUUID();
    const message = await expectOk(
      customer.post<SupportMessage>(`/support-threads/${customer.uid}/messages`, {
        id,
        text: '  Where is   my order?  ',
        context: { kind: 'order', id: 'abc', label: 'IS-10001' },
      }),
    );
    assert.equal(message.senderRole, 'customer');
    assert.equal(message.text, 'Where is my order?');
    assert.equal(message.senderName, 'Dana Whitfield');
    const thread = await expectOk(customer.get<WithId<SupportThread>>(`/support-threads/${customer.uid}`));
    assert.equal(thread.kind, 'customer');
    assert.equal(thread.ownerName, 'Dana Whitfield');
    assert.equal(thread.companyName, 'Whitfield Renovations');
    assert.equal(thread.unreadByStaff, 1);
    assert.equal(thread.unreadByOwner, 0);
    assert.deepEqual(thread.context, { kind: 'order', id: 'abc', label: 'IS-10001' });
    assert.deepEqual(thread.lastMessage, {
      text: 'Where is my order?',
      senderRole: 'customer',
      at: ctx.clock.now(),
    });
    const staffNotes = await notificationsOf(ctx, { key: `support-${id}` });
    assert.deepEqual(staffNotes.map((n) => n.user_id).sort(), [admin.uid, dispatcher.uid].sort());
    assert.ok(staffNotes.every((n) => n.type === 'support_message'));

    // The same id again: the stored message, nothing else written.
    const again = await expectOk(
      customer.post<SupportMessage>(`/support-threads/${customer.uid}/messages`, {
        id,
        text: 'Where is my order?',
        context: null,
      }),
    );
    assert.deepEqual(again, message);
    const after = await expectOk(customer.get<WithId<SupportThread>>(`/support-threads/${customer.uid}`));
    assert.equal(after.unreadByStaff, 1);
    assert.equal((await notificationsOf(ctx, { key: `support-${id}` })).length, 2);
  });

  test('a staff reply notifies the customer; each side resets only its own counter', async () => {
    const id = randomUUID();
    const reply = await expectOk(post(dispatcher, customer.uid, 'It is on the way.', id));
    assert.equal(reply.senderRole, 'staff');
    const thread = await expectOk(dispatcher.get<WithId<SupportThread>>(`/support-threads/${customer.uid}`));
    assert.equal(thread.unreadByOwner, 1);
    assert.equal(thread.unreadByStaff, 1);
    const toCustomer = await notificationsOf(ctx, { key: `support-${id}` });
    assert.deepEqual(
      toCustomer.map((n) => [n.user_id, n.type]),
      [[customer.uid, 'support_reply']],
    );

    await expectOk(customer.post(`/support-threads/${customer.uid}/read`), 204);
    let now = await expectOk(dispatcher.get<WithId<SupportThread>>(`/support-threads/${customer.uid}`));
    assert.equal(now.unreadByOwner, 0);
    assert.equal(now.unreadByStaff, 1, 'the owner cannot reset the staff counter');
    assert.equal(now.ownerReadAt, ctx.clock.now());
    await expectOk(dispatcher.post(`/support-threads/${customer.uid}/read`), 204);
    now = await expectOk(dispatcher.get<WithId<SupportThread>>(`/support-threads/${customer.uid}`));
    assert.equal(now.unreadByStaff, 0);
  });

  test('a staff reply in a store thread notifies every active member of the store', async () => {
    const threadId = `store_${owner.storeId}`;
    const inbound = await expectOk(post(storeStaff, threadId, 'Can you call us about IS-10001-B?'));
    assert.equal(inbound.senderRole, 'supplier');
    const id = randomUUID();
    await expectOk(post(admin, threadId, 'Calling you now.', id));
    const notes = await notificationsOf(ctx, { key: `support-${id}` });
    assert.deepEqual(notes.map((n) => n.user_id).sort(), [owner.uid, storeStaff.uid].sort());
    assert.ok(!notes.some((n) => n.user_id === suspendedMember));
    const thread = await expectOk(owner.get<WithId<SupportThread>>(`/support-threads/${threadId}`));
    assert.equal(thread.kind, 'store');
    assert.equal(thread.ownerId, owner.storeId);
    assert.equal(thread.ownerName, 'Kestrel Lumber Yard');
    assert.equal(thread.unreadByOwner, 1);
  });

  test('staff resolve and assign; a new owner message reopens the thread', async () => {
    const patched = await expectOk(
      dispatcher.patch<WithId<SupportThread>>(`/support-threads/${customer.uid}`, {
        status: 'resolved',
        assignedTo: dispatcher.uid,
      }),
    );
    assert.equal(patched.status, 'resolved');
    assert.equal(patched.assignedTo, dispatcher.uid);
    assert.equal(patched.assignedName, 'Riley Chen');
    await expectError(
      dispatcher.patch(`/support-threads/${customer.uid}`, { assignedTo: customer.uid }),
      'invalid-argument',
    );
    await expectOk(post(customer, customer.uid, 'One more thing.'));
    const reopened = await expectOk(
      dispatcher.get<WithId<SupportThread>>(`/support-threads/${customer.uid}`),
    );
    assert.equal(reopened.status, 'open');
    const list = await expectOk(
      dispatcher.get<Page<WithId<SupportThread>>>('/support-threads?kind=customer&unread=true'),
    );
    assert.deepEqual(
      list.items.map((t) => t.id),
      [customer.uid],
    );
  });

  test('messages page newest first into the past, each page oldest first', async () => {
    const threadId = `store_${owner.storeId}`;
    for (let i = 0; i < 5; i += 1) {
      ctx.clock.advance(1000);
      await expectOk(post(owner, threadId, `message ${i}`));
    }
    const first = await expectOk(
      owner.get<Page<SupportMessage>>(`/support-threads/${threadId}/messages?limit=3`),
    );
    assert.deepEqual(
      first.items.map((m) => m.text),
      ['message 2', 'message 3', 'message 4'],
    );
    assert.ok(first.nextCursor);
    const second = await expectOk(
      owner.get<Page<SupportMessage>>(
        `/support-threads/${threadId}/messages?limit=3&cursor=${encodeURIComponent(first.nextCursor)}`,
      ),
    );
    assert.deepEqual(
      second.items.map((m) => m.text),
      ['Calling you now.', 'message 0', 'message 1'],
    );
  });

  test('a message id used by someone else is already-exists', async () => {
    const id = randomUUID();
    await expectOk(post(customer, customer.uid, 'mine', id));
    await expectError(post(owner, `store_${owner.storeId}`, 'mine too', id), 'already-exists');
  });
});

describe('suggestStore rate limit (§4.6 suggest: 5 per hour)', () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await createTestContext({ env: { RATE_LIMITS_DISABLED: 'false' } });
    await newDispatcher(ctx);
  });
  after(() => ctx.close());

  test('a guest gets 5 suggestions an hour, then RATE_LIMITED with retryAfterMs; the window resets', async () => {
    const body = { storeName: 'Danforth Hardware', city: 'Toronto', interests: [], email: null };
    for (let i = 0; i < 5; i += 1) await expectOk(command(ctx, 'suggestStore', body));
    const envelope = await expectError(
      command(ctx, 'suggestStore', body),
      'resource-exhausted',
      'RATE_LIMITED',
    );
    assert.ok(typeof envelope.details.retryAfterMs === 'number' && envelope.details.retryAfterMs > 0);
    const { rows } = await ctx.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM store_suggestions`,
    );
    assert.equal(rows[0]!.count, 5);
    ctx.clock.advance(HOUR + 1000);
    await expectOk(command(ctx, 'suggestStore', body));
  });
});
