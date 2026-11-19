/**
 * The dedicated LISTEN connection of an instance (docs/PLATFORM.md §8.3). It is not taken from the pool: a
 * LISTEN lives as long as its session. After a reconnect, events may have been missed while it was down, so
 * every socket is closed with 1012 and clients refetch, as after a restart.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import type { Logger } from 'pino';
import type { Config } from '../../config/env';
import { poolOptions } from '../db/pool';
import { LIVE_CHANNEL } from './publish';

export const OUTBOX_CHANNEL = 'is_outbox';
const KEEPALIVE_MS = 30_000;

export interface ListenerHandlers {
  onLive(payload: string): void;
  onOutbox(): void;
  /** Called after a reconnect (not after the first connect). */
  onReconnect(): void;
}

export class Listener {
  private client: pg.Client | null = null;
  private stopped = false;
  private keepalive: NodeJS.Timeout | null = null;
  private connectedOnce = false;
  private running: Promise<void> | null = null;
  /** True while the connection is up; the health check reports it without failing on it. */
  connected = false;

  constructor(
    private readonly config: Config,
    private readonly log: Logger,
    private readonly handlers: ListenerHandlers,
  ) {}

  /** Resolves once the first LISTEN is in place (or the first attempt failed and a retry is scheduled). */
  async start(): Promise<void> {
    this.stopped = false;
    await this.connect().catch((error: unknown) => {
      this.log.error({ err: error }, 'live listener could not connect; retrying');
      this.scheduleReconnect();
    });
  }

  private async connect(): Promise<void> {
    const client = new pg.Client({
      ...poolOptions(this.config),
      keepAlive: true,
      application_name: 'instasupply-listen',
    });
    client.on('notification', (message) => {
      if (message.channel === LIVE_CHANNEL && message.payload) this.handlers.onLive(message.payload);
      else if (message.channel === OUTBOX_CHANNEL) this.handlers.onOutbox();
    });
    client.on('error', (error) => {
      this.log.warn({ err: error }, 'live listener connection failed');
      this.drop(client);
    });
    client.on('end', () => this.drop(client));
    await client.connect();
    await client.query(`LISTEN ${LIVE_CHANNEL}`);
    await client.query(`LISTEN ${OUTBOX_CHANNEL}`);
    if (this.stopped) {
      await client.end().catch(() => {});
      return;
    }
    this.client = client;
    this.connected = true;
    this.keepalive = setInterval(() => {
      client.query('SELECT 1').catch(() => this.drop(client));
    }, KEEPALIVE_MS);
    this.keepalive.unref();
    if (this.connectedOnce) {
      this.log.warn('live listener reconnected; closing sockets so clients refetch');
      this.handlers.onReconnect();
    }
    this.connectedOnce = true;
    this.log.info('live listener connected');
  }

  private drop(client: pg.Client): void {
    if (this.client !== client) return;
    this.client = null;
    this.connected = false;
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
    client.end().catch(() => {});
    if (!this.stopped) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.running) return;
    this.running = (async () => {
      let delay = 500;
      while (!this.stopped && !this.client) {
        await sleep(delay);
        if (this.stopped) break;
        try {
          await this.connect();
        } catch (error) {
          this.log.warn({ err: error, retryInMs: delay }, 'live listener reconnect failed');
          delay = Math.min(delay * 2, 10_000);
        }
      }
      this.running = null;
    })();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.keepalive) clearInterval(this.keepalive);
    const client = this.client;
    this.client = null;
    this.connected = false;
    if (client) await client.end().catch(() => {});
  }
}
