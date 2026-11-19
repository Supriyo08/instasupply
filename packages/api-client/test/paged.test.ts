import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mergeFirstPage, PagedLoader, pagedEntryDescriptor, type PagedState } from '../src/query/paged';
import type { PagedQueryDescriptor } from '../src/query/types';

import { signedIn } from './support';

interface Row {
  id: string;
  v: number;
}
const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id, v: 1 }));
const idOf = (row: Row) => row.id;

async function setup() {
  const kit = await signedIn();
  // The server's full list, newest first; pages of 3.
  let all = rows('1', '2', '3', '4', '5');
  kit.server.on('GET', '/orders', (request) => {
    const start = Number(request.query.get('cursor') ?? 0);
    const items = all.slice(start, start + 3);
    const next = start + 3 < all.length ? String(start + 3) : null;
    return { body: { items, nextCursor: next } };
  });
  const paged: PagedQueryDescriptor<Row> = {
    key: ['orders', 'customer', kit.uid, 'past', null],
    topics: [`user:${kit.uid}:orders`],
    idOf,
    fetchPage: ({ client, signal }, cursor) => client.list<Row>('/orders', { signal, cursor }),
  };
  const descriptor = pagedEntryDescriptor(paged);
  const observation = kit.client.cache.observe(descriptor, { live: false }, () => undefined);
  const loader = new PagedLoader<Row>(
    kit.client.cache,
    () => ({ client: kit.client, signal: new AbortController().signal }),
    () => undefined,
  );
  await kit.clock.advance(0);
  const state = (): PagedState<Row> => observation.getResult().data;
  return {
    kit,
    paged,
    loader,
    state,
    setServer: (next: Row[]) => (all = next),
    refresh: async () => {
      await kit.client.cache.invalidate(paged.key);
    },
  };
}

test('load more appends the next page and ends with no cursor', async () => {
  const t = await setup();
  assert.deepEqual(t.state().items.map(idOf), ['1', '2', '3']);
  assert.equal(t.state().nextCursor, '3');
  await t.loader.loadMore(t.paged);
  assert.deepEqual(t.state().items.map(idOf), ['1', '2', '3', '4', '5']);
  assert.equal(t.state().nextCursor, null);
  await t.loader.loadMore(t.paged); // nothing more: no request
  assert.equal(t.kit.server.requests.filter((r) => r.path === '/orders').length, 2);
});

test('a refetch merges the fresh first page when its last item is in the loaded list', async () => {
  const t = await setup();
  await t.loader.loadMore(t.paged);
  // A new order on top, and order 2 changed.
  t.setServer([{ id: '0', v: 1 }, { id: '1', v: 1 }, { id: '2', v: 2 }, ...rows('3', '4', '5')]);
  await t.refresh();
  assert.deepEqual(t.state().items.map(idOf), ['0', '1', '2', '3', '4', '5']);
  assert.equal(t.state().items.find((r) => r.id === '2')?.v, 2, 'the fresh copy wins');
  assert.equal(t.state().nextCursor, null, 'the loaded tail keeps its cursor');
});

test('a refetch resets to the fresh first page when the anchor is not found', async () => {
  const t = await setup();
  await t.loader.loadMore(t.paged);
  t.setServer(rows('7', '8', '9', '10'));
  await t.refresh();
  assert.deepEqual(t.state().items.map(idOf), ['7', '8', '9']);
  assert.equal(t.state().nextCursor, '3');
});

test('mergeFirstPage rules', () => {
  const current: PagedState<Row> = { items: rows('a', 'b', 'c', 'd', 'e'), nextCursor: 'after-e' };
  assert.deepEqual(mergeFirstPage(current, { items: rows('x', 'a', 'b'), nextCursor: 'after-b' }, idOf), {
    items: rows('x', 'a', 'b', 'c', 'd', 'e'),
    nextCursor: 'after-e',
  });
  assert.deepEqual(mergeFirstPage(current, { items: rows('y', 'z'), nextCursor: 'after-z' }, idOf), {
    items: rows('y', 'z'),
    nextCursor: 'after-z',
  });
  assert.deepEqual(mergeFirstPage(undefined, { items: rows('a'), nextCursor: null }, idOf), {
    items: rows('a'),
    nextCursor: null,
  });
  // A row that moved into the fresh page is not repeated from the tail.
  assert.deepEqual(
    mergeFirstPage(current, { items: rows('d', 'a', 'b'), nextCursor: 'x' }, idOf).items.map(idOf),
    ['d', 'a', 'b', 'c', 'e'],
  );
});
