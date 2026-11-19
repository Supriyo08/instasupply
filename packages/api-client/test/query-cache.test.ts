import assert from 'node:assert/strict';
import { test } from 'node:test';

import { QueryObserver } from '../src/query/observer';
import { QueryCacheImpl } from '../src/query/query-cache';
import { REFETCH, type QueryDescriptor, type QueryResult } from '../src/query/types';
import { createTestClient, type FakeAnswer } from '../src/testing';

import { signedIn } from './support';

type Kit = Awaited<ReturnType<typeof signedIn>> | ReturnType<typeof createTestClient>;

/** A route whose answers the test controls: each request waits until `release` is called. */
function controlled(kit: Kit, path: string) {
  const waiting: ((answer: FakeAnswer) => void)[] = [];
  let count = 0;
  kit.server.on('GET', path, () => {
    count += 1;
    return new Promise<FakeAnswer>((resolve) => waiting.push(resolve));
  });
  return {
    count: () => count,
    pending: () => waiting.length,
    release(answer: FakeAnswer) {
      const next = waiting.shift();
      assert.ok(next, `no request waiting on ${path}`);
      next(answer);
    },
  };
}

function counter(kit: Kit, path: string, body: (n: number) => unknown = (n) => ({ n })) {
  let n = 0;
  kit.server.on('GET', path, () => {
    n += 1;
    return { body: body(n) };
  });
  return () => n;
}

function doc<T>(key: string, path: string, extra: Partial<QueryDescriptor<T | null>> = {}): QueryDescriptor<T | null> {
  return {
    key: [key, 'x'],
    empty: null,
    fetch: ({ client, signal }) => client.get<T>(path, { signal }),
    ...extra,
  };
}

const cacheOf = (kit: Kit) => kit.client.cache as QueryCacheImpl;

test('one fetch and one result for N observers of the same key', async () => {
  const kit = await signedIn();
  const fetches = counter(kit, '/orders/x');
  const query = doc<{ n: number }>('order', '/orders/x');
  const observers = Array.from({ length: 5 }, () => kit.client.cache.observe(query, { live: false }, () => undefined));
  await kit.clock.advance(0);
  assert.equal(fetches(), 1);
  const results = observers.map((o) => o.getResult());
  assert.ok(results.every((r) => r === results[0]), 'the same result object');
  assert.deepEqual(results[0]?.data, { n: 1 });
  for (const o of observers) o.unsubscribe();
});

test('keepPreviousData: a list keeps the previous key\'s data with loading true; a document does not', async () => {
  const kit = await signedIn();
  const a = controlled(kit, '/lists/a');
  const b = controlled(kit, '/lists/b');
  const list = (name: string): QueryDescriptor<string[]> => ({
    key: ['things', name],
    empty: [],
    fetch: ({ client, signal }) => client.get<string[]>(`/lists/${name}`, { signal }),
  });
  const observer = new QueryObserver<string[]>(cacheOf(kit));
  let stop = observer.observe(list('a'), false, () => undefined);
  await kit.clock.advance(0);
  a.release({ body: ['a1'] });
  await kit.clock.advance(0);
  assert.deepEqual(observer.getResult(list('a')).data, ['a1']);
  // The key changes: the very first render already says loading, with the old rows on screen.
  const switching = observer.getResult(list('b'));
  assert.equal(switching.loading, true);
  assert.deepEqual(switching.data, ['a1']);
  stop();
  stop = observer.observe(list('b'), false, () => undefined);
  await kit.clock.advance(0);
  assert.deepEqual(observer.getResult(list('b')).data, ['a1']);
  b.release({ body: ['b1'] });
  await kit.clock.advance(0);
  const settled = observer.getResult(list('b'));
  assert.equal(settled.loading, false);
  assert.deepEqual(settled.data, ['b1']);
  stop();

  const docs = new QueryObserver<{ n: number } | null>(cacheOf(kit));
  counter(kit, '/docs/1');
  counter(kit, '/docs/2');
  const one = (id: string) => ({ ...doc<{ n: number }>('doc', `/docs/${id}`), key: ['doc', id] });
  const stopDoc = docs.observe(one('1'), false, () => undefined);
  await kit.clock.advance(0);
  assert.deepEqual(docs.getResult(one('1')).data, { n: 1 });
  const next = docs.getResult(one('2'));
  assert.equal(next.loading, true);
  assert.equal(next.data, null);
  stopDoc();
});

test('events refetch at most once per minRefetchMs, with one trailing refetch for the burst', async () => {
  const kit = await signedIn();
  const fetches = counter(kit, '/ops/dashboard');
  const query = doc<{ n: number }>('ops-dashboard', '/ops/dashboard', {
    topics: ['ops:orders'],
    minRefetchMs: 5_000,
  });
  const o = kit.client.cache.observe(query, { live: true }, () => undefined);
  kit.client.start();
  await kit.clock.advance(0);
  const base = fetches();
  const emit = () => kit.server.emit({ topic: 'ops:orders', kind: 'updated', id: 'o', at: kit.clock.now() });
  emit();
  await kit.clock.advance(0);
  assert.equal(fetches(), base + 1);
  emit();
  emit();
  emit();
  await kit.clock.advance(4_999);
  assert.equal(fetches(), base + 1);
  await kit.clock.advance(1);
  assert.equal(fetches(), base + 2);
  o.unsubscribe();
  kit.client.dispose();
});

test('an event or an invalidation during a fetch gives one trailing refetch', async () => {
  const kit = await signedIn();
  const route = controlled(kit, '/orders/x');
  const query = doc<{ n: number }>('order', '/orders/x', { topics: ['order:x'] });
  const o = kit.client.cache.observe(query, { live: true }, () => undefined);
  await kit.clock.advance(0);
  assert.equal(route.count(), 1);
  void kit.client.cache.invalidate(['order']);
  void kit.client.cache.invalidate(['order', 'x']);
  route.release({ body: { n: 1 } });
  await kit.clock.advance(0);
  assert.equal(route.count(), 2, 'exactly one trailing fetch');
  route.release({ body: { n: 2 } });
  await kit.clock.advance(0);
  assert.equal(route.count(), 2);
  assert.deepEqual(o.getResult().data, { n: 2 });
  o.unsubscribe();
});

test('reduce folds payload events; REFETCH asks for a normal refetch', async () => {
  const kit = await signedIn();
  const fetches = counter(kit, '/threads/d1/messages', () => [{ id: 'm1', text: 'hi' }]);
  const query: QueryDescriptor<{ id: string; text: string }[]> = {
    key: ['chat-messages', 'd1'],
    empty: [],
    topics: ['thread:d1'],
    fetch: ({ client, signal }) => client.get('/threads/d1/messages', { signal }),
    reduce: (current, event) =>
      event.kind === 'message' && event.data ? [...current, event.data as { id: string; text: string }] : REFETCH,
  };
  const o = kit.client.cache.observe(query, { live: true }, () => undefined);
  kit.client.start();
  await kit.clock.advance(0);
  const base = fetches();
  kit.server.emit({ topic: 'thread:d1', kind: 'message', id: 'm2', at: 1, data: { id: 'm2', text: 'there' } });
  await kit.clock.advance(0);
  assert.deepEqual(o.getResult().data.map((m) => m.id), ['m1', 'm2']);
  assert.equal(fetches(), base, 'folded without a request');
  kit.server.emit({ topic: 'thread:d1', kind: 'updated', id: 'd1', at: 2 });
  await kit.clock.advance(0);
  assert.equal(fetches(), base + 1);
  o.unsubscribe();
  kit.client.dispose();
});

test('polling runs only while the socket is not open', async () => {
  const kit = await signedIn();
  const fetches = counter(kit, '/orders/x');
  const query = doc<{ n: number }>('order', '/orders/x', { topics: ['order:x'], pollMs: 10_000 });
  const o = kit.client.cache.observe(query, { live: true }, () => undefined);
  await kit.clock.advance(0);
  // The socket is not started: the query polls.
  await kit.clock.advance(30_000);
  assert.equal(fetches(), 4);
  kit.client.start();
  await kit.clock.advance(0);
  const atOpen = fetches();
  await kit.clock.advance(60_000);
  assert.equal(fetches(), atOpen, 'open socket: no polling');
  // A plain (non-live) observer never polls.
  const plain = kit.client.cache.observe(doc('other', '/orders/x', { pollMs: 1_000 }), { live: false }, () => undefined);
  kit.client.live.stop();
  await kit.clock.advance(0);
  const stopped = fetches();
  await kit.clock.advance(10_000);
  assert.equal(fetches(), stopped + 1, 'only the live entry polls');
  plain.unsubscribe();
  o.unsubscribe();
});

test('error rows: first failure shows the error and retries after 2, 5 and 15 s', async () => {
  const kit = await signedIn();
  let fail = true;
  let attempts = 0;
  kit.server.on('GET', '/orders/x', () => {
    attempts += 1;
    return fail ? { status: 'unavailable', message: 'busy' } : { body: { n: attempts } };
  });
  // The pipeline itself repeats a GET twice (300 + 900 ms) before the cache sees the failure.
  const query = doc<{ n: number }>('order', '/orders/x');
  const o = kit.client.cache.observe(query, { live: false }, () => undefined);
  await kit.clock.advance(1_200);
  let result: QueryResult<{ n: number } | null> = o.getResult();
  assert.equal(result.loading, false);
  assert.equal(result.error?.status, 'unavailable');
  assert.equal(result.data, null);
  assert.equal(attempts, 3);
  await kit.clock.advance(2_000 + 1_200);
  assert.equal(attempts, 6, 'retried after 2 s');
  fail = false;
  await kit.clock.advance(5_000);
  result = o.getResult();
  assert.equal(result.error, null);
  assert.deepEqual(result.data, { n: 7 });
  o.unsubscribe();
});

test('error rows: a retryable refetch failure keeps the data; permission-denied clears it', async () => {
  const kit = await signedIn();
  let answer: FakeAnswer = { body: { n: 1 } };
  kit.server.on('GET', '/orders/x', () => answer);
  const o = kit.client.cache.observe(doc<{ n: number }>('order', '/orders/x'), { live: false }, () => undefined);
  await kit.clock.advance(0);
  answer = { status: 'unavailable', message: 'busy' };
  void kit.client.cache.invalidate(['order']);
  await kit.clock.advance(1_200);
  let result = o.getResult();
  assert.deepEqual(result.data, { n: 1 });
  assert.equal(result.error, null);
  answer = { status: 'permission-denied', message: 'Not yours.' };
  void kit.client.cache.invalidate(['order']);
  await kit.clock.advance(0);
  result = o.getResult();
  assert.equal(result.data, null);
  assert.equal(result.error?.status, 'permission-denied');
  o.unsubscribe();
});

test('auth gating: loading while restoring, empty while signed out, fetched once signed in', async () => {
  const kit = createTestClient();
  const fetches = counter(kit, '/orders/x');
  const query = doc<{ n: number }>('order', '/orders/x');
  const o = kit.client.cache.observe(query, { live: false }, () => undefined);
  assert.equal(o.getResult().loading, true, 'restoring');
  await kit.client.session.whenRestored();
  const signedOut = o.getResult();
  assert.equal(signedOut.loading, false);
  assert.equal(signedOut.error, null);
  assert.equal(fetches(), 0);
  kit.server.addAccount({ email: 'a@example.com', password: 'pw-123456', profile: null });
  await kit.client.session.signIn({ email: 'a@example.com', password: 'pw-123456' });
  await kit.clock.advance(0);
  assert.equal(fetches(), 1);
  assert.deepEqual(o.getResult().data, { n: 1 });
  o.unsubscribe();
});

test('a disabled descriptor fetches nothing', async () => {
  const kit = await signedIn();
  const fetches = counter(kit, '/orders/x');
  const o = kit.client.cache.observe(doc('order', '/orders/x', { enabled: false }), { live: true }, () => undefined);
  await kit.clock.advance(60_000);
  assert.equal(fetches(), 0);
  assert.deepEqual(o.getResult(), { ...o.getResult(), data: null, loading: false, error: null });
  o.unsubscribe();
});

test('garbage collection: an entry without observers is dropped after gcMs', async () => {
  const kit = await signedIn();
  const fetches = counter(kit, '/orders/x');
  const query = doc<{ n: number }>('order', '/orders/x', { gcMs: 60_000, staleMs: 120_000 });
  const first = kit.client.cache.observe(query, { live: false }, () => undefined);
  await kit.clock.advance(0);
  first.unsubscribe();
  await kit.clock.advance(59_000);
  assert.deepEqual(kit.client.cache.getData(['order', 'x']), { n: 1 });
  const again = kit.client.cache.observe(query, { live: false }, () => undefined);
  await kit.clock.advance(0);
  assert.equal(fetches(), 1, 'fresh cached data is served without a request');
  again.unsubscribe();
  await kit.clock.advance(60_000);
  assert.equal(kit.client.cache.getData(['order', 'x']), undefined);
});
