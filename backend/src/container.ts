/**
 * createDeps(config): every collaborator of the server in one object (docs/PLATFORM.md §2.1). Tests replace
 * single members (clock, gateway, push) by passing overrides.
 */
import pino, { type Logger } from 'pino';
import type pg from 'pg';
import type { Config } from './config/env';
import { systemClock, type Clock } from './platform/clock';
import { configureCrypto } from './platform/crypto';
import { createPool } from './platform/db/pool';
import { LiveHub } from './platform/live/hub';
import { createMail, type MailSender } from './platform/mail/mail';
import { OutboxWorker } from './platform/outbox/worker';
import { createGateway, type PaymentGateway } from './platform/payments';
import { createExpoClient, type PushClient } from './platform/push/expo';
import { Scheduler } from './platform/scheduler/scheduler';
import { createSms, type SmsSender } from './platform/sms/sms';
import { createStorage, type Storage } from './platform/storage/storage';
import { loggerOptions } from './platform/logger';

/** Named places a test can hold a request at (§12.3); a no-op in production. */
export interface Hooks {
  at(point: string): Promise<void>;
}

export const noHooks: Hooks = { at: async () => {} };

export interface Deps {
  config: Config;
  log: Logger;
  clock: Clock;
  pool: pg.Pool;
  storage: Storage;
  sms: SmsSender;
  mail: MailSender;
  push: PushClient;
  gateway: PaymentGateway;
  live: LiveHub;
  outbox: OutboxWorker;
  scheduler: Scheduler;
  hooks: Hooks;
}

export function createLogger(config: Config): Logger {
  return pino(loggerOptions(config));
}

export function createDeps(config: Config, overrides: Partial<Deps> = {}): Deps {
  configureCrypto(config.OTP_PEPPER);
  const log = overrides.log ?? createLogger(config);
  const clock = overrides.clock ?? systemClock;
  const deps: Deps = {
    config,
    log,
    clock,
    pool: overrides.pool ?? createPool(config, log),
    storage: overrides.storage ?? createStorage(config),
    sms: overrides.sms ?? createSms(config),
    mail: overrides.mail ?? createMail(config),
    push: overrides.push ?? createExpoClient(config.EXPO_ACCESS_TOKEN),
    gateway: overrides.gateway ?? createGateway(config, clock),
    live: overrides.live ?? new LiveHub(),
    outbox: overrides.outbox ?? new OutboxWorker(),
    scheduler: overrides.scheduler ?? new Scheduler(),
    hooks: overrides.hooks ?? noHooks,
  };
  deps.live.bind(deps);
  deps.outbox.bind(deps);
  deps.scheduler.bind(deps);
  return deps;
}
