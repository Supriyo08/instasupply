/**
 * Sockets, subscriptions and delivery on one instance (docs/PLATFORM.md §8.1, §8.3). Events reach the hub
 * only through the LISTEN connection, so every instance delivers the same events after the commit.
 */
import type { WebSocket } from 'ws';
import type { Deps } from '../../container';
import type { Actor } from '../auth/actor';
import { authenticateToken } from '../auth/authenticate';
import { verifyAccessToken } from '../auth/tokens';
import {
  CLOSE,
  clientFrameSchema,
  EXPIRY_GRACE_MS,
  IDLE_TIMEOUT_MS,
  MAX_ANONYMOUS_SOCKETS_PER_ADDRESS,
  MAX_FRAME_BYTES,
  MAX_FRAMES_PER_SECOND,
  MAX_SOCKETS_PER_USER,
  MAX_TOPICS_PER_SOCKET,
  PROTOCOL_PING_MS,
  type ControlMessage,
  type DenyReason,
  type LiveNotification,
  type ServerFrame,
} from './protocol';
import { authorizeTopic, isPublicTopic } from './topics';

interface Client {
  socket: WebSocket;
  address: string;
  actor: Actor | null;
  /** Epoch ms at which the current token expires (null while anonymous). */
  tokenExp: number | null;
  topics: Set<string>;
  lastFrameAt: number;
  frameWindowStart: number;
  framesInWindow: number;
  alive: boolean;
  lastPingAt: number;
  /** Frames are handled one after another, so a subscribe always sees the result of a preceding auth. */
  queue: Promise<void>;
}

export class LiveHub {
  private deps: Deps | null = null;
  private readonly clients = new Set<Client>();
  private readonly byTopic = new Map<string, Set<Client>>();
  private timer: NodeJS.Timeout | null = null;

  bind(deps: Deps): void {
    this.deps = deps;
  }

  private get d(): Deps {
    if (!this.deps) throw new Error('LiveHub.bind(deps) was not called');
    return this.deps;
  }

  get size(): number {
    return this.clients.size;
  }

  /** Starts the housekeeping timer (protocol pings, idle and expiry checks). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), Math.min(PROTOCOL_PING_MS, 5_000));
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Called by the route for every accepted upgrade. Returns false when the socket was refused. */
  accept(socket: WebSocket, address: string): boolean {
    const anonymousFromAddress = [...this.clients].filter((c) => c.address === address && !c.actor).length;
    if (anonymousFromAddress >= MAX_ANONYMOUS_SOCKETS_PER_ADDRESS) {
      socket.close(CLOSE.policy, 'too many sockets');
      return false;
    }
    const now = this.d.clock.now();
    const client: Client = {
      socket,
      address,
      actor: null,
      tokenExp: null,
      topics: new Set(),
      lastFrameAt: now,
      frameWindowStart: now,
      framesInWindow: 0,
      alive: true,
      lastPingAt: now,
      queue: Promise.resolve(),
    };
    this.clients.add(client);
    socket.on('pong', () => {
      client.alive = true;
    });
    socket.on('message', (raw: Buffer, isBinary: boolean) => {
      client.queue = client.queue
        .then(() => this.onMessage(client, raw, isBinary))
        .catch((error: unknown) => {
          this.d.log.error({ err: error }, 'live frame failed');
          this.close(client, CLOSE.internal, 'internal error');
        });
    });
    socket.on('close', () => this.forget(client));
    socket.on('error', () => this.forget(client));
    return true;
  }

  private send(client: Client, frame: ServerFrame): void {
    if (client.socket.readyState === client.socket.OPEN) client.socket.send(JSON.stringify(frame));
  }

  private close(client: Client, code: number, reason: string): void {
    this.forget(client);
    try {
      client.socket.close(code, reason);
    } catch {
      client.socket.terminate();
    }
  }

  private forget(client: Client): void {
    if (!this.clients.delete(client)) return;
    for (const topic of client.topics) this.unindex(client, topic);
    client.topics.clear();
  }

  private index(client: Client, topic: string): void {
    let set = this.byTopic.get(topic);
    if (!set) this.byTopic.set(topic, (set = new Set()));
    set.add(client);
    client.topics.add(topic);
  }

  private unindex(client: Client, topic: string): void {
    const set = this.byTopic.get(topic);
    set?.delete(client);
    if (set && set.size === 0) this.byTopic.delete(topic);
  }

  private async onMessage(client: Client, raw: Buffer, isBinary: boolean): Promise<void> {
    if (!this.clients.has(client)) return;
    const now = this.d.clock.now();
    client.lastFrameAt = now;
    if (now - client.frameWindowStart >= 1000) {
      client.frameWindowStart = now;
      client.framesInWindow = 0;
    }
    client.framesInWindow += 1;
    if (client.framesInWindow > MAX_FRAMES_PER_SECOND)
      return this.close(client, CLOSE.policy, 'too many frames');
    if (raw.length > MAX_FRAME_BYTES) return this.close(client, CLOSE.tooLarge, 'frame too large');
    if (isBinary)
      return this.send(client, { type: 'error', status: 'invalid-argument', reason: 'text_frames_only' });

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw.toString('utf8'));
    } catch {
      return this.send(client, { type: 'error', status: 'invalid-argument', reason: 'bad_json' });
    }
    const parsed = clientFrameSchema.safeParse(parsedJson);
    if (!parsed.success)
      return this.send(client, { type: 'error', status: 'invalid-argument', reason: 'bad_frame' });
    const frame = parsed.data;

    switch (frame.type) {
      case 'ping':
        return this.send(client, { type: 'pong' });
      case 'auth':
        return this.onAuth(client, frame.token);
      case 'unsubscribe':
        for (const topic of frame.topics) {
          if (client.topics.delete(topic)) this.unindex(client, topic);
        }
        return;
      case 'subscribe':
        return this.onSubscribe(client, frame.id, frame.topics);
    }
  }

  private async onAuth(client: Client, token: string): Promise<void> {
    const auth = await authenticateToken(this.d, token);
    if (!auth.actor) {
      const reason = String(auth.failure?.details.reason ?? 'token_invalid');
      if (reason === 'account_suspended' || reason === 'session_revoked') {
        this.send(client, {
          type: 'error',
          status: auth.failure?.status === 'permission-denied' ? 'permission-denied' : 'unauthenticated',
          reason,
        });
        return this.close(client, CLOSE.revoked, reason);
      }
      this.send(client, { type: 'error', status: 'unauthenticated', reason });
      return this.close(client, CLOSE.tokenInvalid, reason);
    }
    if (client.actor && client.actor.uid !== auth.actor.uid)
      return this.close(client, CLOSE.revoked, 'another user');
    if (!client.actor) {
      const sockets = [...this.clients].filter((c) => c.actor?.uid === auth.actor!.uid).length;
      if (sockets >= MAX_SOCKETS_PER_USER) return this.close(client, CLOSE.policy, 'too many sockets');
    }
    const verified = await verifyAccessToken(this.d.config, token, this.d.clock.now());
    client.actor = auth.actor;
    client.tokenExp = verified.ok ? verified.exp : this.d.clock.now();
    // Re-evaluate every private subscription for the (possibly changed) account state.
    const dropped: { topic: string; reason: DenyReason }[] = [];
    for (const topic of [...client.topics]) {
      if (isPublicTopic(topic)) continue;
      const reason = await authorizeTopic(this.d.pool, client.actor, topic);
      if (reason) {
        client.topics.delete(topic);
        this.unindex(client, topic);
        dropped.push({ topic, reason });
      }
    }
    this.send(client, { type: 'ready', uid: auth.actor.uid });
    if (dropped.length > 0) this.send(client, { type: 'subscribed', id: 0, topics: [], denied: dropped });
  }

  private async onSubscribe(client: Client, id: number, topics: string[]): Promise<void> {
    const granted: string[] = [];
    const denied: { topic: string; reason: DenyReason }[] = [];
    for (const topic of new Set(topics)) {
      if (client.topics.has(topic)) {
        granted.push(topic);
        continue;
      }
      if (client.topics.size >= MAX_TOPICS_PER_SOCKET) {
        denied.push({ topic, reason: 'permission-denied' });
        continue;
      }
      const reason = await authorizeTopic(this.d.pool, client.actor, topic);
      if (reason) denied.push({ topic, reason });
      else {
        this.index(client, topic);
        granted.push(topic);
      }
    }
    this.send(client, { type: 'subscribed', id, topics: granted, denied });
  }

  /** One `is_live` notification: an event for subscribers, or a control message. */
  dispatch(payload: string): void {
    let message: unknown;
    try {
      message = JSON.parse(payload);
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null) return;
    if ('ctl' in message) return this.control(message as ControlMessage);
    const event = message as LiveNotification;
    if (!Array.isArray(event.topics)) return;
    for (const topic of event.topics) {
      const subscribers = this.byTopic.get(topic);
      if (!subscribers) continue;
      for (const client of subscribers) {
        this.send(client, {
          type: 'event',
          topic,
          kind: event.kind,
          id: event.id,
          at: event.at,
          ...(event.data !== null && event.data !== undefined ? { data: event.data } : {}),
        });
      }
    }
  }

  private control(message: ControlMessage): void {
    for (const client of [...this.clients]) {
      const match =
        (message.ctl === 'drop_user' && client.actor?.uid === message.uid) ||
        (message.ctl === 'drop_session' && client.actor?.sessionId === message.sid);
      if (match) this.close(client, CLOSE.revoked, message.ctl);
    }
  }

  dropUser(uid: string): void {
    this.control({ ctl: 'drop_user', uid });
  }

  dropSession(sid: string): void {
    this.control({ ctl: 'drop_session', sid });
  }

  /** Restart, shutdown or a listener reconnect (events may have been missed): every client reconnects. */
  closeAll(code: number = CLOSE.restarting, reason = 'restarting'): void {
    for (const client of [...this.clients]) this.close(client, code, reason);
  }

  private sweep(): void {
    if (!this.deps) return;
    const now = this.d.clock.now();
    for (const client of [...this.clients]) {
      if (now - client.lastFrameAt > IDLE_TIMEOUT_MS) {
        // 1012 and not 1008: an idle tab should reconnect with backoff, not wait five minutes.
        this.close(client, CLOSE.restarting, 'idle');
        continue;
      }
      if (client.tokenExp !== null && now > client.tokenExp + EXPIRY_GRACE_MS) {
        this.close(client, CLOSE.tokenInvalid, 'token_expired');
        continue;
      }
      if (now - client.lastPingAt < PROTOCOL_PING_MS) continue;
      if (!client.alive) {
        this.forget(client);
        client.socket.terminate();
        continue;
      }
      client.alive = false;
      client.lastPingAt = now;
      try {
        client.socket.ping();
      } catch {
        this.forget(client);
      }
    }
  }

  /** For tests: run the housekeeping once with the injected clock. */
  sweepNow(): void {
    this.sweep();
  }
}
