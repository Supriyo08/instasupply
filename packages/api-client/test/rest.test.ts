import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ApiError } from '../src/errors';
import { buildQueryString } from '../src/http';
import { readAll } from '../src/rest';
import { createFakeClock, createFakeServer, createTestClient } from '../src/testing';

/** A client whose fetch counts every attempt, including those the fake server fails on purpose. */
function counted() {
  const clock = createFakeClock();
  const server = createFakeServer({ clock });
  const attempts: string[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    attempts.push(`${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`);
    return server.fetch(input, init);
  };
  const kit = createTestClient({ server, clock, fetch });
  return { ...kit, attempts };
}

test('query-string rules: nullish left out, arrays joined, booleans and numbers as text', () => {
  const qs = buildQueryString({
    status: ['new', 'accepted'],
    unpaid: true,
    held: false,
    createdSince: 1795123200000,
    sort: 'createdAt:desc',
    jobsiteId: null,
    cursor: undefined,
    empty: [],
    q: 'two by four & more',
  });
  const params = new URLSearchParams(qs.slice(1));
  assert.equal(params.get('status'), 'new,accepted');
  assert.equal(params.get('unpaid'), 'true');
  assert.equal(params.get('held'), 'false');
  assert.equal(params.get('createdSince'), '1795123200000');
  assert.equal(params.get('sort'), 'createdAt:desc');
  assert.equal(params.get('q'), 'two by four & more');
  for (const key of ['jobsiteId', 'cursor', 'empty']) assert.equal(params.has(key), false, key);
  assert.equal(buildQueryString({}), '');
});

test('list sends limit and cursor, readAll follows nextCursor', async () => {
  const { client, server } = createTestClient();
  server.on('GET', '/categories', (request) => {
    const cursor = request.query.get('cursor');
    return cursor === null
      ? { body: { items: [{ id: 'a' }, { id: 'b' }], nextCursor: 'c2' } }
      : { body: { items: [{ id: 'c' }], nextCursor: null } };
  });
  const page = await client.list<{ id: string }>('/categories', { auth: 'none', limit: 2 });
  assert.equal(page.nextCursor, 'c2');
  assert.equal(server.requests.at(-1)?.query.get('limit'), '2');
  const all = await readAll<{ id: string }>(client, '/categories', { auth: 'none' });
  assert.deepEqual(
    all.map((item) => item.id),
    ['a', 'b', 'c'],
  );
  assert.equal(server.requests.at(-1)?.query.get('cursor'), 'c2');
  assert.equal(server.requests.at(-1)?.query.get('limit'), '500');
});

test('notFoundAsNull turns a 404 into null; without it the 404 throws', async () => {
  const { client, server } = createTestClient();
  server.on('GET', '/threads/:id', () => ({ status: 'not-found', message: 'No thread yet.' }));
  assert.equal(await client.get('/threads/u1', { auth: 'none', notFoundAsNull: true }), null);
  await assert.rejects(
    client.get('/threads/u1', { auth: 'none' }),
    (e: unknown) => (e as ApiError).status === 'not-found',
  );
});

test('GET is repeated twice after 503, after 300 and 900 ms', async () => {
  const { client, server, clock, attempts } = counted();
  server.on('GET', '/stores', () => ({ body: { items: [], nextCursor: null } }));
  server.failNext(2, 503);
  let settled = false;
  const pending = client.get('/stores', { auth: 'none' }).finally(() => {
    settled = true;
  });
  await clock.advance(299);
  assert.equal(attempts.length, 1);
  await clock.advance(1);
  assert.equal(attempts.length, 2);
  await clock.advance(899);
  assert.equal(settled, false);
  await clock.advance(1);
  await pending;
  assert.equal(attempts.length, 3);
});

test('GET gives up after three attempts', async () => {
  const { client, server, clock, attempts } = counted();
  server.on('GET', '/stores', () => ({ body: { items: [], nextCursor: null } }));
  server.failNext(3, 503);
  const pending = client.get('/stores', { auth: 'none' }).catch((e: unknown) => e);
  await clock.advance(1_200);
  assert.equal(((await pending) as ApiError).status, 'unavailable');
  assert.equal(attempts.length, 3);
});

test('GET is never repeated after a 400', async () => {
  const { client, server, clock, attempts } = counted();
  server.on('GET', '/products', () => ({ status: 'invalid-argument', message: 'Bad sort.' }));
  const pending = client.get('/products', { auth: 'none' }).catch((e: unknown) => e);
  await clock.advance(5_000);
  assert.equal(((await pending) as ApiError).status, 'invalid-argument');
  assert.equal(attempts.length, 1);
});

test('writes are not repeated', async () => {
  const { client, server, clock, attempts } = counted();
  server.on('PUT', '/me/favorites/:id', () => ({ status: 204 }));
  for (const how of [503, 'network', 502] as const) {
    server.failNext(1, how);
    const pending = client.put('/me/favorites/p1', undefined, { auth: 'none' }).catch((e: unknown) => e);
    await clock.advance(5_000);
    assert.equal(((await pending) as ApiError).retryable, true);
  }
  assert.equal(attempts.length, 3);
});

test('a 204 resolves with undefined, a 200 with the document itself', async () => {
  const { client, server } = createTestClient();
  server.on('DELETE', '/me/cards/:id', () => ({ status: 204 }));
  server.on('GET', '/stores/:id', (_request, params) => ({ body: { id: params.id, name: 'Kestrel' } }));
  assert.equal(await client.delete('/me/cards/c1', { auth: 'none' }), undefined);
  assert.deepEqual(await client.get('/stores/kestrel-lumber', { auth: 'none' }), {
    id: 'kestrel-lumber',
    name: 'Kestrel',
  });
});
