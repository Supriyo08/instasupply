/**
 * Process entry → dist/server.js (docs/PLATFORM.md §2.6). One process does everything: HTTP, WebSocket,
 * the outbox worker and the scheduler. Start order and shutdown order are those of §2.6.
 */
import { buildApp } from './app';
import { ConfigError, loadConfig } from './config/env';
import { createDeps, createLogger } from './container';
import { syncReferenceData } from './cli/migrate';
import { ensureDatabase } from './platform/db/ensure-database';
import { createPool } from './platform/db/pool';
import { CLOSE } from './platform/live/protocol';
import { Listener } from './platform/live/listener';
import { migrate } from './platform/migrations/migrator';
import { migrationsDir } from './platform/paths';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
  const log = createLogger(config);
  for (const warning of config.warnings) log.warn(warning);

  if (config.DATABASE_AUTO_CREATE && (await ensureDatabase(config)))
    log.info('created the development database');
  const pool = createPool(config, log);
  if (config.MIGRATE_ON_START) {
    const applied = await migrate(pool, migrationsDir(), (message) => log.info(message));
    await syncReferenceData(pool, Date.now());
    log.info({ applied: applied.length }, 'migrations are up to date');
  }

  const deps = createDeps(config, { log, pool });
  const app = await buildApp(deps);
  await app.listen({ host: config.HOST, port: config.PORT });

  const listener = new Listener(config, log, {
    onLive: (payload) => deps.live.dispatch(payload),
    onOutbox: () => deps.outbox.wake(),
    onReconnect: () => deps.live.closeAll(CLOSE.restarting, 'events may have been missed'),
  });
  await listener.start();
  deps.live.start();
  if (config.RUN_WORKER) deps.outbox.start();
  if (config.RUN_SCHEDULER) await deps.scheduler.start();

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'shutting down');
    // A hard stop if anything below hangs: Railway kills the process after its draining time anyway.
    setTimeout(() => process.exit(1), 28_000).unref();
    deps.scheduler.stop();
    deps.outbox.stop();
    deps.live.stop();
    deps.live.closeAll(CLOSE.restarting, 'server restarting');
    await app.close();
    await Promise.all([
      deps.outbox.idle(config.SHUTDOWN_GRACE_MS),
      deps.scheduler.idle(config.SHUTDOWN_GRACE_MS),
    ]);
    await listener.stop();
    await pool.end();
    log.info('stopped');
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
