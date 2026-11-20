/**
 * A live-socket client over `app.injectWS('/api/v1/live')` (docs/PLATFORM.md §8.1, §12.2). Frames are
 * queued, so a test awaits the next frame of a kind instead of racing the socket.
 */
import type WebSocket from 'ws';
import type { TestContext } from './database';

export type Frame = Record<string, unknown> & { type: string };

export interface EventFrame extends Frame {
  type: 'event';
  topic: string;
  kind: 'created' | 'updated' | 'deleted' | 'message';
  id: string;
  at: number;
  data?: unknown;
}

export interface SubscribedFrame extends Frame {
  type: 'subscribed';
  id: number;
  topics: string[];
  denied: { topic: string; reason: string }[];
}

export interface LiveClient {
  socket: WebSocket;
  /** Frames received and not yet taken by a `next…` call. */
  frames: Frame[];
  send(frame: object): void;
  /** Sends `auth` (with the connect token unless another is given) and waits for `ready`. */
  auth(token?: string): Promise<Frame>;
  /** Sends `subscribe` and waits for its `subscribed` answer. */
  subscribe(topics: string[]): Promise<SubscribedFrame>;
  unsubscribe(topics: string[]): void;
  next(type: string, timeoutMs?: number): Promise<Frame>;
  nextEvent(topic: string, options?: { kind?: EventFrame['kind']; timeoutMs?: number }): Promise<EventFrame>;
  /** Waits until the server closes the socket; returns the close code. */
  closed(timeoutMs?: number): Promise<number>;
  close(): void;
}

const DEFAULT_TIMEOUT_MS = 3000;

/** Client sockets per context, so `ctx.close()` can end every one a test left open. */
const clients = new WeakMap<object, Set<WebSocket>>();

export function terminateLiveClients(ctx: object): void {
  for (const socket of clients.get(ctx) ?? []) socket.terminate();
  clients.delete(ctx);
}

export async function connectLive(
  ctx: Pick<TestContext, 'app' | 'listen'>,
  token?: string,
  headers: Record<string, string> = {},
): Promise<LiveClient> {
  // Events travel through LISTEN/NOTIFY even inside one process (§8.3).
  await ctx.listen();
  const socket: WebSocket = await ctx.app.injectWS('/api/v1/live', { headers });
  let tracked = clients.get(ctx);
  if (!tracked) {
    tracked = new Set();
    clients.set(ctx, tracked);
  }
  tracked.add(socket);
  const frames: Frame[] = [];
  const waiters = new Set<() => void>();
  const wake = () => {
    for (const waiter of waiters) waiter();
    waiters.clear();
  };
  let closeCode: number | null = null;
  socket.on('message', (raw: Buffer) => {
    frames.push(JSON.parse(raw.toString()) as Frame);
    wake();
  });
  socket.on('close', (code: number) => {
    closeCode = code;
    wake();
  });

  async function waitFor<T>(find: () => T | undefined, timeoutMs: number, what: string): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = find();
      if (found !== undefined) return found;
      if (Date.now() >= deadline)
        throw new Error(`no ${what} within ${timeoutMs} ms; queued frames: ${JSON.stringify(frames)}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(50, deadline - Date.now()));
        waiters.add(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  const take = (match: (frame: Frame) => boolean): Frame | undefined => {
    const index = frames.findIndex(match);
    return index >= 0 ? frames.splice(index, 1)[0] : undefined;
  };

  let subscribeId = 0;
  const send = (frame: object) => socket.send(JSON.stringify(frame));
  const next = (type: string, timeoutMs = DEFAULT_TIMEOUT_MS) =>
    waitFor(() => take((frame) => frame.type === type), timeoutMs, `${type} frame`);

  return {
    socket,
    frames,
    send,
    next,
    async auth(other) {
      const value = other ?? token;
      if (!value) throw new Error('connectLive: no token to authenticate with');
      send({ type: 'auth', token: value });
      return waitFor(
        () => take((frame) => frame.type === 'ready' || frame.type === 'error'),
        DEFAULT_TIMEOUT_MS,
        'ready frame',
      );
    },
    async subscribe(topics) {
      subscribeId += 1;
      const id = subscribeId;
      send({ type: 'subscribe', id, topics });
      return (await waitFor(
        () => take((frame) => frame.type === 'subscribed' && frame.id === id),
        DEFAULT_TIMEOUT_MS,
        `subscribed frame ${id}`,
      )) as SubscribedFrame;
    },
    unsubscribe(topics) {
      send({ type: 'unsubscribe', topics });
    },
    async nextEvent(topic, options = {}) {
      return (await waitFor(
        () =>
          take(
            (frame) =>
              frame.type === 'event' &&
              frame.topic === topic &&
              (options.kind === undefined || frame.kind === options.kind),
          ),
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        `event on ${topic}`,
      )) as EventFrame;
    },
    closed: (timeoutMs = DEFAULT_TIMEOUT_MS) =>
      waitFor(() => closeCode ?? undefined, timeoutMs, 'close of the socket'),
    close: () => socket.close(),
  };
}
