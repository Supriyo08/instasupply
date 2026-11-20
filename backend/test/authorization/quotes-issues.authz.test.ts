/**
 * Authorization of quotes and issues (docs/PLATFORM.md §7.3, §12.4; MARKETPLACE §13.2): customers read their own;
 * store members read their store's issues; staff updates are limited to the assignee and the one status step;
 * the workspace and the notes are staff-only; every command refuses the wrong caller. Each endpoint has an
 * allowed and a denied case for the actors of MARKETPLACE §13.2.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import type { Issue, Page, PlaceOrderResponse, Quote, StoreOrder } from '@instasupply/shared';
import { as, newCustomer, newDriver, newSupplier, type ActorClient } from '../support/actors';
import { createTestContext, type TestContext } from '../support/database';
import { createCard, seedAccounts } from '../support/fixtures';
import { expectError, expectOk, request, type ErrorBody } from '../support/http';

const DRYWALL = 'bluestone-drywall--bdp-dw12';

let ctx: TestContext;
let customerA: ActorClient;
let customerB: ActorClient;
let ownerX: ActorClient; // Bluestone, the store of the issue
let staffX: ActorClient;
let supplierY: ActorClient; // Kestrel
let driver: ActorClient;
let pendingDriver: ActorClient;
let dispatcher: ActorClient;
let admin: ActorClient;

let quoteId: string;
let issueId: string;
let storeOrderId: string;

async function placeAndComplete(customer: ActorClient): Promise<string> {
  const card = await createCard(ctx, customer.uid, { last4: '4242', isDefault: true });
  const body = {
    checkoutId: randomUUID(),
    items: [{ productId: DRYWALL, storeId: 'bluestone-drywall', quantity: 3 }],
    fulfilment: 'pickup',
    jobsiteId: null,
    windowId: null,
    receiving: null,
    siteContact: null,
    instructions: null,
    unloadHelpStoreIds: [],
    cardId: card.id,
    promoCode: null,
    expectedTotalCents: 1,
  };
  const priced = await customer.call<ErrorBody>('placeOrder', body);
  const total = (priced.body.error.details.pricing as { totalCents: number }).totalCents;
  const placed = await expectOk(
    customer.call<PlaceOrderResponse>('placeOrder', { ...body, expectedTotalCents: total }),
  );
  const soId = placed.storeOrders[0]!.storeOrderId;
  const so = await expectOk(admin.get<StoreOrder>(`/store-orders/${soId}`));
  const accepted = await expectOk(
    admin.call<{ version: number }>('acceptStoreOrder', { storeOrderId: soId, expectedVersion: so.version }),
  );
  const ready = await expectOk(
    admin.call<{ version: number }>('updateStoreOrderStatus', {
      storeOrderId: soId,
      expectedVersion: accepted.version,
      status: 'ready',
    }),
  );
  await expectOk(
    admin.call('completePickup', {
      storeOrderId: soId,
      expectedVersion: ready.version,
      pickupCode: null,
      overrideReason: 'Test hand-over',
    }),
  );
  return soId;
}

const materialList = (requestId: string) => ({
  requestId,
  lines: [{ text: 'Twenty 2x4x8 studs', quantity: 20 }],
  attachments: [],
  neededBy: { kind: 'asap', date: null },
  fulfilment: 'pickup',
  jobsiteId: null,
  contact: { preferred: 'email', phone: null, email: 'a@example.com' },
  notes: null,
});

before(async () => {
  ctx = await createTestContext();
  await seedAccounts(ctx);
  customerA = await newCustomer(ctx, { displayName: 'Customer A', phoneNumber: '+14165550191' });
  customerB = await newCustomer(ctx, { displayName: 'Customer B', phoneNumber: '+14165550192' });
  ownerX = await as(ctx, 'bluestoneOwner');
  staffX = await newSupplier(ctx, { storeId: 'bluestone-drywall', storeRole: 'staff' });
  supplierY = await as(ctx, 'kestrelOwner');
  driver = await newDriver(ctx);
  pendingDriver = await newDriver(ctx, { status: 'pending' });
  dispatcher = await as(ctx, 'dispatcher');
  admin = await as(ctx, 'admin');

  quoteId = randomUUID();
  await expectOk(customerA.call('submitMaterialList', materialList(quoteId)));
  storeOrderId = await placeAndComplete(customerA);
  issueId = randomUUID();
  await expectOk(
    customerA.call('reportIssue', {
      issueId,
      storeOrderId,
      type: 'missing_item',
      lines: [{ lineId: 'L1', quantity: 1 }],
      description: 'One sheet was missing.',
      photoPaths: [],
      preferredResolution: 'refund',
    }),
  );
});
after(() => ctx.close());

const anonymous = (method: 'GET' | 'PATCH' | 'PUT', path: string, body?: unknown) =>
  request(ctx, method, path, body);

describe('quotes', () => {
  test('GET /quotes/{id}: the owner and staff read; everyone else is denied', async () => {
    assert.equal((await expectOk(customerA.get<Quote>(`/quotes/${quoteId}`))).id, quoteId);
    await expectOk(dispatcher.get(`/quotes/${quoteId}`));
    await expectOk(admin.get(`/quotes/${quoteId}`));
    await expectError(customerB.get(`/quotes/${quoteId}`), 403);
    await expectError(ownerX.get(`/quotes/${quoteId}`), 403);
    await expectError(supplierY.get(`/quotes/${quoteId}`), 403);
    await expectError(driver.get(`/quotes/${quoteId}`), 403);
    await expectError(pendingDriver.get(`/quotes/${quoteId}`), 403);
    await expectError(anonymous('GET', `/quotes/${quoteId}`), 401);
    await expectError(admin.get(`/quotes/${randomUUID()}`), 404);
  });

  test('GET /quotes: a customer gets only their own; another customerId and staff filters are refused', async () => {
    const own = await expectOk(customerA.get<Page<Quote>>('/quotes'));
    assert.ok(own.items.length >= 1);
    assert.ok(own.items.every((q) => q.customerId === customerA.uid));
    assert.equal((await expectOk(customerB.get<Page<Quote>>('/quotes'))).items.length, 0);
    await expectError(customerB.get(`/quotes?customerId=${customerA.uid}`), 403);
    await expectError(customerA.get(`/quotes?assignedTo=${dispatcher.uid}`), 400);
    const all = await expectOk(dispatcher.get<Page<Quote>>(`/quotes?customerId=${customerA.uid}`));
    assert.ok(all.items.some((q) => q.id === quoteId));
    await expectError(ownerX.get('/quotes'), 403);
    await expectError(driver.get('/quotes'), 403);
    await expectError(anonymous('GET', '/quotes'), 401);
  });

  test('PATCH /quotes/{id}: staff only, assignee and submitted → in_review only', async () => {
    await expectError(customerA.patch(`/quotes/${quoteId}`, { status: 'in_review' }), 403);
    await expectError(ownerX.patch(`/quotes/${quoteId}`, { assignedTo: ownerX.uid }), 403);
    await expectError(driver.patch(`/quotes/${quoteId}`, { status: 'in_review' }), 403);
    await expectError(anonymous('PATCH', `/quotes/${quoteId}`, { status: 'in_review' }), 401);
    // Nothing but the two fields.
    await expectError(dispatcher.patch(`/quotes/${quoteId}`, { status: 'quoted' }), 400);
    await expectError(dispatcher.patch(`/quotes/${quoteId}`, { offer: null }), 400);
    await expectError(dispatcher.patch(`/quotes/${quoteId}`, { customerId: customerB.uid }), 400);
    // The assignee must be active staff.
    await expectError(dispatcher.patch(`/quotes/${quoteId}`, { assignedTo: customerA.uid }), 400);
    const assigned = await expectOk(
      dispatcher.patch<Quote>(`/quotes/${quoteId}`, { assignedTo: dispatcher.uid }),
    );
    assert.equal(assigned.assignedTo, dispatcher.uid);
    assert.equal(assigned.assignedName, dispatcher.account.displayName);
    const opened = await expectOk(admin.patch<Quote>(`/quotes/${quoteId}`, { status: 'in_review' }));
    assert.equal(opened.status, 'in_review');
    // Only from submitted: a closed quote cannot be moved back.
    const closed = randomUUID();
    await expectOk(customerB.call('submitMaterialList', materialList(closed)));
    await expectOk(customerB.call('closeQuote', { quoteId: closed }));
    await expectError(dispatcher.patch(`/quotes/${closed}`, { status: 'in_review' }), 412);
    const cleared = await expectOk(dispatcher.patch<Quote>(`/quotes/${quoteId}`, { assignedTo: null }));
    assert.equal(cleared.assignedName, null);
  });

  test('workspace: staff-only; not-found until the first save', async () => {
    await expectError(dispatcher.get(`/quotes/${quoteId}/workspace`), 404);
    const draft = { lines: [{ productId: DRYWALL, quantity: 3 }], note: 'call the yard' };
    assert.deepEqual(await expectOk(dispatcher.put(`/quotes/${quoteId}/workspace`, draft)), draft);
    assert.deepEqual(await expectOk(admin.get(`/quotes/${quoteId}/workspace`)), draft);
    await expectError(customerA.get(`/quotes/${quoteId}/workspace`), 403);
    await expectError(customerA.put(`/quotes/${quoteId}/workspace`, draft), 403);
    await expectError(ownerX.get(`/quotes/${quoteId}/workspace`), 403);
    await expectError(driver.get(`/quotes/${quoteId}/workspace`), 403);
    await expectError(anonymous('GET', `/quotes/${quoteId}/workspace`), 401);
    // The quote itself never carries the workspace.
    const q = await expectOk(customerA.get<Record<string, unknown>>(`/quotes/${quoteId}`));
    assert.equal('workspace' in q, false);
    await expectError(dispatcher.put(`/quotes/${quoteId}/workspace`, { big: 'x'.repeat(210 * 1024) }), 413);
  });

  test('quote commands refuse the wrong caller', async () => {
    const requestId = randomUUID();
    await expectError(ownerX.call('submitMaterialList', materialList(requestId)), 403);
    await expectError(driver.call('submitMaterialList', materialList(requestId)), 403);
    await expectError(dispatcher.call('submitMaterialList', materialList(requestId)), 403);
    await expectError(request(ctx, 'POST', '/call/submitMaterialList', materialList(requestId)), 401);

    const send = {
      quoteId,
      expectedVersion: 0,
      lines: [
        {
          kind: 'catalog',
          productId: DRYWALL,
          quantity: 2,
          unitPriceCents: null,
          note: null,
          requestLine: 0,
        },
      ],
      unmatched: [],
      fulfilment: 'pickup',
      receiving: null,
      windowId: null,
      unloadHelpStoreIds: [],
      message: null,
      validHours: 48,
    };
    await expectError(customerA.call('sendQuote', send), 403);
    await expectError(ownerX.call('sendQuote', send), 403);
    await expectError(driver.call('sendQuote', send), 403);
    await expectOk(dispatcher.call('sendQuote', send));

    const q = await expectOk(customerA.get<Quote>(`/quotes/${quoteId}`));
    const accept = {
      quoteId,
      version: 1,
      checkoutId: randomUUID(),
      cardId: randomUUID(),
      windowId: null,
      receiving: null,
      siteContact: null,
      instructions: null,
      expectedTotalCents: q.offer!.pricing.totalCents,
    };
    await expectError(customerB.call('acceptQuote', accept), 403);
    await expectError(dispatcher.call('acceptQuote', accept), 403);
    await expectError(ownerX.call('acceptQuote', accept), 403);

    await expectError(customerB.call('reopenQuote', { quoteId, message: null }), 403);
    await expectError(dispatcher.call('reopenQuote', { quoteId, message: null }), 403);
    await expectError(customerB.call('closeQuote', { quoteId }), 403);
    await expectError(ownerX.call('closeQuote', { quoteId }), 403);
    await expectError(driver.call('closeQuote', { quoteId }), 403);
    assert.equal((await expectOk(admin.get<Quote>(`/quotes/${quoteId}`))).status, 'quoted');
  });
});

describe('issues', () => {
  test('GET /issues/{id}: the customer, members of its store and staff read; nobody else', async () => {
    assert.equal((await expectOk(customerA.get<Issue>(`/issues/${issueId}`))).id, issueId);
    await expectOk(ownerX.get(`/issues/${issueId}`));
    await expectOk(staffX.get(`/issues/${issueId}`));
    await expectOk(dispatcher.get(`/issues/${issueId}`));
    await expectError(customerB.get(`/issues/${issueId}`), 403);
    await expectError(supplierY.get(`/issues/${issueId}`), 403);
    await expectError(driver.get(`/issues/${issueId}`), 403);
    await expectError(pendingDriver.get(`/issues/${issueId}`), 403);
    await expectError(anonymous('GET', `/issues/${issueId}`), 401);
  });

  test('GET /issues: scoped to the customer or the store; another scope is denied', async () => {
    const own = await expectOk(customerA.get<Page<Issue>>('/issues'));
    assert.deepEqual(
      own.items.map((i) => i.id),
      [issueId],
    );
    assert.equal((await expectOk(customerB.get<Page<Issue>>('/issues'))).items.length, 0);
    await expectError(customerB.get(`/issues?customerId=${customerA.uid}`), 403);
    await expectError(customerA.get('/issues?storeId=bluestone-drywall'), 403);
    const store = await expectOk(staffX.get<Page<Issue>>('/issues'));
    assert.deepEqual(
      store.items.map((i) => i.id),
      [issueId],
    );
    await expectOk(ownerX.get('/issues?storeId=bluestone-drywall'));
    await expectError(supplierY.get('/issues?storeId=bluestone-drywall'), 403);
    assert.equal((await expectOk(supplierY.get<Page<Issue>>('/issues'))).items.length, 0);
    await expectError(ownerX.get(`/issues?customerId=${customerA.uid}`), 403);
    const ops = await expectOk(
      dispatcher.get<Page<Issue>>(`/issues?storeOrderId=${storeOrderId}&status=open`),
    );
    assert.equal(ops.items.length, 1);
    await expectError(driver.get('/issues'), 403);
    await expectError(anonymous('GET', '/issues'), 401);
  });

  test('PATCH /issues/{id}: staff only, assignee and open → in_review only', async () => {
    await expectError(customerA.patch(`/issues/${issueId}`, { status: 'in_review' }), 403);
    await expectError(ownerX.patch(`/issues/${issueId}`, { status: 'in_review' }), 403);
    await expectError(driver.patch(`/issues/${issueId}`, { assignedTo: null }), 403);
    await expectError(anonymous('PATCH', `/issues/${issueId}`, { status: 'in_review' }), 401);
    await expectError(dispatcher.patch(`/issues/${issueId}`, { status: 'resolved' }), 400);
    await expectError(dispatcher.patch(`/issues/${issueId}`, { resolution: null }), 400);
    await expectError(dispatcher.patch(`/issues/${issueId}`, { assignedTo: ownerX.uid }), 400);
    const picked = await expectOk(
      dispatcher.patch<Issue>(`/issues/${issueId}`, { status: 'in_review', assignedTo: dispatcher.uid }),
    );
    assert.equal(picked.status, 'in_review');
    assert.equal(picked.assignedTo, dispatcher.uid);
  });

  test('notes: staff-only; not-found until the first save', async () => {
    await expectError(dispatcher.get(`/issues/${issueId}/notes`), 404);
    const saved = await expectOk(
      dispatcher.put<{ notes: string; updatedBy: string }>(`/issues/${issueId}/notes`, {
        notes: 'Called the yard.',
      }),
    );
    assert.equal(saved.notes, 'Called the yard.');
    assert.equal(saved.updatedBy, dispatcher.uid);
    assert.equal(
      (await expectOk(admin.get<{ notes: string }>(`/issues/${issueId}/notes`))).notes,
      'Called the yard.',
    );
    await expectError(customerA.get(`/issues/${issueId}/notes`), 403);
    await expectError(ownerX.get(`/issues/${issueId}/notes`), 403);
    await expectError(ownerX.put(`/issues/${issueId}/notes`, { notes: 'x' }), 403);
    await expectError(driver.get(`/issues/${issueId}/notes`), 403);
    await expectError(anonymous('GET', `/issues/${issueId}/notes`), 401);
    await expectError(dispatcher.put(`/issues/${issueId}/notes`, { notes: 'x'.repeat(5001) }), 400);
    const issue = await expectOk(ownerX.get<Record<string, unknown>>(`/issues/${issueId}`));
    assert.equal('notes' in issue, false);
  });

  test('issue commands refuse the wrong caller; a resolved issue cannot be moved back', async () => {
    const reportBody = {
      issueId: randomUUID(),
      storeOrderId,
      type: 'other',
      lines: [],
      description: 'Someone else trying to report.',
      photoPaths: [],
      preferredResolution: 'refund',
    };
    await expectError(customerB.call('reportIssue', reportBody), 403);
    await expectError(ownerX.call('reportIssue', reportBody), 403);
    await expectError(dispatcher.call('reportIssue', reportBody), 403);
    await expectError(driver.call('reportIssue', reportBody), 403);
    // Another customer cannot take over an existing issue id either.
    await expectError(customerB.call('reportIssue', { ...reportBody, issueId }), 409);

    const resolve = { issueId, kind: 'no_action', faultParty: null, note: 'Found the sheet.' };
    await expectError(customerA.call('resolveIssue', resolve), 403);
    await expectError(ownerX.call('resolveIssue', resolve), 403);
    await expectError(driver.call('resolveIssue', resolve), 403);
    await expectOk(dispatcher.call('resolveIssue', resolve));
    await expectError(dispatcher.patch(`/issues/${issueId}`, { status: 'in_review' }), 412);
    assert.equal((await expectOk(customerA.get<Issue>(`/issues/${issueId}`))).status, 'resolved');
  });
});
