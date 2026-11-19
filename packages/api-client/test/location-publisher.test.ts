import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Fix, LocationReport } from '../src/contract';
import { LocationPublisher, PUBLISH_BACKOFF_MS } from '../src/driver/location-publisher';
import { createFakeClock, createFakeServer, type FakeAnswer } from '../src/testing';

import { requestsTo, signedIn } from './support';

async function setup() {
  const clock = createFakeClock();
  const server = createFakeServer({ clock });
  let offline = false;
  const fetch: typeof globalThis.fetch = (input, init) =>
    offline && String(input).includes('/me/location') ? Promise.reject(new TypeError('offline')) : server.fetch(input, init);
  const kit = await signedIn({ server, clock, fetch });
  let answer: () => FakeAnswer = () => ({ body: { online: true, serverTime: clock.now() } });
  kit.server.on('POST', '/me/location', () => answer());
  const publisher = new LocationPublisher(kit.client, { battery: async () => 0.8 });
  let lat = 43.65;
  const fix = (overrides: Partial<Fix> = {}): Fix => ({
    lat,
    lng: -79.38,
    heading: null,
    speed: null,
    accuracy: 10,
    at: clock.now(),
    ...overrides,
  });
  /** A fix about 111 m further north. */
  const moved = (overrides: Partial<Fix> = {}): Fix => {
    lat += 0.001;
    return fix(overrides);
  };
  const reports = () => requestsTo(kit, 'POST', '/me/location').map((r) => r.body as LocationReport);
  return {
    kit,
    clock,
    publisher,
    fix,
    moved,
    reports,
    setOffline: (value: boolean) => (offline = value),
    answerWith: (next: () => FakeAnswer) => (answer = next),
  };
}

test('the first fix is accepted and sent with the battery level', async () => {
  const t = await setup();
  assert.equal(await t.publisher.ingest([t.fix()], { mode: 'normal' }), 'sent');
  const [report] = t.reports();
  assert.equal(report?.fixes.length, 1);
  assert.equal(report?.online, true);
  assert.equal(report?.mode, 'normal');
  assert.equal(report?.battery, 0.8);
  assert.notEqual(t.publisher.getState().lastSentAt, null);
});

test('jitter under 25 m and under 10 s is dropped', async () => {
  const t = await setup();
  await t.publisher.ingest([t.fix()], { mode: 'normal' });
  await t.clock.advance(5_000);
  assert.equal(await t.publisher.ingest([t.fix({ lat: 43.65005 })], { mode: 'normal' }), 'skipped');
  await t.clock.advance(6_000);
  // 11 s, but only ~5 m: still dropped.
  assert.equal(await t.publisher.ingest([t.fix({ lat: 43.65005 })], { mode: 'normal' }), 'skipped');
  await t.clock.advance(1_000);
  assert.equal(await t.publisher.ingest([t.moved()], { mode: 'normal' }), 'sent');
  assert.equal(t.reports().length, 2);
});

test('without movement a heartbeat is accepted after 60 s (20 s in live)', async () => {
  const t = await setup();
  await t.publisher.ingest([t.fix()], { mode: 'normal' });
  await t.clock.advance(59_000);
  assert.equal(await t.publisher.ingest([t.fix()], { mode: 'normal' }), 'skipped');
  await t.clock.advance(1_000);
  assert.equal(await t.publisher.ingest([t.fix()], { mode: 'normal' }), 'sent');
  await t.clock.advance(19_000);
  assert.equal(await t.publisher.ingest([t.fix()], { mode: 'live' }), 'skipped');
  await t.clock.advance(1_000);
  assert.equal(await t.publisher.ingest([t.fix()], { mode: 'live' }), 'sent');
});

test('a fix with 400 m accuracy is dropped unless the heartbeat is due', async () => {
  const t = await setup();
  await t.publisher.ingest([t.fix()], { mode: 'normal' });
  await t.clock.advance(15_000);
  assert.equal(await t.publisher.ingest([t.moved({ accuracy: 400 })], { mode: 'normal' }), 'skipped');
  await t.clock.advance(45_000);
  assert.equal(await t.publisher.ingest([t.moved({ accuracy: 400 })], { mode: 'normal' }), 'sent');
});

test('30 fixes while offline leave 20 queued and one request when the network returns', async () => {
  const t = await setup();
  await t.publisher.ingest([t.fix()], { mode: 'normal' });
  t.setOffline(true);
  for (let i = 0; i < 30; i += 1) {
    await t.clock.advance(10_000);
    await t.publisher.ingest([t.moved()], { mode: 'normal' });
  }
  assert.equal(t.publisher.getState().queued, 20);
  assert.equal(t.publisher.getState().lastError?.status, 'unavailable');
  const sentBefore = t.reports().length;
  t.setOffline(false);
  await t.clock.advance(60_000);
  assert.equal(await t.publisher.ingest([t.moved()], { mode: 'normal' }), 'sent');
  const reports = t.reports().slice(sentBefore);
  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.fixes.length, 20);
  assert.ok((reports[0]?.fixes ?? []).every((f, i, all) => i === 0 || (all[i - 1]?.at ?? 0) <= f.at), 'oldest first');
  assert.equal(t.publisher.getState().queued, 0);
});

test('back-off after failures: 5, 10, 20, 40, then 60 s', async () => {
  assert.deepEqual(PUBLISH_BACKOFF_MS, [5_000, 10_000, 20_000, 40_000, 60_000]);
  const t = await setup();
  await t.publisher.ingest([t.fix()], { mode: 'live' });
  t.answerWith(() => ({ status: 'unavailable', message: 'down' }));
  const attempts = () => t.reports().length;
  await t.clock.advance(4_000);
  await t.publisher.ingest([t.moved()], { mode: 'live' }); // fails: next not before 5 s
  const gaps: number[] = [];
  let last = t.clock.now();
  let count = attempts();
  for (let elapsed = 0; elapsed < 200_000; elapsed += 1_000) {
    await t.clock.advance(1_000);
    await t.publisher.ingest([t.moved()], { mode: 'live' });
    if (attempts() > count) {
      gaps.push(t.clock.now() - last);
      last = t.clock.now();
      count = attempts();
    }
  }
  assert.deepEqual(gaps.slice(0, 5), [5_000, 10_000, 20_000, 40_000, 60_000]);
});

test('RATE_LIMITED waits details.retryAfterMs', async () => {
  const t = await setup();
  await t.publisher.ingest([t.fix()], { mode: 'live' });
  let limited = true;
  t.answerWith(() =>
    limited
      ? { status: 'resource-exhausted', code: 'RATE_LIMITED', message: 'Slow down.', details: { retryAfterMs: 7_000 } }
      : { body: { online: true, serverTime: 0 } },
  );
  await t.clock.advance(4_000);
  assert.equal(await t.publisher.ingest([t.moved()], { mode: 'live' }), 'queued');
  limited = false;
  await t.clock.advance(6_000);
  assert.equal(await t.publisher.ingest([t.moved()], { mode: 'live' }), 'queued', 'still inside retryAfterMs');
  await t.clock.advance(1_000);
  assert.equal(await t.publisher.ingest([t.moved()], { mode: 'live' }), 'sent');
});

test('a revoked session stops the publisher with reason session', async () => {
  const t = await setup();
  await t.publisher.ingest([t.fix()], { mode: 'normal' });
  t.kit.server.revokeSessions(t.kit.uid, 'session_revoked');
  await t.clock.advance(15_000);
  assert.equal(await t.publisher.ingest([t.moved()], { mode: 'normal' }), 'stopped');
  assert.equal(t.publisher.getState().stopped, 'session');
  assert.equal(t.publisher.getState().queued, 0);
  assert.equal(await t.publisher.ingest([t.moved()], { mode: 'normal' }), 'stopped');
});

test('permission-denied stops the publisher with reason forbidden', async () => {
  const t = await setup();
  t.answerWith(() => ({ status: 'permission-denied', message: 'Not an active driver.' }));
  assert.equal(await t.publisher.ingest([t.fix()], { mode: 'normal' }), 'stopped');
  assert.equal(t.publisher.getState().stopped, 'forbidden');
  t.publisher.reset();
  assert.equal(t.publisher.getState().stopped, null);
});

test('ack.online false stops with reason forbidden', async () => {
  const t = await setup();
  t.answerWith(() => ({ body: { online: false, serverTime: 0 } }));
  assert.equal(await t.publisher.ingest([t.fix()], { mode: 'normal' }), 'stopped');
  assert.equal(t.publisher.getState().stopped, 'forbidden');
});

test('a lost refresh answer does not end the session', async () => {
  const t = await setup();
  await t.publisher.ingest([t.fix()], { mode: 'normal' });
  await t.clock.advance(900_000);
  t.kit.server.dropAnswers(1); // the refresh's answer
  assert.equal(await t.publisher.ingest([t.moved()], { mode: 'normal' }), 'queued');
  assert.equal(t.publisher.getState().stopped, null);
  assert.equal(t.kit.client.session.getSnapshot().status, 'signed_in');
  await t.clock.advance(5_000);
  assert.equal(await t.publisher.ingest([t.moved()], { mode: 'normal' }), 'sent');
});

test('setOnline(false) sends at once, even inside the throttle window', async () => {
  const t = await setup();
  await t.publisher.ingest([t.fix()], { mode: 'normal' });
  await t.clock.advance(1_000);
  const ack = await t.publisher.setOnline(false, t.fix(), 'normal');
  assert.equal(ack.online, true);
  const last = t.reports().at(-1);
  assert.equal(last?.online, false);
  assert.equal(t.reports().length, 2);
});

test('setOnline retries once after RATE_LIMITED, then rejects', async () => {
  const t = await setup();
  t.answerWith(() => ({ status: 'resource-exhausted', message: 'x', details: { retryAfterMs: 2_000 } }));
  const pending = t.publisher.setOnline(true, t.fix(), 'normal').catch((e: unknown) => e);
  await t.clock.advance(2_000);
  const error = (await pending) as { status: string };
  assert.equal(error.status, 'resource-exhausted');
  assert.equal(t.reports().length, 2);
});
