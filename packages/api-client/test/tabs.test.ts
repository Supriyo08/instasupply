import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RefreshLock } from '../src/platform';
import { createFakeClock, createFakeServer, createMemoryStorage, createTestClient } from '../src/testing';

import { customerProfile, EMAIL, PASSWORD, requestsTo } from './support';

/** What `navigator.locks` gives the console: one holder at a time, in arrival order. */
function createMutex(): RefreshLock & { order: string[] } {
  let tail: Promise<unknown> = Promise.resolve();
  const order: string[] = [];
  return {
    order,
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}

/** Two tabs: two clients over one server, one clock, one localStorage and one lock. */
async function twoTabs() {
  const clock = createFakeClock();
  const server = createFakeServer({ clock });
  const secrets = createMemoryStorage();
  const cache = createMemoryStorage();
  const lock = createMutex();
  const { uid } = server.addAccount({ email: EMAIL, password: PASSWORD, profile: null });
  server.on('GET', '/thing', (request) => (request.uid ? { body: { ok: true } } : { status: 'unauthenticated', message: 'x' }));
  const tab = () =>
    createTestClient({ server, clock, secretStorage: secrets, cacheStorage: cache, refreshLock: lock }).client;
  const a = tab();
  await a.session.signIn({ email: EMAIL, password: PASSWORD });
  const b = tab();
  await b.session.whenRestored();
  await clock.advance(0);
  return { clock, server, secrets, a, b, uid, lock };
}

test('two tabs refresh one after the other, each with the token the other stored', async () => {
  const { clock, server, a, b } = await twoTabs();
  assert.equal(a.session.getSnapshot().status, 'signed_in');
  assert.equal(b.session.getSnapshot().status, 'signed_in');
  await clock.advance(900_000);
  const before = requestsTo({ server }, 'POST', '/auth/refresh').length;
  const results = await Promise.all([a.get<{ ok: boolean }>('/thing'), b.get<{ ok: boolean }>('/thing')]);
  assert.deepEqual(results, [{ ok: true }, { ok: true }]);
  const refreshes = requestsTo({ server }, 'POST', '/auth/refresh').slice(before);
  assert.equal(refreshes.length, 2);
  const [first, second] = refreshes.map((r) => (r.body as { refreshToken: string }).refreshToken);
  assert.notEqual(first, second, 'the second tab used the token the first one rotated, not a stale copy');
  await clock.advance(0);
  assert.equal(a.session.getSnapshot().status, 'signed_in');
  assert.equal(b.session.getSnapshot().status, 'signed_in');
});

test('a sign-out in one tab signs the other tab out', async () => {
  const { clock, a, b } = await twoTabs();
  b.start();
  await clock.advance(0);
  await a.session.signOut();
  await clock.advance(0);
  const snapshot = b.session.getSnapshot();
  assert.equal(snapshot.status, 'signed_out');
  assert.equal(snapshot.endReason, 'signed_out');
  b.dispose();
});

test('another account signing in in one tab ends the other with `replaced`', async () => {
  const { clock, server, a, b } = await twoTabs();
  b.start();
  await clock.advance(0);
  const other = server.addAccount({ email: 'sam@example.com', password: PASSWORD, profile: null });
  server.on('GET', '/me', (request) => ({
    body: {
      account: { uid: request.uid ?? '', email: 'x', createdAt: 0 },
      profile: request.uid === other.uid ? customerProfile(other.uid) : null,
      store: null,
      serverTime: clock.now(),
    },
  }));
  await a.session.signIn({ email: 'sam@example.com', password: PASSWORD });
  await clock.advance(0);
  assert.equal(a.session.getSnapshot().user?.uid, other.uid);
  const snapshot = b.session.getSnapshot();
  assert.equal(snapshot.status, 'signed_out');
  assert.equal(snapshot.endReason, 'replaced');
  b.dispose();
});
