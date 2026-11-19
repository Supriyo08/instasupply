# InstaSupply clients: the data layer and the move off Firebase

**Status:** design, ready to build · **Date:** 2026-11-19 · **Audience:** engineers building
`packages/api-client`, `frontend/`, `app/customer` and `app/driver`.

Firebase is removed from every client. The three clients talk to our own API over HTTPS and one
WebSocket, through one new package, `packages/api-client`. This document specifies that package,
how each client's session behaves, what replaces every file that touches Firebase today, what each
screen reads, calls and subscribes to, driver location publishing, push notifications, maps,
configuration and dependencies.

**Precedence.** `docs/MARKETPLACE.md` is the source of truth for the domain (§0 to §4, §7 to §11).
Decisions P1 to P18 of the platform brief are binding. `docs/PLATFORM.md` (written in parallel)
owns the server. Where PLATFORM.md and this document name a path, a topic or a payload differently,
**PLATFORM.md wins**, and only the three "single places" of §1.1 change (`src/resources/` for
paths, `src/topics.ts` for topic names, `src/queries/` for what each query subscribes to). Screens
never write a URL or a topic string themselves, so such a correction never reaches a screen.
Appendix A lists every assumption this document makes about the server, numbered, so the two
documents can be reconciled line by line.

**Conventions used below.** Paths are relative to `/api/v1` unless they start with `http`. "The
package" is `packages/api-client`. "Console" is `frontend/` (ops back office, supplier portal at
`/portal`, public tracking page `/track/:token`). `uid` is the account id. All "…At" values are
epoch milliseconds (numbers). Money is integer cents.

**Folder boundaries.** The repository keeps the backend, the web frontend and the apps in separate
top-level folders, each with its own `package.json`, env files, build and deployment. This document
does not blur that:

| Folder | Holds | May import |
| --- | --- | --- |
| `backend/` | the API server (PLATFORM.md) | `packages/shared` |
| `frontend/` | the web console | `packages/shared`, `packages/art`, `packages/api-client` |
| `app/customer/`, `app/driver/` | the two Expo apps | `packages/shared`, `packages/art`, `packages/api-client` |
| `packages/api-client/` | the client data layer specified here | `packages/shared` |

No client imports anything from `backend/`; `frontend/` and `app/` never import each other, and the
two apps never import each other. What clients share is a package under `packages/`; what a client
and the server share is `packages/shared` (types and pure rules) and the HTTP contract.

---

## 0. What was verified, and where

Each platform fact this design leans on was checked on 2026-11-19 against the source named beside
it. Local sources are files in this repository's `node_modules` (installed SDK: `expo@58.0.26`,
`react-native@0.88.1`, `react@19.3.0`); they are the exact code the apps will run.

| # | Fact | Source |
| --- | --- | --- |
| V1 | SDK 58 versions: `expo-secure-store ~58.0.3`, `react-native-webview 14.0.1`, `expo-crypto ~58.0.8`, `expo-network ~58.0.5`, `expo-image-picker ~58.0.10`, `expo-document-picker ~58.0.5`, `expo-image-manipulator ~58.0.16`, `expo-notifications ~58.1.9`, `expo-location ~58.0.22`, `expo-task-manager ~58.0.14`, `@react-native-async-storage/async-storage 2.2.0`; `@expo/dom-webview ~58.0.2` is a dependency of `expo` itself | `node_modules/expo/bundledNativeModules.json`; the same versions are the latest on the npm registry (`npm view`, 2026-11-19) |
| V2 | `expo-secure-store`: Android, iOS, tvOS, in Expo Go; **not web**. Keys may contain only alphanumerics, `.`, `-`, `_`. `keychainAccessible` defaults to `WHEN_UNLOCKED`; `AFTER_FIRST_UNLOCK` allows reads while the phone is locked. No enforced size limit, but old iOS releases refused values above about 2048 bytes. Android data does not survive an uninstall | docs.expo.dev/versions/v58.0.0/sdk/securestore |
| V3 | Push in Expo Go: unavailable on Android since SDK 53. In Expo Go on Android `getDevicePushTokenAsync` and `addPushTokenListener` **throw** | `node_modules/expo-notifications/build/warnOfExpoGoPushUsage.js`, `TokenEmitter.js`, `getDevicePushTokenAsync.js`; docs.expo.dev/push-notifications/faq |
| V4 | An Android build without Firebase configuration does not crash: `getDevicePushTokenAsync` rejects with `E_REGISTRATION_FAILED` ("Unable to get Firebase Messaging instance. Did you configure `googleServicesFile`…"). `getExpoPushTokenAsync` first needs that device token, then an EAS `projectId` (else `ERR_NOTIFICATIONS_NO_EXPERIENCE_ID`), then calls `https://exp.host/--/api/v2/push/getExpoPushToken` | `node_modules/expo-notifications/android/…/tokens/PushTokenModule.kt`, `build/getExpoPushTokenAsync.js` |
| V5 | `google-services.json` "is required for your Android app to be registered with FCM"; the FCM V1 service-account key is uploaded to the Expo project (`eas credentials` or the Expo dashboard). The Expo push service needs no Firebase SDK on our server | docs.expo.dev/push-notifications/fcm-credentials |
| V6 | Android 13+: the permission prompt "will not appear until at least one notification channel is created"; a channel's importance cannot be changed after creation (only name and description). `getLastNotificationResponse()` and `clearLastNotificationResponse()` (synchronous) are current; the `…Async` variants are deprecated | docs.expo.dev/versions/v58.0.0/sdk/notifications; `node_modules/expo-notifications/build/NotificationsEmitter.d.ts` |
| V7 | `expo-location` on Android builds `LocationRequest.Builder(interval).setMinUpdateIntervalMillis(interval).setMinUpdateDistanceMeters(distance)`: with `distanceInterval: 0` updates keep arriving while stationary. In the background, fixes are buffered and delivered to the task as one batch once `deferredUpdatesInterval` has passed and `deferredUpdatesDistance` was covered; in the foreground they are delivered at once. Background location needs a development or release build, and stops when the user terminates the app | `node_modules/expo-location/android/…/LocationHelpers.kt`, `taskConsumers/LocationTaskConsumer.kt`; docs.expo.dev/versions/v58.0.0/sdk/location |
| V8 | `TaskManager.defineTask` "must be called in the global scope"; TaskManager is not available in Expo Go on Android | docs.expo.dev/versions/v58.0.0/sdk/task-manager |
| V9 | DOM components (`'use dom'`): from SDK 56 they use `@expo/dom-webview` by default; `dom={{ useExpoDOMWebView: false }}` switches to `react-native-webview`. Props must be serializable and cross an asynchronous bridge; functions may only be passed as top-level asynchronous props; no `children`. Release builds load the component from `file:///android_asset/www.bundle` (embedded, works without a network); development loads it from the dev server | docs.expo.dev/guides/dom-components; `node_modules/expo/src/dom/webview-wrapper.tsx`, `base.ts`, `dom.types.ts` |
| V10 | `react-native-webview` has `applicationNameForUserAgent` ("Append to the existing user-agent"); `@expo/dom-webview` has no user-agent prop | react-native-webview `docs/Reference.md`; `node_modules/@expo/dom-webview/build/DomWebView.types.d.ts` |
| V11 | OpenStreetMap tile policy: use `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, show attribution, identify the app with a User-Agent, send a Referer from web pages, never prefetch or offer offline tiles; access for commercial services "may be withdrawn at any point" | operations.osmfoundation.org/policies/tiles |
| V12 | Expo CLI env files, first wins: `.env.{mode}.local`, `.env.local`, `.env.{mode}`, `.env`; a variable already set in the shell is never overwritten. `expo start` is development; a Gradle release build bundles with `expo export:embed` in production mode and embeds `app.config` by evaluating `app.config.ts` in production mode too. `expo prebuild` evaluates it in development mode. Only literal `process.env.EXPO_PUBLIC_NAME` references are inlined | `node_modules/@expo/env/build/index.js`, `@expo/cli/build/src/export/embed/index.js`, `expo-constants/scripts/getAppConfig.js` and `get-app-config-android.gradle`; docs.expo.dev/guides/environment-variables |
| V13 | The prebuild Android template allows cleartext HTTP in **debug** builds only (`src/debug/AndroidManifest.xml`, `usesCleartextTraffic="true"`), bundles with `bundleCommand = "export:embed"`, and signs `release` with the debug keystore until a signing config is added | `node_modules/expo/template.tgz` |
| V14 | Metro resolves `package.json` `exports` on all platforms from SDK 53 (condition `react-native` on native, `browser` on web) and is configured for monorepos automatically from SDK 52; `expo/tsconfig.base` uses `moduleResolution: bundler` | docs.expo.dev/versions/v58.0.0/config/metro, /guides/monorepos; `node_modules/expo/tsconfig.base.json` |
| V15 | `Constants.expoConfig` is typed `ExpoConfig & { hostUri: string } \| null` (the dev server's `host:port`, used today by `resolveEmulatorHost`) | docs.expo.dev/versions/v58.0.0/sdk/constants; `packages/expo-firebase/src/emulator-host.ts` |
| V16 | Railway: WebSockets over HTTP/1.1 are supported and are exempt from the request duration and inactivity limits; idle HTTP/1.1 connections close after 60 s; request bodies must finish within 5 min. Build-time variables must be declared with `ARG` in the Dockerfile. Reference variables: `VITE_BACKEND_HOST=https://${{Backend.RAILWAY_PUBLIC_DOMAIN}}` | docs.railway.com/networking/public-networking/specs-and-limits, /builds/dockerfiles, /variables |
| V17 | Railway buckets are private only; the documented upload path is a presigned **POST** (`createPresignedPost`, with content-type and `content-length-range` conditions); browser uploads need a CORS rule on the bucket; presigned URLs live at most 90 days | docs.railway.com/storage-buckets, /storage-buckets/uploading-serving |
| V18 | Vite: `.env.[mode]` beats `.env`; variables present in the environment when Vite runs beat every file; only `VITE_*` reach `import.meta.env`; `vite build` uses mode `production` | vite.dev/guide/env-and-mode |
| V19 | Android defaults of this SDK: `compileSdk 37`, `targetSdk 36`, `minSdk 24`, `buildTools 37.0.0`, NDK `27.1.12297006`. This machine has platforms `android-34`, `android-36`, `android-36.1` (no `android-37`), build-tools up to `37.0.0`, that NDK, JDK 17.0.14, and no `ANDROID_HOME` in the shell | `node_modules/react-native/gradle/libs.versions.toml`, `expo-modules-autolinking/…/ExpoRootProjectPlugin.kt`; `ls ~/Library/Android/sdk/*`, `/usr/libexec/java_home -V` |
| V20 | `expo-network`: `getNetworkStateAsync`, `addNetworkStateListener`, works on web. `expo-crypto`: `randomUUID()` returns a UUIDv4 on Android, iOS and web. `react-leaflet 5.0.0` peers: `leaflet ^1.9.0`, `react ^19`, `react-dom ^19` | docs.expo.dev/versions/v58.0.0/sdk/network, /sdk/crypto; `npm view react-leaflet peerDependencies` |
| V21 | The Expo push service: at most 100 messages per request, 600 notifications per second per project, receipts available after about 15 minutes and kept 24 hours, payload at most 4 KiB | docs.expo.dev/push-notifications/sending-notifications, /faq |

Not verified by running anything: no build, install, server or deployment was run for this
document. Appendix A marks what is assumed.

---

## 1. `packages/api-client`

One package gives all three clients the same data layer: HTTP with our error envelope, our own
session (tokens, refresh, profile), typed commands, REST helpers, uploads, the live socket, a query
cache with hooks, and the driver's location publisher. It replaces `packages/expo-firebase`,
`frontend/src/lib/firebase/*`, `app/driver/src/lib/firebase*.ts`, `firestore-hooks.ts` and the
`firebase` npm package everywhere.

Design rules:

1. **Pure TypeScript at the core.** `src/index.ts` imports no React, no DOM-only API beyond `fetch`,
   `WebSocket` and `AbortController`, and no React Native module. Everything that differs by
   platform is injected (§1.4).
2. **One client per JavaScript runtime**, created in `<client>/src/lib/api.ts`, never in a component.
3. **Screens never build URLs or topic names.** They use `api.call`, the resource functions of §4.2
   and the query descriptors of §4.1.
4. **No external state library.** The cache must tie three things together that no general library
   ties for us: the `{ data, loading, error, retry }` contract the screens already use, topic
   subscriptions that are reference-counted with the cached query, and the polling fallback that
   switches on only while the socket is down. That is about 400 lines we can test with
   `node:test`; a query library would still need that glue and would add a dependency to three
   clients.

### 1.1 Folder layout

```
packages/api-client/
  package.json
  tsconfig.json
  src/
    index.ts                 core exports (everything below except react/, web/, native/, testing/)
    client.ts                createApiClient, ApiClient
    http.ts                  request pipeline: URL, headers, token, timeout, envelope, 401 retry
    errors.ts                ApiError, errorCodeOf, describeError, …
    platform.ts              SecretStorage, KeyValueStorage, Lifecycle, RefreshLock, Clock (interfaces)
    ids.ts                   newRequestId, canonicalJson (query keys from filter objects)
    config.ts                PublicConfig, ConfigStore
    contract.ts              the REST types of PLATFORM.md §5.4, re-exported from `@instasupply/shared`
                             (`rest.ts`); declares only what shared does not have yet (`OutboxMessage`)
    auth/
      tokens.ts              TokenManager: access token in memory, single-flight refresh, rotation
      session.ts             SessionCore: status, user, profile, sign-in, sign-out, offline start
      logout-queue.ts        sign-outs that could not reach the server, retried later
    callables.ts             CallableMap, call(), CALL_INVALIDATIONS
    rest.ts                  get, list, post, put, patch, delete; Page<T>, WithId<T>, query strings
    resources/               *** single place for REST paths ***: every read and write function,
                             one file per aggregate (reads feed the descriptors, writes are §4.2)
      me.ts  catalog.ts  orders.ts  deliveries.ts  jobs.ts  chat.ts  support.ts  quotes.ts
      issues.ts  finance.ts  notifications.ts  users.ts  ops.ts  files.ts  location.ts
      context.ts             ResourceContext, `writeThen` (write, then invalidate the row's families)
      index.ts               createResources: the `api.<resource>` namespaces of §4.2
    topics.ts                *** single place for live topic strings *** (§4.1)
    live/
      protocol.ts            wire messages of /api/v1/live
      backoff.ts             reconnect delays
      live-client.ts         LiveClient
    query/
      types.ts               QueryKey, QueryDescriptor, PagedQueryDescriptor, QueryResult
      query-cache.ts         QueryCache: entries, de-duplication, invalidation, optimistic layer, polling
      observer.ts            QueryObserver: one hook's view across key changes (keepPreviousData)
      paged.ts               first-page merge, load more (usePagedQuery's engine)
      mutation.ts            MutationRunner: optimistic patches, rollback, double-call guard
    queries/                 *** single place for query keys ***: descriptors per aggregate (§4.1);
                             each `fetch` calls a read function of resources/, each `topics` uses topics.ts
      index.ts               export const queries = { … }
      helpers.ts             docQuery, listQuery, pagedQuery, valueQuery, payload reducers
      public.ts  customer.ts  supplier.ts  driver.ts  ops.ts   the tables of §4.1
    uploads.ts               uploadFile: presign, upload, confirm
    driver/
      location-publisher.ts  LocationPublisher, TRACKING_PROFILES (§5)
    react/
      index.ts
      ApiProvider.tsx        ApiProvider, useApi
      use-session-core.ts    useSessionCore
      use-query.ts           useApiQuery, useLiveQuery
      use-paged-query.ts     usePagedQuery
      use-mutation.ts        useApiMutation
      use-misc.ts            useConfig, useLiveStatus, useFileUrl
    web/
      index.ts               createWebPlatform (localStorage, Web Locks, storage events, online/offline)
    native/
      index.ts               createNativePlatform
      platform.native.ts     SecureStore, AsyncStorage, AppState, expo-network, expo-crypto
      platform.ts            the same export for Expo web: delegates to ../web
    testing/
      index.ts               fake server, fake socket, fake clock, memory storage (§1.13)
  test/
    *.test.ts  *.test.tsx    node:test through tsx
    support.ts               shared fixtures (a signed-in customer), not a test file itself
```

### 1.2 Package manifest

```json
{
  "name": "@instasupply/api-client",
  "version": "1.0.0",
  "private": true,
  "description": "InstaSupply API client: session, typed commands, REST, live socket, query cache and React hooks for the web console and the Expo apps.",
  "sideEffects": false,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./react": "./src/react/index.ts",
    "./web": "./src/web/index.ts",
    "./native": "./src/native/index.ts",
    "./testing": "./src/testing/index.ts",
    "./package.json": "./package.json"
  },
  "scripts": {
    "typecheck": "tsc --noEmit -p .",
    "test": "tsx --test test/*.test.ts test/*.test.tsx"
  },
  "dependencies": { "@instasupply/shared": "*" },
  "peerDependencies": {
    "react": "*",
    "react-native": "*",
    "@react-native-async-storage/async-storage": "*",
    "expo-secure-store": "*",
    "expo-network": "*",
    "expo-crypto": "*"
  },
  "peerDependenciesMeta": {
    "react-native": { "optional": true },
    "@react-native-async-storage/async-storage": { "optional": true },
    "expo-secure-store": { "optional": true },
    "expo-network": { "optional": true },
    "expo-crypto": { "optional": true }
  },
  "devDependencies": {
    "@happy-dom/global-registrator": "^21.0.4",
    "@testing-library/dom": "^10.4.2",
    "@testing-library/react": "^16.3.3",
    "@types/node": "^22.15.0",
    "@types/react": "~19.3.0",
    "@types/react-dom": "~19.3.0",
    "@react-native-async-storage/async-storage": "2.2.0",
    "expo-crypto": "~58.0.8",
    "expo-network": "~58.0.5",
    "expo-secure-store": "~58.0.3",
    "react": "19.3.0",
    "react-dom": "19.3.0"
  }
}
```

The four native modules are also dev dependencies so that `tsc` can type-check
`src/native/platform.native.ts` (it is in `include`, though only Metro resolves it); the apps still
list them as their own dependencies for autolinking.

The package is consumed as TypeScript source, like `@instasupply/shared` (Metro and Vite compile
workspace packages; subpath `exports` are resolved by both, V14). The native modules are peer
dependencies: each Expo app lists them in its own `package.json` (§9) so autolinking sees them.
`tsconfig.json`: `target ES2022`, `lib ["ES2022", "DOM"]`, `module ESNext`,
`moduleResolution bundler`, `jsx react-jsx`, `strict`, `noUncheckedIndexedAccess`,
`verbatimModuleSyntax`, `types ["node"]`, `include ["src", "test"]`.

Root changes that come with the package (owners of those files apply them): add
`npm --workspace @instasupply/api-client run typecheck` to the root `typecheck` script and
`npm --workspace @instasupply/api-client run test` to the root `test` script; add
`packages/api-client/**/*.{ts,tsx}` to the React-hooks block of `eslint.config.mjs`.

### 1.3 Errors (`src/errors.ts`)

The server answers every failure with one envelope (decision P4):

```json
{ "error": { "status": "failed-precondition", "code": "PRICE_CHANGED", "message": "Prices changed. Review the new total.", "details": { "pricing": {} } } }
```

```ts
import type { ErrorCode, ErrorDetailsByCode as SharedErrorDetailsByCode } from '@instasupply/shared';

/** Statuses the server sends (MARKETPLACE §5.9, decision P4); PLATFORM.md §4.2 adds `unavailable` (503). */
export type ServerErrorStatus =
  | 'invalid-argument' | 'failed-precondition' | 'permission-denied' | 'unauthenticated'
  | 'not-found' | 'already-exists' | 'resource-exhausted' | 'internal' | 'unavailable';

/** Statuses the client produces itself when no usable answer arrived. */
export type TransportErrorStatus = 'unavailable' | 'deadline-exceeded' | 'cancelled';

export type ApiErrorStatus = ServerErrorStatus | TransportErrorStatus;

/** Why an `unauthenticated` or `permission-denied` answer ended, or did not end, the session (Appendix A, B7). */
export type AuthFailureReason =
  | 'token_expired'      // access token too old: refresh and retry once
  | 'token_invalid'      // malformed or unknown token
  | 'session_revoked'    // signed out elsewhere, or revoked by staff
  | 'refresh_reused'     // an old refresh token was presented: the whole session family is gone
  | 'account_suspended'  // the account was suspended
  | 'credentials';       // wrong email or password

export interface ApiErrorInit {
  status: ApiErrorStatus;
  code?: ErrorCode | null;
  message: string;
  details?: Record<string, unknown>;
  httpStatus?: number | null;
  requestId?: string | null;
  method?: string;
  path?: string;
  cause?: unknown;
  /** False when `message` is technical (a non-envelope answer) and must not be shown. Default: `httpStatus` is set. */
  fromServer?: boolean;
}

export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: ApiErrorStatus;
  /** The business code of MARKETPLACE §5.9 when there is one. Screens react to this, never to `message`. */
  readonly code: ErrorCode | null;
  /** Written for the user by the server; do not show it for `internal` (use `describeError`). */
  override readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
  /** Null when no HTTP response arrived. */
  readonly httpStatus: number | null;
  /** Value of the `x-request-id` response header, for support tickets and logs. */
  readonly requestId: string | null;
  readonly method: string;
  /** Path below /api/v1, without the query string. */
  readonly path: string;
  /** `message` was written by the server for the user; `describeError` shows only those. */
  readonly fromServer: boolean;

  constructor(init: ApiErrorInit);

  /** No answer, a timeout, or a gateway error (502, 503, 504): the same request may work later. */
  get retryable(): boolean;
  /** `unavailable` or `deadline-exceeded`: the device is offline or the server cannot be reached. */
  get isNetwork(): boolean;
  /** `details.reason` when the server sent one of the auth reasons. */
  get authReason(): AuthFailureReason | null;
}

export function isApiError(value: unknown): value is ApiError;
/** Wraps anything thrown (TypeError from fetch, AbortError, a string) into an ApiError. Never throws. */
export function toApiError(value: unknown): ApiError;
/** The MARKETPLACE §5.9 code of any thrown value, or null. `errorCodeOf(e) === ERROR_CODES.PRICE_CHANGED`. */
export function errorCodeOf(error: unknown): ErrorCode | null;
export function errorStatusOf(error: unknown): ApiErrorStatus | null;
/** True for `unavailable` and `deadline-exceeded`. Keeps a typed OTP on screen, shows "You're offline". */
export function isNetworkError(error: unknown): boolean;

/**
 * The `details` each code carries (MARKETPLACE §5.9, column "Details"): the one definition in
 * `@instasupply/shared` `errors.ts`, which the server builds them from. It holds `PRICE_CHANGED`
 * (`pricing`), `WINDOW_UNAVAILABLE` (`windows: WindowOption[]`, plain numbers that can travel in an
 * error), `OUT_OF_STOCK`, `CARD_DECLINED`, `VERSION_CONFLICT`, `CODE_INCORRECT` and every per-store
 * pricing blocker (`{ storeId }`).
 */
export type ErrorDetailsByCode = SharedErrorDetailsByCode;
/** Typed details when `error` carries `code`, else null: `detailsFor(e, 'OUT_OF_STOCK')?.available`. */
export function detailsFor<C extends keyof ErrorDetailsByCode>(error: unknown, code: C): ErrorDetailsByCode[C] | null;

/**
 * A sentence for the user. Server messages are written for users, so they are shown for
 * invalid-argument, failed-precondition, already-exists, not-found, permission-denied and
 * resource-exhausted. `internal`, transport errors and `unauthenticated` get our own wording.
 */
export function describeError(error: unknown, fallback?: string): string;
```

`describeError` wording for statuses without a usable server message:

| Status | Text |
| --- | --- |
| `unavailable` | "Can't reach the server. Check your connection and try again." |
| `deadline-exceeded` | "This is taking longer than usual. Check your connection and try again." |
| `cancelled` | "The request was interrupted. Please try again." |
| `unauthenticated` (reason `credentials`) | "That email and password combination is incorrect." |
| `unauthenticated` (any other reason) | "Your session has ended. Please sign in again." |
| `permission-denied` (reason `account_suspended`) | "Your account is suspended. Contact InstaSupply support." |
| `permission-denied` (no server message) | "You don't have access to this." |
| `resource-exhausted` (no server message) | "Too many requests right now. Please wait a moment and try again." |
| `not-found` (no server message) | "That isn't available right now. Please try again later." |
| `internal`, anything else | the `fallback`, default "Something went wrong. Please try again." |

When a response is not our envelope (a proxy page, an empty body), the status comes from the HTTP
code: 400 and 422 `invalid-argument`, 401 `unauthenticated`, 403 `permission-denied`, 404
`not-found`, 409 `already-exists`, 412 `failed-precondition`, 429 `resource-exhausted`, 502, 503
and 504 `unavailable`, other 5xx `internal`. With the envelope, `error.status` in the body is the
truth and the HTTP code is only recorded. `code` is read from `error.code`, then from
`error.details.code` (the Firebase-era place).

### 1.4 The client and what is injected (`src/client.ts`, `src/platform.ts`)

```ts
export interface StoredSession {
  v: 1;
  uid: string;
  sessionId: string;
  refreshToken: string;
  /** Epoch ms; informational, the server decides. */
  refreshTokenExpiresAt: number;
}

/** Non-secret persistence: cached profile and config, installation id. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Where secrets live: the stored session (JSON of StoredSession) and the logout queue.
 * Native: Keychain / Keystore. Web: localStorage.
 */
export interface SecretStorage extends KeyValueStorage {
  /** Web only: another tab wrote or removed `key`. */
  onExternalChange?(listener: (key: string, value: string | null) => void): () => void;
}

/** Serializes refreshes across browser tabs. Not needed on native (one runtime). */
export interface RefreshLock {
  run<T>(task: () => Promise<T>): Promise<T>;
}

export type LifecycleEvent = 'foreground' | 'background' | 'online' | 'offline';
export interface Lifecycle {
  /** Native: AppState is 'active'. Web: always true (a hidden console tab must keep alerting). */
  isForeground(): boolean;
  /** False only when the platform is sure there is no network. */
  isOnline(): boolean;
  subscribe(listener: (event: LifecycleEvent) => void): () => void;
}

export interface Clock {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}
export type WebSocketFactory = new (url: string) => WebSocketLike;

export interface ApiClientOptions {
  /** Origin of the API: `https://host[:port]`, no trailing slash, no `/api/v1`. See §8. */
  baseUrl: string;
  /** Sent as `X-Client: <name>/<version> (<platform>)` on every request. */
  app: { name: 'customer' | 'driver' | 'console'; version: string; platform: 'android' | 'ios' | 'web' };
  secretStorage: SecretStorage;
  cacheStorage: KeyValueStorage;
  lifecycle: Lifecycle;
  /** UUIDv4. Web: crypto.randomUUID. Native: expo-crypto randomUUID. */
  randomUUID: () => string;
  refreshLock?: RefreshLock;
  /** Defaults: globalThis.fetch, globalThis.WebSocket, Date.now with the global timers, Math.random. */
  fetch?: typeof fetch;
  WebSocket?: WebSocketFactory;
  clock?: Clock;
  random?: () => number;
  timeouts?: Partial<{ readMs: number; writeMs: number; uploadMs: number }>;   // 15 000, 30 000, 120 000
  /** Development logging: requests, refreshes, socket state. Never receives tokens. */
  onDebug?: (event: { type: string; [key: string]: unknown }) => void;
}

export function createApiClient(options: ApiClientOptions): ApiClient;

export interface ApiClient extends Rest, Resources {
  readonly baseUrl: string;
  readonly session: SessionCore;          // §1.5
  readonly config: ConfigStore;           // §8.1
  readonly live: LiveClient;              // §1.9
  readonly cache: QueryCache;             // §1.10 (named `cache`, because "store" is a supplier in this domain)
  /** The injected clock; the location publisher (§5) throttles with it, so tests drive it with the fake clock. */
  readonly clock: Clock;
  /** Typed command: POST /call/<name>. §1.6 */
  call: Call;
  /** Presigned upload, then confirm. §1.8 */
  upload(input: UploadInput): Promise<UploadedFile>;
  /** A UUIDv4 for checkoutId, requestId, issueId, message ids and upload ids (decision D17). */
  newRequestId(): string;
  /** Stable id of this install (storage key `instasupply.installationId`); created on first use. */
  installationId(): Promise<string>;
  /**
   * The device clock corrected by the last `serverTime` the server sent (`/config`, `/me`).
   * Use it for countdowns to server deadlines (`respondBy`, `offerValidUntil`, `holdUntil`), so a
   * phone or a counter PC with a wrong clock still shows "Accept within 7:42" correctly.
   */
  serverNow(): number;
  /**
   * Restores the session, loads /config, starts the live socket and the lifecycle listeners.
   * Idempotent. Called by ApiProvider. Code that runs without UI (the background location task)
   * does not call it and uses `session.whenRestored()` instead, which opens no socket.
   */
  start(): void;
  /** Stops the socket, timers and listeners. Tests and hot reload. */
  dispose(): void;
}
```

Platform bundles, so an app wires the client in three lines:

```ts
// @instasupply/api-client/web
export function createWebPlatform(options?: { persist?: 'local' | 'session' }): PlatformBindings;
// @instasupply/api-client/native   (Android and iOS; on Expo web it returns createWebPlatform())
export function createNativePlatform(): PlatformBindings;

export interface PlatformBindings {
  secretStorage: SecretStorage;
  cacheStorage: KeyValueStorage;
  lifecycle: Lifecycle;
  randomUUID: () => string;
  refreshLock?: RefreshLock;
}
```

`ApiClient` also carries the resource namespaces of §4.2 (`Resources`): `jobsites`, `cards`,
`favorites`, `reviews`, `notifications`, `devices`, `location`, `chat`, `support`, `products`,
`categories`, `deliveries`, `quotes`, `issues`, `suggestions`, `files`.

| Binding | Web (`createWebPlatform`) | Native (`platform.native.ts`) |
| --- | --- | --- |
| `secretStorage` | `localStorage` (or `sessionStorage` with `persist: 'session'`); `onExternalChange` from the `storage` event | `expo-secure-store` (V2) with the option `keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK`, so the driver's background task can read the session while the phone is locked. The stored session is about 250 bytes, far below the old iOS limit |
| `cacheStorage` | `localStorage` | `@react-native-async-storage/async-storage` |
| `lifecycle` | `online` and `offline` window events, `navigator.onLine`; always foreground | `AppState` (`active` is foreground) and `expo-network` `addNetworkStateListener` (`isConnected === false` is offline) |
| `randomUUID` | `crypto.randomUUID()` | `Crypto.randomUUID()` from `expo-crypto` (V20) |
| `refreshLock` | `navigator.locks.request('instasupply.session.refresh', …)` when `navigator.locks` exists, else none | none |

Storage keys owned by the package. In `secretStorage`: `instasupply.session.v1` (the
`StoredSession`) and `instasupply.logout-queue.v1`. In `cacheStorage`: `instasupply.me.v1`,
`instasupply.config.v1` and `instasupply.installationId` (kept from today). Apps keep their own keys
(`instasupply.onboarded`, `instasupply.cart.v2`, `instasupply.site.v1`, `instasupply.online`,
`instasupply.trackingMode`).

**Request pipeline** (`http.ts`), in order:

1. URL = `baseUrl + '/api/v1' + path` plus the query string (§1.7).
2. Headers: `Accept: application/json`, `Content-Type: application/json` when there is a body,
   `X-Client`, and `Authorization: Bearer <access token>` when signed in and the request is not
   marked `auth: 'none'`.
3. Before sending an authenticated request the token manager makes sure the access token has more
   than 60 s left, refreshing first if not (§1.5).
4. `fetch` with an `AbortController`: `readMs` for GET, `writeMs` for everything else, `uploadMs`
   for uploads. A timeout is `deadline-exceeded`; no response is `unavailable`; the caller's own
   abort is `cancelled`.
5. A 2xx with a body is parsed as JSON and returned as is (no wrapper). 204 returns `undefined`.
6. A failure is parsed into `ApiError` (§1.3).
7. `unauthenticated` with reason `token_expired` or no reason: refresh once, then repeat the request
   once. Any other auth reason, or a second 401, goes to the session core (§2).
8. Automatic retries: **GET only**, at most 2 more attempts after `retryable` errors, after 300 ms
   and 900 ms. Commands and writes are never repeated by the client; the user retries, and the
   client-generated id makes that safe (D17).

### 1.5 Tokens and the session core (`src/auth`)

The auth endpoints the client uses (assumptions B3 to B8 of Appendix A):

| Client function | Request | Answer |
| --- | --- | --- |
| `session.register(input)` | `POST /auth/register` `{ email, password, displayName, installationId, app }` | `AuthSessionResponse` |
| `session.signIn(input)` | `POST /auth/login` `{ email, password, installationId, app }` | `AuthSessionResponse` |
| refresh (internal) | `POST /auth/refresh` `{ refreshToken }` | `AuthSessionResponse` |
| `session.signOut()` | `POST /auth/logout` `{ refreshToken }`; needs no access token | 204 |
| `session.signOut({ everywhere: true })` | `POST /auth/logout-all` | 204 |
| `session.requestPasswordReset(email)` | `POST /auth/password/forgot` `{ email }` | 204, whether or not the account exists |
| `session.resetPassword(input)` | `POST /auth/password/reset` `{ email, code, newPassword }` | 204 |
| `session.changePassword(input)` | `POST /auth/password/change` `{ currentPassword, newPassword }` | 204 |
| `session.inspectInvite(token)` | `POST /auth/invites/inspect` `{ token }` | `InviteInfo` (`{ email, displayName, role, expiresAt }`); `not-found` for an unknown, used or expired link |
| `session.setUpPassword(input)` | `POST /auth/password/setup` `{ token, password, installationId, app }` | `AuthSessionResponse` |
| `session.refreshProfile()` | `GET /me` | `MeResponse` |
| `session.updateProfile(patch)` | `PATCH /me` | `MeResponse` |

`app` is `options.app.name`; `installationId` binds the device session, and later the push device,
to this install.

```ts
import type { AccountType, Role, Store, UserPreferences, UserProfile } from '@instasupply/shared';

export interface AuthTokens {
  accessToken: string;
  /** Lifetime in seconds (900). The client keeps its own deadline on its own clock, so a wrong device clock cannot break refreshing. */
  accessTokenTtlSeconds: number;
  refreshToken: string;
  refreshTokenExpiresAt: number;
  sessionId: string;
}

export interface MeResponse {
  account: { uid: string; email: string; createdAt: number };
  /** Null until `registerCustomer` or `registerDriver` gave the account a role (session status "needs_profile"). */
  profile: UserProfile | null;
  /** Suppliers only: the public document of their store. */
  store: WithId<Store> | null;
  serverTime: number;
}

export interface AuthSessionResponse extends AuthTokens {
  /** If the server leaves it out of the refresh answer, the client calls GET /me itself. */
  me?: MeResponse;
}

/** What screens used from the Firebase `User`: uid (66 uses), email (8), displayName (4). */
export interface SessionUser {
  uid: string;
  email: string;
  /** The profile's name, or the name given at registration while there is no profile yet. */
  displayName: string;
}

export type CoreStatus = 'restoring' | 'signed_out' | 'signed_in';

export type SessionEndReason =
  | 'signed_out'   // the user chose to
  | 'expired'      // the refresh token expired or is unknown
  | 'revoked'      // signed out elsewhere, by staff, or reuse was detected
  | 'suspended'    // the account was suspended
  | 'replaced';    // web: another tab signed in as someone else

export interface SessionSnapshot {
  status: CoreStatus;
  user: SessionUser | null;
  profile: UserProfile | null;
  store: WithId<Store> | null;
  /** True while user and profile come from the device cache and the server has not confirmed them in this run. */
  stale: boolean;
  /** Why the last session ended. Cleared by `acknowledgeEnd()` and by the next sign-in. */
  endReason: SessionEndReason | null;
  /** Tokens exist but the account cannot be loaded and there is no cached copy. Show it with `retry`. */
  problem: ApiError | null;
}

export interface ProfilePatch {
  displayName?: string;
  /** A confirmed `avatar` upload of the caller (§1.8), or null to remove the photo. The server derives `photoURL`. */
  photoPath?: string | null;
  /** Merged into the stored preferences by the server. */
  preferences?: Partial<UserPreferences>;
  /** Customers only. */
  companyName?: string | null;
  accountType?: AccountType | null;
}

export interface SessionCore {
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
  /** Resolves once stored tokens were read (and, with a cached profile, at once). Starts the restore if needed. */
  whenRestored(): Promise<SessionSnapshot>;

  signIn(input: { email: string; password: string }): Promise<SessionSnapshot>;
  /** Creates an account without a role. The apps follow it with `registerCustomer` or `registerDriver`. */
  register(input: { email: string; password: string; displayName: string }): Promise<SessionSnapshot>;
  /** Never rejects: when the server cannot be reached, the sign-out is queued and the device is cleaned anyway. */
  signOut(options?: { everywhere?: boolean }): Promise<void>;

  /** GET /me. Call after registerCustomer, registerDriver, verifyPhoneOtp and updateDriverVehicle. */
  refreshProfile(): Promise<SessionSnapshot>;
  updateProfile(patch: ProfilePatch): Promise<SessionSnapshot>;

  requestPasswordReset(email: string): Promise<void>;
  resetPassword(input: { email: string; code: string; newPassword: string }): Promise<void>;
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>;
  inspectInvite(token: string): Promise<{ email: string; displayName: string; role: Role; expiresAt: number }>;
  setUpPassword(input: { token: string; password: string }): Promise<SessionSnapshot>;

  acknowledgeEnd(): void;
  /** Try again after `problem`. */
  retry(): void;
  /** For code outside React (the background location task): a valid access token, or an ApiError. */
  accessToken(): Promise<string>;
}
```

**Token rules** (`tokens.ts`):

1. The access token lives in memory only. The refresh token lives in `secretStorage` only.
2. **Single flight.** At most one `POST /auth/refresh` is in flight per runtime; every caller that
   needs a token awaits the same promise. Ten requests that meet an expired token cause one refresh
   and are each repeated once.
3. **Rotation.** The answer's `refreshToken` replaces the stored one. The new `StoredSession` is
   written to `secretStorage` and awaited **before** the new access token is handed to any request,
   so a crash can never leave the device holding only a token the server has already retired.
4. **Proactive.** A request refreshes first when the access token has less than 60 s left on the
   local deadline (`issuedAtLocal + accessTokenTtlSeconds × 1000`).
5. **More than one runtime.** Browser tabs share the stored session, and so would a second
   JavaScript runtime on a phone. A refresh therefore always reads `secretStorage` first and uses
   the refresh token it finds there, never one remembered in memory; another runtime may have
   rotated it a moment ago. On the web the refresh also runs inside `refreshLock`, so tabs refresh
   one after the other. Each runtime keeps its own access token. A `storage` event that clears the
   session signs this tab out (`endReason: 'signed_out'`); one that carries a different `uid` ends it
   with `'replaced'` and the console reloads the page.
6. **Outcomes of a refresh:**

| Answer | Effect |
| --- | --- |
| 200 | store the new session, continue |
| `unauthenticated` with reason `token_expired`, `token_invalid`, `session_revoked` or `refresh_reused`; `permission-denied` with reason `account_suspended` | the session ends (§2.4) |
| no answer, timeout, 5xx | the session **stays**. The request that needed the token fails with that error. Nothing is cleared: the device is offline or the server is down |
| `resource-exhausted` | the session stays; no new refresh before `details.retryAfterMs` (default 5 000) |

7. **A refresh is safe to repeat** (assumption B6, PLATFORM.md §6.3.5): the driver app refreshes in a
   background task on a moving phone, where the answer is sometimes lost after the server has rotated
   the token. The client then repeats the refresh with the token it still holds, however much later.
   The server answers that repeat with a working pair as long as the child it issued earlier has never
   been used; it treats a token as stolen only when its child was used. The client must therefore never
   use a refresh token after a newer one is stored (rule 3), and must store every rotation before using it.
8. **Proactive refresh for the socket.** While the live socket is `open` and signed in, the token
   manager runs the single-flight refresh at `deadline − 60 s` of the access token even when no HTTP
   request is pending, and the live client sends `auth` with the new token on the open socket (§1.9).
   A console board or a parked app therefore keeps its socket for hours without a 4401.

**Session core rules** (`session.ts`): the snapshot is kept in memory, mirrored to
`cacheStorage['instasupply.me.v1']` as `{ me: MeResponse, savedAt }` after every successful
`/me`, login, refresh and profile patch, and removed when the session ends. The core subscribes to
the live topic `user:{uid}`: any event on it triggers `refreshProfile()`, which is how an approval,
a vehicle review, a phone verification on another device or a role change reaches the screen without
polling. It also calls `refreshProfile()` on `foreground` when the profile is older than 60 s. §2
describes start-up, expiry, suspension and sign-out.

### 1.6 Commands: `call` (`src/callables.ts`)

```ts
import { CALLABLES } from '@instasupply/shared';

export type CallableName = keyof CallableMap;
export interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** `false` skips the default cache invalidation of the command (below). */
  invalidate?: false;
}
export type Call = <N extends CallableName>(
  name: N, data: CallableMap[N][0], options?: CallOptions,
) => Promise<CallableMap[N][1]>;
```

`call(name, data)` sends `POST /call/${CALLABLES[name]}` with `data` as the JSON body and resolves
with the JSON answer. It rejects with `ApiError`. It never repeats a command on its own. The bearer
is sent when there is one (`auth: 'optional'`): `suggestStore` and `geocodeAddress` work signed
out, and the server answers `unauthenticated` to every other command without a session.
`CallableMap` is an interface with one `[Request, Response]` tuple per name in `CALLABLES`
(`placeOrder: [PlaceOrderRequest, PlaceOrderResponse]`, and so on), with the types of
`@instasupply/shared` `api.ts` (MARKETPLACE §5.3). Two compile-time assertions in `callables.ts`
make a missing or extra name a build error:
`keyof typeof CALLABLES extends CallableName` and `CallableName extends keyof typeof CALLABLES`.

| Name | Request type | Response type | Called by |
| --- | --- | --- | --- |
| `registerCustomer` | `RegisterCustomerRequest` | `RegisterCustomerResponse` | customer app |
| `requestPhoneOtp` | `RequestPhoneOtpRequest` | `RequestPhoneOtpResponse` | customer, driver |
| `verifyPhoneOtp` | `VerifyPhoneOtpRequest` | `VerifyPhoneOtpResponse` | customer, driver |
| `placeOrder` | `PlaceOrderRequest` | `PlaceOrderResponse` | customer |
| `cancelOrder` | `CancelOrderRequest` | `CancelOrderResponse` | customer |
| `submitMaterialList` | `SubmitMaterialListRequest` | `SubmitMaterialListResponse` | customer |
| `acceptQuote` | `AcceptQuoteRequest` | `PlaceOrderResponse` | customer |
| `closeQuote` | `CloseQuoteRequest` | `OkResponse` | customer, staff |
| `reopenQuote` | `ReopenQuoteRequest` | `OkResponse` | customer |
| `reportIssue` | `ReportIssueRequest` | `ReportIssueResponse` | customer |
| `suggestStore` | `SuggestStoreRequest` | `OkResponse` | anyone, also signed out |
| `geocodeAddress` | `GeocodeAddressRequest` | `GeocodeAddressResponse` | anyone, also signed out |
| `sendTestNotification` | `Record<string, never>` | `SendTestNotificationResponse` | any signed-in user |
| `acceptStoreOrder` | `AcceptStoreOrderRequest` | `StoreOrderActionResponse` | supplier, staff |
| `updateStoreOrderStatus` | `UpdateStoreOrderStatusRequest` | `StoreOrderActionResponse` | supplier, staff |
| `rejectStoreOrder` | `RejectStoreOrderRequest` | `StoreOrderActionResponse` | supplier, staff |
| `completePickup` | `CompletePickupRequest` | `CompletePickupResponse` | supplier, staff |
| `updateStoreProfile` | `UpdateStoreProfileRequest` | `OkResponse` | supplier, staff |
| `inviteSupplierUser` | `InviteSupplierUserRequest` | `InviteSupplierUserResponse` | store owner, staff |
| `setSupplierUserStatus` | `SetSupplierUserStatusRequest` | `OkResponse` | store owner, staff |
| `createStore` | `CreateStoreRequest` | `OkResponse` | admin |
| `updateStoreSettings` | `UpdateStoreSettingsRequest` | `OkResponse` | admin |
| `createStaffUser` | `CreateStaffUserRequest` | `CreateStaffUserResponse` | admin |
| `registerDriver` | `RegisterDriverRequest` | `RegisterDriverResponse` | driver app |
| `updateDriverVehicle` | `UpdateDriverVehicleRequest` | `OkResponse` | driver |
| `reviewDriverVehicle` | `ReviewDriverVehicleRequest` | `OkResponse` | admin |
| `setDriverStatus` | `SetDriverStatusRequest` | `OkResponse` | admin |
| `claimJob` | `ClaimJobRequest` | `ClaimJobResponse` = `{ deliveryId: string; status: 'accepted' }` | driver |
| `checkInAtStore` | `CheckInAtStoreRequest` | `OkResponse` | driver |
| `updateDeliveryStatus` | `UpdateDeliveryStatusRequest` | `UpdateDeliveryStatusResponse` | driver, staff |
| `completeDelivery` | `CompleteDeliveryRequest` | `OkResponse` | driver, staff |
| `assignDelivery` | `AssignDeliveryRequest` | `OkResponse` | staff |
| `resolveFailedDelivery` | `ResolveFailedDeliveryRequest` | `OkResponse` | staff |
| `createDeliveries` | `CreateDeliveriesRequest` | `CreateDeliveriesResponse` | staff |
| `optimizeRoute` | `OptimizeRouteRequest` | `OptimizeRouteResponse` | staff, driver (own route) |
| `boostJobPayout` (P1) | `BoostJobPayoutRequest` | `OkResponse` | staff |
| `sendQuote` | `SendQuoteRequest` | `OkResponse` | staff |
| `resolveIssue` | `ResolveIssueRequest` | `ResolveIssueResponse` | staff |
| `runJobNow` | `RunJobNowRequest` | `RunJobNowResponse` = `{ job: ScheduledJobName; now: number; result: Record<string, number> }` | admin, only when `config.allowTestJobs` |

`ClaimJobResponse` and `RunJobNowResponse` are unnamed in MARKETPLACE §5.3; `api.ts` of
`@instasupply/shared` exports them with exactly these shapes (PLATFORM.md §5.2), and `CallableMap` is
derived from its `CallableContracts`. `sendTestNotification` has a `void` request there and is sent
as `{}`.

**Default invalidation.** After a command succeeds, `call` marks the query families it changes as
stale (`CALL_INVALIDATIONS`, prefix match on the first key elements, §1.12), so a screen sees its own
write even when the live socket is down. Screens do not list keys for commands.

| Commands | Invalidated key prefixes | Also |
| --- | --- | --- |
| `registerCustomer`, `registerDriver`, `verifyPhoneOtp`, `updateDriverVehicle` | none | `session.refreshProfile()` |
| `placeOrder`, `acceptQuote` | `['orders']`, `['order']`, `['store-orders']`, `['jobsites']`, `['products']`, `['product']`, `['quotes']`, `['quote']`, `['buy-again']` | `session.refreshProfile()` (first-order status and promo uses changed) |
| `cancelOrder` | `['orders']`, `['order']`, `['store-orders']`, `['store-order']`, `['products']`, `['product']` | `session.refreshProfile()` |
| `acceptStoreOrder`, `updateStoreOrderStatus`, `rejectStoreOrder`, `completePickup` | `['store-order']`, `['store-orders']`, `['order']`, `['orders']`, `['products']`, `['product']`, `['deliveries']`, `['delivery']`, `['job-offers']` | |
| `updateStoreProfile`, `updateStoreSettings`, `createStore` | `['stores']`, `['store']`, `['store-settings']`, `['ops-stores']`, `['products']` | |
| `inviteSupplierUser`, `setSupplierUserStatus`, `createStaffUser`, `setDriverStatus`, `reviewDriverVehicle` | `['users']`, `['user']`, `['deliveries']`, `['job-offers']` | |
| `claimJob`, `checkInAtStore`, `updateDeliveryStatus`, `completeDelivery`, `assignDelivery`, `resolveFailedDelivery`, `createDeliveries`, `boostJobPayout` | `['deliveries']`, `['delivery']`, `['delivery-events']`, `['delivery-stats']`, `['job-offers']`, `['job-offer']`, `['route']`, `['store-orders']`, `['store-order']`, `['orders']`, `['order']`, `['ledger']` | |
| `optimizeRoute` | `['route']` | |
| `submitMaterialList`, `sendQuote`, `closeQuote`, `reopenQuote` | `['quotes']`, `['quote']`, `['support-messages']` | |
| `reportIssue`, `resolveIssue` | `['issues']`, `['issue']`, `['store-order']`, `['store-orders']`, `['order']`, `['orders']`, `['ledger']`, `['payouts']` | |
| `suggestStore` | `['suggestions']` | |
| `runJobNow` | every key (`api.cache.invalidateAll()`) | |
| `geocodeAddress`, `requestPhoneOtp`, `sendTestNotification` | none | |

### 1.7 REST helpers (`src/rest.ts`)

```ts
/** Every document the API returns carries its id, also where the shared type has no `id` field (B10). */
export type WithId<T> = T & { id: string };

export interface Page<T> {
  items: T[];
  /** Pass it back as `cursor` for the next page. Null on the last page. */
  nextCursor: string | null;
}

export type QueryValue = string | number | boolean | readonly (string | number)[] | null | undefined;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 'required' (default): send the bearer and fail with `unauthenticated` when signed out. 'optional': send it when there is one. 'none': never send it. */
  auth?: 'required' | 'optional' | 'none';
  /** GET only: turn `not-found` into `null` instead of throwing. */
  notFoundAsNull?: boolean;
}

export interface Rest {
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  /** GET that returns `{ items, nextCursor }`. `limit` and `cursor` go into the query string. */
  list<T>(path: string, options?: RequestOptions & { limit?: number; cursor?: string | null }): Promise<Page<T>>;
  post<T = void>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  put<T = void>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  patch<T = void>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  delete<T = void>(path: string, options?: RequestOptions): Promise<T>;
}
```

Query-string rules, the same for every list endpoint: `undefined` and `null` are left out; arrays
are joined with commas (`status=new,accepted`); booleans are `true` and `false`; timestamps are
epoch milliseconds (`createdSince=1795123200000`); sorting is `sort=<field>:asc` or `:desc`;
`limit` defaults to 50 on the server and is at most 500. A caller who is not staff only ever gets
their own rows (PLATFORM.md §5.3, scoping rule): the scoping filter (`customerId=<own uid>`,
`driverId=<own uid>`, `storeId=<own store>`) may be sent and must then be the caller's own, else
`permission-denied`; when it is left out the server applies it. The descriptors send it anyway, so a
key names whose rows it holds (B11). Path segments are passed through `encodeURIComponent` by the
resource functions.

Writes that the client may repeat are idempotent by construction: creations are `PUT` to an id the
client generated (`api.newRequestId()`), or carry that id in the body (chat and support messages).

### 1.8 Uploads (`src/uploads.ts`)

Files never pass through a command. The client asks the API for a presigned upload, sends the bytes
straight to storage, then confirms; commands receive only the confirmed `path` (decision P10).

```ts
export type UploadPurpose =
  | 'proof'          // proofs/{deliveryId}/…           image, at most 10 MB, the assigned driver
  | 'quote_upload'   // quoteUploads/{uid}/{requestId}/… image, PDF, CSV, XLS, XLSX, at most 15 MB, at most 5 per list
  | 'issue_photo'    // issuePhotos/{issueId}/…          image, at most 10 MB, at most 6 per issue
  | 'store_photo'    // storePhotos/{storeId}/…          image, at most 5 MB, staff or the store owner
  | 'product_photo'  // productPhotos/{storeId}/…        image, at most 5 MB, staff or a store member
  | 'avatar';        // avatars/{uid}/…                  image, at most 5 MB, the user

export type UploadSource =
  /** Browsers, and Expo web. */
  | { kind: 'blob'; blob: Blob; name: string; contentType: string }
  /** React Native: a file URI from the camera, the image picker or the document picker. */
  | { kind: 'uri'; uri: string; name: string; contentType: string; sizeBytes: number };

export interface UploadInput {
  purpose: UploadPurpose;
  /** deliveryId, requestId, issueId, storeId or uid, by purpose. */
  ownerId: string;
  source: UploadSource;
  signal?: AbortSignal;
}

export interface UploadedFile {
  /** Storage path with the MARKETPLACE §6.4 prefix, e.g. `issuePhotos/6f1c…/a2c4….jpg`. Pass it to the command. */
  path: string;
  name: string;
  contentType: string;
  sizeBytes: number;
}

/** Local checks before any request, so the user gets the limit as a form error. PLATFORM.md §16 row 9
 *  moves the constant to `@instasupply/shared`, where the server reads it too; until shared exports it
 *  the package declares it in `uploads.ts` with the numbers of PLATFORM.md §10.1 (MB = 1 048 576 bytes). */
export const UPLOAD_LIMITS: Record<UploadPurpose, { maxBytes: number; contentTypes: readonly string[];
  perScope: { max: number; perDay: boolean } }>;
export function validateUpload(purpose: UploadPurpose, source: UploadSource): string | null;
```

Steps of `api.upload(input)`:

1. `validateUpload`; a failure rejects with `ApiError('invalid-argument')`.
2. `POST /files/presign` `{ purpose, ownerId, fileName, contentType, sizeBytes }` answers
   `PresignedUpload`:

   ```ts
   interface PresignedUpload {
     uploadId: string;
     path: string;
     /** The server always answers POST (both storage drivers, PLATFORM.md §10.1): a multipart form with every entry of `fields` (for the local driver a `token`), then the file as the last part named `file` (S3 presigned POST, V17). PUT (raw bytes with `headers`) is kept only for forward compatibility. */
     method: 'POST' | 'PUT';
     url: string;
     fields: Record<string, string>;
     headers: Record<string, string>;
     expiresAt: number;
   }
   ```
3. The bytes go to `url` with the global `fetch`, without our `Authorization` header and with the
   `uploadMs` timeout. `POST`: a `FormData` with every entry of `fields` in order, then the file:
   `form.append('file', blob, name)` for a blob, `form.append('file', { uri, name, type: contentType })`
   for a URI (React Native's form-data file part). `PUT`: body is the blob; for a URI it is
   `await (await fetch(uri)).blob()`, which is what the driver app does today. Any 2xx is success.
   No `Content-Type` header is set on the multipart request: the runtime adds it with the boundary.
4. `POST /files/confirm` `{ uploadId }` answers `UploadedFile`. The server checks there that the
   object exists and has the declared size and type, then copies it to the final `path` (the form can
   only write a temporary key, so a confirmed file cannot be replaced afterwards). A `quote_upload` name and size returned here
   are what goes into `QuoteAttachment`.

No progress is reported (files are at most 15 MB; screens show a busy state per file). A failed
step 3 or 4 rejects; the caller retries `api.upload` and gets a new path. Compressing images before
upload stays in the apps (`expo-image-manipulator`, width 1280, JPEG 0.6, as `uploadProofPhoto`
does today).

**Reading files.** Public images arrive as ready URLs on the documents (`Store.photoUrl`,
`Product.imageUrl`). Private files (`proofs/`, `issuePhotos/`, `quoteUploads/`) are read through
`GET /files/url?path=<path>`, which answers `{ url, expiresAt }` with a short-lived URL that needs
no header; `useFileUrl(path)` (§1.11) caches it until one minute before `expiresAt`.

### 1.9 The live client (`src/live`)

One WebSocket per client at `/api/v1/live`: `wss://` when `baseUrl` is `https://`, `ws://` when it
is `http://`. Tokens are never put in the URL.

**Wire protocol** (JSON text frames; assumptions B12 to B15):

| Direction | Frame | Meaning |
| --- | --- | --- |
| client to server | `{ "type": "auth", "token": "<access token>" }` | first frame when signed in; sent again after every token refresh |
| client to server | `{ "type": "subscribe", "id": 7, "topics": ["order:6f1c…", "stores"] }` | at most 100 topics per frame |
| client to server | `{ "type": "unsubscribe", "topics": ["stores"] }` | |
| client to server | `{ "type": "ping" }` | heartbeat |
| server to client | `{ "type": "ready", "uid": "u_123" }` (`uid` null when anonymous) | answer to `auth`; an anonymous connection may subscribe to public topics without it |
| server to client | `{ "type": "subscribed", "id": 7, "topics": ["stores"], "denied": [{ "topic": "order:6f1c…", "reason": "permission-denied" }] }` | |
| server to client | `{ "type": "event", "topic": "order:6f1c…", "kind": "updated", "id": "6f1c…", "at": 1795123200000 }` | an invalidation; `data` is present on payload topics (§4.1) |
| server to client | `{ "type": "pong" }` | |
| server to client | `{ "type": "error", "status": "unauthenticated", "reason": "token_expired" }` | |

Close codes the client understands: `4401` (token expired or invalid: refresh, then reconnect at
once), `4403` (session revoked or account suspended: call `session.refreshProfile()`, which ends the
session through the normal path), `1012` (and `1013`, which the server does not send today) (server restarting, or events may have been missed:
reconnect with backoff; `onResync` refetches), `1008` (a socket limit: too many sockets per address or
user, or too many frames; state `waiting` with a fixed delay of 5 minutes, during which queries poll as
when the socket is down, and `attempt` is not increased). Every other close is treated as a network drop.

```ts
export type LiveState =
  | 'stopped'     // not started, or disposed
  | 'connecting'
  | 'open'        // authenticated (or anonymous) and every subscription sent
  | 'waiting'     // closed; a reconnect is scheduled
  | 'offline'     // the lifecycle says there is no network; no attempts until it returns
  | 'paused';     // native app in the background; closed on purpose

export interface LiveEvent<D = unknown> {
  topic: string;
  kind: string;
  id: string | null;
  at: number;
  /** Only on payload topics: tracking, driver locations, chat and support messages, notifications. */
  data?: D;
}

export interface LiveClient {
  getState(): LiveState;
  onState(listener: (state: LiveState) => void): () => void;
  /** Reference-counted: the topic is subscribed on the socket while at least one listener exists. */
  subscribe(topic: string, listener: (event: LiveEvent) => void): () => void;
  /** The server refused the topic. Queries bound to it fall back to polling. */
  isDenied(topic: string): boolean;
  /** Fires when the set of denied topics changes, so the cache can start or stop polling at once. */
  onDenied(listener: () => void): () => void;
  /** Fires after each successful (re)connection once every topic has been sent again: events may have been missed. */
  onResync(listener: () => void): () => void;
  start(): void;
  stop(): void;
}
```

Behaviour:

| Situation | What the client does |
| --- | --- |
| `start()` | connect. When signed in: await `session.accessToken()`, send `auth`, wait for `ready`. Then send every current topic in `subscribe` frames, mark `open`, fire `onResync` |
| new topic while `open` | one `subscribe` frame, batched per tick |
| last listener of a topic leaves | `unsubscribe` after 2 s, so a quick remount does not flap |
| sign-in, sign-out, account change | close and reconnect with the new identity. The query cache has already dropped the old account's queries |
| token refreshed | send `auth` again on the open socket |
| `open`, signed in, access token at `deadline − 60 s` | the token manager refreshes proactively (§1.5 rule 8) and the socket gets the new `auth`; no reconnect, no resync |
| heartbeat | `ping` every 25 s. When the timer fires again and no frame of any kind has arrived since the previous ping, sent at least 20 s earlier, the socket is dead: close and reconnect. The check is tied to the ping, not to wall-clock silence, so a hidden browser tab whose timers are slowed to one per minute keeps its socket |
| the socket closes or errors | `waiting`, then reconnect after `min(30 000, 500 × 2^attempt) × (0.5 + random() / 2)` ms: about 0.5, 1, 2, 4, 8, 16, 30 s with jitter. `attempt` goes back to 0 after a connection stayed `open` for 10 s |
| lifecycle `offline` | close, state `offline`, no timers |
| lifecycle `online` | reconnect at once, `attempt = 0` |
| lifecycle `background` (native only) | after 20 s still in the background: close, state `paused`. System push covers alerts from here (§6). The driver's location task does not use the socket |
| lifecycle `foreground` (native) | reconnect at once. `onResync` makes every live query refetch |
| web tab hidden | nothing changes. The portal's new-order chime and the console's desktop notifications need the socket in hidden tabs |
| `subscribed.denied` | remember the topic as denied, log through `onDebug`; the queries bound to it poll (§1.10). After a re-`auth` the server sends `subscribed` with `id: 0` and the topics it dropped in `denied` (PLATFORM.md §8.1): handled the same way |

Railway keeps WebSockets open without a time limit, even idle (V16). The heartbeat exists for
phones: carrier NATs drop silent connections, and a half-open socket would otherwise look healthy.

### 1.10 The query cache (`src/query`)

```ts
export type QueryKey = readonly (string | number | boolean | null)[];

export interface QueryContext {
  client: ApiClient;
  /** Aborted when the last observer leaves or a newer fetch replaces this one. */
  signal: AbortSignal;
}

/** Returned by `reduce` to ask for a normal refetch instead. */
export declare const REFETCH: unique symbol;

export interface QueryDescriptor<T> {
  /** First element: the family (plural for lists, singular for one document). Only JSON scalars. */
  key: QueryKey;
  /** `data` before the first answer and while disabled: `[]` for lists, `null` for one document. */
  empty: T;
  fetch(context: QueryContext): Promise<T>;
  /** False: nothing is fetched; the result is `{ data: empty, loading: false, error: null }`. Factories set it when an argument is missing (`queries.order(undefined)`). */
  enabled?: boolean;
  /** 'required' (default): fetched only while signed in and dropped when the account changes. 'none': public data, kept across sign-in and sign-out. */
  auth?: 'required' | 'none';
  /** Live topics. An event on any of them refetches the query, unless `reduce` handles the event. Used by useLiveQuery only. */
  topics?: readonly string[];
  /** For payload topics: fold the event into the cached value. Return REFETCH for events it cannot fold. */
  reduce?(current: T, event: LiveEvent): T | typeof REFETCH;
  /** Refetch interval while the socket is not `open` or a topic was denied. Default 15 000; 0 turns polling off. Used by useLiveQuery only. */
  pollMs?: number;
  /** Age after which a new observer, a `foreground` or a resync refetches. Default 30 000. */
  staleMs?: number;
  /** Shortest gap between two refetches caused by events. Default 250; dashboards use 5 000. */
  minRefetchMs?: number;
  /** How long an entry without observers stays cached. Default 300 000. */
  gcMs?: number;
  /** While a hook switches to another key, keep returning its previous data with `loading: true`. Default true for lists, false for single documents. */
  keepPreviousData?: boolean;
  /** Server time (epoch ms) at which the data expires; while observed the entry refetches one minute before. `fileUrl`, `storeOrderProof`. */
  expiresAt?(data: T): number | null;
}

export interface PagedQueryDescriptor<T>
  extends Omit<QueryDescriptor<T[]>, 'fetch' | 'empty' | 'reduce' | 'keepPreviousData'> {
  fetchPage(context: QueryContext, cursor: string | null): Promise<Page<T>>;
  idOf(item: T): string;
}

export interface QueryResult<T> {
  /** Latest data. While a changed key loads this is the previous result when `keepPreviousData`. */
  data: T;
  /** True from the render in which the key changed until that key has answered once. */
  loading: boolean;
  /** Set when there is nothing usable to show (see the table below). */
  error: ApiError | null;
  /** Fetch again now. Wire it to the "Try again" button of ErrorState. */
  retry: () => void;
  /** A refetch is running while `data` is already shown. */
  refreshing: boolean;
  /** When `data` last came from the server, epoch ms. */
  updatedAt: number | null;
}

export interface QueryCache {
  /** One cache entry, one fetch in flight and one set of topic subscriptions per key, for any number of observers. */
  observe<T>(query: QueryDescriptor<T>, mode: { live: boolean }, onChange: () => void): {
    getResult(): QueryResult<T>;
    unsubscribe(): void;
  };
  getData<T>(key: QueryKey): T | undefined;
  /** Writes server-confirmed data, for example the document a write returned. */
  setData<T>(key: QueryKey, update: T | ((current: T | undefined) => T | undefined)): void;
  /** Marks every entry whose key starts with `prefix` stale; those with observers refetch. Settles when those refetches settled (§1.12 step 3 waits for it). */
  invalidate(prefix: QueryKey): Promise<void>;
  invalidateAll(): Promise<void>;
  /** Optimistic layer over the server data (§1.12). Returns the rollback. */
  patch<T>(key: QueryKey, apply: (current: T) => T): () => void;
  prefetch<T>(query: QueryDescriptor<T>): Promise<T>;
  /** Drops every entry whose `auth` is 'required'. The session core calls it whenever the uid changes. */
  clearPrivate(): void;
}
```

Behaviour of one cache entry:

| Event | Effect |
| --- | --- |
| first observer | fetch if there is no data or it is older than `staleMs`; in live mode subscribe to `topics` |
| more observers of the same key | share the entry; no extra request, no extra subscription (what Firestore did for identical listeners). The entry is in live mode while at least one of its observers came from `useLiveQuery` |
| live event on a topic | `reduce` if present and it does not return `REFETCH`; otherwise refetch, at most once per `minRefetchMs` |
| event or `invalidate` during a fetch | one trailing refetch when the current one ends, so the cache never settles on a state older than the event |
| socket not `open`, or one of the topics denied (live mode) | refetch every `pollMs` |
| socket `open` | polling stops; `onResync` refetches every observed live entry once |
| lifecycle `background` (native) or `offline` | polling pauses |
| lifecycle `foreground` or `online` | observed entries older than `staleMs` refetch |
| last observer leaves | unsubscribe topics (after the 2 s grace of §1.9), abort the fetch, drop the entry after `gcMs` |
| the uid changes | `clearPrivate()` |

What a hook returns:

| State of the key | `data` | `loading` | `error` |
| --- | --- | --- | --- |
| disabled, or `auth: 'required'` while signed out | `empty` | false | null |
| `auth: 'required'` while the session is still `restoring` | `empty` | true | null. The fetch starts when the session is known |
| first fetch running | `empty` (or the previous key's data) | true | null |
| answered | the data | false | null |
| first fetch failed | `empty` | false | the error. Retryable errors are retried after 2, 5, 15, then every 30 s while observed; `retry()` forces one now |
| refetch failed with a retryable error, data present | the data, unchanged | false | null. The next poll, event or resync tries again |
| refetch failed with `permission-denied` or `not-found`, data present | `empty` | false | the error. Access was lost or the document is gone: stop showing it |

This keeps the contract of today's hooks (`packages/expo-firebase/src/firestore-hooks.ts`):
`loading` is true from the render in which the query changes, old data stays on screen meanwhile,
and `retry` is always there. One difference is an improvement: a Firestore listener that failed
stopped for good; a failed fetch here is retried.

### 1.11 React bindings (`@instasupply/api-client/react`)

```ts
import type { ReactElement, ReactNode } from 'react';

/** Calls `client.start()` once. Place it above the app's own session provider. */
export function ApiProvider(props: { client: ApiClient; children: ReactNode }): ReactElement;
export function useApi(): ApiClient;

/** The session snapshot; re-renders when it changes (useSyncExternalStore). */
export function useSessionCore(): SessionSnapshot;
/** Null until /config was loaded once on this device (it is cached, so that is the very first start only). */
export function useConfig(): PublicConfig | null;
export function useLiveStatus(): { state: LiveState; online: boolean };

/** Fetch and cache. Refetches when stale on mount and foreground, and when invalidated. Ignores `topics` and `pollMs`. */
export function useApiQuery<T>(query: QueryDescriptor<T>, options?: { enabled?: boolean }): QueryResult<T>;
/** The same, plus the query's live topics and the polling fallback. Use it wherever Firestore `onSnapshot` was used. */
export function useLiveQuery<T>(query: QueryDescriptor<T>, options?: { enabled?: boolean }): QueryResult<T>;

export interface PagedResult<T> {
  items: T[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  error: ApiError | null;
  retry: () => void;
  refreshing: boolean;
}
/** Cursor pagination. `live` (default true) subscribes to the descriptor's topics. */
export function usePagedQuery<T>(
  query: PagedQueryDescriptor<T>, options?: { enabled?: boolean; live?: boolean },
): PagedResult<T>;

export interface OptimisticCache {
  patch<T>(key: QueryKey, apply: (current: T) => T): void;
}
export interface MutationOptions<V, R> {
  /** Runs before the request. Every patch is undone automatically when the request fails. */
  optimistic?(cache: OptimisticCache, variables: V): void;
  /** Key prefixes to invalidate after success, in addition to what the command or resource function already invalidates. */
  invalidate?(variables: V, result: R): readonly QueryKey[];
  onSuccess?(result: R, variables: V): void;
  onError?(error: ApiError, variables: V): void;
}
export interface Mutation<V, R> {
  /** Rejects with ApiError, so `try / catch` plus `describeError` keeps working. A second call while busy returns the first promise (double taps do nothing). */
  run(variables: V): Promise<R>;
  busy: boolean;
  error: ApiError | null;
  reset(): void;
}
export function useApiMutation<V = void, R = void>(
  mutate: (api: ApiClient, variables: V) => Promise<R>, options?: MutationOptions<V, R>,
): Mutation<V, R>;

/** A short-lived URL for a private file (§1.8). Null path: nothing is loaded. */
export function useFileUrl(path: string | null | undefined): {
  url: string | null; loading: boolean; error: ApiError | null; retry: () => void;
};
```

Usage, one line per data need:

```tsx
const order = useLiveQuery(queries.order(orderId));                       // { data: Order | null, loading, error, retry }
const stores = useLiveQuery(queries.stores());                            // { data: WithId<Store>[], … }
const history = usePagedQuery(queries.customerOrders(uid, 'past', {}));   // { items, hasMore, loadMore, … }
const accept = useApiMutation((api, input: AcceptStoreOrderRequest) => api.call('acceptStoreOrder', input));
```

**Paged lists.** `usePagedQuery` keeps the loaded pages as one array. `loadMore` fetches the page
after the stored cursor. On an event, an invalidation, a poll or a resync only the **first page** is
refetched and merged by this rule: if the id of the fresh first page's last item is found in the
loaded array, everything loaded after that item is kept behind the fresh page (items are de-duplicated
by `idOf`, the fresh copy wins); if it is not found, the list is reset to the fresh first page and
its cursor. Boards that must be complete and current (the portal board, open deliveries, the job
board) are single-page `useLiveQuery` lists with a server limit of 200 or 500, not paged lists.

### 1.12 Optimistic updates and cache invalidation

**Invalidation** has three sources, and they are allowed to overlap because refetches of one key
are coalesced (§1.10):

1. the live socket: events on a query's topics;
2. commands: `CALL_INVALIDATIONS` (§1.6);
3. REST writes: every resource function of §4.2 invalidates the families listed in its row.

A key is matched by prefix: `invalidate(['orders'])` hits `['orders', 'customer', uid, 'active', null]`
and every other list of orders; `invalidate(['order', orderId])` hits one document. Families are
named in the plural for lists and in the singular for one document, so a prefix never hits both by
accident.

**Optimistic updates.** Each cache entry holds the server data and a list of pending patches;
observers see `patches.reduce((value, patch) => patch(value), serverData)`.

1. `optimistic(cache, variables)` runs synchronously inside `run`; each `cache.patch(key, apply)`
   adds a patch and observers re-render at once.
2. The request fails: the patches of this mutation are removed (rollback), `error` is set, `run`
   rejects. Nothing else changes.
3. The request succeeds: the affected keys are invalidated and refetched. The patches stay in place
   until those refetches settle (success or failure) and are then removed, so the value never flashes
   back to the old one between the write and the refetch.
4. Refetched server data never overwrites a patch: patches are applied on top of whatever the server
   returned.

Where the clients use it, and nowhere else: favourite hearts, "mark read" and "mark all read",
sending a chat or support message (the message is appended with its client id; the confirmed list
replaces it by id), the portal's on-hand nudges and active toggle, the store "Pause new orders"
toggle, jobsite and card default switches. Commands that move money, stock or a status machine are
**never** optimistic: the screen shows a busy state and then the server's answer.

Example (favourite toggle in `FavoritesProvider`):

```ts
const toggle = useApiMutation(
  (api, v: { productId: string; saved: boolean }) =>
    v.saved ? api.favorites.remove(v.productId) : api.favorites.add(v.productId),
  {
    optimistic: (cache, v) =>
      cache.patch<WithId<Favorite>[]>(queries.favorites(uid).key, (list) =>
        v.saved
          ? list.filter((item) => item.productId !== v.productId)
          : [{ id: v.productId, productId: v.productId, createdAt: Date.now() }, ...list]),
  },
);
```

### 1.13 Tests without a network (`@instasupply/api-client/testing`)

Everything that touches the outside is injected (`fetch`, `WebSocket`, `clock`, `random`, the two
storages, `lifecycle`), so the whole package runs under `node:test` through `tsx`, like
`packages/shared`: `npm --workspace @instasupply/api-client run test`. No server, no port, no real
timer.

```ts
export interface FakeClock extends Clock {
  /** Runs every timer due within `ms`, in order, awaiting microtasks between them. */
  advance(ms: number): Promise<void>;
}
export function createFakeClock(startAt?: number): FakeClock;
/** Works for `cacheStorage` and `secretStorage`. Two clients given the same instance behave like two browser tabs: `onExternalChange` fires in the other one. */
export function createMemoryStorage(initial?: Record<string, string>): SecretStorage & { dump(): Record<string, string> };
export function createFakeLifecycle(): Lifecycle & { emit(event: LifecycleEvent): void };

export interface FakeRequest {
  method: string; path: string; query: URLSearchParams; headers: Headers; body: unknown;
  /** The caller the bearer identified, or null (the fake answers a bad bearer itself, as §6.4 does). */
  uid: string | null;
}
export type FakeAnswer = { status?: number; body?: unknown; headers?: Record<string, string> } | ApiErrorInit;

export interface FakeServer {
  /** Pass both to createApiClient. */
  fetch: typeof fetch;
  WebSocket: WebSocketFactory;
  /** Route handler; `path` may contain `:params`. Later registrations win. A path starting with `http` matches a full URL (a storage form). */
  on(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string,
     handler: (request: FakeRequest, params: Record<string, string>) => FakeAnswer | Promise<FakeAnswer>): void;
  /** Implements /auth/* and /me for one account with rotation and reuse detection. */
  addAccount(input: { email: string; password: string; profile: UserProfile | null }): { uid: string };
  expireAccessTokens(): void;
  revokeSessions(uid: string, reason: AuthFailureReason): void;
  /** The next `count` requests fail before any handler runs. */
  failNext(count: number, how: 'network' | 'timeout' | 502 | 503): void;
  /** Loses the answers of the next `count` requests after their handlers ran (the lost-refresh case of §1.5 rule 7). */
  dropAnswers(count: number): void;
  /** Sends an event frame to every socket subscribed to its topic. */
  emit(event: LiveEvent): void;
  closeSockets(code?: number): void;
  refuseSockets(refuse: boolean): void;
  denyTopic(topic: string): void;
  /** While true, sockets accept frames and answer nothing: a half-open connection (heartbeat test). */
  stallSockets(stall: boolean): void;
  readonly requests: FakeRequest[];
  /** Every frame a client sent, with the number of its socket. */
  readonly frames: { socket: number; frame: ClientFrame }[];
  subscribedTopics(): string[];
  openSockets(): number;
  /** Sockets ever constructed (a reconnect makes a new one). */
  socketCount(): number;
  /** Access-token lifetime the fake issues, seconds (900). */
  accessTokenTtlSeconds: number;
}
export function createFakeServer(options?: { clock?: FakeClock }): FakeServer;

/** A client wired to a fake server, a fake clock, memory storages and a fake lifecycle. */
/** `server` and `clock` may be passed to run two clients (two tabs, an app restart) against one server. */
export function createTestClient(overrides?: Partial<ApiClientOptions> & { server?: FakeServer; clock?: FakeClock }): {
  client: ApiClient; server: FakeServer; clock: FakeClock;
  lifecycle: ReturnType<typeof createFakeLifecycle>;
  secrets: ReturnType<typeof createMemoryStorage>; cache: ReturnType<typeof createMemoryStorage>;
};
```

Hooks are tested with `@testing-library/react` (`renderHook`, `act`) on `happy-dom`
(`GlobalRegistrator.register()` from `@happy-dom/global-registrator` at the top of each
`*.test.tsx`), still under `node:test`. The apps
and the console use the same kit for their own hook tests: wrap in `<ApiProvider client={client}>`.

The package is done when these cases pass (one test file each):

| File | Cases |
| --- | --- |
| `errors.test.ts` | envelope parsing; `code` from `error.code` and from `details.code`; HTTP mapping without an envelope; `describeError` table; `detailsFor` |
| `tokens.test.ts` | ten parallel 401s cause one refresh and ten retries; the new session is stored before the access token is used; proactive refresh under 60 s; refresh network failure keeps the session; each ending reason ends it; lost refresh answer then repeat (`dropAnswers`) keeps the session |
| `session.test.ts` | start with a cached profile is `signed_in` and `stale` at once, then confirmed; start with tokens and no cache while offline gives `problem`, then recovers; sign-out offline queues the logout and clears the device; queued logout is sent at the next start; `user:{uid}` event refreshes the profile; uid change clears private queries |
| `tabs.test.ts` | two clients on one storage refresh one after the other (lock); external clear signs out; external uid change gives `replaced` |
| `call.test.ts` | path and body; default invalidations; `invalidate: false`; no automatic retry of a command |
| `rest.test.ts` | query-string rules; `notFoundAsNull`; GET retries twice on 503 and never on 400; writes are not retried |
| `uploads.test.ts` | POST with fields in order and the file last, for the S3 form and for the local driver's form (a `token` field, `POST /files/local/{uploadId}`); PUT with headers (forward compatibility only); local validation against `UPLOAD_LIMITS`; confirm; failure at each step |
| `live.test.ts` | auth then subscribe; anonymous subscribe; resubscribe and resync after a drop; backoff sequence with a fixed `random`; heartbeat timeout; 4401 refreshes then reconnects; the socket survives two access-token lifetimes without a 4401 (proactive refresh and `auth`); 1008 waits 5 minutes and polls; offline and online; background pause after 20 s and resume; denied topic |
| `query-cache.test.ts` | one fetch for N observers; `keepPreviousData`; event refetch with `minRefetchMs`; trailing refetch; `reduce` and `REFETCH`; polling on only while the socket is down or a topic is denied; error rows of the result table; garbage collection |
| `optimistic.test.ts` | patch, rollback on failure, patch kept until the refetch settles, two overlapping patches |
| `paged.test.ts` | load more; first-page merge when the anchor is found; reset when it is not |
| `location-publisher.test.ts` | §5.6 |
| `hooks.test.tsx` | `useLiveQuery` result sequence across a key change; `useApiMutation` busy and double call; `useSessionCore` re-render; `useFileUrl` refresh before expiry |

---

## 2. Session behaviour per client

The Firebase split between "auth user", "ID-token claims" and "profile document" is gone. There is
one source: `MeResponse`, held by the session core. Role, account status, store membership, city
and capacity class are read from the database on every request (decision P5), so there is nothing
like a stale claim to wait for, and the "awaiting claim" states of today's providers disappear.
Each client keeps its own provider and status names; the provider is now a pure function of the
core snapshot, the public config and one or two local flags.

### 2.1 Start-up from stored tokens

| Stored on the device | Network | What the user sees | What happens |
| --- | --- | --- | --- |
| no session | any | customer: the shop as a guest (or the intro on first run); driver and console: sign-in | `status: 'signed_out'` at once; no request needs a token |
| session and cached profile | online | the app, immediately | `signed_in`, `stale: true`; in the background one `POST /auth/refresh` (its `me` updates the snapshot, `stale: false`) |
| session and cached profile | offline | the app, immediately, with cached data where the screen has any, and each list's error state with "Try again" where it has none | `signed_in`, `stale: true`; the refresh fails with `unavailable`; it is tried again on `online`, on `foreground`, and before the next request |
| session, no cached profile (storage partly cleared) | online | splash for one round trip | `restoring` until the refresh answers |
| session, no cached profile | offline | splash with "Can't reach the server" and "Try again" (plus a sign-out link) | `restoring` with `problem`; retried every 5 s and on `online` |
| session the server no longer accepts | online | sign-in, with the reason | the refresh answers `unauthenticated`: the session ends (§2.4) |

This is what the apps do today with Firebase (a cached session opens the app; "offline with an
expired token: keep the session and try again shortly"), without the 5-second token retry loop in
each provider: the core owns it.

### 2.2 Customer app (`app/customer/src/features/session/SessionProvider.tsx`)

```ts
export type SessionStatus =
  'loading' | 'onboarding' | 'guest' | 'needs_profile' | 'needs_phone' | 'wrong_account' | 'ready';
```

| Order | Condition | Status |
| --- | --- | --- |
| 1 | core `restoring`, or the "intro seen" flag (`instasupply.onboarded`) not read yet, or `useConfig()` is null | `loading` |
| 2 | no user | `onboarding` when the intro was not seen, else `guest` |
| 3 | `profile === null` | `loading` while `signingUp` (sign-up is between `register` and `registerCustomer`), else `needs_profile` |
| 4 | `profile.role !== 'customer'` | `wrong_account` |
| 5 | `config.phoneVerification === 'required'` and `!profile.phoneVerified` | `needs_phone` |
| 6 | otherwise | `ready` |

`Session` keeps its shape: `{ status, user, profile, signingUp, problem, retry, finishOnboarding }`.
`user` is the core's `SessionUser`; `claims` is removed. `problem` is the `describeError` text of
`core.problem`, or of `api.config.error()` while no config was ever loaded (a first start without
a network), else null; `retry` calls `core.retry()` and `api.config.load()`. The root layout already
shows `problem` with "Try again" and a sign-out link. `useCustomer()` is unchanged for screens.

Route guards (`src/app/_layout.tsx`), as MARKETPLACE §7.2 specifies:

| Group | Guard |
| --- | --- |
| `(intro)` | `onboarding` |
| `(auth)` | `guest` |
| `(setup)` | `needs_profile`, `needs_phone`, `wrong_account` |
| `(shop)` | `guest` or `ready`; screens marked 🔒 render `<RequireAccount>` for guests |

The "last settled status" ref that keeps the navigator mounted while `loading` stays as it is.

Flows (`features/session/auth-service.ts`):

| Function | Does |
| --- | --- |
| `signIn(email, password)` | `api.session.signIn` |
| `createAccount(input)` | sets `signingUp`; `api.session.register({ email, password, displayName })`; `api.call('registerCustomer', { displayName, companyName, accountType, marketingOptIn })`; `api.session.refreshProfile()`; clears `signingUp`. A failure after `register` leaves the account without a profile: the status becomes `needs_profile` and `/complete-profile` shows the stored failure, as today |
| `completeProfile(input)` | `api.call('registerCustomer', input)`, then `refreshProfile()` |
| `requestPhoneCode(phoneNumber)` | `api.call('requestPhoneOtp', { phoneNumber })` |
| `verifyPhoneCode(code)` | `api.call('verifyPhoneOtp', { code })`, then `refreshProfile()` |
| `requestPasswordReset(email)`, `resetPassword(input)` | the core functions. The forgot-password screen gains a second step: the 6-digit code from the email and the new password |
| `signOut()` | §2.5 |

With `phoneVerification: 'optional'` the app never forces `needs_phone`; the account screen offers
"Verify your phone", and a `PHONE_UNVERIFIED` error from a command routes to `/verify-phone`. With
`'off'` the phone screens are unreachable. **When `config.environment === 'production'` and
`config.smsDriver === 'outbox'`** no code can be delivered (`requestPhoneOtp` answers
`failed-precondition`), so the phone screens behave exactly as with `'off'` (PLATFORM.md §11.2). The
driver onboarding (§2.3) applies the same rule. Phone codes go to Canadian numbers only; an
`invalid-argument` from `requestPhoneOtp` is shown on the number field.

### 2.3 Driver app (`app/driver/src/features/auth/SessionProvider.tsx`)

```ts
export type SessionStatus =
  | 'loading' | 'signed_out' | 'staff_account' | 'shopper_account' | 'supplier_account'
  | 'needs_profile' | 'needs_phone' | 'pending_approval' | 'suspended' | 'ready';
```

| Order | Condition | Status |
| --- | --- | --- |
| 1 | core `restoring`, or `useConfig()` is null | `loading` |
| 2 | no user and `endReason === 'suspended'` | `suspended` |
| 3 | no user | `signed_out` |
| 4 | `profile === null` | `needs_profile` |
| 5 | role `admin` or `dispatcher` | `staff_account` |
| 6 | role `customer` | `shopper_account` |
| 7 | role `supplier` | `supplier_account` (new; same screen as the two above) |
| 8 | `profile.status === 'suspended'` | `suspended` |
| 9 | `config.phoneVerification === 'required'` and `!profile.phoneVerified` | `needs_phone` |
| 10 | `profile.status === 'pending'` | `pending_approval` |
| 11 | otherwise | `ready` |

`Session` is `{ status, user, profile, problem, retry }`. `problem` and `retry` are new here and
mean what they mean in the customer app (§2.2); the root layout shows them over the splash, with a
sign-out link, instead of an endless spinner. `claims` and `refreshClaims` are removed: when ops
approve the driver, the `user:{uid}` event makes the core fetch `/me` and the status moves from
`pending_approval` to `ready` by itself. `homeHref` sends `supplier_account` to
`/onboarding/account` with the other wrong-role statuses. On `/onboarding/account` the "Back to
sign in" button of the suspended state calls `api.session.acknowledgeEnd()`.

Route guards (`src/app/_layout.tsx`), unchanged apart from the new status:

| Group | Guard |
| --- | --- |
| `(auth)` | `signed_out` |
| `onboarding` | `needs_profile`, `needs_phone`, `pending_approval`, `suspended`, `staff_account`, `shopper_account`, `supplier_account` |
| `(app)` | `ready` |

`createAccount(name, email, password)` is `api.session.register`; `completeProfile(request)` is
`api.call('registerDriver', request)` then `refreshProfile()`. The onboarding steps and their order
do not change.

### 2.4 Expiry, revocation and suspension (all clients)

| Trigger | Core result | Customer app | Driver app | Console |
| --- | --- | --- | --- | --- |
| access token expired | refresh, repeat the request once | nothing visible | nothing visible | nothing visible |
| refresh token expired or unknown (`token_expired`, `token_invalid`) | `signed_out`, `endReason: 'expired'` | `guest`; toast "Your session has ended. Please sign in again." | sign-in with that message | sign-in with that message (today's `REJECTIONS.ended`) |
| `session_revoked` or `refresh_reused` | `signed_out`, `endReason: 'revoked'` | as above | as above | as above |
| `account_suspended`, from a refresh, from `/me`, or as `permission-denied` on any request (the server answers it before `session_revoked`, PLATFORM.md §6.4) | `signed_out`, `endReason: 'suspended'` | `guest`; notice "Your account is suspended. Contact InstaSupply support." | status `suspended`: the explanation screen | sign-in with "Your account is not active. Ask an administrator to restore access." |
| `/me` shows `profile.status === 'suspended'` while the session still works (if the server keeps such sessions, B8) | snapshot updated | treated as above by calling `signOut()` | status `suspended` | signed out with the same message |
| live socket closed with `4403` | `refreshProfile()`, which leads to one of the rows above | | | |
| `signIn` rejected with `permission-denied`, reason `account_suspended` | stays `signed_out`, sets `endReason: 'suspended'` | the suspension notice above | status `suspended`: the explanation screen | "Your account is not active. Ask an administrator to restore access." |
| `signIn` rejected with `resource-exhausted` (`RATE_LIMITED`) | stays `signed_out` | "Too many attempts. Try again in N minutes." from `details.retryAfterMs` | same | same |

When a session ends for any reason the core, in this order: stops the token manager; removes
`instasupply.session.v1` and `instasupply.me.v1`; calls `cache.clearPrivate()`; restarts the live socket as
anonymous; notifies subscribers. It cannot tell the server (the token is dead), and it does not need
to: the server removed the device session, and with it the push device, when it ended the session
(B9).

### 2.5 Sign-out and its clean-up

| Step | Customer app (`features/account/useSignOut.ts`) | Driver app (`features/profile/useSignOut.ts`) | Console (`AuthProvider.signOut`) |
| --- | --- | --- | --- |
| 1 | confirm ("Your cart on this device will be emptied…") | go offline: `setOnline(false)`, which posts `online: false` and stops the background location task (§5). A failure is ignored and sign-out continues: the server sets the driver offline when the session ends (PLATFORM.md §6.3.6) | |
| 2 | `api.session.signOut()` | `api.session.signOut()` | `api.session.signOut()` |
| 3 | `cart.clear()` | remove `instasupply.online` and `instasupply.trackingMode` | navigate to `/login` |

`api.session.signOut()` does this and never rejects:

1. `POST /auth/logout { refreshToken }` with a 3 s timeout. The server deletes the device session
   **and the push device registered under this installation** (B9), so the phone stops receiving
   this account's pushes.
2. If that request failed for a network reason, the refresh token is appended to
   `instasupply.logout-queue.v1` (secure storage, at most 5 entries) and sent again at the next
   start and at the next `online`. Until then a push for the old account can still arrive; the tap
   guard of §6.4 keeps it from opening anything.
3. The local clean-up of §2.4, with `endReason: 'signed_out'`.

`unregisterDevice()` as a separate call before sign-out, and the 3-second `settleWithin` helper
around it, are removed from both apps: step 1 covers it.

### 2.6 Switching accounts

| Case | Behaviour |
| --- | --- |
| guest signs in (customer app) | the cart and the chosen site stay (D18: the cart lives on the device for everyone) |
| A signs out, B signs in on the same phone | A's private queries, topics and cached profile were dropped at sign-out. B's login registers the same Expo push token under B, and the server removes it from every other account (B9), which is what `onDeviceWritten` did |
| a push for A arrives while B is signed in | the tap handler compares `data.userId` with the current uid and ignores the tap (§6.4) |
| console: a second tab signs in as someone else | the first tab's core ends with `endReason: 'replaced'` and the provider reloads the page |
| the role is wrong for the client | customer app: `wrong_account`; driver app: `staff_account`, `shopper_account` or `supplier_account`; console: immediate sign-out with a rejection message (§2.7). The account itself is not changed |

### 2.7 Console (`frontend/src/features/auth/AuthProvider.tsx`)

```ts
export type AuthStatus = 'loading' | 'signed_out' | 'signed_in';
export interface AuthState {
  status: AuthStatus;
  user: SessionUser | null;
  role: 'admin' | 'dispatcher' | 'supplier' | null;
  profile: UserProfile | null;
  /** Suppliers: from `profile.storeId`, `profile.storeRole` and the core's `store`. */
  storeId: string | null;
  storeRole: StoreRole | null;
  store: WithId<Store> | null;
  rejection: string | null;
}
```

| Order | Condition | Result |
| --- | --- | --- |
| 1 | core `restoring` | `loading` |
| 2 | no user | `signed_out`; `rejection` from `endReason` (`expired` and `revoked`: "Your session has ended. Please sign in again."; `suspended`: "Your account is not active. Ask an administrator to restore access.") |
| 3 | `profile` null, or role `driver` or `customer`, or `status !== 'active'`, or a supplier without `storeId` | `api.session.signOut()`, then `signed_out` with the rejection: driver "This is a driver account. Drivers use the InstaSupply Driver app."; customer "This is a customer account. Order in the InstaSupply app."; otherwise "This account doesn't have access to the console." |
| 4 | role `admin` or `dispatcher` | `signed_in` |
| 5 | role `supplier` | `signed_in`; guards send it to `/portal` |

Guards: `RequireStaff` (roles admin and dispatcher; suppliers are redirected to `/portal`),
`RequireAdmin`, `RequireSupplier` (staff are redirected to `/`), unchanged in shape. New public
routes next to `/login`: `/set-password` (reads the token from the fragment, `location.hash` =
`#token=isp_…`, which the browser never sends to a server; removes it from the address bar with
`history.replaceState`; shows whose account it is through `api.session.inspectInvite(token)`, i.e.
`POST /auth/invites/inspect`; asks for a password, calls `api.session.setUpPassword`; this is where the
`passwordSetupLink` of `createStaffUser` and `inviteSupplierUser` points) and `/reset-password`
(email, code, new password). `/track/:token` stays public and signed out.

---

## 3. Migration: every file that touches Firebase

Counted with
`grep -rlE "from ['\"](firebase(/[a-z-]+)?|@instasupply/expo-firebase)['\"]"` on 2026-11-19:
**43** files in `app/customer/src`, **15** in `app/driver/src`, **19** in `frontend/src` (77), plus
the 5 source files of `packages/expo-firebase` itself. The tables list all of them. "Fate" says
whether the file is ported, or disappears anyway under MARKETPLACE §12.4 to §12.6 (do not port
those; port their marketplace replacement instead). In the "Fate" and "Note" columns, "§12.x" means
that section of MARKETPLACE.md.

One change runs through every ported file: time values are numbers now (`TimestampLike` is
`number`, decision P3). `toMillis(value)` from `@instasupply/shared` keeps working on them, so
display code stays as it is. Every place that built a Firestore `Timestamp` or sent
`serverTimestamp()` is in the tables below and now sends epoch milliseconds or nothing at all (the
server stamps `createdAt` and `updatedAt`).

Order of work, so that every step compiles:

1. Build `packages/api-client` with its tests (§1.13). No client changes yet.
2. In each client add `src/lib/api.ts` and the new `src/lib/env.ts`, mount `<ApiProvider>`, and
   replace the session provider (§2). The app now signs in against the API.
3. Replace the data hooks feature by feature (§4), then notifications (§6), location (§5), maps (§7).
4. Remove `firebase` from the three `package.json` files, delete `packages/expo-firebase`, delete
   the `lib/firebase*` files, replace the `.env*` files (§8).
5. Done when `grep -rlE "from ['\"](firebase|@instasupply/expo-firebase)" app frontend packages --include='*.ts' --include='*.tsx'`
   prints nothing, no client `package.json` lists `firebase`, and lint, typecheck, the package
   tests and the three bundles pass.

### 3.1 The wiring every client gets

```ts
// app/customer/src/lib/api.ts   (app/driver/src/lib/api.ts differs only in `name`)
import { createApiClient } from '@instasupply/api-client';
import { createNativePlatform } from '@instasupply/api-client/native';
import { Platform } from 'react-native';

import { appVersion, env } from './env';

const holder = globalThis as { __instasupplyApi?: ReturnType<typeof createApiClient> };

/** One client per JavaScript runtime. The holder keeps it across fast refresh in development. */
export const api = (holder.__instasupplyApi ??= createApiClient({
  baseUrl: env.apiUrl,
  app: { name: 'customer', version: appVersion, platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'web' ? 'web' : 'android' },
  ...createNativePlatform(),
}));

export const call = api.call;
export { queries, topics, describeError, errorCodeOf, detailsFor, isNetworkError, ApiError } from '@instasupply/api-client';
```

```ts
// frontend/src/lib/api.ts
import { createApiClient, describeError } from '@instasupply/api-client';
import { createWebPlatform } from '@instasupply/api-client/web';

import { env } from './env';

export const api = createApiClient({
  baseUrl: env.apiUrl,
  app: { name: 'console', version: __APP_VERSION__, platform: 'web' },
  ...createWebPlatform(),
});
export const call = api.call;
/** The name the console's screens already import. */
export const errorMessage = describeError;
export { queries, topics } from '@instasupply/api-client';
```

`__APP_VERSION__` is defined in `vite.config.ts` (`define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version) }`)
and declared in `vite-env.d.ts`. Root components: the Expo apps wrap their existing providers in
`<ApiProvider client={api}>` in `src/app/_layout.tsx`; the console does it in `src/main.tsx`
around `<ToastProvider>`.

### 3.2 `app/customer` (43 files)

**Group A: 27 files whose only tie is `describeError`.** Change the import to
`import { describeError } from '@instasupply/api-client';`. Nothing else changes unless noted.

| File | Note | Fate |
| --- | --- | --- |
| `src/app/(auth)/forgot-password.tsx` | gains step 2 (code and new password): `requestPasswordReset`, then `resetPassword` | port |
| `src/app/(auth)/login.tsx` | | port |
| `src/app/(auth)/signup.tsx` | | port (G adds company, account type, opt-in) |
| `src/app/(setup)/complete-profile.tsx` | | port |
| `src/app/(setup)/verify-phone.tsx` | | port |
| `src/app/(setup)/wrong-account.tsx` | reads `claims.role`: use `profile.role` | port |
| `src/app/(shop)/about.tsx` | | port |
| `src/app/(shop)/addresses/index.tsx` | | deleted (§12.4; `jobsites/index.tsx` replaces it) |
| `src/app/(shop)/cards/add.tsx` | | port |
| `src/app/(shop)/cards/index.tsx` | | port |
| `src/app/(shop)/checkout/address.tsx` | | deleted (§12.4) |
| `src/app/(shop)/checkout/payment.tsx` | | deleted (§12.4; merged into `checkout/index.tsx`) |
| `src/app/(shop)/notifications.tsx` | | port |
| `src/app/(shop)/product/[id]/write-review.tsx` | | deleted (§12.4; `store/[id]/review.tsx` replaces it) |
| `src/app/(shop)/settings.tsx` | | port |
| `src/components/ui/ErrorState.tsx` | receives `ApiError` from the hooks; `describeError` words it | port |
| `src/features/account/PasswordResetCard.tsx` | becomes a "Change password" form (current and new password): `api.session.changePassword` | port |
| `src/features/account/address/AddressEditor.tsx` | | deleted (§12.4; the jobsite editor replaces it) |
| `src/features/account/useSignOut.ts` | drop `unregisterDevice` and `settleWithin` (§2.5) | port |
| `src/features/checkout/CardChooser.tsx` | | port |
| `src/features/checkout/CartErrorNotice.tsx` | | port |
| `src/features/checkout/usePlaceOrder.ts` | maps MARKETPLACE §5.9 codes with `errorCodeOf` and `detailsFor` instead of showing only the message | port (H) |
| `src/features/orders/components/CancelOrderSheet.tsx` | | port |
| `src/features/product/FavoriteButton.tsx` | | port |
| `src/features/product/useFavoriteProducts.ts` | | port |
| `src/features/session/components/SignOutLink.tsx` | | port |
| `src/features/session/components/usePhoneCode.ts` | `keepsCode(error)` becomes `isNetworkError(error) \|\| errorStatusOf(error) === 'internal'`; delete the local `errorCode` helper | port |

**Group B: 13 files that read or write Firestore, Auth or Storage.**

| File | Firebase use today | Replacement | Fate |
| --- | --- | --- | --- |
| `src/features/session/SessionProvider.tsx` | `onIdTokenChanged`, claims, profile `onSnapshot`, claim repair | §2.2: statuses derived from `useSessionCore()`, `useConfig()`, the intro flag and `signingUp` | rewrite |
| `src/features/session/auth-service.ts` | Firebase Auth sign-in, sign-up, reset email, `getIdToken(true)` | §2.2 table of flows; `confirmCustomerClaim` is deleted | rewrite |
| `src/features/account/profile-service.ts` | `updateDoc(users/{uid})`, `updateProfile` | `updateDisplayName(name)` and `updatePreferences(changes)` call `api.session.updateProfile`; `cleanDisplayName` stays | port |
| `src/features/account/useOrderCount.ts` | `getCountFromServer(orders)` | deleted: `profile.stats.completedOrders` and `nonCancelledOrders` come with `/me` | delete |
| `src/features/addresses/hooks.ts` | address book reads, batch writes | deleted (§12.4). The jobsite hooks live in `src/features/site/hooks.ts`: `useJobsites()` is `useLiveQuery(queries.jobsites(uid))`; `saveJobsite`, `deleteJobsite`, `setDefaultJobsite` call `api.jobsites.*`. The server clears the other defaults in the same write, so `clearOtherDefaults` disappears | delete, new file |
| `src/features/cards/hooks.ts` | card reads, batch writes | `useCards()` is `useLiveQuery(queries.cards(uid))`; `addCard`, `setDefaultCard`, `deleteCard` call `api.cards.*`; `validateCard` passes `Date.now()` to `isFutureExpiry` | port |
| `src/features/catalog/hooks.ts` | product, category and search queries, `in` chunks of 30 | `useCategories`, `useProduct`, `useProductsByIds`, `useProductSearch`, `useFeaturedProducts`, `useCategoryProducts` over the descriptors of §4.1; search runs on the server, so `searchKeyFor` and the client-side word filter go; `useReviews` and `useMyReview` are deleted | rewrite (G) |
| `src/features/catalog/reviews.ts` | `setDoc(products/{id}/reviews/{uid})` | deleted (§12.4). Store reviews: `api.reviews.save` | delete |
| `src/features/favorites/FavoritesProvider.tsx` | `onSnapshot`, `setDoc`, `deleteDoc` | `useLiveQuery(queries.favorites(uid))` and the optimistic toggle of §1.12; `ready` is `!loading`. The provider moves to guests-safe use: with no user it returns no ids | port |
| `src/features/notifications/NotificationsBridge.tsx` | listener on the newest 5 notifications | §6.5 | rewrite |
| `src/features/notifications/hooks.ts` | inbox query, `updateDoc`, `writeBatch` | `useNotifications()` is `useLiveQuery(queries.notifications(uid))`; `markRead(id)`, `markAllRead()` call `api.notifications.*`; `notificationHref` per §6.4 | port |
| `src/features/notifications/push.ts` | device document `setDoc` and `deleteDoc`, FCM fallback | §6.2 and §6.3 | rewrite |
| `src/features/orders/hooks.ts` | orders query, order and tracking documents, callables | `useOrders`, `useOrder`, `useStoreOrders(orderId)`, `useTracking(token)` over §4.1; `useIsFirstOrder` reads `profile.stats.nonCancelledOrders === 0`; `placeOrder` and `cancelOrder` call `api.call` | rewrite (H) |

**Group C: 3 library files.**

| File | Replacement | Fate |
| --- | --- | --- |
| `src/lib/firebase.ts` | deleted; `src/lib/api.ts` (§3.1) | delete |
| `src/lib/callables.ts` | two lines: `export { call } from './api';` so screens keep their import | rewrite |
| `src/lib/env.ts` | §8.2 | rewrite |

New data-layer files in `app/customer/src`: `lib/api.ts`, `lib/ids.ts`
(`export const newRequestId = () => api.newRequestId()`), `features/site/hooks.ts`,
`features/stores/hooks.ts`, `features/quotes/hooks.ts`, `features/issues/hooks.ts`,
`features/support/hooks.ts`, `features/uploads/pick.ts` (image and document pickers that return an
`UploadSource`), `features/notifications/push-availability.ts` (§6.1) and `components/map/*` (§7).
`pick.ts` asks the document picker for `copyToCacheDirectory: true`, so every native source is a
`file://` URI, and returns `kind: 'blob'` on web.
Other files that do not import Firebase but change with it: `app/(shop)/_layout.tsx` (guests enter
the shop now: `FavoritesProvider` takes `uid: string | null`, and `NotificationsBridge` is mounted
only while the status is `ready`), `features/notifications/usePushListeners.ts`
(§6.4), `features/account/usePushPermission.ts` (§6.2), `features/account/support.ts` and
`features/orders/components/SupportCard.tsx` (the support phone comes from `useConfig()`),
`features/orders/components/TrackingMap*.tsx` (replaced by `AppMap`, §7).

### 3.3 `app/driver` (15 files)

| File | Firebase use today | Replacement | Fate |
| --- | --- | --- | --- |
| `src/lib/firebase.ts` | app, auth, db, functions, storage, emulators | deleted; `src/lib/api.ts` (§3.1) | delete |
| `src/lib/firebase-auth.ts` | web persistence | deleted | delete |
| `src/lib/firebase-auth.native.ts` | AsyncStorage persistence | deleted; the refresh token is in SecureStore (§1.4) | delete |
| `src/lib/firestore-hooks.ts` | `useLiveQuery`, `useLiveDoc` | deleted; `@instasupply/api-client/react` | delete |
| `src/lib/callables.ts` | `httpsCallable` | `export { call } from './api';` | rewrite |
| `src/features/auth/SessionProvider.tsx` | `onIdTokenChanged`, claims, profile `onSnapshot`, `refreshClaims` | §2.3 | rewrite |
| `src/features/auth/auth-service.ts` | Firebase Auth | §2.3; `requestPasswordReset` and `resetPassword` as in the customer app | rewrite |
| `src/features/chat/hooks.ts` | thread and messages listeners, `addDoc`, `updateDoc` | `useThread()` is `useLiveQuery(queries.chatThread(uid))`, `useMessages()` is `useLiveQuery(queries.chatMessages(uid))`; `sendMessage` calls `api.chat.send(uid, { id: api.newRequestId(), text, kind, deliveryId })` (optimistic); `markThreadRead` calls `api.chat.markRead(uid)` | port |
| `src/features/deliveries/actions.ts` | `uploadBytes` to `proofs/…`, callables | `uploadProofPhoto` compresses as today, then `api.upload({ purpose: 'proof', ownerId: deliveryId, source: { kind: 'uri', … } })` and returns `path`; the status functions call `api.call`; `codCollected` is removed (§12.6) | port |
| `src/features/deliveries/hooks.ts` | deliveries, route, events, history, count | `useActiveDeliveries`, `useRoutePlan`, `useDelivery`, `useDeliveryEvents`, `useDeliveryHistory` (paged), `useDeliveredToday` over §4.1 (`queries.deliveryStats`); `useOrderedStops` keeps its logic and learns `RouteStop.kind` (two stops per delivery, MARKETPLACE §5.11) | port |
| `src/features/location/publisher.ts` | `setDoc(driverLocations/{uid})` | §5: a thin module around `LocationPublisher` | rewrite |
| `src/features/notifications/NotificationsBridge.tsx` | newest-5 listener, push listeners | §6.4 and §6.5 | rewrite |
| `src/features/notifications/hooks.ts` | inbox query, read flags | as in the customer app; `notificationHref` per §6.4 | port |
| `src/features/notifications/push.ts` | device document, FCM fallback | §6.2 and §6.3; add `push.web.ts` like the customer app, so the web bundle drops `expo-notifications` | rewrite |
| `src/app/(app)/(tabs)/profile.tsx` | count query, `updateDoc` preferences | moves to `src/app/(app)/profile.tsx` (§12.6); deliveries from `profile.driverStats.deliveries`; `toggleChatPush` calls `api.session.updateProfile({ preferences: { chatPush } })`; the "local emulators" footer shows `env.apiUrl` in development | port (J) |

Files that do not import Firebase but change with it: `src/features/location/background-task.native.ts`
(uses `auth.authStateReady()` today; §5.5), `src/features/location/PresenceProvider.tsx` (§5.4),
`src/lib/installation.ts` (deleted; `api.installationId()`), `src/lib/errors.ts` (becomes
`export { describeError } from '@instasupply/api-client';`, so the 12 files that import it stay
untouched), `src/lib/env.ts` (§8.2), `src/features/profile/useSignOut.ts` (§2.5),
`src/app/(app)/(tabs)/index.tsx` and `route.tsx` (their `call` import keeps working),
`src/app/_layout.tsx` (`ApiProvider`), `src/features/route/RouteMap.tsx` and `RouteMap.web.tsx`
(deleted; `AppMap`, §7). New: `src/lib/api.ts`, `src/features/jobs/hooks.ts`,
`src/features/earnings/hooks.ts`, `src/features/notifications/push-availability.ts`,
`src/components/map/*`.

### 3.4 `frontend` (19 files)

| File | Firebase use today | Replacement | Fate |
| --- | --- | --- | --- |
| `src/lib/firebase/app.ts` | app, Firestore, emulator | deleted; `src/lib/api.ts` (§3.1) | delete |
| `src/lib/firebase/services.ts` | auth, functions, storage | deleted | delete |
| `src/lib/firebase/callables.ts` | `httpsCallable`, `errorMessage` | deleted; `call` and `errorMessage` are exported from `src/lib/api.ts`. The 21 files that import `@/lib/firebase/callables` change that path to `@/lib/api` | delete |
| `src/lib/firebase/hooks.ts` | `useCollection`, `useDocument`, `WithId`, `CollectionState`, `DocumentState` | deleted. `src/lib/data.ts` re-exports `WithId` and declares `type CollectionState<T> = QueryResult<WithId<T>[]>` and `type DocumentState<T> = QueryResult<WithId<T> \| null>`, so the 17 files that import those types change only the path | delete |
| `src/lib/data.ts` | every shared listener of the console | same hook names over §4.1: `useDrivers` (`queries.drivers()`), `useStaff`, `useDriverLocations`, `useOpenDeliveries`, `useClosedToday`, `useRecentDeliveries`, `useRoute`, `useThreads`, `useActivity`; `useOpenOrders` becomes `useOpenStoreOrders` (`queries.opsStoreOrders`); `useNow`, `presenceOf`, `indexById`, `groupActiveByDriver`, `mergeById` are unchanged. The 44 files that import it keep their imports | rewrite |
| `src/features/auth/AuthProvider.tsx` | `onIdTokenChanged`, claims, profile listener | §2.7 | rewrite (I1) |
| `src/features/auth/LoginPage.tsx` | `signInWithEmailAndPassword`, `sendPasswordResetEmail` | `api.session.signIn`; "Forgot password?" calls `requestPasswordReset` and links to `/reset-password`; the emulator hint box shows only when `import.meta.env.DEV` | port |
| `src/features/catalog/hooks.ts` | all products, categories | `useProducts(storeId?)` over `queries.portalCatalog(storeId)` or `queries.opsCatalog(filters)` (paged); `useCategories` over `queries.categories()` | rewrite (I1) |
| `src/features/catalog/mutations.ts` | `updateDoc`, `increment`, `runTransaction`, batches, client-built `searchTerms` | `api.products.create`, `update`, `adjustStock`, `remove`; `api.categories.*`. `refreshSearchTerms` and the slug transaction are deleted: the server builds search fields and the id is `{storeId}--{skuSlug}` | rewrite (I1) |
| `src/features/dashboard/store-hooks.ts` | orders and low-stock listeners | deleted (§12.5); the dashboard reads `queries.opsDashboard()` | delete |
| `src/features/deliveries/detail/EditDeliveryModal.tsx` | `updateDoc(deliveries/{id})` | `api.deliveries.update(id, patch)`; window times are already numbers; `codAmount` is removed (§12.5) | port |
| `src/features/deliveries/detail/ProofCard.tsx` | `getDownloadURL` | `useFileUrl(proof.photoPath)` | port |
| `src/features/deliveries/hooks.ts` | delivery, events, private meta | `useDelivery`, `useDeliveryEvents`, `usePrivateMeta` over `queries.delivery`, `queries.deliveryEvents`, `queries.deliveryPrivate`; `trackingUrl` unchanged | port |
| `src/features/drivers/hooks.ts` | driver, location, deliveries, counts | `useDriver` (`queries.user`), `useDriverLocation` (a selector over `queries.driverLocations()`), `useDriverDeliveries`, `useDriverTotals` (`queries.deliveryStats(driverId, 0)`) | port |
| `src/features/messages/hooks.ts` | thread, messages, `addDoc`, `updateDoc` | `queries.chatThread`, `queries.chatMessages`; `sendStaffMessage` calls `api.chat.send`; `markThreadRead` calls `api.chat.markRead` | port |
| `src/features/notifications/useNotifications.ts` | inbox query, read flags | `queries.notifications(uid)`, `api.notifications.*`; `notificationLink` per §6.4 | port |
| `src/features/orders/hooks.ts` | order queries | rewritten for marketplace orders (§12.5) over `queries.opsOrders`, `queries.opsStoreOrders`, `queries.order`, `queries.orderStoreOrders` | rewrite (I2) |
| `src/features/outbox/DevOutboxPage.tsx` | `devOutbox` query | `useLiveQuery(queries.outbox())`; the "Production mode" notice keys on `config.smsDriver !== 'outbox'` | port |
| `src/features/tracking/useTracking.ts` | tracking document | `useLiveQuery(queries.tracking(token))`; the token format check stays | port |

Also changed without importing Firebase: `src/lib/env.ts` and `src/vite-env.d.ts` (§8.3),
`src/main.tsx` (`ApiProvider`), `src/app/router.tsx` (`/set-password`, `/reset-password`,
`/portal/*`), `src/components/map/BaseMap.tsx` (§7.5). New: `src/lib/api.ts`,
`src/features/auth/SetPasswordPage.tsx`, `src/features/auth/ResetPasswordPage.tsx`,
`src/features/files/SignedImage.tsx` (an `<img>` over `useFileUrl`, for proofs, issue photos and
quote attachments).

### 3.5 `packages/expo-firebase` (deleted)

| File | Where its job goes |
| --- | --- |
| `src/client.ts`, `src/auth-persistence.ts`, `src/auth-persistence.native.ts` | `createApiClient`, `createNativePlatform` |
| `src/callables.ts` (`createCaller`) | `api.call` |
| `src/firestore-hooks.ts` (`useLiveQuery`, `useLiveDoc`, `LiveResult`) | `useLiveQuery`, `QueryResult` |
| `src/errors.ts` (`describeError`) | `describeError` of the package |
| `src/emulator-host.ts` (`resolveEmulatorHost`) | `resolveApiUrl` in each app's `lib/env.ts` (§8.2) |
| `src/installation.ts` (`getInstallationId`) | `api.installationId()` |

Remove the workspace folder, then run `npm install` at the root so the lock file drops it and
`firebase`.

---

## 4. What every screen reads, subscribes to and calls

How to use this section: find the screen in §4.3 to §4.6; it names descriptors (`queries.*`, defined
in §4.1), commands (`api.call`, §1.6) and REST writes (`api.<resource>.*`, §4.2). Use
`useLiveQuery` for every descriptor that has topics, `usePagedQuery` for the ones marked "paged",
`useApiQuery` for the rest. A screen never needs anything that is not named in its row.

### 4.1 Topics and query descriptors

**Topics** (`import { topics } from '@instasupply/api-client'`; assumption B14). Unless a row says
"payload", an event only says "this changed": the client refetches.

| Builder | Topic string | May subscribe | Emitted when |
| --- | --- | --- | --- |
| `topics.categories()` | `categories` | anyone | a category changes |
| `topics.stores()` | `stores` | anyone | any store's public document changes (status, pause, hours, rating) |
| `topics.store(storeId)` | `store:{storeId}` | anyone | that store's public document or private settings change |
| `topics.storeProducts(storeId)` | `store:{storeId}:products` | anyone | a product of the store changes (price, stock, reserved, active) |
| `topics.product(productId)` | `product:{productId}` | anyone | that product changes |
| `topics.tracking(token)` | `tracking:{token}` | anyone holding the token | **payload**: the whole `PublicTracking` after each change (status, phase, driver position, ETA) |
| `topics.user(uid)` | `user:{uid}` | that user | the account or profile changes (approval, suspension, phone verified, vehicle review, role, store) |
| `topics.userNotifications(uid)` | `user:{uid}:notifications` | that user | **payload** on `kind: 'created'`: the `AppNotification`; plain event when read flags change |
| `topics.userOrders(uid)` | `user:{uid}:orders` | that customer | any of the customer's orders or store orders changes |
| `topics.userQuotes(uid)` | `user:{uid}:quotes` | that customer | any of the customer's quotes changes |
| `topics.userIssues(uid)` | `user:{uid}:issues` | that customer | any of the customer's issues changes |
| `topics.order(orderId)` | `order:{orderId}` | its customer, staff | the order or one of its store orders changes |
| `topics.storeOrder(id)` | `store-order:{id}` | its customer, members of its store, staff | the store order changes, including the driver projection |
| `topics.quote(id)` | `quote:{id}` | its customer, staff | the quote changes |
| `topics.issue(id)` | `issue:{id}` | its customer, members of its store, staff | the issue changes |
| `topics.supportThread(threadId)` | `support-thread:{threadId}` | the owner (the customer, or the store's members), staff | **payload** on `kind: 'message'`: the `SupportMessage`; plain event when the summary changes |
| `topics.storeOrders(storeId)` | `store:{storeId}:orders` | members, staff | any store order of the store changes |
| `topics.storeIssues(storeId)` | `store:{storeId}:issues` | members, staff | an issue on the store changes |
| `topics.storePayouts(storeId)` | `store:{storeId}:payouts` | the owner, staff | a ledger entry or payout of the store changes |
| `topics.driverDeliveries(uid)` | `driver:{uid}:deliveries` | that driver, staff | a delivery is assigned to, changed for or taken from the driver |
| `topics.driverRoute(uid)` | `driver:{uid}:route` | that driver, staff | the route plan was recomputed |
| `topics.driverEarnings(uid)` | `driver:{uid}:earnings` | that driver, staff | a ledger entry or payout of the driver changes |
| `topics.delivery(id)` | `delivery:{id}` | the assigned driver, staff | the delivery changes or gets an event |
| `topics.jobOffers(cityId, capacityClass)` | `job-offers:{cityId}:{capacityClass}` | an active driver whose city and class in the database are these; staff | an offer whose audience contains this key is created, changed or removed |
| `topics.chatThread(driverId)` | `thread:{driverId}` | that driver, staff | **payload** on `kind: 'message'`: the `ChatMessage`; plain event for the summary |
| `topics.driverLocations()` | `driver-locations` | staff | **payload**: `WithId<DriverLocation>` (`id` is the driver's uid) on every accepted fix |
| `topics.ops(area)` | `ops:{area}` with area `orders`, `store-orders`, `deliveries`, `job-offers`, `quotes`, `issues`, `support-threads`, `threads`, `drivers`, `payouts`, `suggestions`, `outbox` | staff | anything in that area changes |

**Descriptors** (`import { queries } from '@instasupply/api-client'`). "Poll" is `pollMs` in seconds
while the socket is down; 0 means no polling. Every factory accepts `undefined` for an id and then
returns a disabled descriptor. `{uid}` in a request is the caller's own uid, which screens pass in.

Two rules hold for every descriptor:

- **Non-paged lists read everything.** The server answers every list as `Page<T>` with a default
  `limit` of 50 (PLATFORM.md §4.4). A descriptor that is not marked "(paged)" sends `limit=500` unless
  its row gives another value, follows `nextCursor` until it is null (at most 2 000 rows), and its
  `fetch` returns the concatenated `items`.
- **Payload reducers refetch without data.** The server sends an event larger than 7 500 bytes without
  `data` (PLATFORM.md §8.3). Every `reduce` returns `REFETCH` for an event that has no `data`.

Public data (`auth: 'none'`):

| Descriptor | Key | Request | Topics | Poll | Data |
| --- | --- | --- | --- | --- | --- |
| `queries.categories()` | `['categories']` | `GET /categories?limit=500` | `categories` | 300 | `Category[]` by `sortOrder` |
| `queries.stores()` | `['stores']` | `GET /stores?marketId=gta&limit=500` | `stores` | 60 | `WithId<Store>[]`; screens hide `closed` |
| `queries.store(storeId)` | `['store', storeId]` | `GET /stores/{storeId}` | `store:{storeId}` | 60 | `WithId<Store>` or null |
| `queries.storeReviews(storeId)` (paged) | `['store-reviews', storeId]` | `GET /stores/{storeId}/reviews?sort=updatedAt:desc` | none | 0 | `WithId<StoreReview>` |
| `queries.product(productId)` | `['product', productId]` | `GET /products/{productId}` | `product:{productId}` | 30 | `Product` or null |
| `queries.productsByIds(ids)` | `['products', 'ids', ids sorted and joined by ',']` | `GET /products?ids=…`, 50 ids per request | `store:{storeId}:products` for each store in the ids (a product id starts with `{storeId}--`) | 30 | `Product[]`, unordered, only ids that exist |
| `queries.productSearch(params)` | `['products', 'search', canonical JSON of params]` | `GET /products?listed=true&q=&categoryId=&storeId=&inStock=&limit=40` | none | 0 | `Product[]`; `staleMs` 30 000 |
| `queries.featuredProducts(limit)` | `['products', 'featured', limit]` | `GET /products?listed=true&featured=true&sort=name:asc&limit=` | none | 0 | `Product[]` |
| `queries.familyOffers(familyKey)` | `['products', 'family', familyKey]` | `GET /products?listed=true&familyKey=&sort=priceCents:asc` | none | 0 | `Product[]` |
| `queries.storeProducts(storeId, params)` (paged) | `['products', 'store', storeId, categoryId, q]` | `GET /products?storeId=&listed=true&categoryId=&q=&sort=name:asc` | `store:{storeId}:products` | 60 | `Product` |
| `queries.tracking(token)` | `['tracking', token]` | `GET /tracking/{token}` | `tracking:{token}` (payload, replaces the value) | 5 | `PublicTracking` or null |

`GET /config` is not a descriptor: the `ConfigStore` of §8.1 loads and caches it, and screens read
it with `useConfig()`.

Signed-in customer:

| Descriptor | Key | Request | Topics | Poll | Data |
| --- | --- | --- | --- | --- | --- |
| `queries.jobsites(uid)` | `['jobsites', uid]` | `GET /me/jobsites?limit=500` | none | 0 | `Jobsite[]`, default first |
| `queries.cards(uid)` | `['cards', uid]` | `GET /me/cards?limit=500` | none | 0 | `SavedCard[]` |
| `queries.favorites(uid)` | `['favorites', uid]` | `GET /me/favorites?limit=500` | none | 0 | `WithId<Favorite>[]`, newest first |
| `queries.buyAgain(uid)` | `['buy-again', uid]` | `GET /me/buy-again` | none | 0 | `Product[]`, at most 12 |
| `queries.notifications(uid)` | `['notifications', uid]` | `GET /notifications?limit=50` | `user:{uid}:notifications` (payload `created` is prepended; other kinds refetch) | 30 | `AppNotification[]` |
| `queries.customerOrders(uid, state, filters)` (paged) | `['orders', 'customer', uid, state, filters.jobsiteId ?? null]` | `GET /orders?customerId={uid}&status=…&jobsiteId=&sort=createdAt:desc`; `state` `'active'` is `placed,confirmed,preparing,ready,on_the_way`, `'past'` is `completed,cancelled` | `user:{uid}:orders` | 20 | `Order` |
| `queries.order(orderId)` | `['order', orderId]` | `GET /orders/{orderId}` | `order:{orderId}` | 15 | `Order` or null |
| `queries.orderStoreOrders(orderId)` | `['store-orders', 'order', orderId]` | `GET /store-orders?orderId={orderId}` | `order:{orderId}` | 15 | `StoreOrder[]` by letter |
| `queries.storeOrder(id)` | `['store-order', id]` | `GET /store-orders/{id}` | `store-order:{id}` | 10 | `StoreOrder` or null |
| `queries.storeOrderProof(id)` | `['store-order-proof', id]` | `GET /store-orders/{id}/proof`; while observed it refetches at `expiresAt − 60 s` (the photo URL lives 300 s), as `useFileUrl` does | none | 0 | `{ photoUrl: string \| null; expiresAt: number; recipientName: string \| null; deliveredAt: number \| null }` |
| `queries.customerQuotes(uid)` (paged) | `['quotes', 'customer', uid]` | `GET /quotes?customerId={uid}&sort=createdAt:desc` | `user:{uid}:quotes` | 30 | `Quote` |
| `queries.quote(quoteId)` | `['quote', quoteId]` | `GET /quotes/{quoteId}` | `quote:{quoteId}` | 15 | `Quote` or null |
| `queries.customerIssues(uid)` (paged) | `['issues', 'customer', uid]` | `GET /issues?customerId={uid}&sort=createdAt:desc` | `user:{uid}:issues` | 30 | `Issue` |
| `queries.issue(issueId)` | `['issue', issueId]` | `GET /issues/{issueId}` | `issue:{issueId}` | 15 | `Issue` or null |
| `queries.myReview(storeId, storeOrderId)` | `['store-review', storeId, storeOrderId]` | `GET /stores/{storeId}/reviews/{storeOrderId}`, 404 is null | none | 0 | `WithId<StoreReview>` or null |
| `queries.supportThread(threadId)` | `['support-thread', threadId]` | `GET /support-threads/{threadId}`, 404 is null | `support-thread:{threadId}` | 15 | `WithId<SupportThread>` or null |
| `queries.supportMessages(threadId)` | `['support-messages', threadId]` | `GET /support-threads/{threadId}/messages?limit=100` | `support-thread:{threadId}` (payload `message` is appended by id) | 10 | `SupportMessage[]`, oldest first |
| `queries.fileUrl(path)` | `['file-url', path]` | `GET /files/url?path=` | none | 0 | `{ url, expiresAt }`; used through `useFileUrl(path)` by every client |

The customer's own support thread id is their uid; a store's is `store_{storeId}` (MARKETPLACE §1.1).

Supplier portal (store `S` is `profile.storeId`):

| Descriptor | Key | Request | Topics | Poll | Data |
| --- | --- | --- | --- | --- | --- |
| `queries.storeBoard(storeId)` | `['store-orders', 'board', storeId]` | `GET /store-orders?storeId=&status=new,accepted,preparing,ready,out_for_delivery,failed&sort=readyBy:asc&limit=200` | `store:{storeId}:orders` | 10 | `StoreOrder[]` |
| `queries.storeCompleted(storeId, sinceMs)` | `['store-orders', 'completed', storeId, sinceMs]` | `GET /store-orders?storeId=&completedSince=&sort=completedAt:desc&limit=200`, following cursors up to 1 000 rows | `store:{storeId}:orders` | 60 | `StoreOrder[]` |
| `queries.storeHistory(storeId)` (paged) | `['store-orders', 'history', storeId]` | `GET /store-orders?storeId=&sort=createdAt:desc` | `store:{storeId}:orders` | 0 | `StoreOrder` |
| `queries.storeSettings(storeId)` | `['store-settings', storeId]` | `GET /stores/{storeId}/settings` | `store:{storeId}` | 0 | `StorePrivateSettings` |
| `queries.portalCatalog(storeId)` | `['products', 'portal', storeId]` | `GET /products?storeId=&sort=name:asc&limit=500` (no `listed` filter: inactive rows are included) | `store:{storeId}:products` | 30 | `Product[]` |
| `queries.storeIssues(storeId)` (paged) | `['issues', 'store', storeId]` | `GET /issues?storeId=&sort=createdAt:desc` | `store:{storeId}:issues` | 60 | `Issue` |
| `queries.ledger(payeeType, payeeId, filters)` (paged) | `['ledger', payeeType, payeeId, filters.unpaid ?? null, filters.held ?? null, filters.payoutId ?? null]` | `GET /ledger-entries?payeeType=&payeeId=&unpaid=&held=&payoutId=&sort=createdAt:desc` | `store:{payeeId}:payouts` or `driver:{payeeId}:earnings` | 0 | `WithId<LedgerEntry>` |
| `queries.ledgerBalance(payeeType, payeeId)` | `['ledger-balance', payeeType, payeeId]` | `GET /ledger/balance?payeeType=&payeeId=` | `store:{payeeId}:payouts` or `driver:{payeeId}:earnings` | 60 | `LedgerBalance` (`{ payeeType, payeeId, unpaidCents, unpaidCount, heldCents, heldCount, lastPaidAt }`). Balances are never summed on the client from a page of entries |
| `queries.payouts(payeeType, payeeId)` (paged) | `['payouts', payeeType, payeeId]` | `GET /payouts?payeeType=&payeeId=&sort=createdAt:desc` | as above | 0 | `WithId<Payout>` |
| `queries.storeTeam(storeId)` | `['users', 'store', storeId]` | `GET /users?role=supplier&storeId=&limit=500` | none | 0 | `UserProfile[]` |

Driver app:

| Descriptor | Key | Request | Topics | Poll | Data |
| --- | --- | --- | --- | --- | --- |
| `queries.jobBoard(cityId, capacityClass)` | `['job-offers', 'board', cityId, capacityClass]` | `GET /job-offers?status=open&sort=openedAt:desc&limit=200`; the server returns only offers whose audience matches the caller | `job-offers:{cityId}:{capacityClass}` | 20 | `WithId<JobOffer>[]` |
| `queries.jobOffer(deliveryId, cityId, capacityClass)` | `['job-offer', deliveryId]` | `GET /job-offers/{deliveryId}`, 404 is null (taken or withdrawn) | `job-offers:{cityId}:{capacityClass}` | 20 | `WithId<JobOffer>` or null |
| `queries.driverActiveDeliveries(uid)` | `['deliveries', 'driver', uid, 'active']` | `GET /deliveries?driverId={uid}&status=assigned,accepted,picked_up,in_transit,arrived&limit=50` | `driver:{uid}:deliveries` | 15 | `Delivery[]` |
| `queries.driverHistory(uid)` (paged) | `['deliveries', 'driver', uid, 'closed']` | `GET /deliveries?driverId={uid}&status=delivered,failed,cancelled&sort=updatedAt:desc` | `driver:{uid}:deliveries` | 0 | `Delivery` |
| `queries.delivery(deliveryId)` | `['delivery', deliveryId]` | `GET /deliveries/{deliveryId}` | `delivery:{deliveryId}` | 10 | `Delivery` or null |
| `queries.deliveryEvents(deliveryId)` | `['delivery-events', deliveryId]` | `GET /deliveries/{deliveryId}/events?limit=30` | `delivery:{deliveryId}` | 30 | `DeliveryEvent[]`, newest first |
| `queries.deliveryStats(driverId, sinceMs)` | `['delivery-stats', driverId, sinceMs]` | `GET /deliveries/stats?driverId=&since=` | `driver:{driverId}:deliveries` | 0 | `{ delivered: number; failed: number }` |
| `queries.route(driverId)` | `['route', driverId]` | `GET /routes/{driverId}`, 404 is null | `driver:{driverId}:route` | 30 | `RoutePlan` or null |
| `queries.chatThread(driverId)` | `['chat-thread', driverId]` | `GET /threads/{driverId}`, 404 is null | `thread:{driverId}` | 15 | `WithId<ChatThread>` or null |
| `queries.chatMessages(driverId)` | `['chat-messages', driverId]` | `GET /threads/{driverId}/messages?limit=100` | `thread:{driverId}` (payload `message` is appended by id) | 10 | `ChatMessage[]`, oldest first |

Earnings use `queries.ledgerBalance('driver', uid)`, `queries.ledger('driver', uid, filters)` and `queries.payouts('driver', uid)`.

Ops console (staff):

| Descriptor | Key | Request | Topics | Poll | Data |
| --- | --- | --- | --- | --- | --- |
| `queries.opsDashboard()` | `['ops-dashboard']` | `GET /ops/dashboard` | `ops:orders`, `ops:store-orders`, `ops:deliveries`, `ops:job-offers`, `ops:quotes`, `ops:issues`, `ops:support-threads`; `minRefetchMs` 5 000 | 30 | `OpsDashboard` (below) |
| `queries.opsOrders(filters)` (paged) | `['orders', 'ops', canonical JSON of filters]` | `GET /orders?status=&storeId=&customerId=&needsAttention=&createdSince=&sort=createdAt:desc` | `ops:orders` | 30 | `Order` |
| `queries.opsStoreOrders(filters)` (paged) | `['store-orders', 'ops', canonical JSON of filters]` | `GET /store-orders?status=&storeId=&customerId=&acceptOverdue=&sort=createdAt:desc` | `ops:store-orders` | 30 | `StoreOrder` |
| `queries.storeOrderPrivate(id)` | `['store-order-private', id]` | `GET /store-orders/{id}/private` | `store-order:{id}` | 0 | `StoreOrderPrivateMeta` |
| `queries.openDeliveries()` | `['deliveries', 'open']` | `GET /deliveries?status=unassigned,assigned,accepted,picked_up,in_transit,arrived&sort=createdAt:desc&limit=500` | `ops:deliveries` | 15 | `Delivery[]` |
| `queries.deliveriesClosedSince(sinceMs)` | `['deliveries', 'closed-since', sinceMs]` | `GET /deliveries?status=delivered,failed,cancelled&updatedSince=&sort=updatedAt:desc&limit=500` | `ops:deliveries` | 60 | `Delivery[]` |
| `queries.deliveriesCreatedSince(sinceMs)` | `['deliveries', 'created-since', sinceMs]` | `GET /deliveries?createdSince=&sort=createdAt:desc&limit=500` | `ops:deliveries` | 60 | `Delivery[]` |
| `queries.driverDeliveries(driverId)` | `['deliveries', 'driver', driverId, 'recent']` | `GET /deliveries?driverId=&sort=createdAt:desc&limit=50` | `driver:{driverId}:deliveries` | 30 | `Delivery[]` |
| `queries.labourerQueue()` | `['deliveries', 'labourer']` | `GET /deliveries?unloadStatus=needed&limit=200` | `ops:deliveries` | 30 | `Delivery[]` |
| `queries.deliveryPrivate(id)` | `['delivery-private', id]` | `GET /deliveries/{id}/private` | none | 0 | `DeliveryPrivateMeta` |
| `queries.opsJobOffers()` | `['job-offers', 'ops']` | `GET /job-offers?status=scheduled,open&sort=opensAt:asc&limit=500` | `ops:job-offers` | 20 | `WithId<JobOffer>[]` |
| `queries.drivers()` | `['users', 'drivers']` | `GET /users?role=driver&limit=500` | `ops:drivers` | 60 | `UserProfile[]` |
| `queries.staff()` | `['users', 'staff']` | `GET /users?role=admin,dispatcher&limit=500` | none | 0 | `UserProfile[]` |
| `queries.userSessions(uid)` (admin) | `['user-sessions', uid]` | `GET /users/{uid}/sessions?limit=500` | none | 0 | `SessionInfo[]` |
| `queries.opsJobs()` | `['ops-jobs']` | `GET /ops/jobs?limit=50` | `ops:payouts` | 60 | `JobState[]`: the scheduler state; the payouts page shows the last `runDailyPayouts` result (`skippedNoAccount`) |
| `queries.user(uid)` | `['user', uid]` | `GET /users/{uid}` | `ops:drivers` | 60 | `UserProfile` or null |
| `queries.driverLocations()` | `['driver-locations']` | `GET /driver-locations?limit=500` | `driver-locations` (payload, upsert by `id`) | 10 | `WithId<DriverLocation>[]` |
| `queries.chatThreads()` | `['chat-threads']` | `GET /threads?sort=updatedAt:desc&limit=200` | `ops:threads` | 20 | `WithId<ChatThread>[]` |
| `queries.supportThreads(filters)` | `['support-threads', filters.kind ?? null, filters.status ?? null]` | `GET /support-threads?kind=&status=&sort=updatedAt:desc&limit=200` | `ops:support-threads` | 20 | `WithId<SupportThread>[]` |
| `queries.opsQuotes(filters)` (paged) | `['quotes', 'ops', canonical JSON of filters]` | `GET /quotes?status=&customerId=&sort=respondBy:asc` | `ops:quotes` | 30 | `Quote` |
| `queries.quoteWorkspace(quoteId)` | `['quote-workspace', quoteId]` | `GET /quotes/{quoteId}/workspace`, 404 is null | none | 0 | the builder draft (owned by the quote builder, opaque JSON) |
| `queries.opsIssues(filters)` (paged) | `['issues', 'ops', canonical JSON of filters]` | `GET /issues?status=&orderId=&customerId=&storeId=&sort=createdAt:desc` | `ops:issues` | 30 | `Issue` |
| `queries.issueNotes(issueId)` | `['issue-notes', issueId]` | `GET /issues/{issueId}/notes`, 404 is null | none | 0 | `{ notes: string; updatedAt: number; updatedBy: string }` |
| `queries.opsStores()` | `['ops-stores']` | `GET /ops/stores?limit=500` | `stores`, `ops:store-orders`; `minRefetchMs` 5 000 | 60 | `OpsStoreRow[]` (below) |
| `queries.opsCatalog(filters)` (paged) | `['products', 'ops', canonical JSON of filters]` | `GET /products?storeId=&categoryId=&q=&sort=name:asc` (no `listed` filter) | none | 0 | `Product` |
| `queries.opsPayouts(filters)` (paged) | `['payouts', 'ops', canonical JSON of filters]` | `GET /payouts?payeeType=&status=&runKey=&sort=createdAt:desc` | `ops:payouts` | 0 | `WithId<Payout>` |
| `queries.suggestions(status)` | `['suggestions', status]` | `GET /store-suggestions?status=&sort=createdAt:desc&limit=200` | `ops:suggestions` | 120 | `WithId<StoreSuggestion>[]` |
| `queries.outbox()` (paged) | `['outbox']` | `GET /dev-outbox?limit=100` | `ops:outbox` | 15 | `OutboxMessage` (PLATFORM.md §5.4: SMS and email; `body` is null for a redacted row) |
| `queries.activity(limit)` | `['activity', limit]` | `GET /activity?limit=` | `ops:deliveries` | 30 | `DeliveryEvent[]`, newest first |

Two server-computed shapes the console needs (assumption B16), exported by `@instasupply/shared`
`rest.ts` (PLATFORM.md §5.4) and re-exported by the package:

```ts
export interface OpsDashboard {
  today: { orders: number; gmvCents: number };
  storeOrdersByStatus: Partial<Record<StoreOrderStatus, number>>;
  acceptOverdue: number;
  jobOffers: { scheduled: number; open: number; unclaimedOver15Min: number };
  activeDeliveries: number;
  failedDeliveries: number;
  liveStores: number;
  quotes: { waiting: number; nearRespondBy: number };
  issues: { open: number; pastSla: number };
  unreadSupport: number;
  captureFailures: number;
  pendingDrivers: number;
  unreadDriverChat: number;
  generatedAt: number;
}
export interface OpsStoreRow {
  store: WithId<Store>;
  liveProducts: number;
  ordersLast7Days: number;
  medianAcceptSeconds: number | null;
  openNow: boolean;
}
```

The sidebar badges of `AppLayout` (pending drivers, unread messages, unassigned deliveries, new
orders) read `queries.opsDashboard()` instead of four full collections.

### 4.2 REST writes (`api.<resource>.*`, files in `src/resources/`)

Each function invalidates the listed key prefixes after success. "Optimistic" names the patch the
calling hook applies (§1.12).

| Function | Request | Invalidates | Optimistic |
| --- | --- | --- | --- |
| `api.jobsites.save(jobsite: JobsiteFields & { id: string; isDefault: boolean })` | `PUT /me/jobsites/{id}`; the server clears other defaults and keeps `lastUsedAt` | `['jobsites']` | no |
| `api.jobsites.remove(id)` | `DELETE /me/jobsites/{id}` | `['jobsites']` | remove from the list |
| `api.cards.save(card: Omit<SavedCard, 'createdAt'>)` | `PUT /me/cards/{id}`: brand, last 4, expiry, holder, default flag only | `['cards']` | no |
| `api.cards.remove(id)` | `DELETE /me/cards/{id}` | `['cards']` | remove from the list |
| `api.favorites.add(productId)` / `remove(productId)` | `PUT` / `DELETE /me/favorites/{productId}` | `['favorites']` | add or remove the id |
| `api.reviews.save(storeId, storeOrderId, { rating, text })` | `PUT /stores/{storeId}/reviews/{storeOrderId}`; the server sets `authorName` | `['store-reviews', storeId]`, `['store-review', storeId]`, `['store', storeId]`, `['stores']`, `['store-order', storeOrderId]` | no |
| `api.reviews.remove(storeId, storeOrderId)` | `DELETE` the same path (the author, or staff) | as above | no |
| `api.notifications.markRead(id)` | `POST /notifications/{id}/read` | `['notifications']` | set `read: true` |
| `api.notifications.markAllRead()` | `POST /notifications/read-all` | `['notifications']` | set all `read: true` |
| `api.devices.register(input)` | `PUT /me/devices/{installationId}` (§6.3) | none | no |
| `api.devices.unregister()` | `DELETE /me/devices/{installationId}` | none | no |
| `api.location.publish(body)` | `POST /me/location` (§5.2) | none | no |
| `api.chat.send(driverId, { id, text, kind, deliveryId })` | `POST /threads/{driverId}/messages`; the server sets sender fields and time; same `id` twice is one message | `['chat-thread', driverId]`, `['chat-threads']` | append the message |
| `api.chat.markRead(driverId)` | `POST /threads/{driverId}/read`; resets the caller's side | `['chat-thread', driverId]`, `['chat-threads']`, `['ops-dashboard']` | zero the caller's unread count |
| `api.support.send(threadId, { id, text, context })` | `POST /support-threads/{threadId}/messages`; creates the thread on the first message | `['support-thread', threadId]`, `['support-threads']` | append the message |
| `api.support.markRead(threadId)` | `POST /support-threads/{threadId}/read` | `['support-thread', threadId]`, `['support-threads']`, `['ops-dashboard']` | zero the caller's unread count |
| `api.support.update(threadId, { status?, assignedTo? })` (staff) | `PATCH /support-threads/{threadId}` | `['support-thread', threadId]`, `['support-threads']` | no |
| `api.products.create(product)` (store member, staff) | `PUT /products/{productId}` with the client-editable fields of MARKETPLACE §6.3. The id is `productIdFor(storeId, sku)` from `resources/catalog.ts`: `{storeId}--{skuSlug}` by the rule of MARKETPLACE §1.1; `already-exists` when the SKU is taken | `['products']`, `['product']` | no |
| `api.products.update(productId, patch)` | `PATCH /products/{productId}`; locked fields are refused as §6.3 lists them | `['products']`, `['product', productId]` | apply the patch to the portal row |
| `api.products.adjustStock(productId, delta)` | `POST /products/{productId}/stock-adjust` `{ delta }`: an atomic change of `stockOnHand` | `['products']`, `['product', productId]` | add `delta` to the row |
| `api.products.remove(productId)` | `DELETE /products/{productId}` (owner or admin, `reserved === 0`) | `['products']`, `['product', productId]` | no |
| `api.categories.save(id, values)`, `update(id, patch)`, `remove(id)`, `reorder(ids)` (staff) | `PUT`, `PATCH`, `DELETE /categories/{id}`, `POST /categories/reorder` `{ ids }` | `['categories']` | no |
| `api.deliveries.update(deliveryId, patch)` (staff) | `PATCH /deliveries/{deliveryId}`: `customer`, `address`, `location`, `addressNotes`, `notes`, `packageCount`, `priority`, `requireCode`, `windowStart`, `windowEnd`, `unload` | `['delivery', deliveryId]`, `['deliveries']` | no |
| `api.quotes.update(quoteId, { assignedTo?, status?: 'in_review' })` (staff) | `PATCH /quotes/{quoteId}` | `['quote', quoteId]`, `['quotes']` | no |
| `api.quotes.saveWorkspace(quoteId, draft)` (staff) | `PUT /quotes/{quoteId}/workspace` | none (the builder holds the draft) | no |
| `api.issues.update(issueId, { assignedTo?, status?: 'in_review' })` (staff) | `PATCH /issues/{issueId}` | `['issue', issueId]`, `['issues']` | no |
| `api.issues.saveNotes(issueId, notes)` (staff) | `PUT /issues/{issueId}/notes` | `['issue-notes', issueId]` | no |
| `api.suggestions.setStatus(id, status)` (staff) | `PATCH /store-suggestions/{id}` | `['suggestions']` | set the status |
| `api.files.presign`, `confirm`, `url` | §1.8 | none | no |
| `api.users.setPayoutAccount(uid, payoutAccount \| null)` (admin) | `PATCH /users/{uid}/payout-account` (`PayoutAccountPatch`) | `['user', uid]`, `['users']` | no |
| `api.users.setStatus(uid, { status, reason })` (admin; admins, dispatchers, customers) | `PATCH /users/{uid}/status` (`UserStatusPatch`) | `['user', uid]`, `['users']` | no |
| `api.users.revokeSessions(uid)` (admin) | `POST /users/{uid}/sessions/revoke-all` | `['user-sessions', uid]` | no |

`Favorite` is declared in `resources/me.ts`: `{ productId: string; createdAt: number }`.

### 4.3 Customer app (MARKETPLACE §7.3)

`uid` is `useCustomer().user.uid`. Guests see only the rows without 🔒; descriptors with
`auth: 'required'` are empty for guests without any request.

| Route (`src/app`) | Reads | Calls and writes |
| --- | --- | --- |
| `(auth)/*`, `(setup)/*` | the session (§2.2) | `signIn`, `createAccount`, `completeProfile`, `requestPhoneCode`, `verifyPhoneCode`, `requestPasswordReset`, `resetPassword` |
| `(shop)/(tabs)/index` Home | `queries.jobsites(uid)` (switcher); `queries.customerOrders(uid, 'active', {})`, first 3; `queries.tracking(token)` for the first store order that is `out_for_delivery` (one mini map at most, §7.4); `queries.categories()`; `queries.stores()`; `queries.featuredProducts(12)`; `queries.buyAgain(uid)` | none |
| `(shop)/(tabs)/stores` | `queries.stores()`; distance, promise and badges from `storeAvailability()` (shared) with the current site; map: `AppMap` (§7) | none |
| `(shop)/site` | `queries.jobsites(uid)`; the guest site from `SiteProvider` | `api.call('geocodeAddress')` on submit, never per keystroke; 🔒 `api.jobsites.save` |
| `(shop)/search` | `queries.productSearch({ q, categoryId, inStock })`; `queries.stores()` for distance and promise; grouping by `familyKey` and ranking stay in the app | none |
| `(shop)/categories`, `category/[id]` | `queries.categories()`; `queries.productSearch({ categoryId, … })`; `queries.stores()` | none |
| `(shop)/store/[id]` | `queries.store(id)`; `queries.storeProducts(id, { categoryId, q })` | none |
| `(shop)/store/[id]/reviews` | `queries.storeReviews(id)` | none |
| `(shop)/store/[id]/review` 🔒 | `queries.myReview(id, storeOrderId)`; `queries.storeOrder(storeOrderId)` | `api.reviews.save` |
| `(shop)/product/[id]` | `queries.product(id)`; `queries.familyOffers(product.familyKey)`; `queries.stores()`; `queries.favorites(uid)` through `FavoritesProvider` | 🔒 `api.favorites.add` / `remove` |
| `(shop)/cart` | `useCartPricing(uid)`: `queries.productsByIds(cart ids)`, `queries.stores()`, the site, `profile.stats` and `profile.promoUses`, then `priceCheckout` locally | none (the cart is on the device) |
| `(shop)/saved` 🔒 | `queries.favorites(uid)`, `queries.productsByIds(favourite ids)` | `api.favorites.remove` |
| `(shop)/checkout/index` 🔒 | `useCartPricing(uid)`; `queries.jobsites(uid)`; `queries.cards(uid)`; `useConfig()` (`paymentsMode`, `hstNumber`) | `api.call('placeOrder', { checkoutId: newRequestId(), expectedTotalCents, … })` with the id kept in screen state across retries. Errors by `errorCodeOf`: `PRICE_CHANGED` shows `detailsFor(e, 'PRICE_CHANGED').pricing`; `WINDOW_UNAVAILABLE` reopens the picker with `.windows`; `OUT_OF_STOCK` clamps the line to `.available`; `STORE_UNAVAILABLE` and `STORE_PAUSED` mark the section; `PHONE_UNVERIFIED` goes to `/verify-phone`; `CARD_DECLINED` opens `checkout/card`; `PAYMENTS_DISABLED` explains |
| `(shop)/checkout/window` 🔒 | nothing from the server: the shared window helpers with `queries.stores()` data | none |
| `(shop)/checkout/jobsite` 🔒 | `queries.jobsites(uid)` | `api.jobsites.save` |
| `(shop)/checkout/card` 🔒 | `queries.cards(uid)` | `api.cards.save` |
| `(shop)/order-success` 🔒 | route params; `queries.order(orderId)` | none |
| `(shop)/(tabs)/orders` 🔒 | `queries.customerOrders(uid, 'active' or 'past', { jobsiteId })` (paged); `queries.customerQuotes(uid)` (paged); `queries.jobsites(uid)` for the chip | reorder: fills the cart from `queries.orderStoreOrders(orderId)` lines |
| `(shop)/orders/[id]` 🔒 | `queries.order(id)`; `queries.orderStoreOrders(id)`; `queries.tracking(summary.trackingToken)` per delivery store order that is out for delivery; `queries.storeOrderProof(storeOrderId)` once delivered; `queries.customerIssues(uid)`, filtered by `orderId` in the screen, to link a store order to its open case; the pickup PIN and hand-off code come from the order's summaries and the tracking document | `api.call('cancelOrder', { orderId, storeOrderIds })`; links to track, issue, review, support |
| `(shop)/orders/[id]/track/[storeOrderId]` 🔒 | `queries.order(id)` for the token; `queries.tracking(token)`; `AppMap` (§7.4) | share the link `{console origin}/track/{token}` (`config.trackingBaseUrl`) |
| `(shop)/issues/new` 🔒 | `queries.storeOrder(storeOrderId)` | per photo `api.upload({ purpose: 'issue_photo', ownerId: issueId, source })`; then `api.call('reportIssue', { issueId, photoPaths, … })` with `issueId = newRequestId()` created when the screen opens |
| `(shop)/issues/[id]` 🔒 | `queries.issue(id)`; photos through `useFileUrl` | none |
| `(shop)/quotes/new` 🔒 | `queries.jobsites(uid)` | per file `api.upload({ purpose: 'quote_upload', ownerId: requestId, source })`; then `api.call('submitMaterialList', { requestId, attachments, … })` |
| `(shop)/quotes/index` 🔒 | `queries.customerQuotes(uid)` (paged) | none |
| `(shop)/quotes/[id]` 🔒 | `queries.quote(id)` | `api.call('closeQuote')`, `api.call('reopenQuote')` |
| `(shop)/quotes/[id]/accept` 🔒 | `queries.quote(id)`; `queries.cards(uid)`; `queries.stores()` | `api.call('acceptQuote', { checkoutId, version, expectedTotalCents, … })` with `checkoutId = newRequestId()` created once per screen and kept in screen state across retries, as for `placeOrder` (a retry after a lost answer returns the same order, PLATFORM.md §9.2.10); `QUOTE_EXPIRED` and `QUOTE_VERSION` reload the quote |
| `(shop)/support` 🔒 | `queries.supportThread(uid)`; `queries.supportMessages(uid)` | `api.support.send(uid, { id: newRequestId(), text, context })`; `api.support.markRead(uid)` when the screen is focused |
| `(shop)/jobsites/index`, `jobsites/edit` 🔒 | `queries.jobsites(uid)` | `api.jobsites.save`, `remove`; `api.call('geocodeAddress')`; the pin editor is `AppMap` with `pick` (§7.2) |
| `(shop)/cards/index`, `cards/add` 🔒 | `queries.cards(uid)`; `useConfig().paymentsMode` for the test-mode banner | `api.cards.save`, `remove` |
| `(shop)/(tabs)/account` | the session profile | `api.session.updateProfile`; photo: `api.upload({ purpose: 'avatar', ownerId: uid, source })`, then `api.session.updateProfile({ photoPath: path })`; sign-out (§2.5) |
| `(shop)/notifications` 🔒 | `queries.notifications(uid)` | `api.notifications.markRead`, `markAllRead` |
| `(shop)/settings` 🔒 | `profile.preferences`; push state (§6.2) | `api.session.updateProfile({ preferences })` |
| `(shop)/suggest-store` | none | `api.call('suggestStore')` (works signed out) |
| `(shop)/help`, `about` | `useConfig()` (support phone, HST number) | none |

### 4.4 Supplier portal (MARKETPLACE §8)

`S` is `useAuth().storeId`.

| Route | Reads | Calls and writes |
| --- | --- | --- |
| header (every portal page) | `queries.store(S)` (name, `acceptingOrders`); `queries.notifications(uid)` | "Pause new orders": `api.call('updateStoreProfile', { storeId: S, patch: { acceptingOrders } })` |
| `/portal` Orders board | `queries.storeBoard(S)` (lanes New to Out for delivery, and Upcoming by `timing.readyByDate`); `queries.storeCompleted(S, start of today in Toronto)` for "Done today"; the full history list is `queries.storeHistory(S)` (paged). The new-order alert (chime, toast, tab title) fires when a `new` id appears that was not in the previous result, which the socket delivers within the 2 s target; while the socket is down the 10 s poll does | none on the board |
| `/portal/orders/:storeOrderId` | `queries.storeOrder(id)`; when `storeOrder.issueCount > 0`, `queries.storeIssues(S)` filtered by `storeOrderId` in the page | `acceptStoreOrder`, `updateStoreOrderStatus`, `rejectStoreOrder`, `completePickup`, each with `expectedVersion: storeOrder.version`. `VERSION_CONFLICT`: `api.cache.invalidate(['store-order', id])` and tell the user it changed. `CODE_INCORRECT`: show `detailsFor(e, 'CODE_INCORRECT').remaining`. `CODE_LOCKED`, `DRIVER_NOT_ASSIGNED`, `STORE_NOT_READY`: show the message |
| `/portal/catalog` | `queries.portalCatalog(S)`; `queries.categories()` | `api.products.create`, `update`, `adjustStock`, `remove`; photo: `api.upload({ purpose: 'product_photo', ownerId: S, source })`, then `update(productId, { imagePath: path })` |
| `/portal/store` | `queries.store(S)`; `queries.storeSettings(S)` (owner) | `api.call('updateStoreProfile')`; photo: `api.upload({ purpose: 'store_photo', ownerId: S, source })`, then `patch.photoPath` |
| `/portal/payouts` (owner) | balance from `queries.ledgerBalance('store', S)`; held entries `queries.ledger('store', S, { held: true })`; unpaid entries `queries.ledger('store', S, { unpaid: true })` (paged list, not summed); `queries.payouts('store', S)`; drill-down `queries.ledger('store', S, { payoutId })` | none |
| `/portal/insights` (owner) | `queries.storeCompleted(S, now minus 7 or 30 days)`; the figures are computed in the page | none |
| `/portal/team` (owner) | `queries.storeTeam(S)` | `inviteSupplierUser` (shows the returned `passwordSetupLink`), `setSupplierUserStatus` |
| `/portal/support` | `queries.supportThread('store_' + S)`; `queries.supportMessages('store_' + S)` | `api.support.send`, `api.support.markRead` |

### 4.5 Ops console (MARKETPLACE §9)

| Route | Reads | Calls and writes |
| --- | --- | --- |
| layout (sidebar, bell) | `queries.opsDashboard()` for badges; `queries.notifications(uid)` | `api.notifications.*` |
| `/` Dashboard | `queries.opsDashboard()`; "Needs attention" lists: `queries.opsStoreOrders({ acceptOverdue: true })`, `queries.opsStoreOrders({ status: ['failed'] })`, `queries.opsJobOffers()` filtered to open for more than 15 min, `queries.opsIssues({ status: 'open' })`, `queries.opsQuotes({ status: 'submitted' })`, `queries.opsOrders({ needsAttention: true })`; `queries.activity(25)` | none |
| `/live` | `queries.drivers()`; `queries.driverLocations()`; `queries.openDeliveries()`; `queries.route(selectedDriverId)` | `optimizeRoute` |
| `/orders` | `queries.opsOrders(filters)` and `queries.opsStoreOrders(filters)` (paged) | none |
| `/orders/:orderId` | `queries.order(id)`; `queries.orderStoreOrders(id)`; `queries.storeOrderPrivate(storeOrderId)`; `queries.opsIssues({ orderId: id })`; `queries.delivery(deliveryId)` for links | `acceptStoreOrder`, `updateStoreOrderStatus`, `rejectStoreOrder`, `completePickup` (with `overrideReason`), `resolveFailedDelivery` |
| `/stores` | `queries.opsStores()` | none |
| `/stores/new` | `queries.categories()` | `geocodeAddress`, `createStore`, then `inviteSupplierUser` |
| `/stores/:storeId` | `queries.store(id)`; `queries.storeSettings(id)`; `queries.storeTeam(id)`; `queries.portalCatalog(id)`; `queries.opsStoreOrders({ storeId })`; `queries.storeReviews(id)` | `updateStoreProfile`, `updateStoreSettings`, `inviteSupplierUser`, `setSupplierUserStatus`, `api.products.*`, `api.reviews.remove` |
| `/catalog` | `queries.opsCatalog(filters)`; `queries.categories()`; `queries.stores()` for the filter | `api.products.*`, `api.categories.*` |
| `/quotes` | `queries.opsQuotes({ status })` | `api.quotes.update` ("Assign to me") |
| `/quotes/:quoteId` | `queries.quote(id)`; `queries.quoteWorkspace(id)`; listing search per request line: `queries.productSearch({ q, storeId })`; `queries.stores()`; attachments through `useFileUrl`; totals from `priceCheckout` locally | `api.quotes.saveWorkspace` (autosave, debounced 2 s), `sendQuote` (`QUOTE_VERSION` reloads), `closeQuote` |
| `/issues` | `queries.opsIssues({ status })` | `api.issues.update` |
| `/issues/:issueId` | `queries.issue(id)`; `queries.issueNotes(id)`; `queries.storeOrder(issue.storeOrderId)`; `queries.delivery(issue.deliveryId)`; photos through `useFileUrl`; refund preview from `refundForLines` locally | `api.issues.saveNotes`, `resolveIssue` (`REFUND_LIMIT` explains the cap) |
| `/support`, `/support/:threadId` | `queries.supportThreads({ kind, status })`; `queries.supportThread(id)`; `queries.supportMessages(id)`; side panel: `queries.opsOrders({ customerId })`, `queries.opsIssues({ customerId })`, `queries.opsQuotes({ customerId })` | `api.support.send`, `markRead`, `update` |
| `/jobs` | `queries.opsJobOffers()`; `queries.labourerQueue()`; `queries.drivers()` and `queries.driverLocations()` for the assign dialog | `assignDelivery` (`VEHICLE_TOO_SMALL` offers `force`), `boostJobPayout` (P1), `api.deliveries.update(id, { unload })` |
| `/deliveries` | `queries.openDeliveries()`; `queries.deliveriesClosedSince(start of today)`; `queries.deliveriesCreatedSince(range)` | `createDeliveries`, `geocodeAddress` |
| `/deliveries/:id` | `queries.delivery(id)`; `queries.deliveryEvents(id)`; `queries.deliveryPrivate(id)`; `queries.route(delivery.driverId)`; `queries.driverLocations()`; proof photo through `useFileUrl` | `assignDelivery`, `updateDeliveryStatus`, `completeDelivery`, `api.deliveries.update` |
| `/drivers` | `queries.drivers()`; `queries.driverLocations()`; `queries.openDeliveries()` | none |
| `/drivers/:id` | `queries.user(id)`; `queries.driverDeliveries(id)`; `queries.deliveryStats(id, 0)`; `queries.route(id)`; `queries.ledger('driver', id, {})` | `setDriverStatus`, `reviewDriverVehicle`; payout account: `api.users.setPayoutAccount(id, …)` (test reference until Stripe Connect, MARKETPLACE §9); admins: `queries.userSessions(id)` and `api.users.revokeSessions(id)` |
| `/messages`, `/messages/:driverId` | `queries.chatThreads()`; `queries.chatThread(driverId)`; `queries.chatMessages(driverId)`; `queries.drivers()` | `api.chat.send`, `api.chat.markRead` |
| `/payouts` | `queries.opsPayouts(filters)`; drill-down `queries.ledger(payeeType, payeeId, { payoutId })`; `queries.opsJobs()` for the last run and the payees it skipped for a missing payout account (each links to `/drivers/:id`) | `runJobNow({ job: 'runDailyPayouts' })`, shown only when `config.allowTestJobs` |
| `/suggestions` | `queries.suggestions(status)` | `api.suggestions.setStatus` |
| `/team` (admin) | `queries.staff()`; `queries.userSessions(uid)` per member | `createStaffUser` (shows `passwordSetupLink`); `api.users.setStatus(uid, …)` to suspend or restore a member (never the last admin, never oneself); `api.users.revokeSessions(uid)` |
| `/outbox` | `queries.outbox()` | none |
| `/track/:token` (public) | `queries.tracking(token)`; `useConfig()` for map tiles | none |

### 4.6 Driver app (MARKETPLACE §10)

`uid` is `useDriver().user.uid`; the board key is `profile.cityId` and
`profile.vehicle.capacityClass`.

| Route | Reads | Calls and writes |
| --- | --- | --- |
| `(auth)/*`, `onboarding/*` | the session (§2.3) | `createAccount`, `completeProfile` (`registerDriver`), `requestPhoneCode`, `verifyPhoneCode` |
| `(tabs)/jobs` | `queries.jobBoard(cityId, capacityClass)`, only while `ready`; sorted in the app by ready time, then distance from `lastFix`; "Not for me" ids are kept in component state | none |
| `job/[id]` | `queries.jobOffer(id, cityId, capacityClass)`; null means "Someone else just took this job"; `AppMap` with the store pin and the approximate site circle (§7.4) | `api.call('claimJob', { deliveryId })`, then go to `/delivery/{id}`. `OFFER_TAKEN`, `VEHICLE_TOO_SMALL`, `TOO_MANY_JOBS`, `RELEASED_RECENTLY`, `DRIVER_OFFLINE`: show the message; `OFFER_TAKEN` also leaves the screen |
| `(tabs)/index` Today | `queries.driverActiveDeliveries(uid)`; `queries.route(uid)` (order and ETAs through `useOrderedStops`); `queries.deliveryStats(uid, start of today)` | `updateDeliveryStatus` (accept, decline with `declineReason`) |
| `delivery/[id]` | `queries.delivery(id)` (the PIN card and the "store confirmed" step update through `delivery:{id}`); `queries.deliveryEvents(id)` | `checkInAtStore`, `updateDeliveryStatus` (release with `declineReason`, start trip, arrived) |
| `delivery/[id]/complete` | `queries.delivery(id)` | `uploadProofPhoto` (`api.upload`, purpose `proof`), then `completeDelivery({ deliveryId, photoPath, handoffCode, recipientName, note, location })`. `PHOTO_REQUIRED` reopens the camera; `CODE_INCORRECT` shows the remaining attempts |
| `delivery/[id]/fail` | `queries.delivery(id)` | `updateDeliveryStatus({ status: 'failed', failureReason, note, location })` |
| `(tabs)/route` | `queries.route(uid)`; `queries.driverActiveDeliveries(uid)`; `AppMap` (§7.4) | `optimizeRoute({ origin: lastFix })` |
| `(tabs)/earnings` | unpaid balance from `queries.ledgerBalance('driver', uid)`; `queries.ledger('driver', uid, { unpaid: true })` (paged); `queries.ledger('driver', uid, {})` (paged); `queries.payouts('driver', uid)` | none |
| `(tabs)/chat` | `queries.chatThread(uid)`; `queries.chatMessages(uid)` | `api.chat.send`, `api.chat.markRead` |
| `profile` | the session profile (`driverStats`, vehicle, city) | `api.session.updateProfile({ preferences })`, `sendTestNotification`, sign-out (§2.5) |
| `vehicle` | `profile.vehicle`, `profile.vehicleDraft`, `profile.vehicleReviewRequired` | `updateDriverVehicle` |
| `history` | `queries.driverHistory(uid)` (paged) | none |
| `notifications` | `queries.notifications(uid)` | `api.notifications.*` |

`(app)/_layout.tsx` keeps choosing the tracking mode from `queries.driverActiveDeliveries(uid)`:
`live` when any delivery is `accepted`, `picked_up`, `in_transit` or `arrived` (MARKETPLACE §10:
"the live profile is used from `accepted` onwards"), else `normal`.

---

## 5. Driver location

Today the driver app writes `driverLocations/{uid}` straight into Firestore from a foreground
watcher and from a background task, with a throttle in `features/location/publisher.ts`. The same
structure stays; the write becomes an HTTP request with our own token, and the pure logic (throttle,
queue, batching, back-off) moves into the package so it can be tested.

### 5.1 Parts

| Part | File | Job |
| --- | --- | --- |
| `LocationPublisher` | `packages/api-client/src/driver/location-publisher.ts` | decides which fixes to send, queues them, sends batches, backs off, stops when the session ends |
| publisher instance | `app/driver/src/features/location/publisher.ts` | `export const publisher = new LocationPublisher(api, { battery: batteryLevel })`; `toFix`; re-exports `TRACKING_PROFILES`, `Fix`, `TrackingMode` |
| background task | `app/driver/src/features/location/background-task.native.ts` (web stub `background-task.ts` unchanged) | receives OS location batches with no UI running and hands them to the publisher |
| `PresenceProvider` | `app/driver/src/features/location/PresenceProvider.tsx` | online switch, permissions, foreground watcher, starts and stops the background task, shows the last fix |

### 5.2 The request

`api.location.publish(report)` is `POST /me/location` (assumption B17):

```ts
export interface Fix {
  lat: number;
  lng: number;
  /** Degrees clockwise from north; null when unknown. */
  heading: number | null;
  /** Metres per second; null when unknown. */
  speed: number | null;
  /** Horizontal accuracy in metres; null when unknown. */
  accuracy: number | null;
  /** When the device took the fix, epoch ms. */
  at: number;
}
export type TrackingMode = 'normal' | 'live';

export interface LocationReport {
  online: boolean;
  mode: TrackingMode;
  /** 0 to 1, or null. Read at most every 5 minutes (expo-battery), as today. */
  battery: number | null;
  /** Oldest first, 1 to 20. May be empty only when `online` is false and no fix was ever taken. */
  fixes: Fix[];
}
export interface LocationAck {
  /** False when the server will not treat this driver as online (not approved, suspended). */
  online: boolean;
  serverTime: number;
}
```

The server keeps the newest fix as the driver's `DriverLocation` (its `updatedAt` is server time),
fans it out on `driver-locations`, and refreshes the tracking documents of that driver's deliveries.
It answers `permission-denied` to anyone who is not an active driver and `resource-exhausted`
(`RATE_LIMITED`, with `details.retryAfterMs`) to more than one report every 2 seconds.

### 5.3 Profiles, throttling and the heartbeat

```ts
export interface TrackingProfile {
  /** expo-location accuracy for the watcher and the task. */
  accuracy: 'balanced' | 'navigation';
  /** Android `timeInterval` for the watcher and the task, ms. */
  watchIntervalMs: number;
  /** `deferredUpdatesInterval` of the background task: how long the OS batches fixes, ms. */
  deferIntervalMs: number;
  /** A moving fix is accepted when at least this much time and distance passed since the last accepted one. */
  minIntervalMs: number;
  minDistanceM: number;
  /** Without movement, one fix is accepted this often, so the driver stays "online" on every screen. */
  heartbeatMs: number;
}
export const TRACKING_PROFILES: Record<TrackingMode, TrackingProfile>;
```

| | `normal` | `live` |
| --- | --- | --- |
| Used when | online and no delivery in `accepted`, `picked_up`, `in_transit`, `arrived` | at least one such delivery |
| `accuracy` | `balanced` (`Location.Accuracy.Balanced`: cell and Wi-Fi, low power while waiting for jobs) | `navigation` (`Location.Accuracy.BestForNavigation`) |
| `watchIntervalMs` | 15 000 | 4 000 |
| `distanceInterval` passed to expo-location | **0** | **0** |
| `deferIntervalMs` | 30 000 | 8 000 |
| `minIntervalMs` / `minDistanceM` | 10 000 / 25 | 4 000 / 8 |
| `heartbeatMs` | 60 000 | 20 000 |
| Most requests | one per 10 s | one per 4 s |

`minIntervalMs`, `minDistanceM` and `heartbeatMs` are today's numbers. Two things change, both for
the heartbeat:

- **`distanceInterval` is 0.** Today's `distanceInterval` of 20 to 30 m means Android delivers
  nothing while the truck stands still (V7), so a driver waiting at a store or at home drops to
  "stale" after 2 minutes (`LOCATION_STALE_MS`) and is marked offline after 10
  (`markStaleDriversOffline`), stops receiving job offers and fails `claimJob` with `DRIVER_OFFLINE`.
  With 0, fixes keep arriving at `watchIntervalMs`; the publisher drops all of them except one per
  `heartbeatMs`. No JavaScript timer is involved, so it works in the background task as well.
- **`normal` uses balanced accuracy**, so that waiting online for hours does not keep the GPS chip
  on. `live` keeps full accuracy.

On iOS `timeInterval` is ignored and updates with no movement are not guaranteed at balanced
accuracy; the return-to-foreground fix (§5.4) covers that case. iOS builds are not part of this
release.

**Publisher rules**, in order, for each incoming fix:

1. Ignore a fix whose `accuracy` is worse than 150 m, unless a heartbeat is due.
2. Accept it when `force` is set, or it is the first, or the `online` flag changed, or
   (`elapsed ≥ minIntervalMs` and `moved ≥ minDistanceM`), or `elapsed ≥ heartbeatMs`, measured
   against the last accepted fix. Otherwise drop it.
3. Accepted fixes join a queue of at most **20**. When it is full the oldest leaves. A fix older than
   5 minutes is removed as soon as a newer one is queued: an old position is of no use on a map.
4. Flush when no report is in flight and the last one was sent at least `minIntervalMs` ago (or
   `force`): one `POST /me/location` with every queued fix.

Outcome of a flush:

| Answer | Publisher |
| --- | --- |
| 200 | remove the sent fixes; when `ack.online` is false, stop with reason `'forbidden'` |
| no answer, timeout (10 s), 5xx | keep the queue. Next flush not before 5 s, then 10, 20, 40, at most 60 s |
| `resource-exhausted` | keep the queue; wait `details.retryAfterMs` (default 10 000) |
| `invalid-argument` | drop the batch (one bad fix must not block the queue) and log it |
| `unauthenticated` after the client's own refresh attempt (the session ended) | stop with reason `'session'`, clear the queue |
| `permission-denied` | stop with reason `'forbidden'`, clear the queue |

```ts
export type PublishOutcome = 'sent' | 'queued' | 'skipped' | 'stopped';
export interface PublisherState {
  lastAccepted: Fix | null;
  lastSentAt: number | null;
  queued: number;
  stopped: 'session' | 'forbidden' | null;
  lastError: ApiError | null;
}
export class LocationPublisher {
  constructor(client: ApiClient, options?: { battery?: () => Promise<number | null>; maxQueue?: number; maxFixAgeMs?: number });
  /** Foreground watcher and background task both call this. Never throws. */
  ingest(fixes: readonly Fix[], options: { mode: TrackingMode; force?: boolean }): Promise<PublishOutcome>;
  /** Sends at once, outside the throttle: going online (with the first fix) and going offline (with the last one). The server exempts a change of `online` from its 2-second limit; on `resource-exhausted` it retries once after `details.retryAfterMs`. Rejects when the request still fails, so the switch can show the error. */
  setOnline(online: boolean, fix: Fix | null, mode: TrackingMode): Promise<LocationAck>;
  getState(): PublisherState;
  subscribe(listener: (state: PublisherState) => void): () => void;
  /** Forget the last accepted fix and the queue (after going offline, after sign-out). */
  reset(): void;
}
```

### 5.4 Foreground (`PresenceProvider`)

The provider keeps its interface (`online`, `busy`, `permission`, `backgroundEnabled`, `lastFix`,
`error`, `setOnline`, `currentPosition`). Changes:

| Today | New |
| --- | --- |
| `publishFix(uid, fix, …)` writes Firestore | `publisher.ingest([fix], { mode })`; `lastFix` and `error` come from `publisher.subscribe` |
| a foreground watcher always runs, and the background task too when permitted | `startBackgroundUpdates(mode)` first. When it returns true the task is the only source, because expo-location hands fixes to the task immediately while the app is in the foreground (V7). When it returns false (Expo Go, web, permission refused) `Location.watchPositionAsync({ accuracy, timeInterval: watchIntervalMs, distanceInterval: 0 }, …)` is the source |
| going online publishes the first fix | `publisher.setOnline(true, firstFix, mode)`; a `permission-denied` answer shows "Your account can't go online yet." |
| going offline publishes `online: false` | `stopBackgroundUpdates()`, then `publisher.setOnline(false, lastFix, mode)`, then `publisher.reset()` |
| heartbeat on return to the foreground | unchanged: on `AppState` `active`, one `getCurrentPositionAsync` and `publisher.ingest([fix], { mode, force: true })` |
| `instasupply.online` restores the switch at start | unchanged, but only when the session is `ready`; a publisher state `stopped` turns the switch off and removes the key |
| mode change (`normal` to `live`) | store `instasupply.trackingMode`; apply it only while `AppState` is `active` (expo-location throws `ForegroundServiceStartNotAllowedException` when `startLocationUpdatesAsync` with a foreground service is called in the background, `LocationModule.kt` line 330); a change seen in the background is applied at the next `active`. Apply by calling `startLocationUpdatesAsync` again with the new options, which re-registers the running task; never call `stopLocationUpdatesAsync` first. The watcher fallback is restarted the same way |

### 5.5 Background task

```ts
// app/driver/src/features/location/background-task.native.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { api } from '@/lib/api';

import { publisher, toFix, TRACKING_PROFILES, type TrackingMode } from './publisher';

export const LOCATION_TASK = 'instasupply-background-location';
const MODE_KEY = 'instasupply.trackingMode';

// Global scope: TaskManager requires it, and `_layout.tsx` imports this file first (V8).
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  // No UI may be running. This reads the stored session once per runtime and opens no socket.
  const session = await api.session.whenRestored();
  if (session.status !== 'signed_in') return stopBackgroundUpdates();
  const mode = ((await AsyncStorage.getItem(MODE_KEY)) as TrackingMode | null) ?? 'normal';
  const outcome = await publisher.ingest(data.locations.map(toFix), { mode });
  if (outcome === 'stopped') await stopBackgroundUpdates();
});

export async function startBackgroundUpdates(mode: TrackingMode): Promise<boolean> {
  try {
    if (!(await TaskManager.isAvailableAsync())) return false;
    if (!(await Location.getBackgroundPermissionsAsync()).granted) return false;
    const profile = TRACKING_PROFILES[mode];
    await AsyncStorage.setItem(MODE_KEY, mode);
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: profile.accuracy === 'navigation' ? Location.Accuracy.BestForNavigation : Location.Accuracy.Balanced,
      timeInterval: profile.watchIntervalMs,
      distanceInterval: 0,
      deferredUpdatesInterval: profile.deferIntervalMs,
      deferredUpdatesDistance: 0,
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.AutomotiveNavigation,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'InstaSupply is sharing your location',
        notificationBody: 'Dispatch, stores and your customers can see where you are while you are online.',
        notificationColor: '#4F46E5',
        killServiceOnDestroy: false,
      },
    });
    return true;
  } catch {
    return false; // Expo Go, or a build without the location plugin options.
  }
}
```

`stopBackgroundUpdates()` and `requestBackgroundPermission()` stay as they are today.

How the points of the brief are met:

| Point | Where |
| --- | --- |
| HTTP with stored tokens | `publisher` calls `api.location.publish`; the request pipeline adds the bearer (§1.4) |
| token refresh inside the task | the pipeline awaits `session.accessToken()`: when the access token is missing (fresh runtime) or old, the single-flight refresh runs with the refresh token from SecureStore, readable while locked (`AFTER_FIRST_UNLOCK`, V2). The app and the task normally share one JavaScript runtime and one client, and then they share that one refresh; should the OS run the task in a runtime of its own, rules 5 and 7 of §1.5 keep the rotation consistent. Rule 7 also covers a lost answer |
| batching | in the background the OS delivers one batch per `deferIntervalMs` (V7); the publisher sends one request per batch with up to 20 fixes |
| throttling | rules 1 and 2 of §5.3, plus the minimum gap between requests |
| offline queue limits | 20 fixes, none older than 5 minutes behind a newer one, back-off up to 60 s; nothing is written to disk |
| heartbeat while stationary | `distanceInterval: 0` plus the heartbeat rule |
| the session ends while the task runs | outcome `'stopped'`: the task stops the OS updates, so no foreground-service notification is left behind |
| the user swipes the app away | Android stops background location when the app is terminated (V7). The driver goes stale after 2 minutes and offline after 10 on the server; reopening the app restores the switch from `instasupply.online` |

`app.config.ts` keeps the `expo-location` plugin options that enable all of this
(`isAndroidBackgroundLocationEnabled`, `isAndroidForegroundServiceEnabled`,
`isIosBackgroundLocationEnabled`). The permission texts change to mention stores as well.

### 5.6 Tests (`location-publisher.test.ts`)

With the fake clock and fake server: first fix accepted; jitter under 25 m and under 10 s dropped;
heartbeat accepted after 60 s without movement (20 s in `live`); a fix with accuracy 400 m dropped
unless the heartbeat is due; 30 fixes while offline leave 20 queued and one request when the network
returns; back-off sequence 5, 10, 20, 40, 60 s; `RATE_LIMITED` waits `retryAfterMs`; a revoked
session gives `'stopped'` with reason `'session'`; `permission-denied` gives `'forbidden'`; a lost
refresh answer does not end the session; `setOnline(false)` sends even inside the throttle window.

### 5.7 Reading live positions

| Reader | Data | Notes |
| --- | --- | --- |
| Console live map, drivers list, assign dialog, delivery page | `useLiveQuery(queries.driverLocations())`: one `GET /driver-locations`, then payload events on `driver-locations` folded in by `id` | `presenceOf(location, now)` (in `frontend/src/lib/data.ts`) is unchanged: `online` false is offline, older than `LOCATION_STALE_MS` is stale. Markers glide with `AnimatedMarker`. With the socket down the list is polled every 10 s |
| Customer tracking screen, Home mini map, public `/track/:token` | `useLiveQuery(queries.tracking(token))`: `GET /tracking/{token}`, then the whole `PublicTracking` on `tracking:{token}` | the driver's position, heading, `phase`, `etaSeconds` and `distanceMeters` are computed by the server; the client never reads `driver-locations`. A position older than 3 minutes shows "Updated 4 min ago" instead of "Live", as `LiveTracking.tsx` does today. With the socket down: poll every 5 s |
| Supplier portal ("Marco is heading to you") | the `driver` projection inside `StoreOrder`, through `queries.storeBoard` and `queries.storeOrder` | no position, by design (MARKETPLACE §1.4) |
| Driver app | `publisher.getState().lastAccepted` | its own position never comes from the server |

---

## 6. Push notifications

### 6.1 Transport and availability

Push goes through the Expo push service only (decision P11). The apps register an **Expo push
token**; our server posts to `https://exp.host/--/api/v2/push/send` and holds no Firebase
credentials. On Android the Expo service delivers through FCM, so two things outside our code are
needed for push to exist at all, per app (V4, V5):

| Requirement | What it is | Without it |
| --- | --- | --- |
| an Expo project and its id | `EAS_PROJECT_ID`, read by `app.config.ts` into `extra.eas.projectId` | `getExpoPushTokenAsync` throws `ERR_NOTIFICATIONS_NO_EXPERIENCE_ID` |
| `google-services.json` in the Android build, and the FCM V1 service-account key uploaded to that Expo project | `GOOGLE_SERVICES_JSON` (a path) read by `app.config.ts` into `android.googleServicesFile`. It comes from a Firebase project that is used for nothing but FCM transport; the file holds public identifiers, the service-account key never enters the repository | the token request rejects with `E_REGISTRATION_FAILED`; the build still runs |

An APK built without them is valid and must behave: it has the in-app inbox, live banners and
badges, and no system notifications. Whether a build can push is decided once, without calling any
push API (some of them throw, V3):

```ts
// app/<app>/src/features/notifications/push-availability.ts
import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export type PushAvailability =
  | { available: true }
  | { available: false; reason: 'web' | 'expo_go' | 'not_configured' };

export function pushAvailability(): PushAvailability {
  if (Platform.OS === 'web') return { available: false, reason: 'web' };
  if (isRunningInExpoGo()) return { available: false, reason: 'expo_go' };
  const push = Constants.expoConfig?.extra?.push as { android?: boolean; ios?: boolean } | undefined;
  const configured = Platform.OS === 'android' ? push?.android === true : push?.ios === true;
  return configured ? { available: true } : { available: false, reason: 'not_configured' };
}
```

`app.config.ts` writes the flags, because only it knows them: the config embedded in a build is the
public one, which leaves out native-only fields (the reason today's `extra.googleMapsEnabled` flag
exists), so the app does not go looking for `googleServicesFile` there:

```ts
extra: {
  eas: easProjectId ? { projectId: easProjectId } : undefined,
  variant,
  push: { android: Boolean(easProjectId && googleServicesFile), ios: Boolean(easProjectId) },
},
```

Every call to `getExpoPushTokenAsync`, `addPushTokenListener` and `getDevicePushTokenAsync` sits
behind `pushAvailability().available`, and the token request is in a `try / catch` as well (a
wrong `google-services.json` still rejects at run time). The FCM fallback
(`getDevicePushTokenAsync`, provider `'fcm'`) is deleted from both apps: the server cannot send to
raw FCM tokens.

### 6.2 Permission flow

| App | When the system prompt is shown |
| --- | --- |
| Driver | on entering the approved area (`(app)/_layout.tsx`), as today: job offers and dispatch messages are the product |
| Customer | never at start. (1) On `order-success`, a card "Get delivery updates" with an Allow button; (2) in Settings, the existing `PushPermissionNote`. If permission is already granted the device registers silently on every start |

```ts
// app/<app>/src/features/notifications/push.ts
export type PushRegistration =
  | { status: 'registered' }
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'unavailable'; reason: 'web' | 'expo_go' | 'not_configured' | 'token_failed' };

/** `prompt: false` registers only when permission was granted earlier. */
export async function registerForPush(options: { prompt: boolean }): Promise<PushRegistration>;
/** Turns pushes to this device off without signing out (a "pause notifications" switch). Sign-out does not need it (§2.5). */
export async function unregisterDevice(): Promise<void>;
```

Steps of `registerForPush`:

1. `pushAvailability()`; stop with `unavailable` when it says so.
2. Android: create the channels of §6.6 first. On Android 13 and later the system prompt cannot
   appear before a channel exists (V6).
3. `Notifications.getPermissionsAsync()`. Not granted and `prompt` and `canAskAgain`:
   `requestPermissionsAsync()`. Still not granted: `denied`.
4. `Notifications.getExpoPushTokenAsync({ projectId: easProjectId })` inside `try / catch`. It needs
   the network (it calls Expo's servers) and can be slow on iOS; a failure is
   `unavailable: 'token_failed'` and the next app start tries again.
5. `api.devices.register(…)` (§6.3). A network failure is retried at the next start; any other error (`invalid-argument` above all, which means the body and the server disagree) is reported through `onDebug` and the client's error log, never silently swallowed.

`usePushPermission` (customer) keeps its statuses; `unsupported` is now
`!pushAvailability().available`, and its `enable()` calls `registerForPush({ prompt: true })`.

### 6.3 Token upload and removal

```ts
// api.devices.register  →  PUT /me/devices/{installationId}   (PLATFORM.md §5.4 `DeviceInput`, a strict schema)
interface DeviceInput {
  token: string;               // "ExponentPushToken[…]"
  provider: 'expo';
  platform: 'ios' | 'android';
  appVersion: string | null;
  deviceName: string | null;   // Device.deviceName ?? Device.modelName
}
// No `app` field: the server takes the app from the device session (`sessions.app`).
```

| Event | Client | Server (assumption B9) |
| --- | --- | --- |
| session becomes `ready`, permission granted | `registerForPush({ prompt: false })` | upserts the device under the caller and this installation, refreshes `lastSeenAt`, and deletes the same token from every other account |
| the platform rotates the token (`addPushTokenListener`, guarded by §6.1) | `registerForPush({ prompt: false })` again | as above |
| sign-out | nothing extra: `POST /auth/logout` | deletes the session and its device |
| session revoked, account suspended | nothing possible | deletes the session and its device |
| the user turns notifications off in the app | `unregisterDevice()`: `DELETE /me/devices/{installationId}` | deletes the device |
| the Expo service reports `DeviceNotRegistered` (app uninstalled) | nothing | deletes the device when it reads the ticket or the receipt (V21) |

Push preferences (`orderPush`, `promoPush`, `chatPush`, `jobPush`) are profile fields changed with
`api.session.updateProfile({ preferences })`; the server applies them when it sends
(MARKETPLACE §5.8). They are not device settings.

### 6.4 Taps and deep links

One listener set per app, mounted while the session is `ready` (customer:
`features/notifications/usePushListeners.ts`; driver: the same file, split out of
`NotificationsBridge.tsx`). The customer app's logic is the model and the driver app adopts it:

1. `Notifications.setNotificationHandler` at module scope: `shouldShowBanner: false` (the in-app
   banner covers the foreground), `shouldShowList: true`, `shouldPlaySound: true`,
   `shouldSetBadge: false`. Safe in Expo Go.
2. On mount read `Notifications.getLastNotificationResponse()` (synchronous; the driver app's
   `getLastNotificationResponseAsync` is deprecated, V6) for the tap that launched the app, and
   subscribe to `addNotificationResponseReceivedListener`.
3. For each response: build the key `{request.identifier}/{data.notificationId}`; skip it when the
   key was handled in this process; then `clearLastNotificationResponse()`.
4. **Wrong account guard:** when `data.userId` is a string other than the current uid, do nothing.
5. `api.notifications.markRead(data.notificationId)`, ignoring failures.
6. `router.push(notificationHref(data))`.

Every push carries string values only: the keys of MARKETPLACE §5.8 (`customerOrderId`,
`storeOrderId`, `deliveryId`, `quoteId`, `issueId`, `threadId`, `payoutId`), `driverId` on the admin
notifications `driver_signup` and `vehicle_review` (PLATFORM.md §10.2), plus `notificationId`,
`type` and `userId`, which the sender adds (as `legacy/…/notifications/push.ts` does). The same
function serves taps on system notifications, on in-app banners and on inbox rows (for inbox rows
the item's own `type` is merged into `data` first). First match wins:

| App | Condition on `data` | Route |
| --- | --- | --- |
| Customer | `issueId` | `/issues/{issueId}` |
| Customer | `quoteId` | `/quotes/{quoteId}` |
| Customer | `threadId` | `/support` |
| Customer | `customerOrderId` and `storeOrderId` and `deliveryId` (a delivery in progress: on the way, arrived) | `/orders/{customerOrderId}/track/{storeOrderId}` |
| Customer | `customerOrderId` | `/orders/{customerOrderId}` |
| Customer | otherwise | `/notifications` |
| Driver | `threadId` | `/chat` |
| Driver | `type === 'job_offer'` and `deliveryId` | `/job/{deliveryId}` |
| Driver | `payoutId` | `/earnings` |
| Driver | `type === 'vehicle_review'` | `/vehicle` |
| Driver | `deliveryId` and `type` not `delivery_unassigned`, `delivery_cancelled` | `/delivery/{deliveryId}` |
| Driver | otherwise | `/notifications` |
| Console, staff | `type === 'chat_message'` and `threadId` | `/messages/{threadId}` |
| Console, staff | `type` starts with `support_` and `threadId` | `/support/{threadId}` |
| Console, staff | `quoteId` | `/quotes/{quoteId}` |
| Console, staff | `issueId` | `/issues/{issueId}` |
| Console, staff | `customerOrderId` | `/orders/{customerOrderId}` |
| Console, staff | `deliveryId` | `/deliveries/{deliveryId}` |
| Console, staff | `driverId` | `/drivers/{driverId}` |
| Console, staff | `payoutId` | `/payouts` |
| Console, staff | `type === 'store_suggestion'` | `/suggestions` |
| Console, supplier | `storeOrderId` | `/portal/orders/{storeOrderId}` |
| Console, supplier | `threadId` | `/portal/support` |
| Console, supplier | `payoutId` | `/portal/payouts` |
| Console | otherwise | no navigation |

The console has no system push in P0 (web push for the portal is P1 in MARKETPLACE §14.6); its
rows apply to the bell, the toasts and the desktop `Notification` of `useNotificationAlerts`.

### 6.5 In-app banner for new notifications

`NotificationsBridge` no longer runs its own listener on the newest five documents. It uses the
inbox the app already loads:

- `const inbox = useLiveQuery(queries.notifications(uid))`. A new notification arrives as a
  payload event on `user:{uid}:notifications` and is prepended at once; with the socket down the
  30 s poll finds it.
- The bridge keeps the "seen ids" set: the first loaded result only fills the set; afterwards each
  unread id that was not seen raises one toast (haptic on native) whose press marks it read and
  routes with `notificationHref`. This is today's logic with the source swapped, and the console's
  `useNotificationAlerts` already works this way.
- The unread badge is `inbox.data.filter((item) => !item.read).length`.

### 6.6 Android channels

Created by `ensureChannels()` in each app's `push.ts` before any permission request. Ids must equal
what the server sends as `channelId` (`channelFor`, MARKETPLACE §5.8). Importance is fixed at
creation (V6): these values are final, and a different importance later needs a new id.

| App | Channel id | Name | Importance | Carries |
| --- | --- | --- | --- | --- |
| Customer | `orders` (manifest default) | Order updates | `HIGH` | `order_*`, `order_store_update`, `pickup_ready`, `refund_issued`, `quote_update`, `issue_update` |
| Customer | `chat` (new) | Support messages | `HIGH` | `support_reply` |
| Customer | `updates` (new) | Account updates | `DEFAULT` | everything else (`account_*`, `test`, `system`) |
| Customer | `promotions` | Offers | `DEFAULT` | marketing, only with `promoPush` |
| Driver | `jobs` (new) | New jobs | `MAX`, vibration `[0, 250, 150, 250]` | `job_offer`, `job_update` |
| Driver | `assignments` (manifest default) | Assignments | `MAX`, vibration `[0, 250, 150, 250]` | `delivery_assigned`, `delivery_unassigned`, `delivery_cancelled` |
| Driver | `chat` | Messages from dispatch | `HIGH` | `chat_message` |
| Driver | `updates` | Updates | `DEFAULT` | `payout_sent`, `vehicle_review`, `account_*`, the rest |

The `expo-notifications` plugin entry keeps `defaultChannel` (`orders`, `assignments`), `color` and
`icon`. The supplier channel `store` has no device in P0.

### 6.7 When push is unavailable

| Situation | `pushAvailability()` | Behaviour |
| --- | --- | --- |
| Android APK without `google-services.json` or without `EAS_PROJECT_ID` | `not_configured` | no push API is called, nothing can throw. Inbox, banner and badge work through the socket or polling. Settings shows "Push alerts aren't set up in this build. Updates appear in your inbox." |
| Expo Go (Android or iOS) | `expo_go` | the same. Local notifications are not used |
| Web (Expo web, console) | `web` | the same; `push.web.ts` and `usePushListeners.web.ts` keep `expo-notifications` out of the web bundle (the driver app gains these two files) |
| configured build, permission refused | available, `denied` | Settings shows `PushPermissionNote` (`ask` or `blocked`, which opens the system settings) |
| configured build, token request fails (offline at first start, bad credentials) | available, `token_failed` | retried at the next start and when the token listener fires |
| the app was force-stopped by the user on Android | | the OS delivers nothing until the app is opened again (Expo documentation); the inbox catches up on open |

`sendTestNotification` (driver profile) reports `devices: 0` in every unavailable case and the
existing message already explains it ("…it appears in your inbox").

---

## 7. Maps

### 7.1 Decision

Every map is Leaflet with raster tiles whose URL comes from `GET /config` (OpenStreetMap by
default), so no client holds a map API key (decision P14).

| Client | Implementation |
| --- | --- |
| Expo apps, Android and iOS | `AppMap` renders `LeafletCanvas`, an Expo DOM component (`'use dom'`): the react-leaflet code runs inside a WebView. Engine: **`react-native-webview`**, selected with `dom={{ useExpoDOMWebView: false }}` (V9) |
| Expo apps, web | the same `LeafletCanvas` file, rendered directly as DOM (no WebView, no iframe) |
| Console | `react-leaflet` through the existing `components/map/BaseMap.tsx` |

Why a DOM component and not a hand-written HTML page: one react-leaflet implementation serves native
and web, props are typed, and in a release build the component with Leaflet's script and stylesheet
is embedded in the APK (`file:///android_asset/www.bundle`, V9), so nothing is fetched from a CDN.
Why `react-native-webview` and not the default `@expo/dom-webview`: only it can append our app name
to the User-Agent (V10), which the OpenStreetMap tile policy asks of apps (V11); a page loaded from
`file://` sends no Referer.

This path was specified from the SDK 58 documentation and source; no build was run for this
document. The `AppMap` contract of §7.2 is what screens depend on, and it survives both fallbacks:
(1) switch the engine back to `@expo/dom-webview` by deleting two lines (§7.6); (2) replace
`LeafletCanvas` on native by an HTML page loaded into `react-native-webview` with the same props
sent through `postMessage`.

`react-native-maps` is removed from both apps, with the Google Maps key handling
(`GOOGLE_MAPS_ANDROID_API_KEY`, `extra.googleMapsEnabled`, `hasGoogleMapsKey`). MARKETPLACE §7.3
still says "react-native-maps; Leaflet `.web.tsx`" for the stores map; decision P14 replaces that.

### 7.2 The `AppMap` contract (both Expo apps)

Files, identical in `app/customer/src/components/map/` and `app/driver/src/components/map/`:

| File | Content |
| --- | --- |
| `map-types.ts` | the types below |
| `AppMap.tsx` | the only component screens import: frame, loading skeleton, offline note, accessibility, fallback card |
| `LeafletCanvas.tsx` | `'use dom'`; the only file that imports `leaflet`, `react-leaflet` and `leaflet/dist/leaflet.css` |
| `map-icons.ts` | HTML for the marker kinds (Leaflet `divIcon`), used only by `LeafletCanvas` |

```ts
// map-types.ts
import type { LatLng } from '@instasupply/shared';
import type { StyleProp, ViewStyle } from 'react-native';

export type MapTone = 'brand' | 'neutral' | 'success' | 'warning' | 'danger';

export interface MapMarker {
  id: string;
  position: LatLng;
  /** store: storefront glyph. site: house glyph. driver: arrow rotated by `heading`, pulsing. stop: numbered circle. pin: the draggable teardrop. */
  kind: 'store' | 'site' | 'driver' | 'stop' | 'pin';
  /** At most 3 characters inside the marker (stop number, initials). */
  label?: string;
  /** Tooltip on the web; spoken label. */
  title?: string;
  tone?: MapTone;
  /** Degrees clockwise from north; rounded to 5° before drawing. */
  heading?: number | null;
  highlighted?: boolean;
  /** Glide to a new position over 1.2 s instead of jumping (jumps anyway beyond 5 km). */
  glide?: boolean;
  zIndex?: number;
}

export interface MapPolyline {
  id: string;
  points: LatLng[];
  tone?: MapTone;
  dashed?: boolean;
  /** Pixels, default 4. */
  weight?: number;
}

export interface MapCircle {
  id: string;
  center: LatLng;
  radiusM: number;
  tone?: MapTone;
}

/** The camera fits these points when `key` changes, and only then, so live updates never fight the user's panning. */
export interface MapFit {
  key: string;
  points: LatLng[];
  /** Pixels, default 48. */
  padding?: number;
  /** Default 16. One point is shown at min(maxZoom, 15). */
  maxZoom?: number;
}

/** A pin the user places. Controlled: the parent holds `position` and updates it in `onPick`. */
export interface MapPick {
  position: LatLng | null;
  /** Default true: dragging the pin reports its new position. */
  draggable?: boolean;
  /** Default true: tapping the map moves the pin there. */
  tapToPlace?: boolean;
}

export interface AppMapProps {
  markers?: MapMarker[];
  polylines?: MapPolyline[];
  circles?: MapCircle[];
  fit?: MapFit | null;
  /** Used until the first fit. Default: Toronto, 43.6532, -79.3832, zoom 11. */
  initialCenter?: LatLng;
  initialZoom?: number;
  /** False (default): no gestures, touches pass to the page so it keeps scrolling. True: pan, pinch and zoom buttons. */
  interactive?: boolean;
  pick?: MapPick;
  onPick?: (point: LatLng) => void;
  onMarkerPress?: (id: string) => void;
  /** Give the map a height or flex; it fills its frame. */
  style?: StyleProp<ViewStyle>;
  /** The map is a picture to a screen reader: say what it shows. */
  accessibilityLabel: string;
}
```

`LeafletCanvas` receives the same data plus what `AppMap` adds. All of it is JSON (V9); callbacks
are top-level asynchronous functions:

```ts
// LeafletCanvas.tsx  ('use dom')
export interface LeafletCanvasProps {
  tiles: { tileUrl: string; attribution: string; maxZoom: number };   // useConfig()?.map ?? DEFAULT_MAP_TILES
  /** Hex colours from the app's theme tokens, by tone, plus surface and text. */
  palette: Record<MapTone, string> & { surface: string; text: string };
  markers: MapMarker[];
  polylines: MapPolyline[];
  circles: MapCircle[];
  fit: MapFit | null;
  initialCenter: LatLng;
  initialZoom: number;
  interactive: boolean;
  pick: MapPick | null;
  online: boolean;
  onPick: (point: LatLng) => Promise<void>;
  onMarkerPress: (id: string) => Promise<void>;
  onReady: () => Promise<void>;
  onTiles: (state: 'ok' | 'failing') => Promise<void>;
  dom?: import('expo/dom').DOMProps;
}
```

`AppMap` passes `dom` like this (every prop is a documented `react-native-webview` prop, V10):

```ts
dom={{
  useExpoDOMWebView: false,
  applicationNameForUserAgent: `InstaSupplyCustomer/${appVersion}`,   // `InstaSupplyDriver/…` in the driver app
  style: { flex: 1 },
  containerStyle: { flex: 1 },
  scrollEnabled: false,            // iOS: the page inside never scrolls
  nestedScrollEnabled: true,       // Android: gestures inside a ScrollView reach the map
  overScrollMode: 'never',
  setBuiltInZoomControls: false,
}}
```

### 7.3 Behaviour

| Topic | Rule |
| --- | --- |
| Tiles | `tileUrl`, `attribution` and `maxZoom` from `useConfig().map`. Before the first `/config` answer on a fresh install, `DEFAULT_MAP_TILES` from the package: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, `&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors`, 19. Changing the provider is a server setting; no client is rebuilt |
| Attribution | Leaflet's attribution control stays visible at the bottom right on every map, including the 120-point mini map. Nothing may cover it (V11) |
| Markers | `divIcon` HTML from `map-icons.ts`, drawn with the `palette`; no image files. `label` and `title` are HTML-escaped. Markers are keyed by `id`, so a position change moves the existing marker |
| Fitting | on a new `fit.key`: `fitBounds(points, { padding, maxZoom })`, or `setView` for one point. Callers build the key from what should trigger a refit, for example `fitKeyFor(points)` (4 decimals, about 10 m), which moves from `TrackingMap.types.ts` into `map-types.ts` |
| Live updates | the parent passes new `markers`; the bridge delivers them asynchronously (V9). A driver marker with `glide` animates between fixes, so one update every 4 to 10 s looks continuous |
| Draggable pin | `pick` draws a `pin` marker at `pick.position`. Drag end and map taps call `onPick`; the parent stores the point, rounds it with `r6`, checks `SERVICE_AREA` and, when it is outside, shows the error and keeps the old position |
| Non-interactive maps | the frame has `pointerEvents: 'none'`; Leaflet is created with dragging, zoom and keyboard off |
| Loading | a `Skeleton` covers the frame until `onReady`. If `onReady` has not fired after 8 s, `AppMap` shows the fallback card: a one-line text summary and "Open in Maps" (today's `MapUnavailable` and `mapsUrlFor`) |
| Offline | the map shell is in the app binary, so the frame, markers, lines and the pin still draw, on a grey background. `LeafletCanvas` reports `failing` after 4 `tileerror` events with no `tileload` between them, or when `online` is false; `AppMap` then shows "Map tiles can't load right now. Pins are still in the right place." When `online` returns, the tile layer is redrawn. Tiles are never prefetched or stored for offline use: the default tile server forbids it (V11). Only the WebView's normal HTTP cache applies |
| Renderer crash | the DOM wrapper reloads the WebView when its process is killed (`onRenderProcessGone`, `onContentProcessDidTerminate` in `expo/src/dom/webview-wrapper.tsx`); props are sent again on `DOM_READY` |
| Stacking on web | the frame sets `zIndex: 0` so Leaflet's high z-index panes stay under headers and sheets (as `TrackingMap.web.tsx` does) |
| Cost | one `AppMap` per screen. A list never renders more than one map: Home shows the mini map for the first out-for-delivery store order only |
| Development | the component is served by the dev server (`/_expo/@dom`), so a phone needs Metro reachable, as for the rest of the app. DOM components work in Expo Go (V9); `react-native-webview` is included in Expo Go |

### 7.4 Where maps are used

| Screen | Props |
| --- | --- |
| Customer `(tabs)/stores` (map mode) | `interactive`; a `store` marker per store, `site` for the current site; `fit.key` from the filter set; `onMarkerPress` opens the store card |
| Customer `orders/[id]/track/[storeOrderId]` | `interactive`; `store` (from `tracking.pickup`), `site` (`tracking.destination`), `driver` with `glide` and `heading`; a dashed `brand` polyline from the driver to the next target (the store until `loaded`, then the site); `fit.key = fitKeyFor([driver, target])` |
| Customer Home mini map | non-interactive, height 120; `driver` and `site`; same fit rule |
| Customer `site` sheet and `jobsites/edit` | `interactive`; `pick` with the jobsite pin; `initialCenter` from the address search result or the current location |
| Driver `job/[id]` | non-interactive; `store` at `offer.pickup.location`; a `brand` circle of 1 000 m at `offer.dropoff.approxLocation` (the exact site is not known before a claim); `fit` on both |
| Driver `(tabs)/route` | `interactive`; `driver` from the last fix; a `stop` per `RouteStop` with its sequence number as `label` (`tone: 'warning'` for `kind: 'pickup'`, `'brand'` for `'dropoff'`, `highlighted` for the next stop); one polyline from `route.polyline`; `onMarkerPress` opens the delivery |
| Driver `delivery/[id]` | non-interactive preview: `store`, `site`, `driver` |

### 7.5 Console

`frontend/src/components/map/BaseMap.tsx` keeps its helpers (`FitBounds`, `FlyTo`,
`InvalidateOnResize`, `ClickToPick`, `AnimatedMarker`) and `markers.ts`. Changes:

- `TileLayer` reads `const tiles = useConfig()?.map ?? DEFAULT_MAP_TILES` and uses
  `url={tiles.tileUrl} attribution={tiles.attribution} maxZoom={tiles.maxZoom}`. `env.map`,
  `VITE_MAP_TILE_URL` and `VITE_MAP_ATTRIBUTION` are removed. Today's default URL contains `{s}`
  subdomains; the policy's URL has none (V11).
- `DEFAULT_CENTER` becomes Toronto, `{ lat: 43.6532, lng: -79.3832 }` (MARKETPLACE §9).
- `LocationPicker` (the draggable pin) is unchanged apart from its `call` import.
- New in §9 screens with the same pieces: the jobsite map in the quote builder, the pin step of the
  store wizard, store pins on the stores page.

A browser sends the Referer the tile policy asks for, as long as the static server does not set a
restrictive `Referrer-Policy` (`no-referrer` would break it; `strict-origin-when-cross-origin`, the
browser default, is fine).

### 7.6 Packages

| Package | Version | Where | Why |
| --- | --- | --- | --- |
| `leaflet` | `^1.9.4` (installed 1.9.4) | customer, driver, frontend (already there) | the map |
| `react-leaflet` | `^5.0.0` (installed 5.0.0; peers `react ^19`, V20) | customer, driver, frontend (already there) | React bindings |
| `@types/leaflet` | `^1.9.22` | all three (already there) | types |
| `react-native-webview` | `14.0.1` (SDK 58, V1) | customer, driver (**new**) | the WebView engine of the DOM component |
| `@expo/dom-webview` | 58.0.2, ships inside `expo` | nothing to install | fallback engine: delete the `useExpoDOMWebView: false` line and the user-agent line to use it |
| `react-dom`, `react-native-web`, `@expo/metro-runtime` | as installed | customer, driver (already there) | required by DOM components (V9) |
| `react-native-maps` | 1.29.11 | customer, driver | **removed** |

---

## 8. Configuration

### 8.1 Runtime configuration: `GET /config`

Everything that can differ between environments without a rebuild comes from the server
(decision P12). The endpoint is public and needs no token (assumption B19).

```ts
export interface PublicConfig {
  environment: 'development' | 'production';
  paymentsMode: 'test' | 'stripe' | 'disabled';
  phoneVerification: 'required' | 'optional' | 'off';
  /** E.164. "Call support" in the customer app, "Call dispatch" in the driver app. */
  supportPhone: string | null;
  supportEmail: string | null;
  /** Printed on receipts. */
  hstNumber: string | null;
  map: { tileUrl: string; attribution: string; maxZoom: number };
  /** The public tracking link is `${trackingBaseUrl}/${token}`, for example `https://app.instasupply.ca/track`. */
  trackingBaseUrl: string;
  /** 'outbox': messages are stored and shown under Dev SMS outbox instead of being sent. */
  smsDriver: 'outbox' | 'twilio';
  emailDriver: 'outbox' | 'resend' | 'smtp';
  /** Shows "Run payouts now" and allows `runJobNow`. */
  allowTestJobs: boolean;
  serverTime: number;
}

export interface ConfigStore {
  /** The last known config: from this run, or from the device cache. Null only before the very first answer on this device. */
  get(): PublicConfig | null;
  /** Why the last `load()` failed, while `get()` is still null. Otherwise null. */
  error(): ApiError | null;
  subscribe(listener: () => void): () => void;
  load(): Promise<PublicConfig>;
}
export declare const DEFAULT_MAP_TILES: PublicConfig['map'];
```

`client.start()` loads it, stores it in `instasupply.config.v1`, and loads it again on `foreground`
when it is older than 15 minutes. While there is no config at all, a failed load is repeated every
5 s and on `online`. Session statuses wait for it (§2.2, §2.3), so a first start
without a network shows the splash with "Can't reach the server" and "Try again"; every later start
uses the cached copy. `EXPO_PUBLIC_SUPPORT_PHONE`, `EXPO_PUBLIC_DISPATCH_PHONE` and the two
`VITE_MAP_*` variables are gone.

### 8.2 Expo apps: `EXPO_PUBLIC_API_URL`

One build-time value tells an app where the API is: its origin, `https://host[:port]`, without a
path and without a trailing slash.

| Variable | Read by | When it matters | Where it is set |
| --- | --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | the bundle (`src/lib/env.ts`); the guard in `app.config.ts` | every bundle. Empty in development means "find the API on the dev machine" | `.env.development` (empty), `.env.production` (the production origin). A shell or EAS value overrides both (V12) |
| `EXPO_PUBLIC_API_PORT` | the bundle | development only; default `4000` | optional, `.env.development` or `.env.local` |
| `APP_VARIANT` | `app.config.ts`: app name and application id suffix | `expo prebuild` **and** the build (the same value at both) | the shell of the build script, or `eas.json` |
| `EAS_PROJECT_ID` | `app.config.ts`: `extra.eas.projectId` (needed for push, §6.1) | prebuild and build | the shell of the build script, or EAS environment variables |
| `GOOGLE_SERVICES_JSON` | `app.config.ts`: `android.googleServicesFile` and `extra.push.android` | prebuild and build | the shell: a path to the file, inside or outside the repository (`scripts/android-release.sh` copies it to `app/<app>/google-services.json` in the build copy and then sets `GOOGLE_SERVICES_JSON=./google-services.json`, `docs/DEPLOYMENT.md` §6.5), or an EAS file variable |

Removed from both apps: `EXPO_PUBLIC_USE_EMULATORS`, `EXPO_PUBLIC_EMULATOR_HOST`, the six
`EXPO_PUBLIC_FIREBASE_*`, `EXPO_PUBLIC_FUNCTIONS_REGION`, `EXPO_PUBLIC_SUPPORT_PHONE`,
`EXPO_PUBLIC_DISPATCH_PHONE`, `GOOGLE_MAPS_ANDROID_API_KEY`.

```ts
// app/<app>/src/lib/env.ts
import Constants from 'expo-constants';
import { Platform } from 'react-native';

function resolveApiUrl(): string {
  // EXPO_PUBLIC_* are inlined at build time and must be read with literal names (V12).
  const explicit = (process.env.EXPO_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  if (!__DEV__) throw new Error('EXPO_PUBLIC_API_URL is empty in a release bundle (docs/CLIENTS.md §8.2).');
  const port = process.env.EXPO_PUBLIC_API_PORT || '4000';
  if (Platform.OS === 'web') return `${window.location.protocol}//${window.location.hostname}:${port}`;
  // On a phone the API runs on the computer that runs `expo start`: reuse the dev server's host (V15).
  const host = (Constants.expoConfig?.hostUri ?? '').split(':')[0];
  if (host) return `http://${host}:${port}`;
  return Platform.OS === 'android' ? `http://10.0.2.2:${port}` : `http://127.0.0.1:${port}`;
}

export const env = {
  apiUrl: resolveApiUrl(),
  variant: (Constants.expoConfig?.extra?.variant as string | undefined) ?? 'production',
};
export const appVersion = Constants.expoConfig?.version ?? '1.0.0';
export const easProjectId: string | undefined =
  (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ?? Constants.easConfig?.projectId;
```

**Finding the API on a LAN in development.** This is the technique `resolveEmulatorHost` uses today
for the emulators. Start the backend (it listens on all interfaces, port 4000, assumption B1) and
`npm run dev:customer` or `dev:driver`; nothing is configured by hand:

| Where the app runs | `apiUrl` becomes |
| --- | --- |
| a phone on the same Wi-Fi (Expo Go or a development build) | `http://<the dev machine's LAN address>:4000`, taken from `Constants.expoConfig.hostUri` |
| Android emulator, when `hostUri` is missing | `http://10.0.2.2:4000` |
| iOS simulator, when `hostUri` is missing | `http://127.0.0.1:4000` |
| the browser (`expo start --web`) | the page's host with port 4000 |
| `expo start --tunnel`, or an API somewhere else | set `EXPO_PUBLIC_API_URL` in `app/<app>/.env.local` |

Plain `http://` works in development because the debug Android manifest allows cleartext traffic
(V13). A release build does not allow it, so a release bundle must use `https://`; the guard below
enforces that.

**Env files** (the Firebase blocks are deleted from all of them):

```
# app/<app>/.env.development   (loaded by `expo start`)
# Empty: the app finds the API on the machine that runs the dev server (docs/CLIENTS.md §8.2).
EXPO_PUBLIC_API_URL=
EXPO_PUBLIC_API_PORT=4000

# app/<app>/.env.production    (loaded by every release bundle: Gradle, `expo export`, EAS)
# The public origin of the Railway backend service. Not a secret.
EXPO_PUBLIC_API_URL=https://api.instasupply.ca
```

`https://api.instasupply.ca` is the recommended custom domain (Appendix B, Q1). If the owner keeps
the generated Railway domain, that origin goes here instead. Either way the value is baked into the
APK: changing the API's address later means building and distributing new APKs.

**`app.config.ts` changes (both apps):**

| Change | Detail |
| --- | --- |
| add the guard | `const apiUrl = (process.env.EXPO_PUBLIC_API_URL ?? '').trim();` then `if (process.env.NODE_ENV === 'production' && !/^https:\/\/[^/\s]+$/.test(apiUrl)) throw new Error(…)`. Release bundling and the embedded config are evaluated in production mode with `.env.production` loaded (V12), so a release build that cannot reach the API fails at build time, not on the customer's phone. `expo start` and `expo prebuild` run in development mode and are not affected |
| `extra` | `{ eas, variant, push: { android, ios } }` (§6.1); remove `googleMapsEnabled` (customer) |
| `android` | remove `config.googleMaps`; keep `googleServicesFile`, `package`, `adaptiveIcon`, `predictiveBackGestureEnabled` |
| `plugins` | add `'expo-secure-store'`. Customer also adds `expo-image-picker` (camera and photo texts for issue photos and material lists) and keeps `expo-location` with the when-in-use text reworded for jobsites. Driver keeps its `expo-location` background options and `expo-image-picker`; texts mention stores and drop-off photos. `expo-notifications` entries stay (§6.6) |
| descriptions | no grocery wording (MARKETPLACE §12.4, §12.6) |

**`eas.json` (both apps).** EAS cloud builds remain the alternative path (decision P18). The API
address is not repeated here: EAS bundles in production mode and reads the uploaded
`.env.production`.

```json
{
  "cli": { "version": ">= 16.0.0", "appVersionSource": "remote" },
  "build": {
    "base": { "node": "22.13.0" },
    "development": {
      "extends": "base",
      "developmentClient": true,
      "distribution": "internal",
      "channel": "development",
      "env": { "APP_VARIANT": "development" }
    },
    "preview": {
      "extends": "base",
      "distribution": "internal",
      "channel": "preview",
      "environment": "preview",
      "android": { "buildType": "apk" },
      "env": { "APP_VARIANT": "preview" }
    },
    "production": {
      "extends": "base",
      "autoIncrement": true,
      "channel": "production",
      "environment": "production",
      "env": { "APP_VARIANT": "production" }
    },
    "production-apk": {
      "extends": "production",
      "distribution": "internal",
      "android": { "buildType": "apk" }
    }
  },
  "submit": { "production": {} }
}
```

`EXPO_PUBLIC_FUNCTIONS_REGION` and `EXPO_PUBLIC_USE_EMULATORS` leave every profile. A `preview`
build that should talk to another API sets `EXPO_PUBLIC_API_URL` in that profile's `env`.

### 8.3 Console: `VITE_API_URL`

```ts
// frontend/src/lib/env.ts
const DEV_API_PORT = 4000;

function resolveApiUrl(): string {
  const explicit = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  // `vite` on this machine or opened from another device on the LAN: the API is on the same host.
  if (import.meta.env.DEV) return `${window.location.protocol}//${window.location.hostname}:${DEV_API_PORT}`;
  throw new Error('VITE_API_URL is empty in a production build (docs/CLIENTS.md §8.3).');
}

export const env = { apiUrl: resolveApiUrl() } as const;
```

`vite.config.ts` refuses to build without it, so the mistake cannot reach Railway:

```ts
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ command, mode }) => {
  // The .env files of this mode plus the VITE_* variables already in the environment (V18).
  const vars = loadEnv(mode, process.cwd(), 'VITE_');
  if (command === 'build' && !/^https?:\/\/[^/\s]+$/.test(vars.VITE_API_URL ?? '')) {
    throw new Error('Set VITE_API_URL to the origin of the API before building the console.');
  }
  return { /* today's config, plus define: { __APP_VERSION__: … } */ };
});
```

`vite-env.d.ts` declares `VITE_API_URL` only; `VITE_USE_EMULATORS`, the six `VITE_FIREBASE_*`,
`VITE_FUNCTIONS_REGION`, `VITE_MAP_TILE_URL` and `VITE_MAP_ATTRIBUTION` are removed from it and from
the env files. `frontend/.env.development` contains one commented line
(`# VITE_API_URL=http://localhost:4000`); `frontend/.env.example` documents the variable.

On Railway the `frontend` service gets the variable by reference to the `backend` service, and the
Dockerfile declares it, because Railway passes variables to a Docker build only through `ARG` (V16):

```
VITE_API_URL=https://${{backend.RAILWAY_PUBLIC_DOMAIN}}
```

`frontend/Dockerfile` is owned by `docs/DEPLOYMENT.md` §2.4 (it also builds `@instasupply/art` first
and writes `/build-info.json`). The console needs only this from it, before the build step:

```dockerfile
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
```

With a custom API domain the variable is that literal origin instead of the reference. The API must
answer CORS for the console's origin and accept it as WebSocket origin (assumption B22).

### 8.4 Which API each build talks to

| Build | Command | API |
| --- | --- | --- |
| Console, development | `npm run dev:frontend` | `http://<page host>:4000` |
| Console, production build checked locally | `VITE_API_URL=http://localhost:4000 npm run build:frontend`, then `npm --workspace @instasupply/frontend run preview` | the value given |
| Console on Railway | `railway up` for the `frontend` service | the `VITE_API_URL` service variable |
| App, development (Expo Go or development build) | `npm run dev:customer`, `npm run dev:driver` | the dev machine on the LAN (§8.2) |
| App, release APK built locally with Gradle (primary path, P18) | `expo prebuild`, then the Gradle release task, from a copy of the repository in a path without spaces | `.env.production` |
| App, EAS `preview` or `production-apk` | `eas build --profile preview --platform android` | `.env.production`, unless the profile's `env` overrides it |
| CI bundle check | `npx expo export …` | `.env.production` (the guard needs a valid value; nothing is called) |

There is one backend environment, production (decision P17). "Preview" builds therefore differ from
production builds in the application id suffix and name only, and can be installed next to them.

### 8.5 What a release build needs from this document

The build commands, signing and keystores are specified with the deployment (PLATFORM.md and
DEPLOYMENT.md). From the client side a release build needs exactly:

1. `app/<app>/.env.production` with the API origin (§8.2).
2. `APP_VARIANT=production`, and for push `EAS_PROJECT_ID` and `GOOGLE_SERVICES_JSON`, exported in
   the shell for **both** `expo prebuild` and the Gradle task (prebuild evaluates `app.config.ts` in
   development mode and bakes the application id and the Google services plugin into the native
   project; the Gradle task evaluates it again for the embedded config, V12).
3. The Android SDK Platform for API 37: SDK 58 compiles against `compileSdk 37` with build-tools
   `37.0.0`, and this machine has platforms 34, 36 and 36.1 only (V19). Gradle also needs
   `ANDROID_HOME` (or `sdk.dir` in `android/local.properties`); the shell here has neither set.
4. The whole workspace, not only the app folder: the bundle includes `packages/api-client`,
   `packages/shared` and `packages/art`.

---

## 9. Dependencies

Install Expo modules with `npx expo install <package>` inside the app folder (the apps'
`AGENTS.md` requires it); it picks the versions below, which are the SDK 58 pins (V1).

### 9.1 `app/customer`

| Action | Package | Version | Reason |
| --- | --- | --- | --- |
| add | `@instasupply/api-client` | `*` (workspace) | the data layer |
| add | `expo-secure-store` | `~58.0.3` | refresh-token storage |
| add | `expo-crypto` | `~58.0.8` | `randomUUID` for `checkoutId`, `requestId`, `issueId`, message ids |
| add | `expo-network` | `~58.0.5` | online and offline signal for the live client |
| add | `react-native-webview` | `14.0.1` | map engine (§7) |
| add | `expo-image-picker` | `~58.0.10` | issue photos, material-list photos (MARKETPLACE §14.3) |
| add | `expo-document-picker` | `~58.0.5` | material-list PDF and spreadsheets (MARKETPLACE §14.3) |
| add | `expo-image-manipulator` | `~58.0.16` | compress photos before upload |
| remove | `firebase` | `^13.4.0` | |
| remove | `react-native-maps` | `1.29.11` | replaced by `AppMap` |
| keep | `@react-native-async-storage/async-storage` `2.2.0`, `expo-notifications` `~58.1.9`, `expo-device` `~58.0.5`, `expo-location` `~58.0.22`, `expo-constants` `~58.0.16`, `leaflet` `^1.9.4`, `react-leaflet` `^5.0.0`, `@types/leaflet` `^1.9.22`, `react-dom`, `react-native-web`, `@expo/metro-runtime` | | all still used |

The `description` in `package.json` loses "grocery".

### 9.2 `app/driver`

| Action | Package | Version | Reason |
| --- | --- | --- | --- |
| add | `@instasupply/api-client` | `*` (workspace) | the data layer |
| add | `expo-secure-store` | `~58.0.3` | refresh-token storage, readable by the background task |
| add | `expo-crypto` | `~58.0.8` | `randomUUID` for message ids |
| add | `expo-network` | `~58.0.5` | online and offline signal |
| add | `react-native-webview` | `14.0.1` | map engine (§7) |
| remove | `firebase` | `^13.4.0` | |
| remove | `react-native-maps` | `1.29.11` | replaced by `AppMap` |
| keep | `expo-location` `~58.0.22`, `expo-task-manager` `~58.0.14`, `expo-battery` `~58.0.4`, `expo-notifications` `~58.1.9`, `expo-device` `~58.0.5`, `expo-image-picker` `~58.0.10`, `expo-image-manipulator` `~58.0.16`, `expo-application` `~58.1.2`, `@react-native-async-storage/async-storage` `2.2.0`, `leaflet`, `react-leaflet`, `@types/leaflet`, `react-dom`, `react-native-web`, `@expo/metro-runtime` | | all still used |

### 9.3 `frontend`

| Action | Package | Version | Reason |
| --- | --- | --- | --- |
| add | `@instasupply/api-client` | `*` (workspace) | the data layer |
| remove | `firebase` | `^13.4.0` | |
| keep | `leaflet` `^1.9.4`, `react-leaflet` `^5.0.0`, `@types/leaflet` `^1.9.22`, `react-router` `^7.18.0`, `papaparse`, `lucide-react`, Vite `^8.3.8`, Tailwind `^4.3.5` | | unchanged |

No test runner, router or state library is added to any client.

### 9.4 `packages/api-client` and the workspace

| Where | Action | Package | Version |
| --- | --- | --- | --- |
| `packages/api-client` | dependency | `@instasupply/shared` | `*` |
| `packages/api-client` | dev | `@testing-library/react` | `^16.3.3` (peers `react ^18 \|\| ^19`, `@testing-library/dom ^10`) |
| `packages/api-client` | dev | `@testing-library/dom` | `^10.4.2` |
| `packages/api-client` | dev | `@happy-dom/global-registrator` | `^21.0.4` (brings `happy-dom ^21.0.4`; Node 20 or later) |
| `packages/api-client` | dev | `@types/node`, `@types/react`, `@types/react-dom` | `^22.15.0`, `~19.3.0`, `~19.3.0` |
| `packages/api-client` | dev | `react-dom` | `19.3.0` (the workspace override; needed by the hook tests) |
| `packages/expo-firebase` | delete the package | | |
| root `package.json` | `@firebase/rules-unit-testing` and `firebase-tools` serve only `legacy/`; they leave with it. That removal belongs to the backend migration, not to the clients | | |

`tsx` and `typescript` come from the root, as for `packages/shared`.

---

## Appendix A. What this document assumes about the backend

Each line is something a client depends on. PLATFORM.md §13.4 answers every line; after the final
reconciliation of 2026-11-20 all of them match PLATFORM.md, and the text below states the agreed
behaviour. Where PLATFORM.md says otherwise it wins.

| # | Assumption | If it differs, change |
| --- | --- | --- |
| B1 | In development the API listens on `0.0.0.0`, port `4000` (`PORT`), creates its database itself, and allows CORS and WebSocket origins from `http://localhost:*` and LAN addresses | `EXPO_PUBLIC_API_PORT` default, `DEV_API_PORT` (§8) |
| B2 | Everything is under `/api/v1`; bodies are JSON; errors use the envelope with `status`, `code`, `message`, `details`; success returns the document itself, without a wrapper; responses carry `x-request-id` | `http.ts` |
| B3 | `POST /auth/register` creates an account with no role (`MeResponse.profile` is null). `registerCustomer` and `registerDriver` (commands) give it a role and create the profile; calling `registerCustomer` again for an existing customer profile succeeds | `createAccount` in both apps (§2.2, §2.3) |
| B4 | `register`, `login`, `refresh` and `password/setup` answer `AuthSessionResponse` (§1.5); `GET /me` and `PATCH /me` answer `MeResponse`; `PATCH /me` accepts exactly the fields of `ProfilePatch` and merges `preferences` | `auth/session.ts` |
| B5 | Access tokens are bearer JWTs valid 900 s; the answer states the lifetime as `accessTokenTtlSeconds`. The client never decodes the JWT | `tokens.ts` rule 4 |
| B6 | **A refresh can be repeated:** presenting a refresh token again after a lost answer returns a working pair, at any age, as long as the child issued for it has never been used. A token whose child was used, or a superseded sibling, is reuse and revokes the session (PLATFORM.md §6.3.5) | nothing can compensate on the client; without it drivers are signed out on bad networks |
| B7 | Auth failures carry `details.reason`, one of `token_expired`, `token_invalid`, `session_revoked`, `refresh_reused`, `account_suspended`, `credentials` | `ApiError.authReason`, §2.4 |
| B8 | Suspending an account revokes its sessions; every request, refresh, `GET /me` and a login with the right password then answer `permission-denied` with reason `account_suspended`, which the server checks before `session_revoked` (PLATFORM.md §6.4) | §2.4 |
| B9 | A push device belongs to a device session (`installationId`). `POST /auth/logout { refreshToken }` works without an access token and deletes the session and its device. Revocation does the same. `PUT /me/devices/{installationId}` upserts and removes the same token from every other account | §2.5, §6.3 |
| B10 | Documents have the shapes of MARKETPLACE §1.3 with every `…At` as epoch ms and always an `id` string (the old document id: `uid`, `deliveryId`, `storeOrderId`, `payoutId`, …), also where the shared type declares none. Private parts are separate endpoints (`/stores/{id}/settings`, `/store-orders/{id}/private`, `/deliveries/{id}/private`, `/quotes/{id}/workspace`, `/issues/{id}/notes`). A supplier never receives `trackingToken` or the customer's `pickupCode` | `WithId`, §4.1 |
| B11 | Lists answer `{ items, nextCursor }`; filters, `sort`, `limit` and `cursor` work as §1.7 describes; resource names are the Firestore collection names in kebab-case (`store-orders`, `job-offers`, `driver-locations`, `support-threads`, `ledger-entries`, `store-suggestions`, `dev-outbox`), the caller's own data is under `/me/…`; a non-staff caller only gets their own rows: a scoping filter they send must be their own, one they leave out is applied by the server (PLATFORM.md §5.3) | `src/resources/*`, `src/queries/*` |
| B12 | The live socket speaks the frames of §1.9: `auth` as the first message (never a token in the URL), `subscribe` / `unsubscribe` with acknowledgement and per-topic denial, `event`, `ping` / `pong`, the close codes 4401, 4403, 1012 and 1008 | `live/protocol.ts` |
| B13 | Anonymous connections are allowed and may subscribe to the public topics | `live-client.ts` |
| B14 | Topic names and who may subscribe are those of §4.1 | `src/topics.ts` only |
| B15 | Payload events: `tracking:{token}` carries the whole `PublicTracking`; `driver-locations` carries `DriverLocation` with `id`; `thread:{driverId}` and `support-thread:{threadId}` carry the new message on `kind: 'message'`; `user:{uid}:notifications` carries the notification on `kind: 'created'`. The server tolerates 120 s without a client frame | the `reduce` functions in `src/queries/*`; heartbeat interval |
| B16 | These server-computed endpoints exist: `GET /ops/dashboard` (`OpsDashboard`), `GET /ops/stores` (`OpsStoreRow[]`), `GET /me/buy-again`, `GET /store-orders/{id}/proof` (the customer's view of the drop-off photo), `GET /deliveries/stats?driverId=&since=`, `GET /activity?limit=` | the matching descriptors; without `/ops/dashboard` the console would have to load whole lists as it does today |
| B17 | `POST /me/location` accepts `LocationReport` (1 to 20 fixes), answers `LocationAck`, limits a driver to one report per 2 s with `RATE_LIMITED` and `details.retryAfterMs`, and refuses non-drivers with `permission-denied` | `resources/location.ts`, `TRACKING_PROFILES` |
| B18 | Files: `POST /files/presign`, `POST /files/confirm`, `GET /files/url?path=` as in §1.8, with the limits of `UPLOAD_LIMITS` (in `@instasupply/shared`); the server always answers `method: 'POST'`; `Store.photoUrl` and `Product.imageUrl` are URLs usable without a header; in development they carry the origin the device called (PLATFORM.md §11.1), so phones on the LAN and emulators can load them. The bucket allows cross-origin `POST` from the console's origin | `uploads.ts` |
| B19 | `GET /config` is public and returns `PublicConfig` (§8.1) | `config.ts` |
| B20 | `passwordSetupLink` points at the console: `{console origin}/set-password#token=…` (fragment), and the page calls `POST /auth/invites/inspect`; password reset sends a 6-digit code by email (or to the outbox) and `POST /auth/password/forgot` never reveals whether the account exists | the two new console pages, the apps' forgot-password step |
| B21 | Commands are `POST /call/<name>` for every name in `CALLABLES`, with the request and response types of `api.ts`. Creations keyed by a client id are idempotent (D17); `PUT` to a client-generated id and a message `id` repeated are idempotent too | `callables.ts`, §1.7 |
| B22 | CORS allows the console's origin (and any Expo web origin in development) with the `Authorization`, `Content-Type` and `X-Client` headers; the WebSocket accepts the same origins | deployment settings only |
| B23 | Product search runs on the server (`GET /products?q=`), over name, brand, SKU, size, category names and synonyms, and returns at most `limit` rows; `listed=true` hides products of stores that are not live | `queries.productSearch` |
| B24 | The Expo push message carries `channelId` from `channelFor` and `data` with the MARKETPLACE §5.8 keys plus `notificationId`, `type`, `userId`, all strings | §6.4, §6.6 |

## Appendix B. Open questions for the owner

| # | Question | Default taken in this document |
| --- | --- | --- |
| Q1 | Which address do the APKs call? The address is fixed inside each APK at build time. A custom domain (`api.instasupply.ca`, and one for the console) survives a move of the Railway service; the generated `*.up.railway.app` domain does not | `https://api.instasupply.ca` is written in `.env.production`; replace it before the first release build if the owner prefers the generated domain |
| Q2 | Should the first APKs have system push? It needs an Expo account with one project per app, and one Firebase project used only as FCM transport (a `google-services.json` per app and a service-account key uploaded to Expo). Without them the apps work, with inbox and banners only | builds without those files have no push and do not crash (§6.7) |
| Q3 | Map tiles in production: the public OpenStreetMap server may withdraw access from commercial services at any time and forbids heavy use. A paid tile provider is a server setting (`tileUrl` in `/config`), no client change | OpenStreetMap |
| Q4 | The customer app would stop asking for notification permission at first start and ask after the first order and in Settings instead. Keep today's behaviour? | ask later (§6.2) |
| Q5 | On the web the refresh token is kept in `localStorage`. An HttpOnly cookie is safer against script injection but needs the console and the API on one site (custom domains) and a second auth path on the server | `localStorage`; revisit with Q1 |
| Q6 | Is a second backend environment (staging) wanted for `preview` builds? | no: one production environment (decision P17) |
| Q7 | iOS builds are not part of this release (Android APKs only). The design keeps iOS working, but the stationary heartbeat (§5.3) and push credentials were specified for Android first | Android first |

## Appendix C. Done means

1. `packages/api-client` exists with the layout of §1.1, its public API matches §1.3 to §1.11, and
   every case of §1.13 passes with `npm --workspace @instasupply/api-client run test`.
2. No file in `app/`, `frontend/` or `packages/` imports `firebase` or `@instasupply/expo-firebase`;
   `packages/expo-firebase` is deleted; `firebase` and `react-native-maps` are in no client
   `package.json`.
3. Each client signs in, restores its session offline, refreshes tokens, and ends the session for
   each reason of §2.4 with the stated screen.
4. Every screen reads through a descriptor of §4.1 and writes through §1.6 or §4.2; no screen
   contains a URL path or a topic string.
5. With the socket blocked, every live screen still updates within its poll interval; with the
   socket back, polling stops.
6. The driver stays "online" on the console's live map while parked with the app in the background
   for 15 minutes on Android; killing the session stops the location service.
7. An Android release build without `google-services.json` starts, signs in, shows the inbox and
   never throws from a push API; with it, a test notification arrives and its tap opens the right
   screen.
8. Maps render in both apps on Android without any API key, show attribution, and keep their
   markers when the device goes offline.
9. `npm run lint`, `npm run typecheck`, `npm test`, the console build and the Expo exports pass
   with `EXPO_PUBLIC_API_URL` and `VITE_API_URL` set as §8 describes.
