/**
 * Signed-in actors (docs/PLATFORM.md §12.2): `as(ctx, 'dana')` for the named data set, or `newCustomer`,
 * `newSupplier`, `newDriver`, `newDispatcher`, `newAdmin` for a fresh account of a role. Tokens come from the
 * real POST /auth/login, so every request a test makes passes the real authentication.
 */
import { randomBytes } from 'node:crypto';
import type { CityId, StoreRole, VehicleClass } from '@instasupply/shared';
import type { TestContext } from './database';
import {
  accountOf,
  createAccount,
  createStore,
  seedAccounts,
  type Account,
  type AccountSpec,
  type SeedAccountKey,
  type StoreSpec,
} from './fixtures';
import { command, request, type Answer, type Method, type RequestOptions } from './http';
import { connectLive, type LiveClient } from './live';

export type ClientApp = 'customer' | 'driver' | 'console';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

export interface ActorClient {
  account: Account;
  uid: string;
  email: string;
  installationId: string;
  /** The current access token; `refresh()` replaces it. */
  token: string;
  session: SessionTokens;
  call<T = unknown>(name: string, body?: unknown): Promise<Answer<T>>;
  get<T = unknown>(path: string, options?: Omit<RequestOptions, 'token'>): Promise<Answer<T>>;
  post<T = unknown>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'token'>,
  ): Promise<Answer<T>>;
  put<T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, 'token'>): Promise<Answer<T>>;
  patch<T = unknown>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'token'>,
  ): Promise<Answer<T>>;
  del<T = unknown>(path: string, options?: Omit<RequestOptions, 'token'>): Promise<Answer<T>>;
  /** POST /auth/refresh with the current refresh token; the actor keeps the new pair. */
  refresh(): Promise<Answer<SessionTokens>>;
  /** A live socket, already authenticated as this actor (`ready` received). */
  live(): Promise<LiveClient>;
}

const appFor = (account: Account): ClientApp =>
  account.role === 'driver'
    ? 'driver'
    : account.role === 'customer' || account.role === null
      ? 'customer'
      : 'console';

/** Signs a fixture account in through POST /auth/login and returns a client bound to its token. */
export async function signIn(
  ctx: TestContext,
  account: Account,
  options: { app?: ClientApp; installationId?: string } = {},
): Promise<ActorClient> {
  if (account.password === null) throw new Error(`${account.key} has no password (an invited account)`);
  const installationId = options.installationId ?? `test-install-${randomBytes(6).toString('hex')}`;
  const answer = await request<SessionTokens>(ctx, 'POST', '/auth/login', {
    email: account.email,
    password: account.password,
    installationId,
    app: options.app ?? appFor(account),
  });
  if (answer.status !== 200)
    throw new Error(`login of ${account.key} failed: ${answer.status} ${JSON.stringify(answer.body)}`);
  const session: SessionTokens = {
    accessToken: answer.body.accessToken,
    refreshToken: answer.body.refreshToken,
    sessionId: answer.body.sessionId,
  };
  const actor: ActorClient = {
    account,
    uid: account.uid,
    email: account.email,
    installationId,
    token: session.accessToken,
    session,
    call: (name, body) => command(ctx, name, body ?? {}, actor.token),
    get: (path, opts) => send(ctx, actor, 'GET', path, undefined, opts),
    post: (path, body, opts) => send(ctx, actor, 'POST', path, body ?? {}, opts),
    put: (path, body, opts) => send(ctx, actor, 'PUT', path, body ?? {}, opts),
    patch: (path, body, opts) => send(ctx, actor, 'PATCH', path, body ?? {}, opts),
    del: (path, opts) => send(ctx, actor, 'DELETE', path, undefined, opts),
    async refresh() {
      const refreshed = await request<SessionTokens>(ctx, 'POST', '/auth/refresh', {
        refreshToken: actor.session.refreshToken,
      });
      if (refreshed.status === 200) {
        actor.session = {
          accessToken: refreshed.body.accessToken,
          refreshToken: refreshed.body.refreshToken,
          sessionId: refreshed.body.sessionId ?? actor.session.sessionId,
        };
        actor.token = actor.session.accessToken;
      }
      return refreshed;
    },
    async live() {
      const client = await connectLive(ctx, actor.token);
      const ready = await client.auth();
      if (ready.type !== 'ready')
        throw new Error(`live auth of ${account.key} failed: ${JSON.stringify(ready)}`);
      return client;
    },
  };
  return actor;
}

function send<T>(
  ctx: TestContext,
  actor: ActorClient,
  method: Method,
  path: string,
  body: unknown,
  options: Omit<RequestOptions, 'token'> = {},
): Promise<Answer<T>> {
  return request<T>(ctx, method, path, body, { ...options, token: actor.token });
}

const signedIn = new WeakMap<TestContext, Map<string, Promise<ActorClient>>>();

/**
 * The named actor of the seed data set (seeds accounts and catalogue on first use). One session per name
 * and context, so repeated calls are cheap and share the token.
 */
export function as(ctx: TestContext, key: SeedAccountKey | (string & {})): Promise<ActorClient> {
  let cache = signedIn.get(ctx);
  if (!cache) {
    cache = new Map();
    signedIn.set(ctx, cache);
  }
  let actor = cache.get(key);
  if (!actor) {
    actor = (async () => {
      let account = accountOf(ctx, key);
      if (!account) {
        await seedAccounts(ctx);
        account = accountOf(ctx, key);
      }
      if (!account) throw new Error(`as(ctx, '${key}'): no such fixture account`);
      return signIn(ctx, account);
    })();
    // A failed sign-in must not stay cached, or every later call would repeat the old failure.
    actor.catch(() => cache.delete(key));
    cache.set(key, actor);
  }
  return actor;
}

/** Creates an account and signs it in. */
export async function newActor(ctx: TestContext, spec: AccountSpec): Promise<ActorClient> {
  return signIn(ctx, await createAccount(ctx, spec));
}

type Extra = Omit<AccountSpec, 'role'>;

export const newCustomer = (ctx: TestContext, spec: Extra = {}) =>
  newActor(ctx, { ...spec, role: 'customer' });
export const newDispatcher = (ctx: TestContext, spec: Extra = {}) =>
  newActor(ctx, { ...spec, role: 'dispatcher' });
export const newAdmin = (ctx: TestContext, spec: Extra = {}) => newActor(ctx, { ...spec, role: 'admin' });

/** A supplier of `storeId`, or of a new live store when none is given (the store is returned too). */
export async function newSupplier(
  ctx: TestContext,
  spec: Extra & { storeRole?: StoreRole; store?: StoreSpec } = {},
): Promise<ActorClient & { storeId: string }> {
  const { store, ...rest } = spec;
  const storeId = spec.storeId ?? (await createStore(ctx, store ?? {})).id;
  const actor = await newActor(ctx, {
    ...rest,
    role: 'supplier',
    storeId,
    storeRole: spec.storeRole ?? 'owner',
  });
  return Object.assign(actor, { storeId });
}

/** An active driver of a city and capacity class, online at `position` (default: central Toronto). */
export function newDriver(
  ctx: TestContext,
  spec: Extra & { cityId?: CityId; capacityClass?: VehicleClass } = {},
): Promise<ActorClient> {
  const { capacityClass, ...rest } = spec;
  return newActor(ctx, {
    ...rest,
    role: 'driver',
    cityId: spec.cityId ?? 'toronto',
    vehicle: spec.vehicle ?? { capacityClass: capacityClass ?? 'cargo_van' },
    position: spec.position ?? (spec.status === 'pending' ? undefined : { lat: 43.6532, lng: -79.3832 }),
  });
}

/** A signed-up account without a role yet (POST /auth/register's result before registerCustomer). */
export const newRolelessUser = (ctx: TestContext, spec: Extra = {}) => newActor(ctx, { ...spec, role: null });
