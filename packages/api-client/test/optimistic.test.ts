import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ApiError } from '../src/errors';
import { MutationRunner } from '../src/query/mutation';
import type { QueryCacheImpl } from '../src/query/query-cache';
import type { QueryDescriptor } from '../src/query/types';
import type { FakeAnswer } from '../src/testing';

import { signedIn } from './support';

interface Fav {
  id: string;
}

async function setup() {
  const kit = await signedIn();
  let server: Fav[] = [{ id: 'p1' }];
  const releases: (() => void)[] = [];
  let holdRefetch = false;
  kit.server.on('GET', '/me/favorites', () => {
    const snapshot = server.slice();
    const answer: FakeAnswer = { body: snapshot };
    if (!holdRefetch) return answer;
    return new Promise<FakeAnswer>((resolve) => releases.push(() => resolve(answer)));
  });
  let failWrite = false;
  const failIds = new Set<string>();
  kit.server.on('PUT', '/me/favorites/:id', (_request, params) => {
    if (failWrite || failIds.has(params.id ?? '')) return { status: 'internal', message: 'boom' };
    server = [{ id: params.id ?? '' }, ...server];
    return { status: 204 };
  });
  const query: QueryDescriptor<Fav[]> = {
    key: ['favorites', kit.uid],
    empty: [],
    fetch: ({ client, signal }) => client.get('/me/favorites', { signal }),
  };
  const observation = kit.client.cache.observe(query, { live: false }, () => undefined);
  await kit.clock.advance(0);
  const runner = new MutationRunner<{ id: string }, void>(kit.client, kit.client.cache as QueryCacheImpl, () => undefined);
  const add = (id: string) =>
    runner.run((api, v) => api.favorites.add(v.id), { id }, {
      optimistic: (cache, v) => cache.patch<Fav[]>(query.key, (list) => [{ id: v.id }, ...list]),
    });
  const ids = () => observation.getResult().data.map((f) => f.id);
  return {
    kit,
    runner,
    add,
    ids,
    observation,
    failWrites: (on: boolean) => (failWrite = on),
    failId: (id: string) => failIds.add(id),
    holdRefetches: (on: boolean) => (holdRefetch = on),
    releaseRefetch: () => releases.shift()?.(),
  };
}

test('a patch shows at once and the confirmed list takes over', async () => {
  const t = await setup();
  const pending = t.add('p2');
  assert.deepEqual(t.ids(), ['p2', 'p1'], 'optimistic before the request answered');
  await pending;
  await t.kit.clock.advance(0);
  assert.deepEqual(t.ids(), ['p2', 'p1'], 'server data, patch removed');
  assert.equal(t.kit.client.cache.getData<Fav[]>(['favorites', t.kit.uid])?.length, 2);
});

test('a failed request rolls the patch back and rejects with ApiError', async () => {
  const t = await setup();
  t.failWrites(true);
  const pending = t.add('p2');
  assert.deepEqual(t.ids(), ['p2', 'p1']);
  await assert.rejects(pending, (e: unknown) => (e as ApiError).status === 'internal');
  assert.deepEqual(t.ids(), ['p1']);
  assert.equal(t.runner.getState().error?.status, 'internal');
  assert.equal(t.runner.getState().busy, false);
});

test('the patch stays until the refetch settles, so the value never flashes back', async () => {
  const t = await setup();
  t.holdRefetches(true);
  await t.add('p2');
  await t.kit.clock.advance(0);
  assert.deepEqual(t.ids(), ['p2', 'p1'], 'refetch still running: the patch holds');
  t.releaseRefetch();
  await t.kit.clock.advance(0);
  // Resource invalidation and the mutation's own invalidation coalesce into one trailing fetch.
  t.releaseRefetch();
  await t.kit.clock.advance(0);
  assert.deepEqual(t.ids(), ['p2', 'p1']);
  const data = t.kit.client.cache.getData<Fav[]>(['favorites', t.kit.uid]);
  assert.deepEqual(
    data?.map((f) => f.id),
    ['p2', 'p1'],
  );
});

test('two overlapping patches: a failure removes only its own', async () => {
  const t = await setup();
  const runner2 = new MutationRunner<{ id: string }, void>(
    t.kit.client,
    t.kit.client.cache as QueryCacheImpl,
    () => undefined,
  );
  t.holdRefetches(true);
  t.failId('p3');
  const first = t.add('p2');
  const second = runner2.run(
    (api, v) => api.favorites.add(v.id),
    { id: 'p3' },
    { optimistic: (cache, v) => cache.patch<Fav[]>(['favorites', t.kit.uid], (list) => [{ id: v.id }, ...list]) },
  );
  assert.deepEqual(t.ids(), ['p3', 'p2', 'p1']);
  await Promise.allSettled([first, second]);
  assert.deepEqual(t.ids(), ['p2', 'p1'], 'p3 rolled back, p2 still pending its refetch');
  t.holdRefetches(false);
  t.releaseRefetch();
  t.releaseRefetch();
  await t.kit.clock.advance(0);
  assert.deepEqual(t.ids(), ['p2', 'p1']);
});

test('a second run while busy returns the first promise', async () => {
  const t = await setup();
  const a = t.add('p2');
  const b = t.add('p9');
  assert.equal(a, b);
  await a;
  assert.deepEqual(t.ids().includes('p9'), false);
});
