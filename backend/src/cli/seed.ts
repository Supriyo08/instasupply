/**
 * `seed --demo [--reset] [--at <ISO instant>]` (docs/PLATFORM.md §2.2 seed row, §2.6; MARKETPLACE §11).
 *
 * Builds the app in-process (no port) and writes the demo data: categories, the 14 stores with their
 * private settings and seed reviews, the 80 products, the accounts, jobsites and cards. Accounts and the
 * catalogue go through the repositories (products through `deriveProductColumns`, the old
 * onProductWritten). Then it runs scenarios A to K (`seed/scenarios.ts`, workstream `scenarios`) through
 * `app.inject`, giving them job bodies to call directly and the outbox to drain after every step.
 *
 * Guards: refuses a non-empty `orders` table (the IS-1000x numbers must start at IS-10001); `--reset`
 * first truncates every table and restarts the sequences; `--reset` and `--at` are refused with
 * `NODE_ENV=production`, and so is an unset or default `SEED_PASSWORD`. For its whole run the seed holds
 * the advisory lock of every scheduled job (statement (l)) on one dedicated connection, so a live
 * server's scheduler skips those jobs until the seed ends, plus a lock of its own so two seeds never run
 * at once. Staff demo accounts get no password in production: a set-password link is printed instead.
 */
import {
  CATEGORIES,
  validateJobsite,
  validateProduct,
  validateStore,
  type CategoryId,
  type ClientApp,
  type Role,
  type ScheduledJobName,
} from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { buildApp } from '../app';
import { DEV_SEED_PASSWORD, type Config } from '../config/env';
import { createDeps, type Deps } from '../container';
import type { Clock } from '../platform/clock';
import { hashPassword } from '../platform/auth/passwords';
import { createSession, revokeSessions } from '../platform/auth/sessions';
import { signAccessToken } from '../platform/auth/tokens';
import { lockRows } from '../platform/db/locks';
import { connect, withTransaction, type Tx } from '../platform/db/tx';
import { ApiError } from '../platform/http/errors';
import { newId } from '../platform/ids';
import { publishChange } from '../platform/live/publish';
import { jobFor, registeredJobs, type JobResult } from '../platform/scheduler/registry';
import { tryLock, unlock } from '../platform/scheduler/scheduler';
import { inviteUser } from '../modules/auth/account.service';
import {
  deriveProductColumns,
  insertProduct,
  insertStore,
  upsertCategory,
  type StoreDoc,
} from '../modules/stores';
import { option } from './args';
import { syncReferenceData } from './migrate';
import {
  SEED_ACCOUNTS,
  SEED_EMAIL_DOMAIN,
  type SeedAccount,
  type SeedCustomer,
  type SeedDriver,
} from './seed/accounts';
import { SEED_CATEGORIES } from './seed/categories';
import { SEED_JOBSITES } from './seed/jobsites';
import { SEED_PRODUCTS, seedProductId } from './seed/products';
import { SEED_STORES, type SeedStore } from './seed/stores';

const DAY_MS = 86_400_000;
const LOCK_WAIT_MS = 60_000;
const LOCK_POLL_MS = 500;
const SEED_LOCK = `SELECT pg_try_advisory_lock(hashtextextended('instasupply:seed', 0)) AS locked`;
const SEED_UNLOCK = `SELECT pg_advisory_unlock(hashtextextended('instasupply:seed', 0))`;

export const SEED_USAGE = 'usage: seed --demo [--reset] [--at <ISO instant, e.g. 2026-11-19T12:25:00-05:00>]';

// ---------- arguments ----------

export interface SeedArgs {
  reset: boolean;
  /** Epoch ms of `--at`, or null for the real clock. */
  at: number | null;
}

/** The arguments of `seed`, or the message to print when they are wrong. */
export function parseSeedArgs(args: readonly string[]): SeedArgs | { error: string } {
  const list = [...args];
  if (!list.includes('--demo')) return { error: SEED_USAGE };
  const known = new Set(['--demo', '--reset', '--at']);
  const atIndex = list.indexOf('--at');
  for (const [index, arg] of list.entries()) {
    if (index === atIndex + 1 && atIndex >= 0) continue;
    if (!known.has(arg)) return { error: `unknown argument "${arg}"\n${SEED_USAGE}` };
  }
  let at: number | null = null;
  if (atIndex >= 0) {
    const value = option(list, 'at');
    const parsed = value === null ? Number.NaN : Date.parse(value);
    if (!Number.isFinite(parsed)) return { error: `--at needs an ISO instant\n${SEED_USAGE}` };
    at = parsed;
  }
  return { reset: list.includes('--reset'), at };
}

// ---------- clock ----------

/**
 * The seed's clock: the real clock, or with `--at` a fixed instant that moves only when a scenario calls
 * `advance` (like the harness FakeClock, which `src/` cannot import).
 */
export class SeedClock implements Clock {
  private offset = 0;

  constructor(private readonly start: number | null) {}

  /** True with `--at`: time stands still until `advance`. */
  get fixed(): boolean {
    return this.start !== null;
  }

  now(): number {
    return this.start === null ? Date.now() : this.start + this.offset;
  }

  /** Moves a fixed clock forward; refused on the real clock, whose time cannot be changed. */
  advance(ms: number): number {
    if (this.start === null) throw new Error('advance() needs a fixed clock (seed --demo --at <ISO>)');
    if (!(ms >= 0)) throw new Error('a seed clock only moves forward');
    this.offset += ms;
    return this.now();
  }
}

// ---------- what scenarios get ----------

export interface SeedAnswer<T = unknown> {
  status: number;
  body: T;
}

/** An account signed in in-process (no password needed, so staff work in production too). */
export interface SeedActor {
  key: string;
  uid: string;
  email: string;
  role: Role;
  /** `POST /api/v1/call/<name>`; throws a SeedStepError unless the answer is 2xx. */
  call<T = unknown>(name: string, body?: unknown): Promise<T>;
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  put<T = unknown>(path: string, body?: unknown): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown): Promise<T>;
  del<T = unknown>(path: string): Promise<T>;
  /** Any request, answered as is (for steps that expect an error). Paths are relative to /api/v1. */
  request<T = unknown>(method: string, path: string, body?: unknown): Promise<SeedAnswer<T>>;
}

export interface SeededAccount {
  key: string;
  uid: string;
  email: string;
  role: Role;
  displayName: string;
  /** False for a staff account that got a set-password link instead (production). */
  hasPassword: boolean;
}

export interface SeedContext {
  deps: Deps;
  app: FastifyInstance;
  config: Config;
  clock: SeedClock;
  production: boolean;
  /** Every demo account by key (accounts.ts). */
  accounts: ReadonlyMap<string, SeededAccount>;
  /** Jobsite ids by key (jobsites.ts). */
  jobsites: ReadonlyMap<string, string>;
  /** Card ids by `${ownerKey}:${last4}`, e.g. `dana:4242`. */
  cards: ReadonlyMap<string, string>;
  /** The account signed in in-process, one session per key and run. */
  as(key: string): Promise<SeedActor>;
  /** Runs the outbox until nothing is due; returns how many events were handled. */
  drain(): Promise<number>;
  /** The body of a scheduled job at `now` (default: the seed clock), without runJobNow and its lock. */
  runJob(name: ScheduledJobName, now?: number): Promise<JobResult>;
  /** A line of the final summary. */
  print(line: string): void;
}

/** `backend/src/cli/seed/scenarios.ts` (workstream `scenarios`) exports this. */
export interface ScenarioModule {
  runScenarios(ctx: SeedContext): Promise<void>;
}

/** A scenario step answered with something other than 2xx. */
export class SeedStepError extends Error {
  override readonly name = 'SeedStepError';

  constructor(
    readonly step: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`${step} answered ${status}: ${JSON.stringify(body)}`);
  }
}

/** A guard of §2.2 refused the run (exit code 1, the message on standard error). */
export class SeedRefusal extends Error {
  override readonly name = 'SeedRefusal';
}

// ---------- the command ----------

export interface SeedOptions {
  /** Replaces single members of deps (a test passes its pool). The clock is always the seed's own. */
  deps?: Partial<Omit<Deps, 'clock'>>;
  /** Where the summary goes (default: standard output). */
  out?: (line: string) => void;
  /**
   * The scenarios to run: by default `seed/scenarios.ts` when it exists. `null` writes the base data only.
   */
  scenarios?: ScenarioModule | null;
}

export interface SeedReport {
  accounts: SeededAccount[];
  /** Staff set-password links (production only). */
  staffLinks: { email: string; link: string }[];
  stores: number;
  products: number;
  reviews: number;
  scenarios: 'ran' | 'missing' | 'skipped';
}

/** `seed` as the CLI runs it: 0 when the demo data is in place, 1 after a refusal or a failure. */
export async function runSeed(
  config: Config,
  args: readonly string[],
  options: SeedOptions = {},
): Promise<number> {
  const parsed = parseSeedArgs(args);
  if ('error' in parsed) {
    console.error(parsed.error);
    return 1;
  }
  try {
    await seedDemo(config, parsed, options);
    return 0;
  } catch (error) {
    if (error instanceof SeedRefusal) console.error(error.message);
    else if (error instanceof SeedStepError || error instanceof ApiError)
      console.error(`seed failed: ${error.message}`);
    else console.error(error);
    return 1;
  }
}

/** The password of the demo accounts, after the production checks of §2.2. */
export function seedPassword(config: Pick<Config, 'NODE_ENV' | 'SEED_PASSWORD'>): string {
  const production = config.NODE_ENV === 'production';
  const value = config.SEED_PASSWORD ?? '';
  if (production) {
    if (value === '' || value === DEV_SEED_PASSWORD) {
      throw new SeedRefusal(
        'seed refused: with NODE_ENV=production set SEED_PASSWORD to a new password for the demo accounts (not the development default).',
      );
    }
    return value;
  }
  return value === '' ? DEV_SEED_PASSWORD : value;
}

/** The whole run; throws SeedRefusal for a guard, anything else for a failure. */
export async function seedDemo(
  config: Config,
  args: SeedArgs,
  options: SeedOptions = {},
): Promise<SeedReport> {
  const production = config.NODE_ENV === 'production';
  if (production && args.reset)
    throw new SeedRefusal('seed refused: --reset is not allowed with NODE_ENV=production.');
  if (production && args.at !== null)
    throw new SeedRefusal('seed refused: --at is not allowed with NODE_ENV=production.');
  const password = seedPassword(config);
  const out = options.out ?? ((line: string) => console.info(line));

  const clock = new SeedClock(args.at);
  const ownPool = options.deps?.pool === undefined;
  const deps = createDeps(config, { ...options.deps, clock });
  let app: FastifyInstance | null = null;
  let lockClient: pg.PoolClient | null = null;
  const held: string[] = [];
  let seedLocked = false;
  const sessions: string[] = [];
  try {
    app = await buildApp(deps);
    await app.ready();

    lockClient = await connect(deps.pool);
    // One seed at a time; then every scheduled job, so a live scheduler skips them while the seed runs.
    const { rows } = await lockClient.query<{ locked: boolean }>(SEED_LOCK);
    seedLocked = rows[0]?.locked === true;
    if (!seedLocked) throw new SeedRefusal('seed refused: another seed is running against this database.');
    for (const name of jobNames()) {
      await waitForJobLock(lockClient, name);
      held.push(name);
    }

    if (!(await tableExists(deps.pool, 'orders'))) {
      throw new SeedRefusal('seed refused: the database has no schema yet. Run `npm run migrate` first.');
    }
    if (args.reset) await resetDatabase(deps);
    const { rows: orders } = await deps.pool.query<{ any: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM orders) AS any',
    );
    if (orders[0]?.any) {
      throw new SeedRefusal(
        'seed refused: the orders table is not empty, so the demo order numbers could not start at IS-10001. ' +
          'Use `npm run seed -- --reset` on a development database.',
      );
    }

    const base = await writeBaseData(deps, { production, password });
    await deps.outbox.drain();

    const lines: string[] = [];
    const context = scenarioContext(deps, app, config, clock, production, base, sessions, lines);
    const scenarios = options.scenarios === undefined ? await loadScenarios() : options.scenarios;
    if (scenarios) {
      await scenarios.runScenarios(context);
      await deps.outbox.drain();
    }

    const report: SeedReport = {
      accounts: [...base.accounts.values()],
      staffLinks: base.staffLinks,
      stores: base.stores,
      products: base.products,
      reviews: base.reviews,
      scenarios: scenarios ? 'ran' : options.scenarios === null ? 'skipped' : 'missing',
    };
    printSummary(out, config, report, { production, password, clock, lines });
    return report;
  } finally {
    if (sessions.length > 0) {
      await withTransaction(deps, (tx) => revokeSessions(tx, sessions, 'logout')).catch(() => undefined);
    }
    if (lockClient) {
      try {
        for (const name of held.reverse()) await unlock(lockClient, name);
        if (seedLocked) await lockClient.query(SEED_UNLOCK);
        lockClient.release();
      } catch {
        // A broken connection drops its session locks with it.
        lockClient.release(true);
      }
    }
    if (app) await app.close();
    if (ownPool) await deps.pool.end();
  }
}

// ---------- locks, schema and reset ----------

/** The seven ScheduledJobName values; the Record makes the compiler flag a name added in shared. */
const SCHEDULED_JOBS: Record<ScheduledJobName, true> = {
  escalateStoreOrders: true,
  expirePickupHolds: true,
  publishDueJobOffers: true,
  markStaleDriversOffline: true,
  expireQuotes: true,
  runDailyPayouts: true,
  captureDuePayments: true,
};

/** Every job a scheduler could run: the registered ones (internal jobs included) and the shared names. */
function jobNames(): string[] {
  const names = new Set<string>([...Object.keys(SCHEDULED_JOBS), ...registeredJobs().map((job) => job.name)]);
  return [...names].sort();
}

/** Statement (l) on the dedicated connection, polled like runJobNow (a blocking lock would hit statement_timeout). */
async function waitForJobLock(client: pg.PoolClient, name: string): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (!(await tryLock(client, name))) {
    if (Date.now() >= deadline) {
      throw new SeedRefusal(
        `seed refused: the job ${name} has been running for a minute. Try again shortly.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
  }
}

async function tableExists(pool: pg.Pool, table: string): Promise<boolean> {
  const { rows } = await pool.query<{ found: string | null }>('SELECT to_regclass($1) AS found', [table]);
  return rows[0]?.found !== null && rows[0]?.found !== undefined;
}

const SEQUENCES = ['order_number_seq', 'quote_number_seq', 'issue_number_seq'] as const;

/** `--reset`: every table emptied (the migration journal kept), the number sequences restarted, reference data back. */
async function resetDatabase(deps: Deps): Promise<void> {
  const { rows } = await deps.pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> 'schema_migrations'
      ORDER BY tablename`,
  );
  if (rows.length > 0) {
    const tables = rows.map((row) => `"${row.tablename.replaceAll('"', '""')}"`).join(', ');
    await deps.pool.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
  }
  for (const sequence of SEQUENCES) await deps.pool.query(`ALTER SEQUENCE ${sequence} RESTART`);
  await syncReferenceData(deps.pool, deps.clock.now());
  // scheduler_state was emptied too: put back the rows a running scheduler reads.
  await deps.scheduler.ensureRows(deps.clock.now());
}

// ---------- the base data ----------

interface BaseData {
  accounts: Map<string, SeededAccount>;
  jobsites: Map<string, string>;
  cards: Map<string, string>;
  staffLinks: { email: string; link: string }[];
  stores: number;
  products: number;
  reviews: number;
}

/**
 * Categories, stores (with settings and reviews), products, accounts, jobsites and cards. Rows that are
 * already there (same id, same email) are left alone, so a run that failed before its first order can be
 * repeated.
 */
export async function writeBaseData(
  deps: Deps,
  options: { production: boolean; password: string },
): Promise<BaseData> {
  const now = deps.clock.now();
  await withTransaction(deps, async (tx) => {
    const existing = await lockRows<{ id: string }>(
      tx,
      'categories',
      SEED_CATEGORIES.map((category) => category.id),
    );
    const have = new Set(existing.map((row) => row.id));
    for (const category of SEED_CATEGORIES) {
      if (!have.has(category.id)) await upsertCategory(tx, category, false);
    }
  });

  let stores = 0;
  let reviews = 0;
  for (const store of SEED_STORES) {
    const written = await withTransaction(deps, (tx) => writeStore(tx, store, now));
    stores += written.store ? 1 : 0;
    reviews += written.reviews;
  }

  let products = 0;
  for (const item of SEED_PRODUCTS) {
    const store = SEED_STORES.find((candidate) => candidate.id === item.storeId);
    if (!store) throw new Error(`seed product ${item.sku} names an unknown store ${item.storeId}`);
    const { storeId, ...raw } = item;
    const checked = validateProduct(raw, storeId);
    if (!checked.ok)
      throw new Error(`seed product ${item.sku} is invalid: ${JSON.stringify(checked.errors)}`);
    const { stockOnHand, ...fields } = checked.value;
    const category = CATEGORIES[fields.categoryId as CategoryId];
    const inserted = await withTransaction(deps, (tx) =>
      insertProduct(tx, {
        id: seedProductId(item),
        storeId,
        doc: { ...fields, updatedBy: 'seed' },
        stockOnHand,
        columns: deriveProductColumns(fields, store.doc, category),
      }),
    );
    if (inserted) products += 1;
  }

  const passwordHash = await hashPassword(options.password);
  const accounts = new Map<string, SeededAccount>();
  const jobsites = new Map<string, string>();
  const cards = new Map<string, string>();
  const staffLinks: { email: string; link: string }[] = [];
  for (const account of SEED_ACCOUNTS) {
    const staffLink = options.production && (account.role === 'admin' || account.role === 'dispatcher');
    const result = await withTransaction(deps, (tx) =>
      staffLink ? inviteStaff(tx, deps.config, account) : writeAccount(tx, account, passwordHash, now),
    );
    accounts.set(account.key, {
      key: account.key,
      uid: result.uid,
      email: account.email,
      role: account.role,
      displayName: account.displayName,
      hasPassword: !staffLink,
    });
    if (result.link) staffLinks.push({ email: account.email, link: result.link });
    if (account.role === 'customer') {
      for (const [key, id] of await withTransaction(deps, (tx) => writeCards(tx, account, result.uid, now))) {
        cards.set(key, id);
      }
    }
  }

  for (const jobsite of SEED_JOBSITES) {
    const ownerUid = accounts.get(jobsite.ownerKey)?.uid;
    if (!ownerUid)
      throw new Error(`seed jobsite ${jobsite.key} names an unknown account ${jobsite.ownerKey}`);
    const checked = validateJobsite(jobsite.fields);
    if (!checked.ok)
      throw new Error(`seed jobsite ${jobsite.key} is invalid: ${JSON.stringify(checked.errors)}`);
    const id = await withTransaction(deps, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM jobsites WHERE user_id = $1 AND doc->>'label' = $2`,
        [ownerUid, checked.value.label],
      );
      if (rows[0]) return rows[0].id;
      const created = newId();
      await tx.query(
        `INSERT INTO jobsites (id, user_id, doc, is_default, last_used_at, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, NULL, $5, $5)`,
        [created, ownerUid, JSON.stringify(checked.value), jobsite.isDefault, new Date(tx.now)],
      );
      return created;
    });
    jobsites.set(jobsite.key, id);
  }

  return { accounts, jobsites, cards, staffLinks, stores, products, reviews };
}

/** One store, its private settings and its seed reviews, with the rating columns recomputed. */
async function writeStore(
  tx: Tx,
  seed: SeedStore,
  now: number,
): Promise<{ store: boolean; reviews: number }> {
  const checked = validateStore({ ...seed.doc, photoUrl: null });
  if (!checked.ok) throw new Error(`seed store ${seed.id} is invalid: ${JSON.stringify(checked.errors)}`);
  const { photoUrl: _photoUrl, ...value } = checked.value;
  const doc: StoreDoc = { ...value, photoPath: null };
  const store = await insertStore(tx, seed.id, doc, seed.settings);
  let reviews = 0;
  for (const [index, review] of seed.reviews.entries()) {
    const at = new Date(now - review.daysAgo * DAY_MS);
    const { rowCount } = await tx.query(
      `INSERT INTO store_reviews (id, store_id, store_order_id, customer_id, author_name, rating, text, created_at,
                                  updated_at)
       VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $7) ON CONFLICT (id) DO NOTHING`,
      [
        review.id,
        seed.id,
        `seed-reviewer-${seed.id}-${index + 1}`,
        review.authorName,
        review.rating,
        review.text,
        at,
      ],
    );
    reviews += rowCount;
  }
  if (reviews > 0) {
    await lockRows(tx, 'stores', [seed.id]);
    await tx.query(
      `UPDATE stores s SET (rating_sum, rating_count) =
         (SELECT COALESCE(sum(r.rating), 0)::integer, count(*)::integer FROM store_reviews r WHERE r.store_id = $1),
         updated_at = $2
       WHERE s.id = $1`,
      [seed.id, new Date(tx.now)],
    );
    await publishChange(tx, 'stores', 'updated', { id: seed.id });
  }
  return { store, reviews };
}

function docFor(account: SeedAccount, now: number): Record<string, unknown> {
  switch (account.role) {
    case 'admin':
    case 'dispatcher':
      return { preferences: { chatPush: true, deliveryPush: true } };
    case 'supplier':
      return { preferences: { chatPush: true, storeOrderPush: true } };
    case 'customer':
      return {
        companyName: account.companyName,
        accountType: account.accountType,
        stats: { nonCancelledOrders: 0, completedOrders: 0, lastOrderAt: null },
        promoUses: {},
        preferences: { orderPush: true, chatPush: true, promoPush: false },
      };
    case 'driver': {
      const approved = account.status === 'active';
      return {
        vehicle: account.vehicle,
        vehicleDraft: null,
        vehicleReviewRequired: false,
        payoutAccount: approved
          ? { provider: 'test', accountRef: `acct_seed_${account.key}`, label: 'Test bank ••0001' }
          : null,
        compliance: {
          licenceAttestedAt: now - 30 * DAY_MS,
          insuranceAttestedAt: now - 30 * DAY_MS,
          termsAcceptedAt: now - 30 * DAY_MS,
          licenceVerified: approved,
          insuranceVerified: approved,
          verifiedBy: null,
          verifiedAt: approved ? now - 29 * DAY_MS : null,
        },
        approvedBy: null,
        approvedAt: approved ? now - 29 * DAY_MS : null,
        preferences: { chatPush: true, deliveryPush: true, jobPush: true },
        driverStats: { deliveries: 0, earnedCents: 0 },
      };
    }
  }
}

/** Inserts the account unless its email is taken; returns the uid either way. */
async function writeAccount(
  tx: Tx,
  account: SeedAccount,
  passwordHash: string,
  now: number,
): Promise<{ uid: string; created: boolean; link: null }> {
  const uid = newId();
  const store = account.role === 'supplier' ? account : null;
  const driver = account.role === 'driver' ? account : null;
  const { rowCount } = await tx.query(
    `INSERT INTO users (id, email, password_hash, password_changed_at, role, status, display_name, phone_number,
                        phone_verified, store_id, store_role, city_id, doc, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $4, $4)
     ON CONFLICT DO NOTHING`,
    [
      uid,
      account.email.toLowerCase(),
      passwordHash,
      new Date(now),
      account.role,
      driver ? driver.status : 'active',
      account.displayName,
      account.phoneNumber,
      account.phoneNumber !== null && account.phoneVerified,
      store?.storeId ?? null,
      store?.storeRole ?? null,
      driver?.cityId ?? null,
      JSON.stringify(docFor(account, now)),
    ],
  );
  if (rowCount === 0) return { uid: await uidOf(tx, account.email), created: false, link: null };
  await publishChange(tx, 'users', 'updated', { uid, role: account.role });
  if (driver) await writeDriverLocation(tx, uid, driver);
  return { uid, created: true, link: null };
}

async function writeDriverLocation(tx: Tx, uid: string, driver: SeedDriver): Promise<void> {
  await tx.query(
    `INSERT INTO driver_locations (driver_id, lat, lng, heading, speed, accuracy, battery, online, updated_at)
     VALUES ($1, $2, $3, NULL, NULL, 10, 0.9, $4, $5) ON CONFLICT (driver_id) DO NOTHING`,
    [uid, driver.position.lat, driver.position.lng, driver.online, new Date(tx.now)],
  );
  await publishChange(tx, 'driver_locations', 'updated', {
    id: uid,
    lat: driver.position.lat,
    lng: driver.position.lng,
    heading: null,
    speed: null,
    accuracy: 10,
    online: driver.online,
    battery: 0.9,
    updatedAt: tx.now,
  });
}

/** Production staff: an account without a password and a fresh set-password link (§6.3.8). */
async function inviteStaff(
  tx: Tx,
  config: Config,
  account: SeedAccount,
): Promise<{ uid: string; created: boolean; link: string | null }> {
  const { rows } = await tx.query<{ id: string; role: Role | null; password_hash: string | null }>(
    'SELECT id, role, password_hash FROM users WHERE lower(email) = $1',
    [account.email.toLowerCase()],
  );
  const existing = rows[0];
  // An account that already set its password keeps it: the seed never takes a working sign-in away.
  if (existing && existing.password_hash !== null) return { uid: existing.id, created: false, link: null };
  const invite = await inviteUser(tx, config, {
    email: account.email,
    displayName: account.displayName,
    role: account.role,
    invitedBy: null,
    doc: docFor(account, tx.now),
  });
  return { uid: invite.uid, created: !existing, link: invite.passwordSetupLink };
}

/** The customer's cards (only for an account without cards, so a rerun adds none). */
async function writeCards(
  tx: Tx,
  account: SeedCustomer,
  uid: string,
  now: number,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const { rows } = await tx.query<{ id: string; last4: string }>(
    'SELECT id, last4 FROM cards WHERE user_id = $1 ORDER BY created_at, id',
    [uid],
  );
  if (rows.length > 0) {
    for (const row of rows) ids.set(`${account.key}:${row.last4}`, row.id);
    return ids;
  }
  for (const card of account.cards) {
    const id = newId();
    await tx.query(
      `INSERT INTO cards (id, user_id, brand, last4, exp_month, exp_year, holder, is_default, provider, created_at,
                          updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'test', $9, $9)`,
      [
        id,
        uid,
        card.brand,
        card.last4,
        card.expMonth,
        card.expYear,
        card.holder,
        card.isDefault,
        new Date(now),
      ],
    );
    ids.set(`${account.key}:${card.last4}`, id);
  }
  return ids;
}

async function uidOf(db: Pick<Tx, 'query'>, email: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE lower(email) = $1', [
    email.toLowerCase(),
  ]);
  const row = rows[0];
  if (!row) throw new Error(`no account ${email}`);
  return row.id;
}

// ---------- the scenario context ----------

function appFor(role: Role): ClientApp {
  if (role === 'driver') return 'driver';
  if (role === 'customer') return 'customer';
  return 'console';
}

function scenarioContext(
  deps: Deps,
  app: FastifyInstance,
  config: Config,
  clock: SeedClock,
  production: boolean,
  base: BaseData,
  sessions: string[],
  lines: string[],
): SeedContext {
  const actors = new Map<string, Promise<SeedActor>>();

  const signIn = async (key: string): Promise<SeedActor> => {
    const account = base.accounts.get(key);
    if (!account) throw new Error(`unknown seed account ${key}`);
    const app_ = appFor(account.role);
    const session = await withTransaction(deps, async (tx) => {
      await lockRows(tx, 'users', [account.uid]);
      return createSession(tx, config, {
        userId: account.uid,
        app: app_,
        installationId: `seed-${key}`,
        platform: null,
        appVersion: null,
        deviceName: 'seed --demo',
        userAgent: 'instasupply-seed',
        ipHash: null,
      });
    });
    // A driver's session is kept: revoking it would set the driver offline (§6.3.6).
    if (app_ !== 'driver') sessions.push(session.sessionId);
    let token = '';
    let signedAt = Number.NEGATIVE_INFINITY;
    const bearer = async (): Promise<string> => {
      const now = clock.now();
      // Access tokens live ACCESS_TOKEN_TTL_SECONDS; sign a fresh one well before that on the real clock.
      if (now - signedAt > (config.ACCESS_TOKEN_TTL_SECONDS * 1000) / 2 || now < signedAt) {
        token = await signAccessToken(config, { uid: account.uid, sessionId: session.sessionId, now });
        signedAt = now;
      }
      return token;
    };
    const request = async <T>(method: string, path: string, body?: unknown): Promise<SeedAnswer<T>> => {
      const answer = await app.inject({
        method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        url: `/api/v1${path.startsWith('/') ? path : `/${path}`}`,
        headers: { authorization: `Bearer ${await bearer()}` },
        ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
      });
      const text = answer.body;
      let parsed: unknown = null;
      if (text.length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      return { status: answer.statusCode, body: parsed as T };
    };
    const ok = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      const answer = await request<T>(method, path, body);
      if (answer.status < 200 || answer.status >= 300) {
        throw new SeedStepError(`${key}: ${method} ${path}`, answer.status, answer.body);
      }
      return answer.body;
    };
    return {
      key,
      uid: account.uid,
      email: account.email,
      role: account.role,
      call: (name, body) => ok('POST', `/call/${name}`, body ?? {}),
      get: (path) => ok('GET', path),
      post: (path, body) => ok('POST', path, body ?? {}),
      put: (path, body) => ok('PUT', path, body ?? {}),
      patch: (path, body) => ok('PATCH', path, body ?? {}),
      del: (path) => ok('DELETE', path),
      request,
    };
  };

  return {
    deps,
    app,
    config,
    clock,
    production,
    accounts: base.accounts,
    jobsites: base.jobsites,
    cards: base.cards,
    as(key) {
      let actor = actors.get(key);
      if (!actor) {
        actor = signIn(key);
        actors.set(key, actor);
      }
      return actor;
    },
    drain: () => deps.outbox.drain(),
    async runJob(name, now) {
      const job = jobFor(name);
      if (!job) throw new Error(`no job called ${name} is registered`);
      return job.run(deps, now ?? clock.now());
    },
    print(line) {
      lines.push(line);
    },
  };
}

function isScenarioModule(value: unknown): value is ScenarioModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runScenarios' in value &&
    typeof (value as { runScenarios: unknown }).runScenarios === 'function'
  );
}

/**
 * `seed/scenarios.ts` belongs to the `scenarios` workstream (wave 3). Until it exists the seed writes the
 * base data only. The specifier is a variable so this file type-checks and bundles without it.
 */
async function loadScenarios(): Promise<ScenarioModule | null> {
  const specifier = './seed/scenarios';
  try {
    const loaded: unknown = await import(specifier);
    if (!isScenarioModule(loaded)) throw new Error('seed/scenarios.ts must export runScenarios(ctx)');
    return loaded;
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
    if (code === 'ERR_MODULE_NOT_FOUND' && String(error).includes('scenarios')) return null;
    throw error;
  }
}

// ---------- summary ----------

function printSummary(
  out: (line: string) => void,
  config: Config,
  report: SeedReport,
  extra: { production: boolean; password: string; clock: SeedClock; lines: string[] },
): void {
  out(
    `Demo data ready (${extra.clock.fixed ? `fixed clock at ${new Date(extra.clock.now()).toISOString()}` : 'real clock'}).`,
  );
  out(
    `  ${report.stores} stores, ${report.products} products and ${report.reviews} reviews written; existing rows kept.`,
  );
  out('');
  out(`Accounts (every email ends in @${SEED_EMAIL_DOMAIN}):`);
  for (const account of report.accounts) {
    out(`  ${account.role.padEnd(10)} ${account.email.padEnd(36)} ${account.displayName}`);
  }
  out(
    extra.production
      ? '  Password: the value of SEED_PASSWORD (staff accounts excepted, see below).'
      : `  Password: ${extra.password}`,
  );
  if (report.staffLinks.length > 0) {
    out('');
    out(
      `Staff accounts have no password; one-time set-password links, valid ${config.INVITE_LINK_TTL_HOURS} hours:`,
    );
    for (const { email, link } of report.staffLinks) out(`  ${email}: ${link}`);
  }
  out('');
  out(`Console and supplier portal: ${config.WEB_URL}`);
  if (report.scenarios === 'missing') {
    out('Scenarios A to K are not available yet (backend/src/cli/seed/scenarios.ts): base data only.');
  }
  for (const line of extra.lines) out(line);
  out('Driver simulator: npm run simulate -- --driver marco@instasupply.test');
}
