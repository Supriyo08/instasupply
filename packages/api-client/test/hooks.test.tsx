import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();
// React checks this flag to know that `act` is in use.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { ApiClient } from '../src/client';
import type { QueryDescriptor, QueryResult } from '../src/query/types';
import { ApiProvider, useApiMutation, useFileUrl, useLiveQuery, useSessionCore } from '../src/react';
import { createTestClient, type FakeAnswer } from '../src/testing';

import { signedIn } from './support';

after(async () => {
  await GlobalRegistrator.unregister();
});

function wrapperFor(client: ApiClient) {
  return ({ children }: { children: ReactNode }) => <ApiProvider client={client}>{children}</ApiProvider>;
}

type Kit = Awaited<ReturnType<typeof signedIn>> | ReturnType<typeof createTestClient>;

async function settle(kit: Kit, ms = 0): Promise<void> {
  await act(async () => {
    await kit.clock.advance(ms);
  });
}

test('useLiveQuery: the result sequence across a key change', async () => {
  const kit = await signedIn();
  const releases = new Map<string, (answer: FakeAnswer) => void>();
  kit.server.on('GET', '/lists/:name', (_request, params) =>
    new Promise<FakeAnswer>((resolve) => releases.set(params.name ?? '', resolve)),
  );
  const list = (name: string): QueryDescriptor<string[]> => ({
    key: ['things', name],
    empty: [],
    topics: [`thing:${name}`],
    fetch: ({ client, signal }) => client.get<string[]>(`/lists/${name}`, { signal }),
  });
  const seen: Pick<QueryResult<string[]>, 'data' | 'loading'>[] = [];
  const { result, rerender, unmount } = renderHook(
    ({ name }: { name: string }) => {
      const value = useLiveQuery(list(name));
      seen.push({ data: value.data, loading: value.loading });
      return value;
    },
    { initialProps: { name: 'a' }, wrapper: wrapperFor(kit.client) },
  );
  assert.equal(result.current.loading, true);
  assert.deepEqual(result.current.data, []);
  await settle(kit);
  await act(async () => releases.get('a')?.({ body: ['a1'] }));
  await settle(kit);
  assert.equal(result.current.loading, false);
  assert.deepEqual(result.current.data, ['a1']);

  seen.length = 0;
  rerender({ name: 'b' });
  // The render in which the key changed already says loading, with the old rows kept.
  assert.deepEqual(seen[0], { data: ['a1'], loading: true });
  await settle(kit);
  await act(async () => releases.get('b')?.({ body: ['b1'] }));
  await settle(kit);
  assert.deepEqual(seen.at(-1), { data: ['b1'], loading: false });
  assert.ok(seen.every((entry) => entry.loading || entry.data[0] === 'b1'));
  assert.equal(typeof result.current.retry, 'function');
  unmount();
});

test('useApiMutation: busy while running; a double call returns the first promise', async () => {
  const kit = await signedIn();
  let release: (answer: FakeAnswer) => void = () => undefined;
  let calls = 0;
  kit.server.on('POST', '/call/claimJob', () => {
    calls += 1;
    return new Promise<FakeAnswer>((resolve) => (release = resolve));
  });
  const { result } = renderHook(
    () => useApiMutation((api, deliveryId: string) => api.call('claimJob', { deliveryId })),
    { wrapper: wrapperFor(kit.client) },
  );
  assert.equal(result.current.busy, false);
  let first: Promise<unknown> = Promise.resolve();
  let second: Promise<unknown> = Promise.resolve();
  act(() => {
    first = result.current.run('d1');
    second = result.current.run('d1');
  });
  assert.equal(first, second);
  assert.equal(result.current.busy, true);
  await settle(kit);
  await act(async () => {
    release({ body: { deliveryId: 'd1', status: 'accepted' } });
    await first;
  });
  assert.equal(result.current.busy, false);
  assert.equal(result.current.error, null);
  assert.equal(calls, 1);

  kit.server.on('POST', '/call/claimJob', () => ({ status: 'failed-precondition', code: 'JOB_TAKEN', message: 'Taken.' }));
  await act(async () => {
    await result.current.run('d2').catch(() => undefined);
  });
  assert.equal(result.current.error?.status, 'failed-precondition');
  act(() => result.current.reset());
  assert.equal(result.current.error, null);
});

test('useSessionCore re-renders when the session changes', async () => {
  const kit = createTestClient();
  kit.server.addAccount({ email: 'a@example.com', password: 'pw-123456', profile: null });
  const { result } = renderHook(() => useSessionCore(), { wrapper: wrapperFor(kit.client) });
  await settle(kit);
  assert.equal(result.current.status, 'signed_out');
  await act(async () => {
    await kit.client.session.signIn({ email: 'a@example.com', password: 'pw-123456' });
  });
  assert.equal(result.current.status, 'signed_in');
  assert.equal(result.current.user?.email, 'a@example.com');
  await act(async () => {
    await kit.client.session.signOut();
  });
  assert.equal(result.current.status, 'signed_out');
  assert.equal(result.current.endReason, 'signed_out');
  kit.client.dispose();
});

test('useFileUrl refreshes the URL a minute before it expires', async () => {
  const kit = await signedIn();
  let n = 0;
  kit.server.on('GET', '/files/url', (request) => {
    n += 1;
    return {
      body: { url: `https://files.test/${request.query.get('path')}?v=${n}`, expiresAt: kit.clock.now() + 300_000 },
    };
  });
  const { result, rerender } = renderHook(({ path }: { path: string | null }) => useFileUrl(path), {
    initialProps: { path: null as string | null },
    wrapper: wrapperFor(kit.client),
  });
  assert.equal(result.current.url, null);
  assert.equal(result.current.loading, false);
  assert.equal(n, 0, 'a null path loads nothing');
  rerender({ path: 'proofs/d1/p.jpg' });
  await settle(kit);
  assert.equal(result.current.url, 'https://files.test/proofs/d1/p.jpg?v=1');
  await settle(kit, 239_000);
  assert.equal(n, 1);
  await settle(kit, 1_000);
  assert.equal(n, 2);
  assert.equal(result.current.url, 'https://files.test/proofs/d1/p.jpg?v=2');
});
