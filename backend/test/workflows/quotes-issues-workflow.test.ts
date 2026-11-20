/**
 * Quotes and issues workflow (docs/PLATFORM.md §12.4, MARKETPLACE §13.3): submit (attachment checks) → send →
 * accept at quoted prices with a custom line; version and expiry errors; expireQuotes through runJob; reopen;
 * close; the issue window and one open issue per store order; refund after capture (V5) and credit before
 * capture; clawback per fault; replacement order; the dispatcher refund limit; and the concurrency cases
 * "accept a quote twice" (§12.3) and two reports on one store order.
 *
 * Orders go through the real commands: placeOrder (pickup, so no driver is needed), the store accepts and
 * readies them, staff hand them over, and draining the outbox captures the payment.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import {
  percentBps,
  type Issue,
  type Order,
  type Page,
  type PlaceOrderResponse,
  type Quote,
  type ReportIssueResponse,
  type ResolveIssueResponse,
  type StoreOrder,
  type SubmitMaterialListResponse,
} from '@instasupply/shared';
import { as, newCustomer, type ActorClient } from '../support/actors';
import { DAY, HOUR, MINUTE } from '../support/clock';
import { createTestContext, type TestContext } from '../support/database';
import { createCard, seedAccounts } from '../support/fixtures';
import { expectError, expectOk, type ErrorBody } from '../support/http';
import { outboxEvents } from '../support/outbox';
import { together } from '../support/race';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(48, 3),
]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);

const DRYWALL = 'bluestone-drywall--bdp-dw12';
const COMPOUND = 'bluestone-drywall--bdp-jc17';
const STUD = 'kestrel-lumber--kly-spf248';
const OSB = 'kestrel-lumber--kly-osb716';

let ctx: TestContext;
let dana: ActorClient;
let dispatcher: ActorClient;
let admin: ActorClient;
let bluestone: ActorClient;

async function cardOf(uid: string, last4 = '4242'): Promise<string> {
  const { rows } = await ctx.pool.query<{ id: string }>(
    'SELECT id FROM cards WHERE user_id = $1 AND last4 = $2 ORDER BY created_at LIMIT 1',
    [uid, last4],
  );
  if (rows[0]) return rows[0].id;
  return (await createCard(ctx, uid, { last4, isDefault: true })).id;
}

/** presign → upload → confirm (docs/PLATFORM.md §10.1); returns the confirmed path. */
async function upload(
  actor: ActorClient,
  purpose: 'quote_upload' | 'issue_photo',
  ownerId: string,
  file: { bytes: Buffer; contentType: string; name: string },
): Promise<string> {
  const ticket = await expectOk(
    actor.post<{ uploadId: string }>('/files/presign', {
      purpose,
      ownerId,
      fileName: file.name,
      contentType: file.contentType,
      sizeBytes: file.bytes.length,
    }),
  );
  await ctx.deps.storage.put(`uploads/${ticket.uploadId}`, file.bytes, file.contentType);
  const confirmed = await expectOk(
    actor.post<{ path: string }>('/files/confirm', { uploadId: ticket.uploadId }),
  );
  return confirmed.path;
}

/** placeOrder for pickup at the price the server quotes (the first call learns it through PRICE_CHANGED). */
async function placePickup(
  customer: ActorClient,
  items: { productId: string; storeId: string; quantity: number }[],
): Promise<PlaceOrderResponse> {
  const body = {
    checkoutId: randomUUID(),
    items,
    fulfilment: 'pickup',
    jobsiteId: null,
    windowId: null,
    receiving: null,
    siteContact: null,
    instructions: null,
    unloadHelpStoreIds: [],
    cardId: await cardOf(customer.uid),
    promoCode: null,
    expectedTotalCents: 1,
  };
  const first = await customer.call<ErrorBody>('placeOrder', body);
  assert.equal(first.body.error?.code, 'PRICE_CHANGED', JSON.stringify(first.body));
  const pricing = first.body.error.details.pricing as { totalCents: number };
  return expectOk(
    customer.call<PlaceOrderResponse>('placeOrder', { ...body, expectedTotalCents: pricing.totalCents }),
  );
}

async function storeOrder(id: string): Promise<StoreOrder> {
  return expectOk(admin.get<StoreOrder>(`/store-orders/${id}`));
}

/**
 * The store accepts (shorting lines when `adjustments` says so) and readies the order; staff hand it over
 * (override, no PIN needed in a test).
 */
async function completePickup(
  storeOrderId: string,
  adjustments?: { lineId: string; fulfilledQty: number; reason: string }[],
): Promise<void> {
  let so = await storeOrder(storeOrderId);
  const accepted = await expectOk(
    admin.call<{ version: number }>('acceptStoreOrder', {
      storeOrderId,
      expectedVersion: so.version,
      ...(adjustments ? { adjustments } : {}),
    }),
  );
  const ready = await expectOk(
    admin.call<{ version: number }>('updateStoreOrderStatus', {
      storeOrderId,
      expectedVersion: accepted.version,
      status: 'ready',
    }),
  );
  await expectOk(
    admin.call('completePickup', {
      storeOrderId,
      expectedVersion: ready.version,
      pickupCode: null,
      overrideReason: 'Test hand-over',
    }),
  );
  so = await storeOrder(storeOrderId);
  assert.equal(so.status, 'picked_up');
}

async function completeOrder(placed: PlaceOrderResponse): Promise<void> {
  for (const so of placed.storeOrders) await completePickup(so.storeOrderId);
}

async function order(id: string): Promise<Order> {
  return expectOk(admin.get<Order>(`/orders/${id}`));
}

async function ledger(storeOrderId: string) {
  const { rows } = await ctx.pool.query<{
    id: string;
    kind: string;
    payee_type: string;
    payee_id: string;
    amount_cents: number;
    held_for_issue_id: string | null;
  }>(
    `SELECT id, kind, payee_type, payee_id, amount_cents, held_for_issue_id FROM ledger_entries
      WHERE store_order_id = $1 ORDER BY id`,
    [storeOrderId],
  );
  return rows;
}

function materialList(requestId: string, overrides: Record<string, unknown> = {}) {
  return {
    requestId,
    lines: [
      { text: '10 sheets of 1/2 in drywall', quantity: 10 },
      { text: 'LVL beam 1-3/4 x 11-7/8, 20 ft', quantity: 1 },
    ],
    attachments: [],
    neededBy: { kind: 'this_week', date: null },
    fulfilment: 'pickup',
    jobsiteId: null,
    contact: { preferred: 'call', phone: '+14165550110', email: null },
    notes: 'Back lane access.',
    ...overrides,
  };
}

const LVL = {
  kind: 'custom',
  storeId: 'kestrel-lumber',
  name: 'LVL beam 1-3/4 x 11-7/8, 20 ft',
  unit: 'each',
  size: '1-3/4 in × 11-7/8 in × 20 ft',
  quantity: 1,
  unitPriceCents: 18_999,
  weightKg: 40,
  dimsCm: { l: 610, w: 5, h: 30 },
  note: 'Special order, 2 days',
  requestLine: 1,
} as const;

function sendBody(quoteId: string, expectedVersion: number, overrides: Record<string, unknown> = {}) {
  return {
    quoteId,
    expectedVersion,
    lines: [
      {
        kind: 'catalog',
        productId: DRYWALL,
        quantity: 10,
        unitPriceCents: 1700,
        note: null,
        requestLine: 0,
      },
      LVL,
    ],
    unmatched: [],
    fulfilment: 'pickup',
    receiving: null,
    windowId: null,
    unloadHelpStoreIds: [],
    message: 'Kestrel can have the LVL in 2 days.',
    validHours: 48,
    ...overrides,
  };
}

async function quote(id: string, actor: ActorClient = admin): Promise<Quote> {
  return expectOk(actor.get<Quote>(`/quotes/${id}`));
}

async function submit(customer: ActorClient, overrides: Record<string, unknown> = {}): Promise<string> {
  const requestId = randomUUID();
  await expectOk(
    customer.call<SubmitMaterialListResponse>('submitMaterialList', materialList(requestId, overrides)),
  );
  return requestId;
}

function acceptBody(q: Quote, customer: ActorClient, cardId: string, checkoutId = randomUUID()) {
  void customer;
  return {
    quoteId: q.id,
    version: q.offer!.version,
    checkoutId,
    cardId,
    windowId: null,
    receiving: null,
    siteContact: null,
    instructions: null,
    expectedTotalCents: q.offer!.pricing.totalCents,
  };
}

async function report(
  customer: ActorClient,
  storeOrderId: string,
  overrides: Record<string, unknown> = {},
  issueId: string = randomUUID(),
): Promise<{ issueId: string; answer: Awaited<ReturnType<ActorClient['call']>> }> {
  const answer = await customer.call<ReportIssueResponse>('reportIssue', {
    issueId,
    storeOrderId,
    type: 'missing_item',
    lines: [{ lineId: 'L1', quantity: 1 }],
    description: 'One item was missing from the pickup.',
    photoPaths: [],
    preferredResolution: 'refund',
    ...overrides,
  });
  return { issueId, answer };
}

async function issue(id: string): Promise<Issue> {
  return expectOk(admin.get<Issue>(`/issues/${id}`));
}

/** A store order of `storeId` in an order. */
const letterOf = (placed: PlaceOrderResponse, storeId: string): string =>
  placed.storeOrders.find((so) => so.storeId === storeId)!.storeOrderId;

before(async () => {
  ctx = await createTestContext();
  await seedAccounts(ctx);
  dana = await as(ctx, 'dana');
  dispatcher = await as(ctx, 'dispatcher');
  admin = await as(ctx, 'admin');
  bluestone = await as(ctx, 'bluestoneOwner');
});
after(() => ctx.close());

describe('quotes', () => {
  test('submitMaterialList: attachments are checked; a retry answers the same quote; another customer is refused', async () => {
    const requestId = randomUUID();
    const path = await upload(dana, 'quote_upload', requestId, {
      bytes: PDF,
      contentType: 'application/pdf',
      name: 'takeoff.pdf',
    });
    const body = materialList(requestId, {
      attachments: [{ path, name: 'renamed.pdf', contentType: 'application/pdf', sizeBytes: 1 }],
    });
    const first = await expectOk(dana.call<SubmitMaterialListResponse>('submitMaterialList', body));
    assert.equal(first.quoteId, requestId);
    assert.match(first.number, /^Q-1000\d$/);
    // Respond within 30 minutes of support hours (Thu 12:25 is inside them).
    assert.equal(first.respondBy, ctx.clock.now() + 30 * MINUTE);
    const again = await expectOk(dana.call<SubmitMaterialListResponse>('submitMaterialList', body));
    assert.deepEqual(again, first);

    const q = await quote(requestId, dana);
    assert.equal(q.status, 'submitted');
    // Name, type and size come from the files row, not from the request.
    assert.deepEqual(q.request.attachments, [
      { path, name: 'takeoff.pdf', contentType: 'application/pdf', sizeBytes: PDF.length },
    ]);
    const staffNote = await ctx.pool.query(
      `SELECT 1 FROM notifications WHERE dedupe_key = $1 AND user_id = $2`,
      [`quote-new-${requestId}`, dispatcher.uid],
    );
    assert.equal(staffNote.rowCount, 1);

    const sam = await as(ctx, 'sam');
    await expectError(sam.call('submitMaterialList', body), 409);

    // A file uploaded for another request, or a path never uploaded, is refused.
    const other = randomUUID();
    await expectError(
      dana.call(
        'submitMaterialList',
        materialList(other, {
          attachments: [{ path, name: 'takeoff.pdf', contentType: 'application/pdf', sizeBytes: 10 }],
        }),
      ),
      400,
    );
    await expectError(
      dana.call(
        'submitMaterialList',
        materialList(other, {
          attachments: [
            {
              path: `quoteUploads/${dana.uid}/${other}/nothing.pdf`,
              name: 'nothing.pdf',
              contentType: 'application/pdf',
              sizeBytes: 10,
            },
          ],
        }),
      ),
      400,
    );
    // At least one line or one file; delivery needs a jobsite; email contact needs an email.
    await expectError(dana.call('submitMaterialList', materialList(other, { lines: [] })), 400);
    await expectError(dana.call('submitMaterialList', materialList(other, { fulfilment: 'delivery' })), 400);
    await expectError(
      dana.call(
        'submitMaterialList',
        materialList(other, { contact: { preferred: 'email', phone: null, email: null } }),
      ),
      400,
    );
  });

  test('send → accept at the quoted prices with a custom line; version and price errors; accept twice', async () => {
    const quoteId = await submit(dana);
    // Staff open it from the inbox.
    await expectOk(dispatcher.patch<Quote>(`/quotes/${quoteId}`, { status: 'in_review' }));
    await expectOk(dispatcher.call('sendQuote', sendBody(quoteId, 0)));
    const q = await quote(quoteId, dana);
    assert.equal(q.status, 'quoted');
    assert.equal(q.offer!.version, 1);
    assert.equal(q.offerValidUntil, ctx.clock.now() + 48 * HOUR);
    assert.equal(q.assignedTo, dispatcher.uid);
    const [drywall, lvl] = q.offer!.lines;
    assert.equal(drywall!.listPriceCents, 1848);
    assert.equal(drywall!.unitPriceCents, 1700);
    assert.equal(lvl!.kind, 'custom');
    assert.equal(lvl!.storeName, 'Kestrel Lumber Yard');
    assert.equal(q.offer!.pricing.itemsCents, 10 * 1700 + 18_999);
    assert.deepEqual(q.offerHistory, [
      { version: 1, totalCents: q.offer!.pricing.totalCents, sentAt: ctx.clock.now() },
    ]);
    // The customer is told; they asked to be called, so an SMS is queued too.
    const told = await ctx.pool.query(`SELECT 1 FROM notifications WHERE dedupe_key = $1`, [
      `quote-sent-${quoteId}-v1`,
    ]);
    assert.equal(told.rowCount, 1);
    assert.equal(
      (await outboxEvents(ctx, 'sms.send')).filter((row) => String(row.payload.body).includes(q.number))
        .length,
      1,
    );

    // Two people cannot send over each other.
    await expectError(dispatcher.call('sendQuote', sendBody(quoteId, 0)), 412, 'QUOTE_VERSION');

    const cardId = await cardOf(dana.uid);
    await expectError(
      dana.call('acceptQuote', { ...acceptBody(q, dana, cardId), version: 2 }),
      412,
      'QUOTE_VERSION',
    );
    await expectError(
      dana.call('acceptQuote', { ...acceptBody(q, dana, cardId), expectedTotalCents: 1 }),
      412,
      'PRICE_CHANGED',
    );

    const body = acceptBody(q, dana, cardId);
    const placed = await expectOk(dana.call<PlaceOrderResponse>('acceptQuote', body));
    assert.equal(placed.orderId, body.checkoutId);
    assert.equal(placed.totalCents, q.offer!.pricing.totalCents);
    const o = await order(placed.orderId);
    assert.equal(o.source, 'quote');
    assert.equal(o.quoteId, quoteId);
    assert.equal(o.payment.status, 'authorized');
    const bluestoneSo = await storeOrder(letterOf(placed, 'bluestone-drywall'));
    assert.equal(bluestoneSo.lines[0]!.unitPriceCents, 1700);
    // The store is paid the price it agreed to.
    assert.equal(bluestoneSo.storeValueCents, 17_000);
    const kestrelSo = await storeOrder(letterOf(placed, 'kestrel-lumber'));
    assert.equal(kestrelSo.lines[0]!.kind, 'custom');
    assert.equal(kestrelSo.lines[0]!.productId, null);
    assert.equal(kestrelSo.lines[0]!.unitPriceCents, 18_999);

    const accepted = await quote(quoteId, dana);
    assert.equal(accepted.status, 'accepted');
    assert.equal(accepted.orderId, placed.orderId);

    // Accept a quote twice (§12.3): the same checkoutId after the first committed answers the same order.
    const repeat = await expectOk(dana.call<PlaceOrderResponse>('acceptQuote', body));
    assert.deepEqual(repeat, placed);
    const orders = await ctx.pool.query(`SELECT id FROM orders WHERE doc->>'quoteId' = $1`, [quoteId]);
    assert.equal(orders.rowCount, 1);

    // Another checkoutId for an accepted quote: refused, and its card hold voided.
    const otherCheckout = randomUUID();
    await expectError(dana.call('acceptQuote', acceptBody(q, dana, cardId, otherCheckout)), 412);
    const journal = await ctx.pool.query<{ status: string }>(
      'SELECT status FROM payment_authorizations WHERE order_id = $1',
      [otherCheckout],
    );
    assert.ok(
      journal.rows.every((row) => row.status === 'voided' || row.status === 'void_pending'),
      JSON.stringify(journal.rows),
    );
    assert.equal((await ctx.pool.query('SELECT 1 FROM orders WHERE id = $1', [otherCheckout])).rowCount, 0);
  });

  test('accept a quote twice at once with the same checkoutId: one order, the same answer', async () => {
    const cardId = await cardOf(dana.uid);
    for (let round = 0; round < 5; round += 1) {
      const quoteId = await submit(dana);
      await expectOk(admin.call('sendQuote', sendBody(quoteId, 0)));
      const q = await quote(quoteId, dana);
      const body = acceptBody(q, dana, cardId);
      const [a, b] = await together([
        () => dana.call<PlaceOrderResponse>('acceptQuote', body),
        () => dana.call<PlaceOrderResponse>('acceptQuote', body),
      ]);
      assert.equal(a!.status, 200, JSON.stringify(a!.body));
      assert.equal(b!.status, 200, JSON.stringify(b!.body));
      assert.deepEqual(a!.body, b!.body);
      const orders = await ctx.pool.query(`SELECT id FROM orders WHERE doc->>'quoteId' = $1`, [quoteId]);
      assert.equal(orders.rowCount, 1);
      const intents = ctx.gateway
        .of('authorize')
        .filter((call) => call.input.idempotencyKey.includes(body.checkoutId) && call.result?.ok);
      assert.ok(intents.length >= 1);
      assert.equal(
        ctx.gateway.of('void').filter((call) => call.input.idempotencyKey.includes(body.checkoutId)).length,
        0,
      );
    }
  });

  test('close: the customer declines; staff cancel only before an offer; already closed is ok', async () => {
    const declined = await submit(dana);
    await expectOk(dispatcher.call('sendQuote', sendBody(declined, 0)));
    await expectError(dispatcher.call('closeQuote', { quoteId: declined, reason: 'no stock' }), 412);
    await expectOk(dana.call('closeQuote', { quoteId: declined, reason: 'Found it elsewhere' }));
    await expectOk(dana.call('closeQuote', { quoteId: declined }));
    const q = await quote(declined);
    assert.equal(q.status, 'declined');
    assert.equal(q.closeReason, 'Found it elsewhere');
    await expectError(dana.call('reopenQuote', { quoteId: declined, message: null }), 412);

    const cancelled = await submit(dana);
    await expectOk(dispatcher.call('closeQuote', { quoteId: cancelled, reason: "Can't source the LVL" }));
    assert.equal((await quote(cancelled)).status, 'cancelled');
    const told = await ctx.pool.query(`SELECT body FROM notifications WHERE dedupe_key = $1`, [
      `quote-closed-${cancelled}`,
    ]);
    assert.equal(told.rowCount, 1);
    await expectError(dispatcher.call('sendQuote', sendBody(cancelled, 0)), 412);
  });

  test('GET /quotes: the ops inbox by respondBy and the customer list page without gaps', async () => {
    const page1 = await expectOk(dana.get<Page<Quote>>('/quotes?limit=2'));
    assert.equal(page1.items.length, 2);
    assert.ok(page1.nextCursor);
    const rest = await expectOk(
      dana.get<Page<Quote>>(`/quotes?limit=100&cursor=${encodeURIComponent(page1.nextCursor!)}`),
    );
    const all = [...page1.items, ...rest.items];
    assert.equal(new Set(all.map((q) => q.id)).size, all.length);
    const { rows } = await ctx.pool.query('SELECT id FROM quotes WHERE customer_id = $1', [dana.uid]);
    assert.equal(all.length, rows.length);

    const inbox = await expectOk(
      dispatcher.get<Page<Quote>>('/quotes?status=submitted,in_review&sort=respondBy:asc'),
    );
    const due = inbox.items.map((q) => q.respondBy);
    assert.deepEqual(
      due,
      [...due].sort((a, b) => a - b),
    );
    assert.ok(inbox.items.every((q) => q.status === 'submitted' || q.status === 'in_review'));
  });
});

describe('issues', () => {
  let v1: PlaceOrderResponse;
  let drywallSo: string;
  let caseId: string;
  let first: ActorClient;

  test('issue window, one open issue per store order, retries and held ledger entries', async () => {
    // Scenario A of MARKETPLACE §11.5 as a pickup: Dana's first order (welcome discount, no fees).
    first = await newCustomer(ctx, { displayName: 'Ada First', phoneNumber: '+14165550190' });
    await cardOf(first.uid);
    v1 = await placePickup(first, [
      { productId: DRYWALL, storeId: 'bluestone-drywall', quantity: 6 },
      { productId: COMPOUND, storeId: 'bluestone-drywall', quantity: 1 },
      { productId: STUD, storeId: 'kestrel-lumber', quantity: 20 },
      { productId: OSB, storeId: 'kestrel-lumber', quantity: 4 },
    ]);
    drywallSo = letterOf(v1, 'bluestone-drywall');
    // Not completed yet: nothing to report.
    await expectError(
      report(first, drywallSo).then((r) => r.answer),
      412,
      'ISSUE_WINDOW_CLOSED',
    );
    await completeOrder(v1);
    await ctx.drainOutbox();
    const captured = await order(v1.orderId);
    assert.equal(captured.payment.status, 'captured');
    const so = await storeOrder(drywallSo);
    assert.equal(so.current.totalCents, 14_949);
    assert.equal(so.lines[0]!.discountCents, 675);
    assert.ok((await ledger(drywallSo)).some((entry) => entry.kind === 'sale'));

    caseId = randomUUID();
    const photo = await upload(first, 'issue_photo', caseId, {
      bytes: PNG,
      contentType: 'image/png',
      name: 'crack.png',
    });
    const body = {
      issueId: caseId,
      storeOrderId: drywallSo,
      type: 'damaged',
      lines: [{ lineId: 'L1', quantity: 2 }],
      description: 'Two drywall sheets were cracked at the corner.',
      photoPaths: [photo],
      preferredResolution: 'refund',
    };
    // Damaged needs a photo.
    await expectError(first.call('reportIssue', { ...body, photoPaths: [] }), 400);
    // More than were supplied.
    await expectError(first.call('reportIssue', { ...body, lines: [{ lineId: 'L1', quantity: 7 }] }), 400);
    // Someone else's store order.
    await expectError(dana.call('reportIssue', { ...body, issueId: randomUUID(), photoPaths: [] }), 403);

    const answer = await expectOk(first.call<ReportIssueResponse>('reportIssue', body));
    assert.equal(answer.issueId, caseId);
    assert.match(answer.number, /^CASE-\d+$/);
    assert.deepEqual(await expectOk(first.call<ReportIssueResponse>('reportIssue', body)), answer);
    const opened = await issue(caseId);
    assert.equal(opened.status, 'open');
    assert.equal(opened.slaDueAt, ctx.clock.now() + 4 * HOUR);
    assert.equal(opened.storeId, 'bluestone-drywall');
    assert.deepEqual(opened.lines, [
      { lineId: 'L1', name: so.lines[0]!.name, quantity: 2, unitPriceCents: 1848 },
    ]);
    assert.equal((await storeOrder(drywallSo)).issueCount, 1);
    // The store's unpaid entries for this store order are held while the issue is open.
    const held = (await ledger(drywallSo)).filter((entry) => entry.payee_type === 'store');
    assert.ok(held.length >= 1);
    assert.ok(held.every((entry) => entry.held_for_issue_id === caseId));
    // The store hears about it.
    const storeNote = await ctx.pool.query(
      'SELECT 1 FROM notifications WHERE dedupe_key = $1 AND user_id = $2',
      [`issue-store-${caseId}`, bluestone.uid],
    );
    assert.equal(storeNote.rowCount, 1);

    await expectError(
      report(first, drywallSo, { lines: [{ lineId: 'L2', quantity: 1 }] }).then((r) => r.answer),
      412,
      'ISSUE_ALREADY_OPEN',
    );

    // The window closes 48 hours after completion.
    const kestrelSo = letterOf(v1, 'kestrel-lumber');
    await ctx.pool.query(
      `UPDATE store_orders SET doc = jsonb_set(doc, '{completedAt}', to_jsonb($2::bigint)) WHERE id = $1`,
      [kestrelSo, ctx.clock.now() - 2 * DAY - MINUTE],
    );
    await expectError(
      report(first, kestrelSo).then((r) => r.answer),
      412,
      'ISSUE_WINDOW_CLOSED',
    );
    await ctx.pool.query(
      `UPDATE store_orders SET doc = jsonb_set(doc, '{completedAt}', to_jsonb($2::bigint)) WHERE id = $1`,
      [kestrelSo, ctx.clock.now() - 2 * DAY + MINUTE],
    );
    await expectOk(report(first, kestrelSo).then((r) => r.answer));
  });

  test('refund after capture (V5): 3 922 refunded, store clawback −3 326, holds released', async () => {
    await expectOk(
      dispatcher.patch<Issue>(`/issues/${caseId}`, { status: 'in_review', assignedTo: dispatcher.uid }),
    );
    const resolved = await expectOk(
      dispatcher.call<ResolveIssueResponse>('resolveIssue', {
        issueId: caseId,
        kind: 'refund',
        faultParty: 'store',
        note: 'Cracked in the yard; Bluestone agreed.',
      }),
    );
    assert.deepEqual(resolved, { refundCents: 3922, replacementOrderId: null });
    const refunds = (await outboxEvents(ctx, 'payment.refund')).filter(
      (row) => row.payload.issueId === caseId,
    );
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0]!.payload.idempotencyKey, `refund_${caseId}`);
    assert.equal(refunds[0]!.payload.amountCents, 3922);
    await ctx.drainOutbox();
    const o = await order(v1.orderId);
    assert.equal(o.payment.status, 'partially_refunded');
    assert.equal(o.payment.refundedCents, 3922);
    assert.equal(o.payment.refundedByStoreOrder[drywallSo], 3922);
    assert.equal(
      ctx.gateway.of('refund').filter((call) => call.input.idempotencyKey === `refund_${caseId}`).length,
      1,
    );

    const entries = await ledger(drywallSo);
    const clawback = entries.find((entry) => entry.id === `clawback_${caseId}`);
    assert.ok(clawback, JSON.stringify(entries));
    assert.equal(clawback.payee_id, 'bluestone-drywall');
    assert.equal(clawback.amount_cents, -3326);
    assert.ok(entries.every((entry) => entry.held_for_issue_id === null));

    const done = await issue(caseId);
    assert.equal(done.status, 'resolved');
    assert.equal(done.resolution!.refundCents, 3922);
    assert.equal(done.resolution!.refundItemsCents, 3696);
    assert.equal(done.resolution!.faultParty, 'store');
    await expectError(
      dispatcher.call('resolveIssue', {
        issueId: caseId,
        kind: 'no_action',
        faultParty: null,
        note: 'again',
      }),
      412,
    );

    // A second case on the same store order cannot refund the same sheets again.
    const second = await report(first, drywallSo, {
      type: 'other',
      lines: [{ lineId: 'L1', quantity: 5 }],
    });
    await expectError(second.answer, 400);
  });

  test('credit before capture: current and storeValueCents drop, the capture charges less; driver clawback', async () => {
    const sam = await as(ctx, 'sam');
    const placed = await placePickup(sam, [
      { productId: COMPOUND, storeId: 'bluestone-drywall', quantity: 3 },
      { productId: DRYWALL, storeId: 'bluestone-drywall', quantity: 2 },
    ]);
    const soId = placed.storeOrders[0]!.storeOrderId;
    await completeOrder(placed);
    // The finalize event waits in the outbox: the payment is still only authorized.
    assert.equal((await order(placed.orderId)).payment.status, 'authorized');
    const before = await storeOrder(soId);

    const { issueId, answer } = await report(sam, soId);
    await expectOk(answer);
    // A pickup had no driver, so a driver cannot be at fault.
    await expectError(
      dispatcher.call('resolveIssue', { issueId, kind: 'refund', faultParty: 'driver', note: 'x' }),
      400,
    );
    const resolved = await expectOk(
      dispatcher.call<ResolveIssueResponse>('resolveIssue', {
        issueId,
        kind: 'refund',
        faultParty: 'store',
        note: 'Short one pail.',
      }),
    );
    const after = await storeOrder(soId);
    assert.equal(after.current.totalCents, before.current.totalCents - resolved.refundCents);
    assert.equal(after.current.itemsCents, before.current.itemsCents - before.lines[0]!.unitPriceCents);
    assert.equal(after.storeValueCents, before.storeValueCents - before.lines[0]!.unitPriceCents);
    assert.equal((await order(placed.orderId)).current.totalCents, after.current.totalCents);
    // Not captured: no refund event, no store clawback (the sale entry will be smaller instead).
    assert.equal(
      (await outboxEvents(ctx, 'payment.refund')).filter((row) => row.payload.issueId === issueId).length,
      0,
    );

    await ctx.drainOutbox();
    const o = await order(placed.orderId);
    assert.equal(o.payment.status, 'captured');
    assert.equal(o.payment.capturedCents, after.current.totalCents);
    const entries = await ledger(soId);
    assert.equal(entries.find((entry) => entry.kind === 'sale')!.amount_cents, after.storeValueCents);
    assert.ok(!entries.some((entry) => entry.kind === 'clawback'));

    // A delivered store order has a driver; the issue names them, and a driver at fault gets the clawback.
    const marco = await as(ctx, 'marco');
    const second = await report(sam, soId, {
      lines: [{ lineId: 'L2', quantity: 1 }],
      type: 'short_quantity',
    });
    await expectOk(second.answer);
    await ctx.pool.query(
      `UPDATE issues SET doc = jsonb_set(doc, '{driverId}', to_jsonb($2::text)) WHERE id = $1`,
      [second.issueId, marco.uid],
    );
    const byDriver = await expectOk(
      admin.call<ResolveIssueResponse>('resolveIssue', {
        issueId: second.issueId,
        kind: 'refund',
        faultParty: 'driver',
        note: 'Lost in transit.',
      }),
    );
    assert.ok(byDriver.refundCents > 0);
    const driverEntry = await ctx.pool.query<{ payee_type: string; payee_id: string; amount_cents: number }>(
      'SELECT payee_type, payee_id, amount_cents FROM ledger_entries WHERE id = $1',
      [`clawback_${second.issueId}`],
    );
    assert.deepEqual(driverEntry.rows[0], { payee_type: 'driver', payee_id: marco.uid, amount_cents: -1848 });
  });

  test('replacement: a not_required order at $0 for the same store; the store at fault pays only the commission', async () => {
    const sam = await as(ctx, 'sam');
    const placed = await placePickup(sam, [
      { productId: DRYWALL, storeId: 'bluestone-drywall', quantity: 4 },
    ]);
    const soId = placed.storeOrders[0]!.storeOrderId;
    await completeOrder(placed);
    await ctx.drainOutbox();
    const { issueId, answer } = await report(sam, soId, {
      type: 'wrong_item',
      photoPaths: [],
      lines: [{ lineId: 'L1', quantity: 2 }],
      preferredResolution: 'replacement',
    });
    await expectError(answer, 400);
    const photo = await upload(sam, 'issue_photo', issueId, {
      bytes: PNG,
      contentType: 'image/png',
      name: 'w.png',
    });
    await expectOk(
      (
        await report(
          sam,
          soId,
          {
            type: 'wrong_item',
            photoPaths: [photo],
            lines: [{ lineId: 'L1', quantity: 2 }],
            preferredResolution: 'replacement',
          },
          issueId,
        )
      ).answer,
    );
    const resolved = await expectOk(
      dispatcher.call<ResolveIssueResponse>('resolveIssue', {
        issueId,
        kind: 'replacement',
        faultParty: 'store',
        note: 'Sent 5/8 instead of 1/2.',
      }),
    );
    assert.equal(resolved.refundCents, 0);
    assert.ok(resolved.replacementOrderId);
    const replacement = await order(resolved.replacementOrderId);
    assert.equal(replacement.source, 'replacement');
    assert.equal(replacement.issueId, issueId);
    assert.equal(replacement.payment.status, 'not_required');
    assert.equal(replacement.placed.totalCents, 0);
    assert.equal(replacement.customerId, sam.uid);
    const rso = await storeOrder(replacement.storeOrderIds[0]!);
    assert.equal(rso.storeId, 'bluestone-drywall');
    assert.equal(rso.fulfilment, 'pickup');
    assert.equal(rso.lines[0]!.quantity, 2);
    assert.equal(rso.lines[0]!.unitPriceCents, 0);
    // Valued at the catalogue price (§3.6); the fault is applied by the ledger when it settles (§9.2.12).
    assert.equal(rso.storeValueCents, 2 * 1848);
    // Shorted to 1 at accept: the store value follows what was fulfilled. Store at fault → no sale_, but
    // the commission on that value.
    await completePickup(rso.id, [{ lineId: 'L1', fulfilledQty: 1, reason: 'damaged' }]);
    const settled = await storeOrder(rso.id);
    assert.equal(settled.lines[0]!.fulfilledQty, 1);
    assert.equal(settled.storeValueCents, 1848);
    const bps = (
      await ctx.pool.query<{ bps: number }>(
        `SELECT (meta->>'commissionBps')::int AS bps FROM store_orders WHERE id = $1`,
        [rso.id],
      )
    ).rows[0]!.bps;
    assert.deepEqual(
      (await ledger(rso.id)).map((row) => [row.id, row.payee_id, row.amount_cents]),
      [[`commission_${rso.id}`, 'bluestone-drywall', -percentBps(1848, bps)]],
    );
    assert.equal((await issue(issueId)).resolution!.replacementOrderId, replacement.id);
    // The first-order counters are not touched by a replacement.
    const stats = await ctx.pool.query<{ n: number }>(
      `SELECT (doc #>> '{stats,nonCancelledOrders}')::int AS n FROM users WHERE id = $1`,
      [sam.uid],
    );
    assert.ok(stats.rows[0]!.n >= 1);

    // Not the store's fault: the store is paid the catalogue price.
    const other = await placePickup(sam, [{ productId: DRYWALL, storeId: 'bluestone-drywall', quantity: 1 }]);
    await completeOrder(other);
    const r2 = await report(sam, other.storeOrders[0]!.storeOrderId, { preferredResolution: 'replacement' });
    await expectOk(r2.answer);
    const platform = await expectOk(
      admin.call<ResolveIssueResponse>('resolveIssue', {
        issueId: r2.issueId,
        kind: 'replacement',
        faultParty: 'platform',
        note: 'Our mistake.',
      }),
    );
    const r2Order = await order(platform.replacementOrderId!);
    const r2so = r2Order.storeOrderIds[0]!;
    assert.equal((await storeOrder(r2so)).storeValueCents, 1848);
    await completePickup(r2so);
    assert.deepEqual(
      (await ledger(r2so)).map((row) => [row.id, row.amount_cents]),
      [
        [`commission_${r2so}`, -percentBps(1848, bps)],
        [`sale_${r2so}`, 1848],
      ],
    );
  });

  test('a dispatcher refunds at most $100 per case (REFUND_LIMIT); an admin has no limit; no action', async () => {
    const sam = await as(ctx, 'sam');
    const placed = await placePickup(sam, [
      { productId: DRYWALL, storeId: 'bluestone-drywall', quantity: 10 },
    ]);
    const soId = placed.storeOrders[0]!.storeOrderId;
    await completeOrder(placed);
    await ctx.drainOutbox();
    const { issueId, answer } = await report(sam, soId, { lines: [{ lineId: 'L1', quantity: 10 }] });
    await expectOk(answer);
    await expectError(
      dispatcher.call('resolveIssue', {
        issueId,
        kind: 'refund',
        faultParty: 'platform',
        note: 'All of it.',
      }),
      412,
      'REFUND_LIMIT',
    );
    assert.equal((await issue(issueId)).status, 'open');
    const resolved = await expectOk(
      admin.call<ResolveIssueResponse>('resolveIssue', {
        issueId,
        kind: 'refund',
        faultParty: 'platform',
        note: 'All of it.',
      }),
    );
    assert.ok(resolved.refundCents > 10_000);
    // Platform at fault: no clawback.
    assert.equal(
      (await ctx.pool.query('SELECT 1 FROM ledger_entries WHERE id = $1', [`clawback_${issueId}`])).rowCount,
      0,
    );

    const other = await placePickup(sam, [
      { productId: COMPOUND, storeId: 'bluestone-drywall', quantity: 1 },
    ]);
    await completeOrder(other);
    const r = await report(sam, other.storeOrders[0]!.storeOrderId, { type: 'late', lines: [] });
    await expectOk(r.answer);
    const none = await expectOk(
      dispatcher.call<ResolveIssueResponse>('resolveIssue', {
        issueId: r.issueId,
        kind: 'no_action',
        faultParty: null,
        note: 'Collected on time.',
      }),
    );
    assert.deepEqual(none, { refundCents: 0, replacementOrderId: null });
    const told = await ctx.pool.query('SELECT body FROM notifications WHERE dedupe_key = $1', [
      `issue-resolved-${r.issueId}`,
    ]);
    assert.equal(told.rowCount, 1);
  });

  test('two reports on one store order at once: one case, the other ISSUE_ALREADY_OPEN', async () => {
    const sam = await as(ctx, 'sam');
    for (let round = 0; round < 5; round += 1) {
      const placed = await placePickup(sam, [
        { productId: COMPOUND, storeId: 'bluestone-drywall', quantity: 1 },
      ]);
      const soId = placed.storeOrders[0]!.storeOrderId;
      await completeOrder(placed);
      const [a, b] = await together([() => report(sam, soId), () => report(sam, soId)]);
      const statuses = [a!.answer.status, b!.answer.status].sort();
      assert.deepEqual(statuses, [200, 412], JSON.stringify([a!.answer.body, b!.answer.body]));
      const loser = [a!, b!].find((r) => r.answer.status === 412)!;
      assert.equal((loser.answer.body as ErrorBody).error.code, 'ISSUE_ALREADY_OPEN');
      const open = await ctx.pool.query(`SELECT 1 FROM issues WHERE store_order_id = $1`, [soId]);
      assert.equal(open.rowCount, 1);
      assert.equal((await storeOrder(soId)).issueCount, 1);
    }
  });
});

describe('quote expiry', () => {
  test('expiry: QUOTE_EXPIRED before the job runs; expireQuotes; reopen with a message; a new version', async () => {
    const quoteId = await submit(dana);
    await expectOk(dispatcher.call('sendQuote', sendBody(quoteId, 0, { validHours: 24 })));
    const q = await quote(quoteId, dana);
    const cardId = await cardOf(dana.uid);
    // The offer runs out 24 hours later (Fri 12:25, stores still open). Time only moves forward in this file,
    // so the sessions are refreshed rather than the clock set back.
    ctx.clock.advance(24 * HOUR);
    for (const actor of [dana, dispatcher, admin]) await expectOk(actor.refresh());
    {
      await expectError(dana.call('acceptQuote', acceptBody(q, dana, cardId)), 412, 'QUOTE_EXPIRED');
      const result = await ctx.runJob('expireQuotes');
      assert.ok(result.expired! >= 1);
      assert.equal(result.errors, 0);
      assert.equal((await quote(quoteId)).status, 'expired');
      assert.equal((await ctx.runJob('expireQuotes')).expired, 0);
      await expectError(dana.call('acceptQuote', acceptBody(q, dana, cardId)), 412, 'QUOTE_EXPIRED');

      await expectOk(dana.call('reopenQuote', { quoteId, message: 'Can you add 2 more sheets?' }));
      const reopened = await quote(quoteId);
      assert.equal(reopened.status, 'in_review');
      const message = await ctx.pool.query<{ text: string; context: { kind: string; id: string } }>(
        'SELECT text, context FROM support_messages WHERE thread_id = $1 ORDER BY seq DESC LIMIT 1',
        [dana.uid],
      );
      assert.equal(message.rows[0]!.text, 'Can you add 2 more sheets?');
      assert.deepEqual(
        { kind: message.rows[0]!.context.kind, id: message.rows[0]!.context.id },
        { kind: 'quote', id: quoteId },
      );
      // Reopening twice is fine; an in-review quote has nothing to accept.
      await expectOk(dana.call('reopenQuote', { quoteId, message: null }));
      await expectError(dana.call('acceptQuote', acceptBody(q, dana, cardId)), 412);

      await expectOk(dispatcher.call('sendQuote', sendBody(quoteId, 1)));
      const v2 = await quote(quoteId, dana);
      assert.equal(v2.status, 'quoted');
      assert.equal(v2.offer!.version, 2);
      assert.deepEqual(
        v2.offerHistory.map((entry) => entry.version),
        [1, 2],
      );
      await expectError(dana.call('acceptQuote', acceptBody(q, dana, cardId)), 412, 'QUOTE_VERSION');
    }
  });
});
