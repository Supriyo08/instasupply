import assert from 'node:assert/strict';
import { test } from 'node:test';

import { reconnectDelay } from '../src/live/backoff';
import type { QueryDescriptor } from '../src/query/types';
import { createTestClient } from '../src/testing';

import { requestsTo, signedIn } from './support';

type Kit = Awaited<ReturnType<typeof signedIn>> | ReturnType<typeof createTestClient>;

function framesOfType(kit: Kit, type: string) {
  return kit.server.frames.filter((entry) => entry.frame.type === type);
}

/** A live query on `order:o1`, with its fetch count. */
function liveOrder(kit: Kit, pollMs = 15_000) {
  let fetches = 0;
  kit.server.on('GET', '/orders/o1', () => {
    fetches += 1;
    return { body: { id: 'o1', n: fetches } };
  });
  const query: QueryDescriptor<{ id: string; n: number } | null> = {
    key: ['order', 'o1'],
    empty: null,
    topics: ['order:o1'],
    pollMs,
    fetch: ({ client, signal }) => client.get('/orders/o1', { signal }),
  };
  const observation = kit.client.cache.observe(query, { live: true }, () => undefined);
  return { observation, fetches: () => fetches };
}

test('signed in: auth first, then every topic in a subscribe frame, then open', async () => {
  const kit = await signedIn();
  kit.client.live.subscribe('order:o1', () => undefined);
  kit.client.start();
  await kit.clock.advance(0);
  assert.equal(kit.client.live.getState(), 'open');
  const types = kit.server.frames.map((entry) => entry.frame.type);
  assert.equal(types[0], 'auth');
  assert.equal(types[1], 'subscribe');
  const subscribe = kit.server.frames[1]?.frame;
  assert.ok(subscribe?.type === 'subscribe');
  assert.deepEqual([...subscribe.topics].sort(), ['order:o1', `user:${kit.uid}`].sort());
  assert.deepEqual(kit.server.subscribedTopics(), ['order:o1', `user:${kit.uid}`].sort());
  kit.client.dispose();
});

test('anonymous: subscribes to public topics without auth', async () => {
  const kit = createTestClient();
  const events: string[] = [];
  kit.client.live.subscribe('stores', (event) => events.push(event.kind));
  kit.client.start();
  await kit.clock.advance(0);
  assert.equal(kit.client.live.getState(), 'open');
  assert.equal(framesOfType(kit, 'auth').length, 0);
  assert.deepEqual(kit.server.subscribedTopics(), ['stores']);
  kit.server.emit({ topic: 'stores', kind: 'updated', id: 'kestrel-lumber', at: kit.clock.now() });
  await kit.clock.advance(0);
  assert.deepEqual(events, ['updated']);
  kit.client.dispose();
});

test('a topic added while open goes out in one frame per tick; the last listener leaving unsubscribes after 2 s', async () => {
  const kit = createTestClient();
  kit.client.start();
  await kit.clock.advance(0);
  const offA = kit.client.live.subscribe('product:p1', () => undefined);
  const offB = kit.client.live.subscribe('product:p2', () => undefined);
  await kit.clock.advance(0);
  const subscribes = framesOfType(kit, 'subscribe');
  assert.equal(subscribes.length, 1);
  offA();
  offB();
  await kit.clock.advance(1_999);
  assert.equal(framesOfType(kit, 'unsubscribe').length, 0);
  // A quick remount inside the grace period does not flap.
  const offC = kit.client.live.subscribe('product:p2', () => undefined);
  await kit.clock.advance(1);
  const unsubscribes = framesOfType(kit, 'unsubscribe');
  assert.equal(unsubscribes.length, 1);
  assert.deepEqual(unsubscribes[0]?.frame.type === 'unsubscribe' && unsubscribes[0].frame.topics, [
    'product:p1',
  ]);
  assert.deepEqual(kit.server.subscribedTopics(), ['product:p2']);
  offC();
  kit.client.dispose();
});

test('after a drop: reconnect with backoff, resubscribe, resync', async () => {
  const kit = await signedIn();
  const order = liveOrder(kit);
  let resyncs = 0;
  kit.client.live.onResync(() => (resyncs += 1));
  kit.client.start();
  await kit.clock.advance(0);
  assert.equal(resyncs, 1);
  const fetchesBefore = order.fetches();
  kit.server.closeSockets(1012);
  await kit.clock.advance(0);
  assert.equal(kit.client.live.getState(), 'waiting');
  // attempt 0, random 0.5: 500 × 0.75 = 375 ms
  await kit.clock.advance(374);
  assert.equal(kit.server.socketCount(), 1);
  await kit.clock.advance(1);
  assert.equal(kit.client.live.getState(), 'open');
  assert.equal(kit.server.socketCount(), 2);
  assert.equal(resyncs, 2);
  assert.ok(kit.server.subscribedTopics().includes('order:o1'));
  assert.equal(order.fetches(), fetchesBefore + 1, 'the resync refetched the live query');
  order.observation.unsubscribe();
  kit.client.dispose();
});

test('backoff sequence with a fixed random', async () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 7].map((attempt) => reconnectDelay(attempt, () => 1)),
    [500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000],
  );
  const delays: number[] = [];
  const kit = createTestClient({
    random: () => 0,
    onDebug: (event) => {
      if (event.type === 'live.reconnect-scheduled') delays.push(event.delay as number);
    },
  });
  kit.server.refuseSockets(true);
  kit.client.start();
  for (let i = 0; i < 8; i += 1) await kit.clock.advance(30_000);
  assert.deepEqual(delays.slice(0, 8), [250, 500, 1_000, 2_000, 4_000, 8_000, 15_000, 15_000]);
  // A connection that stays open 10 s puts the attempt back to 0.
  kit.server.refuseSockets(false);
  await kit.clock.advance(30_000);
  assert.equal(kit.client.live.getState(), 'open');
  await kit.clock.advance(10_000);
  kit.server.closeSockets(1012);
  await kit.clock.advance(0);
  assert.equal(delays.at(-1), 250);
  kit.client.dispose();
});

test('heartbeat: a ping every 25 s; no frame since the previous ping means the socket is dead', async () => {
  const kit = createTestClient();
  kit.client.start();
  await kit.clock.advance(0);
  await kit.clock.advance(100_000);
  assert.equal(framesOfType(kit, 'ping').length, 4);
  assert.equal(kit.server.socketCount(), 1, 'pongs keep the socket');
  kit.server.stallSockets(true);
  await kit.clock.advance(25_000); // ping sent, no pong
  assert.equal(kit.client.live.getState(), 'open');
  kit.server.stallSockets(false);
  await kit.clock.advance(25_000); // nothing arrived since that ping: dead
  assert.equal(kit.client.live.getState(), 'waiting');
  await kit.clock.advance(1_000);
  assert.equal(kit.client.live.getState(), 'open');
  assert.equal(kit.server.socketCount(), 2);
  kit.client.dispose();
});

test('4401: refresh, then reconnect at once', async () => {
  const kit = await signedIn();
  kit.client.start();
  await kit.clock.advance(0);
  const refreshes = requestsTo(kit, 'POST', '/auth/refresh').length;
  kit.server.closeSockets(4401);
  await kit.clock.advance(0);
  assert.equal(kit.client.live.getState(), 'open');
  assert.equal(kit.server.socketCount(), 2);
  assert.equal(requestsTo(kit, 'POST', '/auth/refresh').length, refreshes + 1);
  assert.equal(framesOfType(kit, 'auth').length, 2);
  kit.client.dispose();
});

test('the socket survives two access-token lifetimes without a 4401', async () => {
  const kit = await signedIn();
  kit.client.start();
  await kit.clock.advance(0);
  const refreshes = requestsTo(kit, 'POST', '/auth/refresh').length;
  for (let elapsed = 0; elapsed < 2 * 900_000 + 60_000; elapsed += 30_000) await kit.clock.advance(30_000);
  assert.equal(kit.server.socketCount(), 1, 'never reconnected');
  assert.equal(kit.client.live.getState(), 'open');
  assert.ok(requestsTo(kit, 'POST', '/auth/refresh').length >= refreshes + 2);
  assert.ok(framesOfType(kit, 'auth').length >= 3, 'each refreshed token was sent as a new auth');
  kit.client.dispose();
});

test('1008: wait 5 minutes without counting an attempt, polling meanwhile', async () => {
  const kit = await signedIn();
  const order = liveOrder(kit, 15_000);
  kit.client.start();
  await kit.clock.advance(0);
  const atOpen = order.fetches();
  await kit.clock.advance(60_000);
  assert.equal(order.fetches(), atOpen, 'no polling while the socket is open');
  kit.server.closeSockets(1008);
  await kit.clock.advance(0);
  assert.equal(kit.client.live.getState(), 'waiting');
  await kit.clock.advance(299_000);
  assert.equal(kit.server.socketCount(), 1, 'no reconnect before 5 minutes');
  assert.ok(order.fetches() >= atOpen + 19, `polled every 15 s (${order.fetches() - atOpen})`);
  await kit.clock.advance(1_000);
  assert.equal(kit.client.live.getState(), 'open');
  const afterReconnect = order.fetches();
  await kit.clock.advance(60_000);
  assert.equal(order.fetches(), afterReconnect, 'polling stopped once the socket is back');
  order.observation.unsubscribe();
  kit.client.dispose();
});

test('offline closes the socket and stops trying; online reconnects at once', async () => {
  const kit = createTestClient();
  kit.client.start();
  await kit.clock.advance(0);
  kit.lifecycle.emit('offline');
  await kit.clock.advance(0);
  assert.equal(kit.client.live.getState(), 'offline');
  await kit.clock.advance(120_000);
  assert.equal(kit.server.socketCount(), 1, 'no attempts while offline');
  kit.lifecycle.emit('online');
  await kit.clock.advance(0);
  assert.equal(kit.client.live.getState(), 'open');
  assert.equal(kit.server.socketCount(), 2);
  kit.client.dispose();
});

test('native background: pause after 20 s, resume and resync on foreground', async () => {
  const kit = createTestClient();
  let resyncs = 0;
  kit.client.live.onResync(() => (resyncs += 1));
  kit.client.start();
  await kit.clock.advance(0);
  kit.lifecycle.emit('background');
  await kit.clock.advance(19_000);
  assert.equal(kit.client.live.getState(), 'open');
  await kit.clock.advance(1_000);
  assert.equal(kit.client.live.getState(), 'paused');
  assert.equal(kit.server.openSockets(), 0);
  kit.lifecycle.emit('foreground');
  await kit.clock.advance(0);
  assert.equal(kit.client.live.getState(), 'open');
  assert.equal(resyncs, 2);
  // A short trip to the background keeps the socket.
  kit.lifecycle.emit('background');
  await kit.clock.advance(5_000);
  kit.lifecycle.emit('foreground');
  await kit.clock.advance(30_000);
  assert.equal(kit.client.live.getState(), 'open');
  assert.equal(kit.server.socketCount(), 2);
  kit.client.dispose();
});

test('a denied topic is remembered and its query polls while the socket is open', async () => {
  const kit = await signedIn();
  kit.server.denyTopic('order:o1');
  const order = liveOrder(kit, 15_000);
  kit.client.start();
  await kit.clock.advance(0);
  assert.equal(kit.client.live.getState(), 'open');
  assert.equal(kit.client.live.isDenied('order:o1'), true);
  const before = order.fetches();
  await kit.clock.advance(45_000);
  assert.equal(order.fetches(), before + 3);
  order.observation.unsubscribe();
  kit.client.dispose();
});

test('sign-out reconnects the socket as anonymous', async () => {
  const kit = await signedIn();
  kit.client.start();
  await kit.clock.advance(0);
  await kit.client.session.signOut();
  await kit.clock.advance(0);
  assert.equal(kit.client.live.getState(), 'open');
  assert.equal(kit.server.socketCount(), 2);
  assert.deepEqual(kit.server.subscribedTopics(), []);
  kit.client.dispose();
});
