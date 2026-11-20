/**
 * A self-contained test context for the platform and auth tests: one throwaway database per test file,
 * the real app through `app.inject`, a FakeClock. It follows docs/PLATFORM.md §12.1 and §12.2 so that
 * these files can move onto the harness workstream's `test/support` once it lands (that folder is not
 * owned by the platform workstream and does not exist yet).
 */
import { randomBytes } from 'node:crypto';
// Tests hash passwords with the cheap cost and expect test defaults, even when started by hand.
process.env.NODE_ENV = 'test';
import { Writable } from 'node:stream';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import pino from 'pino';
import { buildApp } from '../../src/app';
import { loadConfig, type Config } from '../../src/config/env';
import { createDeps, type Deps, type Hooks } from '../../src/container';
import { syncReferenceData } from '../../src/cli/migrate';
import { Listener } from '../../src/platform/live/listener';
import { migrate } from '../../src/platform/migrations/migrator';
import { migrationsDir } from '../../src/platform/paths';

/** Thu 2026-11-19 12:25 America/Toronto, the reference time of MARKETPLACE §4.8. */
export const REFERENCE_TIME = 1795109100000;

export class FakeClock {
  constructor(private ms: number = REFERENCE_TIME) {}
  now(): number {
    return this.ms;
  }
  set(ms: number): void {
    this.ms = ms;
  }
  advance(ms: number): void {
    this.ms += ms;
  }
}

/** A gate per hold point (§12.3): `hold(ctx, point)` stops the next request that reaches it. */
export class TestHooks implements Hooks {
  private readonly gates = new Map<string, { reached: () => void; release: Promise<void> }>();
  async at(point: string): Promise<void> {
    const gate = this.gates.get(point);
    if (!gate) return;
    this.gates.delete(point);
    gate.reached();
    await gate.release;
  }
  hold(point: string): { reached: Promise<void>; release: () => void } {
    let release!: () => void;
    let reached!: () => void;
    const releasePromise = new Promise<void>((resolve) => (release = resolve));
    const reachedPromise = new Promise<void>((resolve) => (reached = resolve));
    this.gates.set(point, { reached, release: releasePromise });
    return { reached: reachedPromise, release };
  }
}

export interface TestContext {
  app: FastifyInstance;
  deps: Deps;
  pool: pg.Pool;
  clock: FakeClock;
  hooks: TestHooks;
  config: Config;
  databaseUrl: string;
  /** Log lines written by the app (JSON objects), for the logging test. */
  logs: Record<string, unknown>[];
  drainOutbox(): Promise<number>;
  runJob(name: string, now?: number): Promise<Record<string, number>>;
  /** Starts a LISTEN connection so live events reach the hub (only live tests need it). */
  listen(): Promise<void>;
  close(): Promise<void>;
}

const stamp = (): string => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
let counter = 0;

const MAINTENANCE = { database: 'postgres' };

async function createDatabase(name: string): Promise<void> {
  const client = new pg.Client(MAINTENANCE);
  await client.connect();
  try {
    const template = process.env.TEST_RUN ? ` TEMPLATE "${process.env.TEST_RUN}_tpl"` : '';
    await client.query(`CREATE DATABASE "${name}"${template}`);
  } finally {
    await client.end();
  }
}

export async function dropDatabase(name: string): Promise<void> {
  const client = new pg.Client(MAINTENANCE);
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}

/** A connection string for a database on the server the libpq variables name (default: the local one). */
export function urlFor(name: string): string {
  const host = process.env.PGHOST ?? 'localhost';
  const port = process.env.PGPORT ?? '5432';
  const user = process.env.PGUSER ? encodeURIComponent(process.env.PGUSER) : '';
  const password = process.env.PGPASSWORD ? `:${encodeURIComponent(process.env.PGPASSWORD)}` : '';
  const auth = user ? `${user}${password}@` : '';
  return `postgres://${auth}${host}:${port}/${name}`;
}

export function newDatabaseName(): string {
  counter += 1;
  return `instasupply_test_${stamp()}_${randomBytes(3).toString('hex')}_${process.pid}_${counter}`;
}

export async function createTestContext(
  options: { env?: Record<string, string>; deps?: Partial<Deps>; clock?: FakeClock } = {},
): Promise<TestContext> {
  const name = newDatabaseName();
  await createDatabase(name);
  const databaseUrl = urlFor(name);
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    LOG_LEVEL: 'info',
    ...options.env,
  });
  const clock = options.clock ?? new FakeClock();
  const hooks = new TestHooks();
  const logs: Record<string, unknown>[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      for (const line of chunk.toString('utf8').split('\n'))
        if (line.trim()) logs.push(JSON.parse(line) as Record<string, unknown>);
      done();
    },
  });
  const log = pino(
    { level: 'info', messageKey: 'message', formatters: { level: (label: string) => ({ level: label }) } },
    sink,
  );
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 6, options: '-c TimeZone=UTC' });
  pool.on('error', () => {});
  if (!process.env.TEST_RUN) await migrate(pool, migrationsDir());
  await syncReferenceData(pool, clock.now());
  const deps = createDeps(config, { log, pool, clock, hooks, ...options.deps });
  const app = await buildApp(deps);
  await app.ready();
  let listener: Listener | null = null;
  return {
    app,
    deps,
    pool,
    clock,
    hooks,
    config,
    databaseUrl,
    logs,
    drainOutbox: () => deps.outbox.drain(),
    runJob: (job, now) => deps.scheduler.runJob(job, now ?? clock.now()),
    listen: async () => {
      listener = new Listener(config, log, {
        onLive: (payload) => deps.live.dispatch(payload),
        onOutbox: () => {},
        onReconnect: () => deps.live.closeAll(1012),
      });
      await listener.start();
    },
    close: async () => {
      deps.live.closeAll(1012);
      await app.close();
      if (listener) await listener.stop();
      await pool.end();
      await dropDatabase(name);
    },
  };
}

// ---------- HTTP helpers ----------

export interface Answer<T = unknown> {
  status: number;
  body: T;
  headers: LightMyRequestResponse['headers'];
}

export async function call<T = Record<string, unknown>>(
  ctx: TestContext,
  options: InjectOptions & { token?: string | null },
): Promise<Answer<T>> {
  const { token, headers, ...rest } = options;
  const response = await ctx.app.inject({
    ...rest,
    headers: { ...(headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  const text = response.body;
  return {
    status: response.statusCode,
    body: (text ? JSON.parse(text) : null) as T,
    headers: response.headers,
  };
}

export const post = <T = Record<string, unknown>>(
  ctx: TestContext,
  url: string,
  payload: unknown,
  token?: string | null,
) =>
  call<T>(ctx, { method: 'POST', url: `/api/v1${url}`, payload: payload as Record<string, unknown>, token });

export const get = <T = Record<string, unknown>>(ctx: TestContext, url: string, token?: string | null) =>
  call<T>(ctx, { method: 'GET', url: `/api/v1${url}`, token });

export const command = <T = Record<string, unknown>>(
  ctx: TestContext,
  name: string,
  body: unknown,
  token?: string | null,
) => post<T>(ctx, `/call/${name}`, body ?? {}, token);

export interface ErrorBody {
  error: { status: string; code: string | null; message: string; details: Record<string, unknown> };
}

export interface SessionBody {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  refreshTokenExpiresAt: number;
  accessTokenTtlSeconds: number;
  me: { account: { uid: string; email: string }; profile: Record<string, unknown> | null; store: unknown };
}

export const PASSWORD = 'Builder2026';

export async function registerAccount(
  ctx: TestContext,
  input: {
    email: string;
    password?: string;
    displayName?: string;
    installationId?: string;
    app?: 'customer' | 'driver';
  },
): Promise<SessionBody> {
  const answer = await post<SessionBody>(ctx, '/auth/register', {
    email: input.email,
    password: input.password ?? PASSWORD,
    displayName: input.displayName ?? 'Test User',
    installationId: input.installationId ?? `install-${randomBytes(4).toString('hex')}`,
    app: input.app ?? 'customer',
  });
  if (answer.status !== 200)
    throw new Error(`register failed: ${answer.status} ${JSON.stringify(answer.body)}`);
  return answer.body;
}

export async function loginAccount(
  ctx: TestContext,
  input: {
    email: string;
    password?: string;
    installationId?: string;
    app?: 'customer' | 'driver' | 'console';
  },
): Promise<Answer<SessionBody>> {
  return post<SessionBody>(ctx, '/auth/login', {
    email: input.email,
    password: input.password ?? PASSWORD,
    installationId: input.installationId ?? `install-${randomBytes(4).toString('hex')}`,
    app: input.app ?? 'customer',
  });
}

/** Gives an account a role directly in the database (registerCustomer and friends are wave-2 commands). */
export async function setRole(
  ctx: TestContext,
  uid: string,
  role: 'admin' | 'dispatcher' | 'customer' | 'driver' | 'supplier',
  extra: {
    storeId?: string;
    storeRole?: 'owner' | 'staff';
    status?: 'active' | 'pending' | 'suspended';
  } = {},
): Promise<void> {
  await ctx.pool.query(
    `UPDATE users SET role = $2, status = $3, store_id = $4, store_role = $5 WHERE id = $1`,
    [uid, role, extra.status ?? 'active', extra.storeId ?? null, extra.storeRole ?? null],
  );
}

/** A role-holding account with a fresh session token. */
export async function accountWithRole(
  ctx: TestContext,
  email: string,
  role: 'admin' | 'dispatcher' | 'customer' | 'driver' | 'supplier',
  extra: Parameters<typeof setRole>[3] = {},
): Promise<SessionBody> {
  const session = await registerAccount(ctx, { email });
  await setRole(ctx, session.me.account.uid, role, extra);
  return session;
}

/** A minimal store row (catalogue fixtures belong to the harness and seed workstreams). */
export async function insertStore(ctx: TestContext, id: string): Promise<void> {
  const doc = {
    name: `Store ${id}`,
    status: 'live',
    marketId: 'gta',
    cityId: 'toronto',
    acceptingOrders: true,
    photoPath: null,
  };
  await ctx.pool.query(
    `INSERT INTO stores (id, doc, settings, created_at, updated_at) VALUES ($1, $2::jsonb, '{}'::jsonb, $3, $3)`,
    [id, JSON.stringify(doc), new Date(ctx.clock.now())],
  );
}

export async function outboxRows(ctx: TestContext, event?: string) {
  const { rows } = await ctx.pool.query<{
    id: number;
    event: string;
    payload: Record<string, unknown>;
    status: string;
  }>(
    `SELECT id, event, payload, status FROM outbox ${event ? 'WHERE event = $1' : ''} ORDER BY id`,
    event ? [event] : [],
  );
  return rows;
}
