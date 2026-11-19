import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CALLABLES } from '@instasupply/shared';

import { CALL_INVALIDATIONS } from '../src/callables';
import type { ApiError } from '../src/errors';
import type { QueryDescriptor } from '../src/query/types';

import { requestsTo, signedIn } from './support';

function observeOrders(kit: Awaited<ReturnType<typeof signedIn>>) {
  let fetches = 0;
  kit.server.on('GET', '/orders/o1', () => {
    fetches += 1;
    return { body: { id: 'o1', fetch: fetches } };
  });
  const query: QueryDescriptor<{ id: string } | null> = {
    key: ['order', 'o1'],
    empty: null,
    fetch: ({ client, signal }) => client.get('/orders/o1', { signal }),
  };
  const observation = kit.client.cache.observe(query, { live: false }, () => undefined);
  return { observation, fetches: () => fetches };
}

test('call sends POST /call/<name> with the request as the body and resolves with the answer', async () => {
  const kit = await signedIn();
  kit.server.on('POST', '/call/cancelOrder', (request) => ({
    body: { cancelled: [(request.body as { orderId: string }).orderId], notCancellable: [] },
  }));
  const result = await kit.client.call('cancelOrder', { orderId: 'o1' });
  assert.deepEqual(result, { cancelled: ['o1'], notCancellable: [] });
  const [sent] = requestsTo(kit, 'POST', '/call/cancelOrder');
  assert.deepEqual(sent?.body, { orderId: 'o1' });
  assert.match(sent?.headers.get('authorization') ?? '', /^Bearer at_/);
  assert.equal(sent?.headers.get('content-type'), 'application/json');
  assert.equal(sent?.headers.get('x-client'), 'customer/1.0.0 (android)');
});

test('a public command works signed out and sends no bearer', async () => {
  const kit = await signedIn();
  await kit.client.session.signOut();
  kit.server.on('POST', '/call/suggestStore', () => ({ body: { ok: true } }));
  await kit.client.call('suggestStore', {
    storeName: 'Kestrel',
    city: 'Toronto',
    interests: [],
    email: null,
  });
  const [sent] = requestsTo(kit, 'POST', '/call/suggestStore');
  assert.equal(sent?.headers.get('authorization'), null);
});

test('default invalidations refetch the observed families, and refresh the profile where listed', async () => {
  const kit = await signedIn();
  const orders = observeOrders(kit);
  await kit.clock.advance(0);
  assert.equal(orders.fetches(), 1);
  kit.server.on('POST', '/call/cancelOrder', () => ({ body: { cancelled: ['o1'], notCancellable: [] } }));
  const meBefore = requestsTo(kit, 'GET', '/me').length;
  await kit.client.call('cancelOrder', { orderId: 'o1' });
  await kit.clock.advance(0);
  assert.equal(orders.fetches(), 2);
  assert.equal(requestsTo(kit, 'GET', '/me').length, meBefore + 1);
  orders.observation.unsubscribe();
});

test('`invalidate: false` skips the default invalidation', async () => {
  const kit = await signedIn();
  const orders = observeOrders(kit);
  await kit.clock.advance(0);
  kit.server.on('POST', '/call/cancelOrder', () => ({ body: { cancelled: [], notCancellable: [] } }));
  await kit.client.call('cancelOrder', { orderId: 'o1' }, { invalidate: false });
  await kit.clock.advance(0);
  assert.equal(orders.fetches(), 1);
  orders.observation.unsubscribe();
});

test('a command is never repeated by the client', async () => {
  const kit = await signedIn();
  kit.server.on('POST', '/call/claimJob', () => ({ body: { deliveryId: 'd1', status: 'accepted' } }));
  kit.server.failNext(1, 503);
  await assert.rejects(kit.client.call('claimJob', { deliveryId: 'd1' }), (e: unknown) => {
    assert.equal((e as ApiError).status, 'unavailable');
    return true;
  });
  // The 503 was answered before the handler: no claim request reached it, and none was retried.
  assert.equal(requestsTo(kit, 'POST', '/call/claimJob').length, 0);
  kit.server.failNext(1, 'network');
  await assert.rejects(kit.client.call('claimJob', { deliveryId: 'd1' }));
  assert.equal(requestsTo(kit, 'POST', '/call/claimJob').length, 0);
  const ok = await kit.client.call('claimJob', { deliveryId: 'd1' });
  assert.equal(ok.status, 'accepted');
  assert.equal(requestsTo(kit, 'POST', '/call/claimJob').length, 1);
});

test('every command has an invalidation rule and a path', () => {
  assert.deepEqual(Object.keys(CALL_INVALIDATIONS).sort(), Object.keys(CALLABLES).sort());
  assert.equal(Object.keys(CALLABLES).length, 39);
});
