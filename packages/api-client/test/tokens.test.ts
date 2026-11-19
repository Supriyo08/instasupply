import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ApiError } from '../src/errors';
import { STORAGE_KEYS, type StoredSession } from '../src/platform';
import { createMemoryStorage } from '../src/testing';

import { requestsTo, signedIn } from './support';

function thing(kit: Awaited<ReturnType<typeof signedIn>>, log?: string[]) {
  const answer = (request: { uid: string | null; headers: Headers }) => {
    log?.push(`request ${request.headers.get('authorization')?.slice('Bearer '.length)}`);
    return request.uid
      ? { body: { ok: true } }
      : { status: 'unauthenticated' as const, message: 'x', details: { reason: 'token_invalid' } };
  };
  kit.server.on('GET', '/thing', answer);
  kit.server.on('POST', '/thing', answer);
}

function stored(kit: { secrets: { dump(): Record<string, string> } }): StoredSession | null {
  const raw = kit.secrets.dump()[STORAGE_KEYS.session];
  return raw ? (JSON.parse(raw) as StoredSession) : null;
}

test('ten parallel 401s cause one refresh and ten retries', async () => {
  const kit = await signedIn();
  thing(kit);
  kit.server.expireAccessTokens();
  const before = requestsTo(kit, 'POST', '/auth/refresh').length;
  const results = await Promise.all(
    Array.from({ length: 10 }, () => kit.client.get<{ ok: boolean }>('/thing')),
  );
  assert.equal(
    results.every((r) => r.ok),
    true,
  );
  assert.equal(requestsTo(kit, 'POST', '/auth/refresh').length - before, 1);
  assert.equal(requestsTo(kit, 'GET', '/thing').length, 20);
});

test('the new session is stored before the new access token is used', async () => {
  const memory = createMemoryStorage();
  // How many /thing requests had gone out when the rotated session reached storage.
  const sentAtStore: number[] = [];
  let kitRef: Awaited<ReturnType<typeof signedIn>> | null = null;
  const secretStorage = {
    ...memory,
    setItem: async (key: string, value: string) => {
      if (key === STORAGE_KEYS.session && kitRef)
        sentAtStore.push(requestsTo(kitRef, 'GET', '/thing').length);
      await memory.setItem(key, value);
    },
  };
  const kit = await signedIn({ secretStorage });
  kitRef = kit;
  thing(kit);
  kit.server.expireAccessTokens();
  await kit.client.get('/thing');
  const sent = requestsTo(kit, 'GET', '/thing');
  assert.equal(sent.length, 2);
  // Only the refused request had gone out when the new session was written.
  assert.deepEqual(sentAtStore, [1]);
  const tokenOf = (i: number) => sent[i]?.headers.get('authorization');
  assert.notEqual(tokenOf(0), tokenOf(1));
});

test('proactive refresh when the access token has under 60 s left', async () => {
  const kit = await signedIn();
  thing(kit);
  const refreshes = requestsTo(kit, 'POST', '/auth/refresh').length;
  await kit.clock.advance(841_000);
  await kit.client.get('/thing');
  assert.equal(requestsTo(kit, 'POST', '/auth/refresh').length, refreshes + 1);
  // The request went out once, with a fresh token: no 401 round trip.
  assert.equal(requestsTo(kit, 'GET', '/thing').length, 1);
});

test('a refresh that meets no network keeps the session', async () => {
  const kit = await signedIn();
  thing(kit);
  await kit.clock.advance(900_000);
  kit.server.failNext(1, 'network');
  await assert.rejects(kit.client.post('/thing'), (e: unknown) => (e as ApiError).status === 'unavailable');
  assert.equal(kit.client.session.getSnapshot().status, 'signed_in');
  assert.ok(stored(kit), 'the stored session is untouched');
  await kit.client.post('/thing');
});

for (const [name, setup, reason] of [
  [
    'token_expired',
    (kit: Awaited<ReturnType<typeof signedIn>>) =>
      kit.server.on('POST', '/auth/refresh', () => ({
        status: 'unauthenticated',
        message: 'expired',
        details: { reason: 'token_expired' },
      })),
    'expired',
  ],
  [
    'token_invalid',
    async (kit: Awaited<ReturnType<typeof signedIn>>) => {
      const session = stored(kit);
      assert.ok(session);
      await kit.secrets.setItem(
        STORAGE_KEYS.session,
        JSON.stringify({ ...session, refreshToken: 'isr_unknown' }),
      );
    },
    'expired',
  ],
  [
    'session_revoked',
    (kit: Awaited<ReturnType<typeof signedIn>>) => kit.server.revokeSessions(kit.uid, 'session_revoked'),
    'revoked',
  ],
  [
    'account_suspended',
    (kit: Awaited<ReturnType<typeof signedIn>>) => kit.server.revokeSessions(kit.uid, 'account_suspended'),
    'suspended',
  ],
] as const) {
  test(`a refresh answered with ${name} ends the session (${reason})`, async () => {
    const kit = await signedIn();
    thing(kit);
    await setup(kit);
    await kit.clock.advance(900_000);
    await assert.rejects(kit.client.post('/thing'));
    await kit.clock.advance(0);
    const snapshot = kit.client.session.getSnapshot();
    assert.equal(snapshot.status, 'signed_out');
    assert.equal(snapshot.endReason, reason);
    assert.equal(stored(kit), null);
    assert.equal(kit.cache.dump()[STORAGE_KEYS.me], undefined);
  });
}

test('a request answered with account_suspended ends the session with endReason suspended', async () => {
  const kit = await signedIn();
  thing(kit);
  kit.server.revokeSessions(kit.uid, 'account_suspended');
  await assert.rejects(
    kit.client.post('/thing'),
    (e: unknown) => (e as ApiError).authReason === 'account_suspended',
  );
  await kit.clock.advance(0);
  assert.equal(kit.client.session.getSnapshot().endReason, 'suspended');
});

test('a replayed refresh token (refresh_reused) ends the session as revoked', async () => {
  const kit = await signedIn();
  thing(kit);
  const first = stored(kit);
  assert.ok(first);
  // Rotate twice, so the first token's child has been used.
  await kit.clock.advance(900_000);
  await kit.client.post('/thing');
  await kit.clock.advance(900_000);
  await kit.client.post('/thing');
  await kit.secrets.setItem(STORAGE_KEYS.session, JSON.stringify(first));
  await kit.clock.advance(900_000);
  await assert.rejects(kit.client.post('/thing'));
  await kit.clock.advance(0);
  assert.equal(kit.client.session.getSnapshot().endReason, 'revoked');
});

test('a lost refresh answer, then the repeat with the same token, keeps the session', async () => {
  const kit = await signedIn();
  thing(kit);
  const before = stored(kit);
  await kit.clock.advance(900_000);
  kit.server.dropAnswers(1);
  await assert.rejects(kit.client.post('/thing'), (e: unknown) => (e as ApiError).isNetwork);
  assert.equal(kit.client.session.getSnapshot().status, 'signed_in');
  assert.equal(stored(kit)?.refreshToken, before?.refreshToken, 'nothing stored from the lost answer');
  await kit.client.post('/thing');
  const refreshes = requestsTo(kit, 'POST', '/auth/refresh').slice(-2);
  assert.deepEqual(
    refreshes.map((r) => (r as unknown as { body: { refreshToken: string } }).body.refreshToken),
    [before?.refreshToken, before?.refreshToken],
  );
  assert.notEqual(stored(kit)?.refreshToken, before?.refreshToken);
  assert.equal(kit.client.session.getSnapshot().status, 'signed_in');
});
