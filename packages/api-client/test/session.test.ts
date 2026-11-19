import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { QueryDescriptor } from '../src/query/types';
import { STORAGE_KEYS } from '../src/platform';
import { createFakeLifecycle, createMemoryStorage, createTestClient } from '../src/testing';

import { requestsTo, signedIn } from './support';

/** A second runtime (an app restart) on the same server, with copies of the first one's storage. */
function restart(kit: Awaited<ReturnType<typeof signedIn>>, options: { withCache: boolean }) {
  return createTestClient({
    server: kit.server,
    clock: kit.clock,
    secretStorage: createMemoryStorage(kit.secrets.dump()),
    cacheStorage: createMemoryStorage(options.withCache ? kit.cache.dump() : {}),
  });
}

test('start with a cached profile is signed_in and stale at once, then confirmed', async () => {
  const kit = await signedIn();
  const next = restart(kit, { withCache: true });
  const snapshot = await next.client.session.whenRestored();
  assert.equal(snapshot.status, 'signed_in');
  assert.equal(snapshot.stale, true);
  assert.equal(snapshot.user?.uid, kit.uid);
  await next.clock.advance(0);
  assert.equal(next.client.session.getSnapshot().stale, false);
  assert.equal(requestsTo(next, 'POST', '/auth/refresh').length >= 1, true);
});

test('start with tokens, no cached profile and no network gives `problem`, then recovers', async () => {
  const kit = await signedIn();
  const next = restart(kit, { withCache: false });
  next.server.failNext(1, 'network');
  const snapshot = await next.client.session.whenRestored();
  assert.equal(snapshot.status, 'restoring');
  assert.equal(snapshot.problem?.status, 'unavailable');
  await next.clock.advance(5_000);
  const after = next.client.session.getSnapshot();
  assert.equal(after.status, 'signed_in');
  assert.equal(after.problem, null);
  assert.equal(after.stale, false);
});

test('sign-out without a network queues the logout and cleans the device', async () => {
  const kit = await signedIn();
  const refreshToken = JSON.parse(kit.secrets.dump()[STORAGE_KEYS.session] ?? '{}').refreshToken as string;
  kit.server.failNext(1, 'network');
  await kit.client.session.signOut();
  const snapshot = kit.client.session.getSnapshot();
  assert.equal(snapshot.status, 'signed_out');
  assert.equal(snapshot.endReason, 'signed_out');
  const secrets = kit.secrets.dump();
  assert.equal(secrets[STORAGE_KEYS.session], undefined);
  assert.deepEqual(JSON.parse(secrets[STORAGE_KEYS.logoutQueue] ?? '[]'), [refreshToken]);
  assert.equal(kit.cache.dump()[STORAGE_KEYS.me], undefined);

  // The queued logout is sent at the next start.
  const next = restart(kit, { withCache: false });
  await next.client.session.whenRestored();
  await next.clock.advance(0);
  const logouts = requestsTo(next, 'POST', '/auth/logout');
  assert.equal((logouts.at(-1)?.body as { refreshToken: string }).refreshToken, refreshToken);
  assert.equal(next.secrets.dump()[STORAGE_KEYS.logoutQueue], undefined);
});

test('a queued logout is also sent when the network returns', async () => {
  const kit = await signedIn();
  kit.server.failNext(1, 'network');
  await kit.client.session.signOut();
  kit.client.start();
  await kit.clock.advance(0);
  const before = requestsTo(kit, 'POST', '/auth/logout').length;
  kit.lifecycle.emit('online');
  await kit.clock.advance(0);
  assert.equal(requestsTo(kit, 'POST', '/auth/logout').length, before + 1);
  assert.equal(kit.secrets.dump()[STORAGE_KEYS.logoutQueue], undefined);
  kit.client.dispose();
});

test('an event on user:{uid} refreshes the profile', async () => {
  const kit = await signedIn();
  kit.client.start();
  await kit.clock.advance(0);
  assert.equal(kit.client.live.getState(), 'open');
  assert.ok(kit.server.subscribedTopics().includes(`user:${kit.uid}`));
  const before = requestsTo(kit, 'GET', '/me').length;
  kit.server.emit({ topic: `user:${kit.uid}`, kind: 'updated', id: kit.uid, at: kit.clock.now() });
  await kit.clock.advance(0);
  assert.equal(requestsTo(kit, 'GET', '/me').length, before + 1);
  kit.client.dispose();
});

test('a uid change clears private queries and keeps public ones', async () => {
  const kit = await signedIn();
  kit.server.on('GET', '/private', (request) => ({ body: { owner: request.uid } }));
  kit.server.on('GET', '/public', () => ({ body: { hello: 'world' } }));
  const privateQuery: QueryDescriptor<{ owner: string } | null> = {
    key: ['private-thing'],
    empty: null,
    fetch: ({ client, signal }) => client.get('/private', { signal }),
  };
  const publicQuery: QueryDescriptor<{ hello: string } | null> = {
    key: ['public-thing'],
    empty: null,
    auth: 'none',
    fetch: ({ client, signal }) => client.get('/public', { signal, auth: 'none' }),
  };
  await kit.client.cache.prefetch(privateQuery);
  await kit.client.cache.prefetch(publicQuery);
  assert.deepEqual(kit.client.cache.getData(['private-thing']), { owner: kit.uid });
  await kit.client.session.signOut();
  assert.equal(kit.client.cache.getData(['private-thing']), undefined);
  assert.deepEqual(kit.client.cache.getData(['public-thing']), { hello: 'world' });
});

test('signIn rejected with account_suspended stays signed out with endReason suspended', async () => {
  const kit = createTestClient({ lifecycle: createFakeLifecycle() });
  const { uid } = kit.server.addAccount({ email: 'x@example.com', password: 'pw-123456', profile: null });
  kit.server.revokeSessions(uid, 'account_suspended');
  await assert.rejects(kit.client.session.signIn({ email: 'x@example.com', password: 'pw-123456' }));
  const snapshot = kit.client.session.getSnapshot();
  assert.equal(snapshot.status, 'signed_out');
  assert.equal(snapshot.endReason, 'suspended');
  kit.client.session.acknowledgeEnd();
  assert.equal(kit.client.session.getSnapshot().endReason, null);
});

test('register gives a session without a profile; the name shows until the profile exists', async () => {
  const kit = createTestClient();
  const snapshot = await kit.client.session.register({
    email: 'new@example.com',
    password: 'pw-123456',
    displayName: 'Sam Builder',
  });
  assert.equal(snapshot.status, 'signed_in');
  assert.equal(snapshot.profile, null);
  assert.equal(snapshot.user?.displayName, 'Sam Builder');
  const body = requestsTo(kit, 'POST', '/auth/register')[0]?.body as Record<string, unknown>;
  assert.equal(body.app, 'customer');
  assert.equal(typeof body.installationId, 'string');
});
