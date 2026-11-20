import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type WebSocket from 'ws';
import { withTransaction } from '../../src/platform/db/tx';
import {
  publish,
  publishChange,
  publishControl,
  serializeNotification,
} from '../../src/platform/live/publish';
import { accountWithRole, createTestContext, type SessionBody, type TestContext } from './context';

type Frame = Record<string, unknown> & { type: string };

/** A socket with a frame queue, so a test can await the next frame of a type. */
async function connect(ctx: TestContext, headers: Record<string, string> = {}) {
  const socket: WebSocket = await ctx.app.injectWS('/api/v1/live', { headers });
  const frames: Frame[] = [];
  const waiters: (() => void)[] = [];
  let closed: { code: number } | null = null;
  socket.on('message', (raw: Buffer) => {
    frames.push(JSON.parse(raw.toString()) as Frame);
    waiters.splice(0).forEach((wake) => wake());
  });
  socket.on('close', (code: number) => {
    closed = { code };
    waiters.splice(0).forEach((wake) => wake());
  });
  const next = async (type: string, timeoutMs = 3000): Promise<Frame> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = frames.findIndex((frame) => frame.type === type);
      if (index >= 0) return frames.splice(index, 1)[0]!;
      if (Date.now() > deadline) throw new Error(`no ${type} frame; got ${JSON.stringify(frames)}`);
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
  };
  const closedWith = async (timeoutMs = 3000): Promise<number> => {
    const deadline = Date.now() + timeoutMs;
    while (!closed && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    if (!closed) throw new Error('socket did not close');
    return (closed as { code: number }).code;
  };
  return { socket, frames, next, closedWith, send: (frame: object) => socket.send(JSON.stringify(frame)) };
}

describe('live socket (§8)', () => {
  let ctx: TestContext;
  let customer: SessionBody;
  before(async () => {
    ctx = await createTestContext();
    await ctx.listen();
    customer = await accountWithRole(ctx, 'dana@example.com', 'customer');
  });
  after(() => ctx.close());

  test('ping → pong; anonymous sockets get public topics only', async () => {
    const live = await connect(ctx);
    live.send({ type: 'ping' });
    await live.next('pong');
    live.send({
      type: 'subscribe',
      id: 1,
      topics: ['stores', 'categories', `user:${customer.me.account.uid}`, 'nope:x'],
    });
    const answer = await live.next('subscribed');
    assert.deepEqual(answer.topics, ['stores', 'categories']);
    assert.deepEqual(answer.denied, [
      { topic: `user:${customer.me.account.uid}`, reason: 'unauthenticated' },
      { topic: 'nope:x', reason: 'not-found' },
    ]);
    live.socket.close();
  });

  test('auth → ready; an event arrives only after its transaction commits; a rollback publishes nothing', async () => {
    const uid = customer.me.account.uid;
    const live = await connect(ctx);
    live.send({ type: 'auth', token: customer.accessToken });
    assert.deepEqual(await live.next('ready'), { type: 'ready', uid });
    live.send({ type: 'subscribe', id: 2, topics: [`user:${uid}`, 'user:someone-else'] });
    const answer = await live.next('subscribed');
    assert.deepEqual(answer.topics, [`user:${uid}`]);
    assert.deepEqual(answer.denied, [{ topic: 'user:someone-else', reason: 'permission-denied' }]);

    await assert.rejects(
      withTransaction(ctx.deps, async (tx) => {
        await publishChange(tx, 'users', 'updated', { uid, role: 'customer' });
        throw new Error('rolled back');
      }),
    );
    await withTransaction(ctx.deps, (tx) => publishChange(tx, 'users', 'updated', { uid, role: 'customer' }));
    const event = await live.next('event');
    assert.equal(event.topic, `user:${uid}`);
    assert.equal(event.kind, 'updated');
    assert.equal(event.id, uid);
    assert.equal(event.data, undefined);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      live.frames.filter((frame) => frame.type === 'event').length,
      0,
      'the rolled-back event was delivered',
    );
    live.socket.close();
  });

  test('payload events carry data; one over the NOTIFY limit is sent without it', async () => {
    const uid = customer.me.account.uid;
    const live = await connect(ctx);
    live.send({ type: 'auth', token: customer.accessToken });
    await live.next('ready');
    live.send({ type: 'subscribe', id: 3, topics: [`user:${uid}:notifications`] });
    await live.next('subscribed');
    await withTransaction(ctx.deps, (tx) =>
      publish(tx, {
        topics: [`user:${uid}:notifications`],
        kind: 'created',
        id: 'n1',
        data: { small: true },
      }),
    );
    assert.deepEqual((await live.next('event')).data, { small: true });
    const big = { text: 'x'.repeat(9000) };
    assert.equal(
      JSON.parse(serializeNotification({ topics: [], kind: 'created', id: 'n2', at: 0, data: big })).data,
      null,
    );
    await withTransaction(ctx.deps, (tx) =>
      publish(tx, { topics: [`user:${uid}:notifications`], kind: 'created', id: 'n2', data: big }),
    );
    const event = await live.next('event');
    assert.equal(event.id, 'n2');
    assert.equal(event.data, undefined);
    live.socket.close();
  });

  test('drop_user closes the sockets of that user with 4403', async () => {
    const live = await connect(ctx);
    live.send({ type: 'auth', token: customer.accessToken });
    await live.next('ready');
    await withTransaction(ctx.deps, (tx) =>
      publishControl(tx, { ctl: 'drop_user', uid: customer.me.account.uid }),
    );
    assert.equal(await live.closedWith(), 4403);
  });

  test('a session revoked while its auth frame is being checked still closes the socket with 4403', async () => {
    const victim = await accountWithRole(ctx, 'revoked-mid-auth@example.com', 'customer');
    const live = await connect(ctx);
    const gate = ctx.hooks.hold('live:afterSessionRead');
    live.send({ type: 'auth', token: victim.accessToken });
    await gate.reached;
    // The session row was read as valid; the revocation commits before the socket has its actor.
    await withTransaction(ctx.deps, (tx) =>
      publishControl(tx, { ctl: 'drop_session', sid: victim.sessionId }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    gate.release();
    assert.equal(await live.closedWith(), 4403);
    assert.equal(
      live.frames.some((frame) => frame.type === 'ready'),
      false,
    );
  });

  test('an oversized frame closes with 1009 and is not logged as an error', async () => {
    const live = await connect(ctx);
    const before = ctx.logs.length;
    live.socket.send(JSON.stringify({ type: 'subscribe', id: 1, topics: ['x'.repeat(20 * 1024)] }));
    assert.equal(await live.closedWith(), 1009);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const errors = ctx.logs.slice(before).filter((line) => line.level === 'error' || line.level === 'fatal');
    assert.deepEqual(errors, []);
  });

  test('a bad token closes with 4401; an expired token closes after 30 s; 120 s idle closes', async () => {
    const bad = await connect(ctx);
    bad.send({ type: 'auth', token: 'not-a-token' });
    const error = await bad.next('error');
    assert.equal(error.status, 'unauthenticated');
    assert.equal(await bad.closedWith(), 4401);

    const fresh = await accountWithRole(ctx, 'exp@example.com', 'customer');
    const expiring = await connect(ctx);
    expiring.send({ type: 'auth', token: fresh.accessToken });
    await expiring.next('ready');
    const idle = await connect(ctx);
    ctx.clock.advance(15 * 60_000 + 31_000);
    ctx.deps.live.sweepNow();
    assert.equal(await expiring.closedWith(), 4401);
    assert.equal(await idle.closedWith(), 1012);
  });

  test('an Origin that CORS refuses cannot open a socket; no Origin is fine', async () => {
    await assert.rejects(connect(ctx, { origin: 'https://evil.example' }));
    const ok = await connect(ctx, { origin: 'http://localhost:5173' });
    ok.socket.close();
  });

  test('the listener reconnect closes every socket with 1012', async () => {
    const live = await connect(ctx);
    ctx.deps.live.closeAll(1012, 'events may have been missed');
    assert.equal(await live.closedWith(), 1012);
  });
});
