/**
 * createTestContext (docs/PLATFORM.md §12.1): one database per test file, cloned from the run's template,
 * and the real app on it, reached through `app.inject` (no port). Only the clock, the payment gateway and
 * the push sender are replaced; storage is the local driver in a temporary directory.
 */
// Tests hash passwords with the cheap cost and load test defaults, also when a file is started by hand.
process.env.NODE_ENV = 'test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import pino from 'pino';
import { buildApp } from '../../src/app';
import { loadConfig, type Config } from '../../src/config/env';
import { createDeps, type Deps } from '../../src/container';
import { Listener } from '../../src/platform/live/listener';
import { FakeClock } from './clock';
import { createDatabase, dropDatabase, newRunName, prepareDatabase, templateName, urlFor } from './db-admin';
import { RecordingGateway, RecordingPush } from './doubles';
import { terminateLiveClients } from './live';
import { TestHooks } from './race';

export interface TestContext {
  app: FastifyInstance;
  deps: Deps;
  pool: pg.Pool;
  clock: FakeClock;
  gateway: RecordingGateway;
  push: RecordingPush;
  hooks: TestHooks;
  config: Config;
  databaseName: string;
  /** Log lines the app wrote (JSON objects). Empty unless `env.LOG_LEVEL` is raised above `silent`. */
  logs: Record<string, unknown>[];
  /** Runs the outbox until nothing is due at the fake clock; returns how many events were handled. */
  drainOutbox(): Promise<number>;
  /** runJobNow without HTTP: the job body at `now` (default: the fake clock). */
  runJob(name: string, now?: number): Promise<Record<string, number>>;
  /** Starts the LISTEN connection so published events reach sockets; idempotent. */
  listen(): Promise<void>;
  /** Closes sockets, the app and the pool and drops the database; idempotent. */
  close(): Promise<void>;
}

export interface TestContextOptions {
  clock?: FakeClock;
  /** Replaces single members of deps (e.g. a failing push client). */
  deps?: Partial<Deps>;
  /** Extra environment for loadConfig, e.g. `{ RATE_LIMITS_DISABLED: 'false' }`. */
  env?: Record<string, string>;
}

let counter = 0;

/**
 * `<TEST_RUN>_<pid>_<n>`: files run in separate processes, so the pid keeps two files of one run apart;
 * the TEST_RUN prefix is what lets the runner drop everything of its run and nothing of another's.
 */
function nextDatabaseName(): { name: string; template: string | null } {
  counter += 1;
  const run = process.env.TEST_RUN;
  if (run) return { name: `${run}_${process.pid}_${counter}`, template: templateName(run) };
  return { name: `${newRunName()}_${process.pid}_${counter}`, template: null };
}

/** Every context of this process that is still open, so a crash of one test still drops them on exit. */
const open = new Set<TestContext>();
let exitHookInstalled = false;
function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  // node --test ends a file's process once its tests finish; a file that forgot ctx.close() would leave
  // its database behind (the runner drops it too, but a single file started by hand has no runner).
  process.once('beforeExit', () => {
    void Promise.all([...open].map((ctx) => ctx.close().catch(() => {})));
  });
}

export async function createTestContext(options: TestContextOptions = {}): Promise<TestContext> {
  installExitHook();
  const { name, template } = nextDatabaseName();
  await createDatabase(name, template ?? undefined);
  let storageDir: string | null = null;
  try {
    if (!template) await prepareDatabase(name);
    storageDir = await mkdtemp(path.join(tmpdir(), 'instasupply-test-'));
    const databaseUrl = urlFor(name);
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      STORAGE_LOCAL_DIR: storageDir,
      ...options.env,
    });
    const clock = options.clock ?? new FakeClock();
    const hooks = new TestHooks();
    const logs: Record<string, unknown>[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        for (const line of chunk.toString('utf8').split('\n')) {
          if (!line.trim()) continue;
          try {
            logs.push(JSON.parse(line) as Record<string, unknown>);
          } catch {
            logs.push({ message: line });
          }
        }
        done();
      },
    });
    const log = pino(
      {
        level: config.LOG_LEVEL,
        messageKey: 'message',
        formatters: { level: (label: string) => ({ level: label }) },
      },
      sink,
    );
    // max 6 (§12.1): four files at once stay far below the server's 100 connections.
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 6, options: '-c TimeZone=UTC' });
    pool.on('error', () => {});
    const gateway = new RecordingGateway(clock);
    const push = new RecordingPush();
    const deps = createDeps(config, { log, pool, clock, hooks, gateway, push, ...options.deps });
    const app = await buildApp(deps);
    await app.ready();

    let listener: Listener | null = null;
    let closing: Promise<void> | null = null;
    const dir = storageDir;
    const ctx: TestContext = {
      app,
      deps,
      pool,
      clock,
      gateway,
      push,
      hooks,
      config,
      databaseName: name,
      logs,
      drainOutbox: () => deps.outbox.drain(),
      runJob: (job, now) => deps.scheduler.runJob(job, now ?? clock.now()),
      listen: async () => {
        if (listener) return;
        listener = new Listener(config, log, {
          onLive: (payload) => deps.live.dispatch(payload),
          onOutbox: () => {},
          onReconnect: () => deps.live.closeAll(1012),
        });
        await listener.start();
      },
      close: () => {
        closing ??= (async () => {
          open.delete(ctx);
          deps.live.closeAll(1012);
          // Over app.injectWS no TCP end ever arrives, so ws would keep each closing socket's 30-second
          // close timer alive and hold the file's process open; terminating both ends clears them.
          terminateLiveClients(ctx);
          for (const socket of app.websocketServer?.clients ?? []) socket.terminate();
          await app.close().catch(() => {});
          if (listener) await listener.stop().catch(() => {});
          await pool.end().catch(() => {});
          await dropDatabase(name);
          await rm(dir, { recursive: true, force: true });
        })();
        return closing;
      },
    };
    open.add(ctx);
    return ctx;
  } catch (error) {
    await dropDatabase(name).catch(() => {});
    if (storageDir) await rm(storageDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
