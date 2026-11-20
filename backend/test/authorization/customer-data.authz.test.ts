/**
 * The caller's own data (docs/PLATFORM.md §5.3.3, §7.3, §12.4; MARKETPLACE §13.2): jobsites, cards,
 * favourites, the cart, "Buy again", the profile fields of PATCH /me, and registerCustomer. Per endpoint one
 * allowed and one denied case for the actors of §13.2; jobsite validation (postal code, NANP, province, service
 * area, a pin-only new build); a client-set `lastUsedAt` or `createdAt` is an unknown key; cards refuse
 * `number`, `cvv` and brand `rupay`; another user's rows are unreachable; the "default flag" race of §12.3.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import type { Jobsite, MeResponse, Page, SavedCard } from '@instasupply/shared';
import {
  newCustomer,
  newDispatcher,
  newDriver,
  newSupplier,
  signIn,
  type ActorClient,
} from '../support/actors';
import { createTestContext, type TestContext } from '../support/database';
import { createAccount } from '../support/fixtures';
import { command, expectError, expectOk, get, put } from '../support/http';
import { race } from '../support/race';

let ctx: TestContext;
let customerA: ActorClient;
let customerB: ActorClient;
let supplier: ActorClient;
let driver: ActorClient;
let dispatcher: ActorClient;

const JOBSITE = {
  label: 'Leslieville semi reno',
  line1: 'Pape Ave & Dundas St E',
  line2: null,
  city: 'Toronto',
  province: 'ON',
  postalCode: 'M4M 2E3',
  location: { lat: 43.6648, lng: -79.3405 },
  cityId: 'toronto',
  areaLabel: 'Leslieville · M4M',
  contactName: 'Dana Whitfield',
  contactPhone: '(416) 555-0110',
  instructions: 'Laneway access off Pape.',
  receiving: 'attended',
  maxVehicleClass: null,
  isDefault: false,
};

const CARD = {
  brand: 'visa',
  last4: '4242',
  expMonth: 12,
  expYear: 2030,
  holder: 'Dana Whitfield',
  isDefault: false,
};

before(async () => {
  ctx = await createTestContext();
  customerA = await newCustomer(ctx);
  customerB = await newCustomer(ctx);
  supplier = await newSupplier(ctx);
  driver = await newDriver(ctx);
  dispatcher = await newDispatcher(ctx);
});

after(async () => {
  await ctx?.close();
});

describe('customer data (MARKETPLACE §6.2 jobsites, cards, favourites, cart → PLATFORM §5.3.3)', () => {
  test('anonymous callers are unauthenticated; drivers, suppliers and staff are not customers', async () => {
    for (const path of ['/me/jobsites', '/me/cards', '/me/favorites', '/me/buy-again', '/me/cart']) {
      await expectError(get(ctx, path), 401);
      for (const other of [driver, supplier, dispatcher]) await expectError(other.get(path), 403);
    }
    await expectError(put(ctx, `/me/jobsites/${randomUUID()}`, JOBSITE), 401);
    await expectError(driver.put(`/me/jobsites/${randomUUID()}`, JOBSITE), 403);
    await expectError(supplier.put(`/me/cards/${randomUUID()}`, CARD), 403);
    await expectError(dispatcher.put(`/me/favorites/kestrel-lumber--kly-spf248`), 403);
  });

  test('jobsites: create, list default first, replace; lastUsedAt and createdAt are kept by the server', async () => {
    const id = randomUUID();
    const created = await expectOk(customerA.put<Jobsite>(`/me/jobsites/${id}`, { ...JOBSITE, id }));
    assert.equal(created.id, id);
    assert.equal(created.isDefault, true, 'the first jobsite is always the default');
    assert.equal(created.contactPhone, '+14165550110', 'the phone comes back normalized');
    assert.equal(created.lastUsedAt, null);
    const second = randomUUID();
    await expectOk(
      customerA.put<Jobsite>(`/me/jobsites/${second}`, { ...JOBSITE, label: 'Junction basement' }),
    );
    const replaced = await expectOk(
      customerA.put<Jobsite>(`/me/jobsites/${second}`, {
        ...JOBSITE,
        label: 'Junction basement',
        isDefault: true,
      }),
    );
    assert.equal(replaced.isDefault, true);
    const list = await expectOk(customerA.get<Page<Jobsite>>('/me/jobsites?limit=500'));
    assert.deepEqual(
      list.items.map((site) => [site.id, site.isDefault]),
      [
        [second, true],
        [id, false],
      ],
    );
    await expectError(customerA.put(`/me/jobsites/${id}`, { ...JOBSITE, lastUsedAt: Date.now() }), 400);
    await expectError(customerA.put(`/me/jobsites/${id}`, { ...JOBSITE, createdAt: Date.now() }), 400);
    await expectError(customerA.put(`/me/jobsites/${id}`, { ...JOBSITE, id: randomUUID() }), 400);
    await expectError(customerA.put('/me/jobsites/not-a-uuid', JOBSITE), 400);
  });

  test('jobsite validation: postal code, NANP phone, province, service area; a pin-only new build is fine', async () => {
    const bad = async (patch: Record<string, unknown>, field: string) => {
      const envelope = await expectError(
        customerA.put(`/me/jobsites/${randomUUID()}`, { ...JOBSITE, ...patch }),
        400,
      );
      assert.ok(
        field in (envelope.details.fields as Record<string, string>),
        `${field}: ${JSON.stringify(envelope)}`,
      );
    };
    await bad({ postalCode: 'V6B 1A1' }, 'postalCode');
    await bad({ contactPhone: '+44 20 7946 0958' }, 'contactPhone');
    await bad({ province: 'QC' }, 'province');
    await bad({ location: { lat: 45.5017, lng: -73.5673 } }, 'location');
    await bad({ cityId: 'montreal' }, 'cityId');
    const newBuild = await expectOk(
      customerA.put<Jobsite>(`/me/jobsites/${randomUUID()}`, {
        ...JOBSITE,
        label: 'New build lot 14',
        line1: 'Lot 14, Mattamy Way',
        postalCode: null,
      }),
    );
    assert.equal(newBuild.postalCode, null);
  });

  test("another customer's jobsite is unreachable: not listed, already-exists on PUT, not-found on DELETE", async () => {
    const id = randomUUID();
    await expectOk(customerA.put(`/me/jobsites/${id}`, JOBSITE));
    const theirs = await expectOk(customerB.get<Page<Jobsite>>('/me/jobsites'));
    assert.ok(!theirs.items.some((site) => site.id === id));
    await expectError(customerB.put(`/me/jobsites/${id}`, JOBSITE), 409);
    await expectError(customerB.del(`/me/jobsites/${id}`), 404);
    const mine = await expectOk(customerA.get<Page<Jobsite>>('/me/jobsites'));
    assert.ok(mine.items.some((site) => site.id === id && site.label === JOBSITE.label));
  });

  test('deleting the default jobsite makes the most recently used one the default', async () => {
    const owner = await newCustomer(ctx);
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    await expectOk(owner.put(`/me/jobsites/${a}`, { ...JOBSITE, isDefault: true }));
    await expectOk(owner.put(`/me/jobsites/${b}`, { ...JOBSITE, label: 'B' }));
    await expectOk(owner.put(`/me/jobsites/${c}`, { ...JOBSITE, label: 'C' }));
    await ctx.pool.query('UPDATE jobsites SET last_used_at = $2 WHERE id = $1', [
      b,
      new Date(ctx.clock.now()),
    ]);
    await expectOk(owner.del(`/me/jobsites/${a}`), 204);
    const list = await expectOk(owner.get<Page<Jobsite>>('/me/jobsites'));
    assert.deepEqual(list.items[0] && [list.items[0].id, list.items[0].isDefault], [b, true]);
    assert.equal(list.items.filter((site) => site.isDefault).length, 1);
  });

  test('default flag race: two PUTs with isDefault true at once → exactly one default, no 23505 (×25)', async () => {
    await race({
      times: 25,
      setup: async () => {
        const owner = await newCustomer(ctx);
        const ids = [randomUUID(), randomUUID(), randomUUID()];
        await expectOk(owner.put(`/me/jobsites/${ids[0]}`, { ...JOBSITE, isDefault: true }));
        return { owner, ids };
      },
      run: ({ owner, ids }) => [
        () => owner.put(`/me/jobsites/${ids[1]}`, { ...JOBSITE, label: 'One', isDefault: true }),
        () => owner.put(`/me/jobsites/${ids[2]}`, { ...JOBSITE, label: 'Two', isDefault: true }),
      ],
      check: async (results, { owner }) => {
        for (const result of results) assert.equal(result.status, 200, JSON.stringify(result.body));
        const { rows } = await ctx.pool.query<{ n: string }>(
          'SELECT count(*) AS n FROM jobsites WHERE user_id = $1 AND is_default',
          [owner.uid],
        );
        assert.equal(Number(rows[0]!.n), 1);
      },
    });
  });

  test('cards: brand, last 4, expiry, holder and the default flag only; number, cvv and rupay are refused', async () => {
    const id = randomUUID();
    const saved = await expectOk(customerA.put<SavedCard>(`/me/cards/${id}`, { ...CARD, id }));
    assert.deepEqual(
      { ...saved, createdAt: undefined },
      {
        id,
        brand: 'visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2030,
        holder: 'Dana Whitfield',
        isDefault: true,
        createdAt: undefined,
      },
    );
    assert.ok(!('provider' in saved) && !('providerRef' in saved));
    await expectError(
      customerA.put(`/me/cards/${randomUUID()}`, { ...CARD, number: '4242424242424242' }),
      400,
    );
    await expectError(customerA.put(`/me/cards/${randomUUID()}`, { ...CARD, cvv: '123' }), 400);
    await expectError(customerA.put(`/me/cards/${randomUUID()}`, { ...CARD, brand: 'rupay' }), 400);
    await expectError(customerA.put(`/me/cards/${randomUUID()}`, { ...CARD, last4: '42' }), 400);
    await expectError(customerA.put(`/me/cards/${randomUUID()}`, { ...CARD, expMonth: 13 }), 400);
    await expectError(customerB.put(`/me/cards/${id}`, CARD), 409);
    await expectError(customerB.del(`/me/cards/${id}`), 404);
    const theirs = await expectOk(customerB.get<Page<SavedCard>>('/me/cards'));
    assert.ok(!theirs.items.some((card) => card.id === id));
    await expectOk(customerA.del(`/me/cards/${id}`), 204);
  });

  test('PAYMENTS_MODE=disabled: saving a card fails with PAYMENTS_DISABLED', async () => {
    const disabled = await createTestContext({ env: { PAYMENTS_MODE: 'disabled' } });
    try {
      const customer = await newCustomer(disabled);
      await expectError(customer.put(`/me/cards/${randomUUID()}`, CARD), 412, 'PAYMENTS_DISABLED');
    } finally {
      await disabled.close();
    }
  });

  test('favourites: idempotent PUT and DELETE, newest first, own only', async () => {
    await expectOk(customerA.put('/me/favorites/kestrel-lumber--kly-spf248'), 204);
    ctx.clock.advance(1000);
    await expectOk(customerA.put('/me/favorites/kestrel-lumber--kly-osb716'), 204);
    await expectOk(customerA.put('/me/favorites/kestrel-lumber--kly-osb716'), 204);
    const list = await expectOk(
      customerA.get<Page<{ id: string; productId: string }>>('/me/favorites?limit=500'),
    );
    assert.deepEqual(
      list.items.map((f) => f.id),
      ['kestrel-lumber--kly-osb716', 'kestrel-lumber--kly-spf248'],
    );
    const paged = await expectOk(customerA.get<Page<{ id: string }>>('/me/favorites?limit=1'));
    assert.equal(paged.items.length, 1);
    const next = await expectOk(
      customerA.get<Page<{ id: string }>>(`/me/favorites?limit=1&cursor=${paged.nextCursor}`),
    );
    assert.deepEqual(
      next.items.map((f) => f.id),
      ['kestrel-lumber--kly-spf248'],
    );
    const others = await expectOk(customerB.get<Page<unknown>>('/me/favorites'));
    assert.equal(others.items.length, 0);
    await expectOk(customerA.del('/me/favorites/kestrel-lumber--kly-spf248'), 204);
    await expectOk(customerA.del('/me/favorites/kestrel-lumber--kly-spf248'), 204);
  });

  test('cart (P1): own only; bounds of the lines and of the promo code; unknown keys refused', async () => {
    await expectError(customerA.get('/me/cart'), 404);
    const cart = {
      lines: [{ productId: 'kestrel-lumber--kly-spf248', storeId: 'kestrel-lumber', quantity: 20 }],
      promoCode: 'BUILD25',
      unloadHelpStoreIds: ['kestrel-lumber'],
      fulfilment: 'delivery',
      jobsiteId: null,
    };
    const saved = await expectOk(customerA.put<{ updatedAt: number }>('/me/cart', cart));
    assert.equal(saved.updatedAt, ctx.clock.now());
    assert.deepEqual(
      { ...(await expectOk(customerA.get<Record<string, unknown>>('/me/cart'))), updatedAt: 0 },
      { ...cart, updatedAt: 0 },
    );
    await expectError(customerB.get('/me/cart'), 404);
    await expectError(customerA.put('/me/cart', { ...cart, promoCode: 'X' }), 400);
    await expectError(customerA.put('/me/cart', { ...cart, updatedAt: 1 }), 400);
    await expectError(
      customerA.put('/me/cart', { ...cart, unloadHelpStoreIds: ['a', 'b', 'c', 'd', 'e', 'f'] }),
      400,
    );
    await expectError(
      customerA.put('/me/cart', {
        ...cart,
        lines: Array.from({ length: 101 }, (_, i) => ({ productId: `p${i}`, storeId: 's', quantity: 1 })),
      }),
      400,
    );
    await expectOk(customerA.del('/me/cart'), 204);
    await expectError(customerA.get('/me/cart'), 404);
  });

  test('buy again: an empty rail for a new customer; customers only', async () => {
    const rail = await expectOk(customerB.get<Page<unknown>>('/me/buy-again'));
    assert.deepEqual(rail, { items: [], nextCursor: null });
  });

  test('PATCH /me: only the five profile fields; never role, status, store or stats', async () => {
    const me = await expectOk(
      customerA.patch<MeResponse>('/me', {
        displayName: '  Dana   W. ',
        preferences: { promoPush: true },
        companyName: 'Whitfield Renovations',
        accountType: 'builder',
      }),
    );
    assert.equal(me.profile?.displayName, 'Dana W.');
    assert.equal(me.profile?.companyName, 'Whitfield Renovations');
    assert.equal(me.profile?.accountType, 'builder');
    assert.equal(me.profile?.preferences?.promoPush, true);
    assert.equal(me.profile?.preferences?.orderPush, true, 'preferences are merged, not replaced');
    for (const forbidden of [
      { role: 'admin' },
      { status: 'active' },
      { storeId: 'kestrel-lumber' },
      { stats: { nonCancelledOrders: 0 } },
      { promoUses: {} },
      { phoneVerified: true },
      { preferences: { unknownPush: true } },
      { photoURL: 'https://example.com/a.png' },
    ]) {
      await expectError(customerA.patch('/me', forbidden), 400);
    }
    await expectError(customerA.patch('/me', { photoPath: 'avatars/someone/else.png' }), 400);
    await expectError(customerA.patch('/me', { displayName: '' }), 400);
    await expectError(driver.patch('/me', { companyName: 'Not a customer' }), 400);
    await expectOk(driver.patch('/me', { displayName: 'Marco B.' }));
  });

  test('registerCustomer: a role-less account becomes an active customer; repeatable; other roles refused', async () => {
    const fresh = await createAccount(ctx, { role: null, displayName: '' });
    const login = await signIn(ctx, fresh, { app: 'customer' });
    await expectError(get(ctx, '/me/jobsites', { token: login.token }), 403);
    await expectError(command(ctx, 'registerCustomer', {}, login.token), 400);
    const answer = await expectOk(
      command(ctx, 'registerCustomer', { displayName: 'Jo Builder', marketingOptIn: true }, login.token),
    );
    assert.deepEqual(answer, { status: 'active' });
    const me = await expectOk(get<MeResponse>(ctx, '/me', { token: login.token }));
    assert.equal(me.profile?.role, 'customer');
    assert.deepEqual(me.profile?.stats, { nonCancelledOrders: 0, completedOrders: 0, lastOrderAt: null });
    assert.equal(me.profile?.preferences?.promoPush, true);
    const again = await expectOk(command(ctx, 'registerCustomer', { displayName: 'Jo B.' }, login.token));
    assert.deepEqual(again, { status: 'active' });
    const renamed = await expectOk(get<MeResponse>(ctx, '/me', { token: login.token }));
    assert.equal(renamed.profile?.displayName, 'Jo B.');
    await expectError(driver.call('registerCustomer', { displayName: 'Driver' }), 412);
    await expectError(dispatcher.call('registerCustomer', { displayName: 'Staff' }), 412);
    await expectError(command(ctx, 'registerCustomer', { displayName: 'Anon' }), 401);
  });
});
