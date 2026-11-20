/**
 * Ledger entries and payouts (MARKETPLACE §6.2, §13.2 → PLATFORM §7.3 `canReadPayee`, §5.3.8): per payee, the
 * owner of the store and the driver themselves; store staff (not owners) are denied; another store or driver
 * is denied (never an empty list); staff read every payee; anonymous callers are unauthenticated.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { LedgerBalance, LedgerEntry, Page, Payout, WithId } from '@instasupply/shared';
import { runKeyOf } from '../../src/modules/payouts';
import {
  newAdmin,
  newCustomer,
  newDispatcher,
  newDriver,
  newSupplier,
  type ActorClient,
} from '../support/actors';
import { createTestContext, type TestContext } from '../support/database';
import { expectError, expectOk, get } from '../support/http';

describe('finance (ledger entries, payouts)', () => {
  let ctx: TestContext;
  let ownerX: ActorClient & { storeId: string };
  let staffX: ActorClient;
  let ownerY: ActorClient & { storeId: string };
  let driver: ActorClient;
  let otherDriver: ActorClient;
  let pendingDriver: ActorClient;
  let customer: ActorClient;
  let dispatcher: ActorClient;
  let admin: ActorClient;
  let storePayout: string;
  let driverPayout: string;

  const entry = async (payeeType: 'store' | 'driver', payeeId: string, amount: number, id: string) => {
    await ctx.pool.query(
      `INSERT INTO ledger_entries (id, payee_type, payee_id, kind, amount_cents, description, created_at)
       VALUES ($1, $2, $3, 'adjustment', $4, 'test', $5)`,
      [id, payeeType, payeeId, amount, new Date(ctx.clock.now())],
    );
  };

  before(async () => {
    ctx = await createTestContext();
    ownerX = await newSupplier(ctx, { store: { id: 'store-x', name: 'Store X' } });
    staffX = await newSupplier(ctx, { storeId: 'store-x', storeRole: 'staff' });
    ownerY = await newSupplier(ctx, { store: { id: 'store-y', name: 'Store Y' } });
    driver = await newDriver(ctx);
    otherDriver = await newDriver(ctx, { cityId: 'mississauga' });
    pendingDriver = await newDriver(ctx, { status: 'pending' });
    customer = await newCustomer(ctx);
    dispatcher = await newDispatcher(ctx);
    admin = await newAdmin(ctx);
    await entry('store', 'store-x', 10_000, 'sale_x');
    await entry('store', 'store-y', 20_000, 'sale_y');
    await entry('driver', driver.uid, 4_775, 'delivery_d');
    await entry('driver', otherDriver.uid, 1_200, 'delivery_o');
    await entry('driver', pendingDriver.uid, 900, 'delivery_p');
    await ctx.runJob('runDailyPayouts', ctx.clock.now());
    const runKey = runKeyOf(ctx.clock.now());
    storePayout = `store_store-x_${runKey}`;
    driverPayout = `driver_${driver.uid}_${runKey}`;
    // Unpaid entries after the run, so the lists have both.
    await entry('store', 'store-x', 500, 'later_x');
    await entry('driver', driver.uid, 300, 'later_d');
  });
  after(() => ctx.close());

  const ids = <T extends { id: string }>(page: Page<T>): string[] => page.items.map((item) => item.id).sort();

  test('anonymous: every endpoint is unauthenticated', async () => {
    for (const path of ['/ledger-entries', '/ledger/balance', '/payouts', `/payouts/${storePayout}`]) {
      await expectError(get(ctx, path), 'unauthenticated');
    }
  });

  test('the owner of a store reads the store, by default and when naming it; never another store', async () => {
    const own = await expectOk(ownerX.get<Page<WithId<LedgerEntry>>>('/ledger-entries'));
    assert.deepEqual(ids(own), ['later_x', 'sale_x']);
    const named = await expectOk(
      ownerX.get<Page<WithId<LedgerEntry>>>('/ledger-entries?payeeType=store&payeeId=store-x&unpaid=true'),
    );
    assert.deepEqual(ids(named), ['later_x']);
    const balance = await expectOk(ownerX.get<LedgerBalance>('/ledger/balance'));
    assert.equal(balance.unpaidCents, 500);
    assert.equal(balance.payeeId, 'store-x');
    assert.deepEqual(ids(await expectOk(ownerX.get<Page<WithId<Payout>>>('/payouts'))), [storePayout]);
    assert.equal((await expectOk(ownerX.get<WithId<Payout>>(`/payouts/${storePayout}`))).netCents, 10_000);

    await expectError(ownerX.get('/ledger-entries?payeeType=store&payeeId=store-y'), 'permission-denied');
    await expectError(ownerX.get('/ledger/balance?payeeType=store&payeeId=store-y'), 'permission-denied');
    await expectError(ownerX.get('/payouts?payeeType=store&payeeId=store-y'), 'permission-denied');
    await expectError(ownerX.get(`/payouts/store_store-y_${runKeyOf(ctx.clock.now())}`), 'permission-denied');
    await expectError(ownerX.get(`/payouts/${driverPayout}`), 'permission-denied');
    await expectError(
      ownerX.get(`/ledger-entries?payeeType=driver&payeeId=${driver.uid}`),
      'permission-denied',
    );
    await expectError(ownerY.get(`/payouts/${storePayout}`), 'permission-denied');
  });

  test('store staff (not owners) are denied everything', async () => {
    for (const path of [
      '/ledger-entries',
      '/ledger-entries?payeeType=store&payeeId=store-x',
      '/ledger/balance',
      '/payouts',
      `/payouts/${storePayout}`,
    ]) {
      await expectError(staffX.get(path), 'permission-denied');
    }
  });

  test('a driver reads their own; never another driver or a store', async () => {
    assert.deepEqual(ids(await expectOk(driver.get<Page<WithId<LedgerEntry>>>('/ledger-entries'))), [
      'delivery_d',
      'later_d',
    ]);
    assert.equal((await expectOk(driver.get<LedgerBalance>('/ledger/balance'))).unpaidCents, 300);
    assert.deepEqual(ids(await expectOk(driver.get<Page<WithId<Payout>>>('/payouts'))), [driverPayout]);
    await expectOk(driver.get(`/payouts/${driverPayout}`));
    await expectError(
      driver.get(`/ledger-entries?payeeType=driver&payeeId=${otherDriver.uid}`),
      'permission-denied',
    );
    await expectError(driver.get('/ledger-entries?payeeType=store&payeeId=store-x'), 'permission-denied');
    await expectError(driver.get(`/payouts/${storePayout}`), 'permission-denied');
    await expectError(otherDriver.get(`/payouts/${driverPayout}`), 'permission-denied');
    // A pending driver still reads their own earnings (policy `driver`, any status).
    assert.deepEqual(ids(await expectOk(pendingDriver.get<Page<WithId<LedgerEntry>>>('/ledger-entries'))), [
      'delivery_p',
    ]);
  });

  test('a customer is denied', async () => {
    for (const path of ['/ledger-entries', '/ledger/balance', '/payouts', `/payouts/${storePayout}`]) {
      await expectError(customer.get(path), 'permission-denied');
    }
  });

  test('staff read every payee and filter freely on lists; the balance needs a payee', async () => {
    for (const staff of [dispatcher, admin]) {
      const all = await expectOk(staff.get<Page<WithId<LedgerEntry>>>('/ledger-entries?limit=500'));
      assert.equal(all.items.length, 7);
      const payouts = await expectOk(staff.get<Page<WithId<Payout>>>('/payouts'));
      assert.equal(payouts.items.length, 5);
      await expectOk(staff.get(`/payouts/${storePayout}`));
      await expectOk(staff.get(`/ledger/balance?payeeType=driver&payeeId=${driver.uid}`));
      await expectError(staff.get('/ledger/balance'), 'invalid-argument');
      const drivers = await expectOk(staff.get<Page<WithId<Payout>>>('/payouts?payeeType=driver'));
      assert.equal(drivers.items.length, 3, 'staff may filter by payee type alone');
      const onlyX = await expectOk(staff.get<Page<WithId<LedgerEntry>>>('/ledger-entries?payeeId=store-x'));
      assert.deepEqual(ids(onlyX), ['later_x', 'sale_x']);
      const byRun = await expectOk(
        staff.get<Page<WithId<Payout>>>(`/payouts?runKey=${runKeyOf(ctx.clock.now())}&status=pending`),
      );
      assert.equal(byRun.items.length, 5);
    }
  });

  test('pages neither skip nor repeat', async () => {
    const first = await expectOk(dispatcher.get<Page<WithId<LedgerEntry>>>('/ledger-entries?limit=4'));
    assert.equal(first.items.length, 4);
    assert.ok(first.nextCursor);
    const second = await expectOk(
      dispatcher.get<Page<WithId<LedgerEntry>>>(
        `/ledger-entries?limit=4&cursor=${encodeURIComponent(first.nextCursor)}`,
      ),
    );
    assert.equal(second.items.length, 3);
    assert.equal(second.nextCursor, null);
    const all = [...first.items, ...second.items].map((e) => e.id);
    assert.equal(new Set(all).size, 7);
    await expectError(dispatcher.get('/ledger-entries?cursor=nonsense'), 'invalid-argument');
  });
});
