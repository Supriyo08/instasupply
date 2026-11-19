# InstaSupply backend platform specification

**Status:** implementation-ready · **Date:** 2026-11-19 · **Audience:** every engineer who builds or
calls the API server · **Owner of this file:** the platform workstream.

This document specifies the backend that replaces Firebase: a Node 22 + Fastify 5 API server on
PostgreSQL 17, deployed on Railway. `docs/MARKETPLACE.md` stays the source of truth for the
**domain**: its §0 to §4 (decisions, data shapes, state machines, money, time), §7 to §10 (the three
apps) and §11 (seed data) are binding. Its §5 (Cloud Functions), §6 (rules and indexes) and §12 to
§14 describe the right behaviour on the wrong platform. This document maps every callable, trigger,
schedule, rule and index of those sections onto the new platform. Where the two documents disagree
about *behaviour*, MARKETPLACE wins; where they disagree about *platform*, this document wins.

### How to read the specs together

`docs/MARKETPLACE.md` is frozen: nobody edits it. Read it with this table. "Binding" means the section is
the specification; "superseded" means its platform content is replaced and its behaviour is carried by the
named section here or in a sibling document.

| MARKETPLACE section | Status | Read together with, or instead |
| --- | --- | --- |
| §0 Decisions D1 to D18 | binding for the domain. Where a decision names a Firebase product (Firestore documents, callables, triggers, claims, Storage, FCM) the *behaviour* is binding and the mechanism is replaced by §1.2 here. **D13** (data in Toronto, `northamerica-northeast2`) is superseded by P17: Railway has no Canadian region and the deployment uses US East (§14 question 11). **D10**: claims become `users` columns (§6.4). | §1.1, §1.2 |
| §1 Domain model (§1.3 shapes) | binding. `TimestampLike` becomes `number` (§16). `private/*` sub-documents become private columns (§3.3). Paths `apps/customer`, `apps/driver`, `apps/backoffice` in MARKETPLACE are today's `app/customer`, `app/driver`, `frontend`. | §3.3, §5.4, §16 |
| §2 State machines, §3 Money, §4 Time | binding, unchanged | §9.2, §10.4 (adds the authorization journal R2) |
| §5 Backend (callables, triggers, schedules, notifications, errors) | behaviour binding, platform superseded. Callables → §5.2 commands; flows → §9.2; triggers → §9.4; schedules → §9.5; notifications → §10.2; §5.9 error codes binding, with the HTTP map of §4.2 | §5, §9, §10 |
| §6 Security rules and indexes | behaviour binding, platform superseded. Rules → §7 (endpoint policies and object checks) and §10.1 (the Storage rules); indexes → §3.4 | §3.4, §7, §10.1 |
| §7 to §10 The three apps | binding: screens and their behaviour | `docs/CLIENTS.md` §4 binds every screen to the endpoints and topics of §5 and §8 here |
| §11 Seed data | binding for content and end states; "Admin SDK" and `runJobNow` are replaced as §2.2 (`seed`) says | §2.2, §2.6 |
| §12 Migration | superseded | `docs/CLIENTS.md` §3 (client files), §13.3 here (server port map), `docs/DEPLOYMENT.md` §7.2 (CI files) |
| §13 Test plan | §13.1 binding (shared unit tests stay in `packages/shared`); §13.2 and §13.3 are carried by §12.4 here | §12 |
| §14 Work breakdown | superseded | §15 here |
| §15 Open questions | still open unless §14 here or the owner checklist answers them | §14 |

Precedence when two documents disagree: domain behaviour → MARKETPLACE; server, API names, topics,
variables of the backend → this document; client behaviour → `docs/CLIENTS.md` (which may only call what §5
and §8 define); Railway, images, Android builds and CI → `docs/DEPLOYMENT.md`.

References look like "MARKETPLACE §5.5.1" (the domain spec) or "§9.2" (this document). In a list
such as "MARKETPLACE §5.4 and §5.5", every number belongs to the document that is named.

Two sibling documents were written in parallel and are kept consistent with this one:
`docs/CLIENTS.md` (the client data layer `packages/api-client`, the console and the two apps) and
`docs/DEPLOYMENT.md` (Railway, the images, Android builds, CI). This document owns the server. The
names all three must share (paths, parameters, topics, frames, variables, commands of the CLI) are
defined here and were aligned with the two siblings; §13.4 lists, assumption by assumption, what
matches and the few places where they still have to follow this document.

The backend, the web console and the apps stay in separate top-level folders (`backend/`,
`frontend/`, `app/`). This document adds files under `backend/` only; §2 opens with the rules that
keep the three apart.

**How the parts fit**

```
 customer app ─┐                                   ┌─ PostgreSQL 17 (document tables, outbox, LISTEN/NOTIFY)
 driver app  ──┼─ HTTPS /api/v1/*  ───────────────►│
 web console ──┘  WSS   /api/v1/live               ├─ object storage (local disk | S3-compatible bucket)
        packages/api-client                        ├─ Expo push service
                              backend (one process:├─ SMS (dev outbox | Twilio) · email (dev outbox | Resend | SMTP)
                              HTTP + WebSocket +   ├─ PaymentGateway (TestGateway)
                              outbox worker +      └─ routing and geocoding (OSRM, Nominatim | Google)
                              scheduler)
```

One process type does everything. Two or more instances can run side by side: realtime fan-out goes
through `LISTEN/NOTIFY`, the outbox worker claims rows with `FOR UPDATE SKIP LOCKED`, and scheduled
jobs take PostgreSQL advisory locks.

**Contents:** 1 Decisions and the Firebase mapping · 2 `backend/` layout · 3 Database · 4 API
conventions · 5 Endpoint catalogue · 6 Auth · 7 Authorization · 8 Realtime · 9 Transactions,
projections, outbox and jobs · 10 Files, notifications, SMS, email, payments · 11 Configuration ·
12 Testing · 13 Verified platform facts · 14 Open questions · 15 Work breakdown ·
16 What changes in `packages/shared`.

---

## 1. Decisions and the Firebase mapping

### 1.1 Decisions (P1 to P18 are binding; the "Refinement" column is what this document adds)

| # | Decision | Refinement fixed here |
| --- | --- | --- |
| P1 | Node 22, TypeScript, ES modules, Fastify 5, PostgreSQL 17, `pg` with plain SQL behind thin typed repositories, no ORM, forward-only numbered SQL migrations, zod at the edge, shared validators for domain rules. | Versions in §2.3. Migrator in §2.6. One `withTransaction` helper and one row-lock helper (§3.6). |
| P2 | One table per aggregate: typed columns for keys, filters, sorts and hot counters, plus `doc jsonb` holding the shared TypeScript shape. Private parts in separate columns. Stock in real columns. Human numbers from sequences. Integer cents. | Three column classes (§3.1): **key**, **owned**, **mirror**. Mirror columns are `GENERATED ALWAYS AS (…) STORED` from `doc`, so they cannot drift and cannot be written by mistake. |
| P3 | `timestamptz` where the database filters or sorts; epoch milliseconds inside documents and on the wire; `TimestampLike` becomes `number`. | One clock: every command takes `now` once from the application clock and uses it for every timestamp it writes, including `created_at` and `updated_at`. No `now()` in SQL for business time. The pool parses `timestamptz` to epoch milliseconds (§3.1). |
| P4 | `/api/v1`: commands `POST /call/<name>`, REST queries, REST writes, one error envelope, cursor pagination, client UUIDs for idempotency. | HTTP status map, pagination and idempotency rules in §4; the catalogue in §5. |
| P5 | Own auth: email + password (scrypt), HS256 access JWT (15 min), rotating opaque refresh tokens with reuse detection, account state re-read on every request, phone OTP, reset codes, set-password links. | §6. An account may exist without a role (`users.role IS NULL`): signed up, profile not created yet. This keeps the `registerCustomer` / `registerDriver` contracts and the `needs_profile` session state. |
| P6 | Role matrix of MARKETPLACE §6.2 as endpoint policies plus object checks; deny by default. | §7. A supplier's store id always comes from the database row of the caller, never from the request. |
| P7 | One WebSocket `/api/v1/live`, topics, invalidations, payload for high-frequency data, `LISTEN/NOTIFY` fan-out, polling fallback. | §8. Publishing happens with `pg_notify` **inside** the business transaction, so an event exists exactly when its change committed. |
| P8 | Coupled changes in one SQL transaction with row locks; projections in the same transaction; network side effects through a transactional outbox. | Row locks are taken with `SELECT … FOR NO KEY UPDATE` (see R1). A global lock order (§3.6). The outbox in §9.3. |
| P9 | Scheduled jobs on timers in the API process, advisory locks, `runX(now)`, `runJobNow`. | §9.5. |
| P10 | `Storage` interface, `local` and `s3` drivers, presigned uploads validated by the server, authorized downloads, the path prefixes of MARKETPLACE §6.4. | §10.1. Uploads are presigned **POST** forms (size and type are enforced by the bucket), then confirmed by the server. |
| P11 | Inbox table; Expo push with receipts and dead-token removal; no Firebase Admin SDK. | §10.2. |
| P12 | SMS and email behind interfaces with an `outbox` driver; `PHONE_VERIFICATION`; `GET /api/v1/config`. | §10.3, §11.2. The email variables are `EMAIL_DRIVER` and `EMAIL_FROM`. |
| P13 | `PaymentGateway` and `TestGateway` exactly as MARKETPLACE §3.8. | §10.4, plus a journal of card authorizations (R2). |
| P14 | Leaflet with a configurable tile URL; Nominatim and OSRM by default with caching and rate limits; Google optional. | Server side in §9.6; tile settings are served by `/config`. |
| P15 | `packages/api-client` replaces `packages/expo-firebase` and the Firebase SDK. | This document fixes what it talks to: §4, §5, §6.2 (tokens), §8 (live protocol). `docs/CLIENTS.md` specifies the package. |
| P16 | No Docker locally; PostgreSQL 17 from Homebrew; the API creates its development database; a throwaway database per test run. | §2.6, §12.1. |
| P17 | Railway: Postgres, `backend` service (Dockerfile at `backend/Dockerfile`, built from the repository root), `frontend` service, a bucket. | §2.7 states what the backend guarantees to the image and the service. `docs/DEPLOYMENT.md` owns the Dockerfile, `.railway/railway.ts` and the Railway steps. |
| P18 | Android release APKs against the production API. | Nothing here except `GET /api/v1/config` and CORS (native apps send no `Origin`). |

**Refinements that go beyond the list above**

| # | Refinement | Why |
| --- | --- | --- |
| R1 | Row locks use `FOR NO KEY UPDATE`, not `FOR UPDATE`. | Both exclude other writers of the row. `FOR UPDATE` also blocks the `FOR KEY SHARE` lock that every foreign-key check takes on the parent row, so an unrelated insert (a notification for a user whose row is locked) would wait, and could deadlock. We never update or delete a referenced key, so the weaker lock is the correct one. |
| R2 | `payment_authorizations` journals every card hold before the gateway is called. | A crash between "authorize" and the order transaction would otherwise leave a hold on the customer's card until it expires. The capture sweep voids orphans. |
| R3 | Mirror columns are generated by PostgreSQL. | "Update the status column but forget the document" is impossible: writing a generated column is an error (SQLSTATE 428C9). |
| R4 | Every transaction that touches an order locks the customer's `users` row first. | It serializes everything that happens to one customer's orders (first-order race, same `checkoutId` twice, aggregate recomputation) with one cheap lock, and it is the first step of the global lock order. |
| R5 | No generic idempotency-key store. | Every retried write is idempotent through a client UUID used as the row id, a natural key, a state check or `expectedVersion` (§4.5). |
| R6 | `unavailable` (HTTP 503) joins the eight HttpsError-style statuses, for the platform only. | Clients need to tell "retry later" (database busy, shutting down) from "bug" (`internal`). Domain code never throws it. |

### 1.2 How each Firebase concept maps

| Firebase concept | Was used for | New platform | Section |
| --- | --- | --- | --- |
| Callable (`onCall`) and the `callable()` wrapper | every command | `POST /api/v1/call/<name>` registered with `defineCommand()`; same request and response types; unknown errors are logged and replaced by a generic `internal` | §4, §5.2 |
| `HttpsError(code, message, details)` | client-visible failures | `ApiError(status, message, { code?, details? })` → `{ error: { status, code, message, details } }` | §4.2 |
| `details.code` | `ERROR_CODES` | top-level `error.code` | §4.2 |
| Firestore document | one aggregate | one row: `doc jsonb` + key, owned and mirror columns | §3.1 |
| Subcollection `…/private/{doc}` | PINs, hand-off codes, commission, workspace, notes, store settings | a private column on the same row (`meta`, `settings`, `workspace`, `notes`); serializers never return it; separate staff-only endpoints read it | §3.3 |
| Subcollection of a user (`jobsites`, `cards`, `favorites`, `devices`) | customer data | own tables with `user_id` | §3.2 |
| Firestore transaction | atomic coupled changes | SQL transaction (READ COMMITTED) with ordered row locks | §3.6, §9 |
| `create()` (fail if it exists) | ledger entries, notification keys | `INSERT … ON CONFLICT DO NOTHING` | §9 |
| `FieldValue.increment` | stock, unread counters | `SET n = n + $1` on an owned column | §3.1 |
| `serverTimestamp()` / `request.time` | instants | `now` from the application clock, one per command | §3.1 |
| Document trigger (`onDocumentWritten`, `onDocumentCreated`) | projections and side effects | DB-only work: a function called **in the same transaction** by every command that changes the row. Network work: an outbox event written in that transaction | §9.4 |
| Trigger event id | idempotency of notifications | a dedupe key built from the business identity (`so-…-v{version}`); unique per recipient | §10.2 |
| Scheduled function (`onSchedule`) | escalations, expiries, payouts, capture sweep | a job in the in-process scheduler, guarded by an advisory lock; body `runX(now)` | §9.5 |
| Security rule, read | who may read a document | endpoint policy + object check + role-aware serializer | §7 |
| Security rule, validated client write | jobsites, cards, favourites, reviews, messages, read flags, product edits, staff assignments, device tokens, driver locations, preferences | a REST write endpoint that runs the same checks (zod + shared validators) | §5.3 |
| `rules-unit-testing` tests | rules | authorization tests against the endpoints | §12.4 |
| Composite index | queries | SQL index; the 37 rows of MARKETPLACE §6.5 are mapped in §3.4 | §3.4 |
| Field override "not indexed" | large arrays | nothing to do: only columns are indexed | — |
| TTL policy (`expiresAt`) | `rateLimits`, `otpChallenges`, `devOutbox` | the internal job `purgeExpiredRows` | §9.5 |
| Listener (`onSnapshot`) | live screens | REST read + subscription to a live topic; an event invalidates, the client refetches; polling when the socket is down | §8 |
| Custom claims (`role`, `active`, `storeId`, `storeRole`, `cityId`, `capacityClass`) | authorization | columns of `users`, read on every request. `GET /api/v1/me` returns them inside `profile`. No token refresh is ever needed after a role change | §6.4 |
| Firebase Auth user, `disabled`, `revokeRefreshTokens` | accounts, suspension | `users` + `sessions`; suspension sets `status = 'suspended'` and revokes every session in one transaction; it takes effect on the next request and closes live sockets | §6 |
| ID token (1 h) / refresh token | session | access JWT (15 min) / rotating opaque refresh token | §6.2 |
| `generatePasswordResetLink` | invites | one-time set-password link `WEB_URL/set-password#token=…` (the secret is in the fragment, which browsers never send to a server, so it reaches no access log) | §6.3 |
| Phone number on the Auth user | uniqueness of a verified number | partial unique index `users_phone_key` | §3.2 |
| `counters/*` documents | human numbers | sequences `order_number_seq`, `quote_number_seq`, `issue_number_seq` | §3.2 |
| Cloud Storage + Storage rules | photos and uploads | `files` table + `Storage` driver; upload tickets checked per purpose; authorized download URLs | §10.1 |
| `getDownloadURL` | `imageUrl`, `photoUrl` | `API_URL/api/v1/media/<path>`, derived by the serializer | §10.1 |
| FCM through the Admin SDK | push | Expo push service only | §10.2 |
| App Check | abuse protection of public callables | not available. Replaced by per-IP and per-account rate limits and strict CORS | §4.6 |
| Functions region, `.env.<project>`, Secret Manager | configuration | environment variables on Railway (§11); nothing secret in the repository | §11 |
| Emulator Suite | local development and tests | local PostgreSQL, `local` storage driver, `outbox` SMS and mail drivers, `TestGateway` | §2.6, §12 |
| `devOutbox` collection | SMS without a provider | `dev_outbox` table, now also for email | §10.3 |

### 1.3 Names used everywhere

| Thing | Name |
| --- | --- |
| API base path | `/api/v1` |
| Development API origin | `http://localhost:4000` |
| Command endpoint | `POST /api/v1/call/<name>` |
| Live endpoint | `GET /api/v1/live` (WebSocket upgrade) |
| Health check | `GET /api/v1/health` |
| Bundles | `backend/dist/server.js` (the server), `backend/dist/cli.js` (`migrate`, `create-admin`, `seed --demo`, `storage-cors`) |
| NOTIFY channels | `is_live` (realtime events), `is_outbox` (wake the worker) |
| Development database | `instasupply_dev` |
| Test databases | `instasupply_test_<stamp>_<rand>_tpl` (template) and `…_<n>` (one per test file), on the server named by the libpq variables `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` |
| Local file root | `backend/.data/files` |
| Access token | JWT, HS256, 15 minutes |
| Refresh token | `isr_<tokenId>.<secret>` |
| Set-password token | `isp_<tokenId>.<secret>`, delivered as `WEB_URL/set-password#token=…` |

---

## 2. `backend/` layout

**Folder boundaries.** The repository keeps the backend, the web frontend and the apps in separate
top-level folders. Each one is its own npm workspace with its own `package.json`, `tsconfig.json`,
environment file, tests, build and deployment. Everything this document specifies lives in
`backend/`; it adds no file to `frontend/` or `app/`. `docs/CLIENTS.md` states the same rules from
the clients' side.

```
instasupply/
├── backend/             the API server: this document                         @instasupply/backend
├── frontend/            the web console (ops, supplier portal, tracking page) @instasupply/frontend
├── app/
│   ├── customer/        the customer app (Expo)                               @instasupply/customer
│   └── driver/          the driver app (Expo)                                 @instasupply/driver
├── packages/
│   ├── shared/          domain types and pure rules: the server and every client
│   ├── api-client/      the client data layer (docs/CLIENTS.md): clients only
│   └── art/             images and icons: clients only
├── legacy/              the Firebase build, kept for reference: nothing imports it
├── scripts/             repository tools: smoke test, Android builds (docs/DEPLOYMENT.md)
├── .railway/            the Railway environment as code (docs/DEPLOYMENT.md §2.2)
└── docs/
```

This is the target layout: `packages/api-client` does not exist yet and replaces today's
`packages/expo-firebase` (`docs/CLIENTS.md` §3.5). The other folders exist today.

| Rule | How it is kept |
| --- | --- |
| Server code lives only in `backend/` | Source, migrations, seed data, tests, development scripts, `Dockerfile` and `.env.example` are all inside it (§2.1). At run time the server reads `backend/migrations` and, with the `local` storage driver, writes below `STORAGE_LOCAL_DIR` (`backend/.data/files` in development, a temporary folder in tests). It reads and writes no file of `frontend/` or `app/`. |
| `backend/` imports exactly one workspace package: `@instasupply/shared` | It is the only `@instasupply/*` entry in `backend/package.json` (§2.3). The lint block below makes any other one an error. The image is built from the root manifests, `backend/` and `packages/shared` alone (`docs/DEPLOYMENT.md` §2.3), so a stray import also fails the build. |
| `backend/` never imports a file of `frontend/`, `app/`, `packages/api-client`, `packages/art` or `legacy/` | The same lint block. Code that is ported from `legacy/` is copied into `backend/src` and rewritten (§13.3), never imported. |
| No client imports from `backend/` | The contract between a client and the server is the HTTP and WebSocket API of §4, §5 and §8, nothing else. `@instasupply/backend` is `private` and has no `main` and no `exports`. Shapes both sides need live in `packages/shared`; the few that are not there yet are declared once on each side (§5.4). |
| Each folder runs, builds and deploys alone | `npm run dev:backend` starts only the API. `backend/` becomes the Railway service `backend`, `frontend/` a separate service, and the two apps are built into APKs (`docs/DEPLOYMENT.md`). |
| Each folder has its own configuration | The server reads the variables of §11 (`backend/.env` is optional and is never committed). The console and the apps have their own files and variables (`docs/CLIENTS.md` §8). No folder reads another folder's environment file. |

The backend workstream adds one block to the root `eslint.config.mjs` (after the existing blocks)
and changes nothing else in that file:

```js
{
  // Folder boundary: the server imports @instasupply/shared and nothing else from this repository.
  files: ['backend/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        { regex: '^@instasupply/(?!shared(/|$))', message: 'backend/ may import only @instasupply/shared.' },
        { regex: '^(\\.\\./)+(frontend|packages|legacy|app/(customer|driver))(/|$)',
          message: 'backend/ may not import files of another top-level folder.' },
      ],
    }],
  },
},
```

`regex` patterns are supported by the installed ESLint (10.15.0, read in
`node_modules/eslint/lib/rules/no-restricted-imports.js`); both expressions were tried on sample
import strings. The rule also covers `import type`. `backend/src/app.ts` stays importable as
`'../app'`: the second pattern needs `app/customer` or `app/driver`.

### 2.1 Folders and files

`platform/` holds everything that is not domain logic. `modules/` mirrors MARKETPLACE §5.1, one
folder per module, one owner per folder. A module never edits another module's files; it imports the
helpers listed in §9.1.

```
backend/
├── package.json                 @instasupply/backend (§2.2, §2.3)
├── tsconfig.json                §2.4
├── build.mjs                    esbuild bundle (§2.5)
├── Dockerfile                   built from the repository root; specified in docs/DEPLOYMENT.md §2.3
├── .env.example                 every variable of §11.1 with its development default
├── migrations/
│   └── 0001_init.sql            the DDL of §3.2, pasted unchanged
├── scripts/                     development-only tools (run with tsx; `no-console` is off here)
│   ├── simulate-driver.ts       drives a seeded driver through the HTTP API (port of legacy/scripts)
│   └── db.ts                    `npm run db -- reset | status`
├── src/
│   ├── server.ts                process entry (§2.6) → dist/server.js
│   ├── cli.ts                   command-line entry (§2.6) → dist/cli.js: migrate | create-admin | seed | storage-cors |
│   │                            revoke-sessions
│   ├── cli/
│   │   ├── migrate.ts           apply migrations, then upsert reference data (the 25 categories); exit 0 or 1
│   │   ├── create-admin.ts      first administrator: prints a one-time set-password link to stdout
│   │   ├── revoke-sessions.ts   `revoke-sessions --email <e>`: revokes every session of one account (§6.3.6)
│   │   ├── seed.ts              `seed --demo`: MARKETPLACE §11. Accounts and catalogue through repositories;
│   │   │                        every order, quote, issue and status change through the real commands (app.inject);
│   │   │                        job bodies called directly; clock, locks and passwords as in §2.2
│   │   ├── seed/                categories.ts, stores.ts, products.ts, accounts.ts, jobsites.ts, scenarios.ts
│   │   └── storage-cors.ts      puts the CORS rule of §10.1 on the bucket, from CORS_ORIGINS
│   ├── app.ts                   buildApp(deps): the Fastify instance with every plugin and route
│   ├── container.ts             createDeps(config): { config, log, clock, pool, storage, sms, mail, push,
│   │                            gateway, live, outbox, scheduler }; tests replace single members
│   ├── config/
│   │   ├── env.ts               zod schema of §11.1 → typed `config`; refuses unsafe production values
│   │   └── public-config.ts     builds the GET /api/v1/config payload (§11.2)
│   ├── platform/
│   │   ├── clock.ts             Clock { now(): number }; systemClock; FakeClock lives in test/support
│   │   ├── ids.ts               newId (UUIDv4), isRequestId, newTrackingToken, newHandoffCode, newPickupCode
│   │   ├── crypto.ts            hmacHex(domain, value) keyed with OTP_PEPPER, sha256Hex, safeEqualHex, randomDigits
│   │   ├── logger.ts            pino options: string `level`, message key `message`, redaction list (§4.3)
│   │   ├── db/
│   │   │   ├── pool.ts          createPool(config): pg.Pool, type parsers, session settings (§3.1)
│   │   │   ├── tx.ts            withTransaction, Tx, RetryTransaction (§3.6)
│   │   │   ├── locks.ts         lockRows, lockGraph, LOCK_RANK (§3.6)
│   │   │   ├── sequences.ts     nextNumber(tx, 'order' | 'quote' | 'issue')
│   │   │   ├── json.ts          jsonb(value) = JSON.stringify(value); never pass objects or arrays raw
│   │   │   └── ensure-database.ts  create the development database when it is missing
│   │   ├── migrations/
│   │   │   └── migrator.ts      migrate(pool, dir), status(pool, dir)
│   │   ├── http/
│   │   │   ├── contract.ts      the REST types of §5.4 (the same shapes packages/api-client declares)
│   │   │   ├── errors.ts        ApiError, fail, failCode, invalidArgument, notFound, permissionDenied,
│   │   │   │                    failedPrecondition, HTTP_STATUS (§4.2)
│   │   │   ├── error-handler.ts setErrorHandler and setNotFoundHandler → the error envelope
│   │   │   ├── command.ts       defineCommand, the registry, POST /api/v1/call/:name (§5.1)
│   │   │   ├── route.ts         defineRoute: policy + zod schemas + handler for REST endpoints
│   │   │   ├── context.ts       RequestContext { actor, ip, requestId, log, deps }
│   │   │   ├── validation.ts    parse(schema, value): zod issues → invalid-argument with details.fields
│   │   │   ├── pagination.ts    Page<T>, readPage, encodeCursor, decodeCursor (§4.4)
│   │   │   ├── rate-limit.ts    consumeRateLimit, BUCKETS, options of the in-memory limiter (§4.6)
│   │   │   ├── cors.ts          origin list from CORS_ORIGINS (§4.8)
│   │   │   ├── client-address.ts  clientAddress(req) (§4.6) and publicOrigin(req) (§11.1): the only readers of
│   │   │   │                    the caller's address and of the server's own public origin
│   │   │   ├── security-headers.ts  helmet options (§4.8)
│   │   │   └── health.ts        GET /api/v1/health, GET /api/v1/config
│   │   ├── auth/
│   │   │   ├── passwords.ts     hashPassword, verifyPassword, needsRehash (scrypt, §6.1)
│   │   │   ├── tokens.ts        signAccessToken, verifyAccessToken, mintRefreshToken, parseRefreshToken
│   │   │   ├── sessions.ts      createSession, rotate, revokeSession, revokeAllSessions
│   │   │   ├── actor.ts         Actor, loadActor(pool, uid, sid)
│   │   │   ├── authenticate.ts  onRequest hook: Authorization header → ctx.actor (§6.4)
│   │   │   └── policies.ts      requireAuth, requireStaff, requireAdmin, requireCustomer, requireSupplier,
│   │   │                        requireStoreAccess, requireActiveDriver, requireOperator (§7.1)
│   │   ├── live/
│   │   │   ├── protocol.ts      the message types of §8.1
│   │   │   ├── topics.ts        topic patterns, authorizeTopic(actor, topic), topicsFor(table, row) (§8.2)
│   │   │   ├── publish.ts       publishChange(tx, table, kind, row), publish, publishNow, publishControl
│   │   │   ├── listener.ts      the dedicated LISTEN connection with reconnect (§8.3)
│   │   │   ├── hub.ts           sockets, subscriptions, delivery, dropUser, dropSession
│   │   │   └── ws-route.ts      GET /api/v1/live
│   │   ├── outbox/
│   │   │   ├── outbox.ts        enqueue(tx, event, payload, options)
│   │   │   ├── registry.ts      registerHandler(event, handler)
│   │   │   └── worker.ts        claim loop, backoff, reaper, drain() (§9.3)
│   │   ├── scheduler/
│   │   │   ├── registry.ts      registerJob({ name, schedule, run })
│   │   │   └── scheduler.ts     tick, advisory locks, runJob(name, now) (§9.5)
│   │   ├── storage/
│   │   │   ├── storage.ts       Storage interface, createStorage(config) (§10.1)
│   │   │   ├── local-driver.ts
│   │   │   ├── s3-driver.ts
│   │   │   ├── purposes.ts      FILE_PURPOSES: prefix, size, content types, who uploads, who reads
│   │   │   ├── files.service.ts presignUpload, confirmUpload, requireReadyFile, authorizeRead, fileUrl, mediaUrl
│   │   │   ├── files.repository.ts
│   │   │   └── files.routes.ts  /files/presign, /files/confirm, /files/url, /files/local/{uploadId}, /media/*
│   │   ├── sms/                 sms.ts (SmsSender, createSms), outbox-driver.ts, twilio-driver.ts, sms.handler.ts
│   │   ├── mail/                mail.ts (MailSender, createMail), outbox-driver.ts, resend-driver.ts, smtp-driver.ts,
│   │   │                        templates.ts, mail.handler.ts
│   │   ├── push/                expo.ts (send, receipts), channels.ts (channelFor, pushAllowed), push.handler.ts,
│   │   │                        receipts.job.ts
│   │   └── payments/            gateway.ts (PaymentGateway), test-gateway.ts, stripe-gateway.ts (throws "not
│   │                            implemented"), index.ts (createGateway by PAYMENTS_MODE)
│   └── modules/
│       ├── auth/                routes.ts (register, login, refresh, logout, sessions, password, invites, GET /me),
│       │                        account.service.ts, phone-otp.ts, staff.ts (createStaffUser, PATCH /users/{uid}/status),
│       │                        supplier-users.ts, sessions-admin.ts (GET /users/{uid}/sessions, revoke-all),
│       │                        users.routes.ts, users.repository.ts, serializers.ts (toUserProfile, toMeResponse),
│       │                        schemas.ts
│       ├── drivers/             register-driver.ts, driver-status.ts (setDriverStatus and the release of §9.2.9),
│       │                        driver-vehicle.ts (updateDriverVehicle, reviewDriverVehicle), payout-account.ts
│       │                        (PATCH /users/{uid}/payout-account), stale-drivers.ts (markStaleDriversOffline),
│       │                        routes.ts, schemas.ts
│       ├── account/             (new: these were client writes under rules) routes.ts (PATCH /me, jobsites, cards,
│       │                        favorites, buy-again, devices, cart), profile.service.ts, jobsites.repository.ts,
│       │                        cards.repository.ts, favorites.repository.ts, devices.repository.ts,
│       │                        carts.repository.ts, schemas.ts
│       ├── commerce/            register-customer.ts, place-order.ts, cancel-order.ts, order-writer.ts
│       │                        (stageMarketplaceOrder), checkout-context.ts, order-aggregate.ts
│       │                        (projectOrderAggregate), orders.repository.ts, routes.ts, schemas.ts
│       ├── payments/            payment-service.ts (authorize, void, finalize, refund), authorization-journal.ts,
│       │                        capture-sweep.ts (captureDuePayments), handlers.ts (payment.* outbox handlers),
│       │                        repository.ts
│       ├── stores/              catalogue and stores: store-admin.ts (createStore, updateStoreSettings,
│       │                        updateStoreProfile), product-derivation.ts (was onProductWritten), store-fanout.ts
│       │                        (was onStoreWritten), reviews.ts (was onStoreReviewWritten), stores.repository.ts,
│       │                        products.repository.ts, categories.repository.ts, catalog.routes.ts, schemas.ts
│       ├── store-orders/        accept-store-order.ts, update-store-order-status.ts, reject-store-order.ts,
│       │                        complete-pickup.ts, transitions.ts (stageStoreOrderTransition), stock.ts
│       │                        (stageStock*), pickup-code.ts, driver-projection.ts (projectDriverOntoStoreOrder),
│       │                        store-order-effects.ts (was onStoreOrderWritten), scheduled.ts (escalateStoreOrders,
│       │                        expirePickupHolds), store-orders.repository.ts, stock.repository.ts, routes.ts
│       │                        (GET /store-orders…), schemas.ts
│       ├── deliveries/          delivery-writer.ts (stageMarketplaceDelivery, stageDeliveryCancellation,
│       │                        stageNewDelivery), update-status.ts (updateDeliveryStatus, completeDelivery),
│       │                        assign-delivery.ts, create-deliveries.ts, check-in.ts, resolve-failed.ts,
│       │                        delivery-effects.ts (was onDeliveryWritten), repository.ts, routes.ts, schemas.ts
│       ├── jobs/                offers.ts (stageJobOffer, deleteJobOffer), claim-job.ts, boost.ts (P1),
│       │                        publish-due-offers.ts, offer-effects.ts (was onJobOfferWritten), repository.ts,
│       │                        routes.ts
│       ├── routing/             planner.ts, providers.ts, optimize-route.ts, route.handler.ts (outbox
│       │                        `route.plan`), repository.ts, routes.ts
│       ├── tracking/            tracking-service.ts, location.ts (was onDriverLocationWritten), eta.handler.ts
│       │                        (outbox `tracking.eta`), repository.ts, routes.ts
│       ├── geocoding/           geocoder.ts (providers, cache, throttle), command.ts (geocodeAddress)
│       ├── maintenance/         purge.ts (purgeExpiredRows), run-job-now.ts
│       ├── quotes/              submit-material-list.ts, send-quote.ts, accept-quote.ts, close-quote.ts,
│       │                        reopen-quote.ts, expire-quotes.ts, repository.ts, routes.ts, schemas.ts
│       ├── issues/              report-issue.ts, resolve-issue.ts, repository.ts, routes.ts, schemas.ts
│       ├── support/             messages.ts (was onSupportMessageCreated), repository.ts, routes.ts
│       ├── suggestions/         suggest-store.ts, repository.ts, routes.ts
│       ├── payouts/             ledger.ts (recordStoreOrderLedger, recordDeliveryLedger, recordClawback, holds),
│       │                        daily-payouts.ts (runDailyPayouts), transfer.handler.ts (outbox
│       │                        `payout.transfer`), repository.ts, routes.ts
│       ├── notifications/       notify.ts (notify, notifyUsers, notifyStaff, notifyStoreMembers, notifyDrivers),
│       │                        inbox.routes.ts, test-notification.ts, repository.ts
│       ├── chat/                messages.ts (was onChatMessageCreated), repository.ts, routes.ts
│       └── ops/                 (new) dashboard.ts, routes.ts (dashboard, store statistics, job state, dev outbox,
│                                outbox events)
└── test/                        §12
    ├── support/                 run.ts, database.ts, app.ts, actors.ts, fixtures.ts, clock.ts, outbox.ts, live.ts,
    │                            race.ts
    ├── platform/                *.test.ts
    ├── auth/                    *.test.ts
    ├── authorization/           *.authz.test.ts (the old rules tests)
    └── workflows/               *.test.ts (the old emulator workflows)
```

Rules for every module folder:

- `index.ts` exports `register(app, deps)`. It registers the module's REST routes, its commands
  (`defineCommand`), its outbox handlers (`registerHandler`) and its jobs (`registerJob`). `app.ts`
  calls every module's `register` and nothing else from the module.
- `routes.ts` (or `*.routes.ts`) contains HTTP only: policy, zod schema, call the service, serialize.
- Service files (named as in MARKETPLACE §5.1) contain the domain logic and own their transactions.
- `repository.ts` (or `*.repository.ts`) contains every SQL statement of the module and the
  row ↔ document mapping. SQL appears nowhere else.
- `schemas.ts` contains the zod schemas of the module's requests. A schema is named
  `<TypeName>Schema` and its inferred type must be assignable to the shared type (checked with
  `satisfies z.ZodType<PlaceOrderRequest>`).
- MARKETPLACE §5.1 lists a module `sms/`. It became `platform/sms/` (a provider, not domain logic).
- MARKETPLACE §5.1's `stores/` is split into `stores/` (catalogue and stores) and `store-orders/`, and the
  driver account commands live in `drivers/` instead of `auth/`, so that each workstream of §15 owns whole
  folders. `maintenance/` keeps the platform jobs `purgeExpiredRows` and `runJobNow`.

### 2.2 `package.json` scripts

```json
{
  "name": "@instasupply/backend",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "tsx watch --env-file-if-exists=.env src/server.ts",
    "build": "node build.mjs",
    "start": "node dist/server.js",
    "migrate": "tsx --env-file-if-exists=.env src/cli.ts migrate",
    "seed": "tsx --env-file-if-exists=.env src/cli.ts seed --demo",
    "create-admin": "tsx --env-file-if-exists=.env src/cli.ts create-admin",
    "simulate": "tsx --env-file-if-exists=.env scripts/simulate-driver.ts",
    "db": "tsx --env-file-if-exists=.env scripts/db.ts",
    "test": "tsx test/support/run.ts",
    "typecheck": "tsc --noEmit -p ."
  }
}
```

| Script | What it does |
| --- | --- |
| `dev` | Starts the API on `PORT` (4000). With the development defaults it creates the database `instasupply_dev` if it is missing, applies pending migrations, then serves HTTP, WebSocket, the outbox worker and the scheduler. Restarts on file changes. |
| `build` | Bundles `src/server.ts` → `dist/server.js` and `src/cli.ts` → `dist/cli.js` (§2.5). |
| `start` | Runs the bundle. Does **not** migrate when `NODE_ENV=production` (`MIGRATE_ON_START` is false there). |
| `migrate` | Applies pending migrations to `DATABASE_URL`, upserts the reference data, exits 0 or 1. `-- --status` lists applied and pending files. In the image: `node dist/cli.js migrate`. |
| `seed` | `seed --demo` writes the demo data of MARKETPLACE §11. It builds the app in-process (no port), runs scenarios A to K through `app.inject`, calls the job bodies of §9.5 directly (`runX(deps, now)`; never the `runJobNow` command, so `ALLOW_TEST_JOBS` stays `false`) and drains the outbox after every step. **Clock:** the real clock by default; MARKETPLACE §11 makes every scenario valid at any time of day (ASAP when every store in it can do ASAP now, else the earliest valid window; amounts never depend on time). `--at <ISO instant>` runs on a `FakeClock` starting there instead (refused when `NODE_ENV=production`); CI and `seed-smoke.test.ts` use `--at 2026-11-19T12:25:00-05:00`, the reference time of MARKETPLACE §4.8. **Next to a live server:** for its whole run the seed holds the advisory lock of every scheduled job (statement (l), `pg_advisory_lock` on one dedicated connection), so a running scheduler skips those jobs until the seed ends; the outbox worker of a live server may handle seed events, which is harmless because every handler is idempotent (§9.3). Afterwards the scenarios age in real time: Voltway's `new` store order of scenario B is reminded and auto-rejected when its real deadline passes. **Guards:** refuses when the `orders` table is not empty (the IS-1000x numbers of MARKETPLACE §11.5 must start at IS-10001); `-- --reset` first truncates every table and restarts the sequences, and is refused when `NODE_ENV=production`. **Passwords:** demo customers, drivers and supplier users get `SEED_PASSWORD` (development default `Instasupply@123`; with `NODE_ENV=production` the command refuses when it is unset or is that default). The two demo staff accounts (`admin@instasupply.test`, `dispatch@instasupply.test`) get **no** password in production: the seed issues a set-password link for each (§6.3.8) and prints it, so a shared demo password never opens the console as staff. Outside production they get `SEED_PASSWORD` like the rest. It prints the accounts, the staff links, B's Kestrel tracking link, C's PIN and the simulator command. In the image: `node dist/cli.js seed --demo`. |
| `create-admin` | `-- --email ops@example.com --name "Ops Lead"`: creates the admin (or finds it) and prints a one-time set-password link to standard output, nowhere else. In the image: `node dist/cli.js create-admin --email … --name …`. |
| `simulate` | `-- --driver marco@instasupply.test --speed 60`: signs in over HTTP and plays a driver (MARKETPLACE §11.5, last paragraph). |
| `db` | `reset` drops and recreates the development database; `status` prints migration state. Development only. |
| `test` | The runner of §12.1. `-- test/workflows/checkout-workflow.test.ts` runs one file. |
| `typecheck` | `tsc --noEmit`. |

The root `package.json` already has `dev:backend`. Its owner adds `test:backend`
(`npm --workspace @instasupply/backend run test`) and `build:backend`.

### 2.3 Dependencies

Versions were read from the npm registry on 2026-11-19 (`npm view <name> version`); see §13.

| Package | Version | Used for |
| --- | --- | --- |
| `@instasupply/shared` | `*` (workspace) | domain types, state machines, pricing, time, validators; inlined by the bundle |
| `fastify` | `^5.12.8` | HTTP server |
| `@fastify/websocket` | `^11.3.7` | `/api/v1/live` (wraps `ws`) |
| `@fastify/cors` | `^11.4.3` | CORS |
| `@fastify/helmet` | `^13.2.0` | security headers |
| `@fastify/rate-limit` | `^11.2.2` | per-IP request limiter (in memory) |
| `@fastify/multipart` | `^10.1.9` | the upload target of the `local` storage driver only |
| `pg` | `^8.23.1` | PostgreSQL driver (pure JavaScript; `pg-native` is not installed) |
| `zod` | `^4.6.7` | request schemas, environment schema |
| `jose` | `^6.2.18` | sign and verify the HS256 access token |
| `@aws-sdk/client-s3` | `^3.1172.0` | `s3` storage driver (HeadObject, GetObject, PutObject, DeleteObject) |
| `@aws-sdk/s3-presigned-post` | `^3.1172.0` | presigned upload forms |
| `@aws-sdk/s3-request-presigner` | `^3.1172.0` | presigned download URLs |
| `nodemailer` | `^10.6.0` | `smtp` mail driver |

| Dev package | Version | Used for |
| --- | --- | --- |
| `@types/node` | `^22.15.0` | same line as `packages/shared` |
| `@types/pg` | `^8.23.1` | |
| `@types/ws` | `^8.18.2` | the `WebSocket` type in handlers |
| `@types/nodemailer` | `^8.0.2` | |
| `pino-pretty` | `^13.2.0` | readable logs in development (`LOG_PRETTY=true`) |
| `esbuild` | `^0.28.2` | `build.mjs` |

`tsx` (`^4.20.0`) and `typescript` (`~6.0.3`) come from the root `package.json`. Not used on purpose:
an ORM or query builder (P1), `bcrypt`/`argon2` (native builds; scrypt is in `node:crypto`),
`firebase-admin`, `expo-server-sdk` (two `fetch` calls, ported from
`legacy/firebase/functions/src/modules/notifications/push.ts`), a Twilio or Resend SDK (one `fetch`
call each), `dotenv` (Node's `--env-file-if-exists`), `jsonwebtoken`.

Fastify logs with pino, which it brings itself (`fastify@5.12.8` depends on `pino ^9.14.0 || ^10.1.0`).

### 2.4 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src", "test", "scripts"]
}
```

The same options as `packages/shared` and the legacy functions. Imports have no file extension
(`moduleResolution: "bundler"`); TypeScript is never run by plain `node`, only by `tsx` (development,
tests, scripts) or after bundling.

### 2.5 How `@instasupply/shared` is consumed

`packages/shared` ships TypeScript source (`"main": "src/index.ts"`) and has no build step.

- **Development, tests, scripts:** `tsx` compiles it on the fly through the workspace link in
  `node_modules`. Nothing to configure.
- **Production:** `build.mjs` bundles with esbuild. `@instasupply/shared` is inlined; every package
  listed under `dependencies` stays external and is installed in the image.

```js
// backend/build.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const here = import.meta.dirname;
const pkg = JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8'));
const external = Object.keys(pkg.dependencies)
  .filter((name) => name !== '@instasupply/shared')
  .flatMap((name) => [name, `${name}/*`]);

await build({
  entryPoints: { server: path.join(here, 'src/server.ts'), cli: path.join(here, 'src/cli.ts') },
  outdir: path.join(here, 'dist'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
  external,
});
```

Both entries live one folder below `backend/` (`src/` in development, `dist/` in the image), so
`path.resolve(import.meta.dirname, '../migrations')` finds the migration files in both cases, whatever
the working directory. No other file is read from disk at run time. The seed data files are part of
the `cli` bundle.

### 2.6 Process lifecycle

**Start (`src/server.ts`), in this order**

1. `loadConfig()`: parse and validate the environment (§11.1). An invalid or unsafe value stops the
   process with a message that names the variable.
2. `DATABASE_AUTO_CREATE=true` (development default): `ensureDatabase()` connects to the maintenance
   database `postgres` on the same server and runs `CREATE DATABASE "<name>"` when the database of
   `DATABASE_URL` does not exist. The name must match `^[a-z][a-z0-9_]{0,62}$`.
3. `createPool()`.
4. `MIGRATE_ON_START=true` (development and test default): `migrate(pool, dir)` and
   `syncReferenceData()`, exactly what the `migrate` command does.
5. `createDeps()`: storage, SMS, mail, push, gateway, live hub, outbox worker, scheduler.
6. `buildApp(deps)`, `app.listen({ host: config.HOST, port: config.PORT })`.
7. Start the LISTEN connection, then the outbox worker (`RUN_WORKER`), then the scheduler
   (`RUN_SCHEDULER`).

**Stop (SIGTERM or SIGINT)**

1. Stop the scheduler timer and the worker loop (no new job, no new claim).
2. Close every WebSocket with code 1012, then `app.close()`: new requests get 503
   (`return503OnClosing`), in-flight requests finish.
3. Wait for running jobs and handlers, at most `SHUTDOWN_GRACE_MS` (20 000). A handler that is cut off
   is retried later (§9.3).
4. End the LISTEN connection and the pool; exit 0. The whole stop takes less than 30 s.

Railway sends SIGTERM and then SIGKILL after the service's draining time, which is **0 seconds by
default** (§13). `docs/DEPLOYMENT.md` sets it to 30 s for the backend service.

**CLI (`src/cli.ts`)**: `node dist/cli.js <command>`; each command loads the same configuration as
the server, does its work, closes the pool and exits 0 or 1.

| Command | Does |
| --- | --- |
| `migrate [--status]` | the migrator below, then `syncReferenceData()`: inserts the 25 categories of `CATEGORIES` (shared) that are missing; existing rows are left alone, so staff edits survive. Idempotent. This is the Railway pre-deploy command. |
| `create-admin --email <e> --name <n>` | §6.3.8 without an inviter: creates the admin account when the email is free, issues a fresh set-password link either way and prints it. |
| `seed --demo [--reset] [--at <ISO>]` | the demo data of MARKETPLACE §11 (see the script table in §2.2: clock, job locks, guards, staff links) |
| `revoke-sessions --email <e>` | revokes every session of that account with reason `admin` (the clean-up of §6.3.6, `drop_user`). For when no administrator can sign in, or after a leak (`docs/DEPLOYMENT.md` §4.7). |
| `storage-cors` | `PutBucketCors` on `S3_BUCKET` with the rule of §10.1, built from `CORS_ORIGINS`. Run once after the first deployment and after every change of the console's origin. |

**Migrator (`platform/migrations/migrator.ts`)**

- Files: `backend/migrations/NNNN_name.sql`, four digits, applied in ascending order. Forward only:
  there are no down migrations, and a released file is never edited.
- Table `schema_migrations (version integer PRIMARY KEY, name text NOT NULL, checksum text NOT NULL,
  applied_at timestamptz NOT NULL)`, created by the migrator itself (it is not in `0001_init.sql`).
- `migrate()` takes `pg_advisory_lock(hashtextextended('instasupply:migrate', 0))` on one connection,
  so two processes starting together apply each file once. Each file runs in its own transaction
  together with its `schema_migrations` row. A file whose first line is `-- migrate:no-transaction`
  runs outside a transaction (for a later `CREATE INDEX CONCURRENTLY`).
- If the SHA-256 of an applied file differs from the stored checksum, `migrate()` fails and names the
  file.
- Exit code 0 when nothing is pending or everything applied; 1 otherwise.

### 2.7 What the backend guarantees to the image and to Railway

`docs/DEPLOYMENT.md` owns `backend/Dockerfile` (§2.3 there), `.railway/railway.ts` and every Railway
step. Its §2.1 lists what it expects from the backend; this table is the backend's side of that
contract.

| Item | Guarantee |
| --- | --- |
| Build | `npm run build --workspace @instasupply/backend`, run from the repository root with the root and backend dependencies installed, writes `backend/dist/server.js` and `backend/dist/cli.js`: ES-module bundles that contain `@instasupply/shared` and import every other dependency from `node_modules` |
| Files needed at run time | `backend/dist/**`, `backend/migrations/**`, `backend/package.json` (`"type": "module"`), and the production dependencies of `@instasupply/backend` |
| Start | `node dist/server.js` with `backend/` as the working directory. Listens on `PORT` (4000 in development; whatever Railway sets) on host `::`. Applies no migrations when `NODE_ENV=production` |
| Pre-deploy command | `node dist/cli.js migrate` (exit code 1 stops the deployment) |
| Shutdown | on SIGTERM: stops accepting requests, closes WebSockets, stops the timers and the outbox worker, exits within 30 s |
| Health check | `GET /api/v1/health` → 200 and `{ "status": "ok", … }` only when the database answers; no authentication |
| Public config | `GET /api/v1/config` (§11.2) |
| WebSocket | `/api/v1/live` accepts a connection without a token and without an `Origin` header |
| Client address | read from `X-Real-IP` by `clientAddress()` when `TRUST_PROXY=true`; Fastify's `trustProxy` is off and `request.ip` is never read (§4.6) |
| Demo data | `seed --demo` may run inside the live container next to the running server: it locks the scheduled jobs for its duration and refuses a non-empty `orders` table (§2.2) |
| Start-up | the server does not contact the bucket, the SMS or mail provider, or the Expo service while starting; only the database must answer |
| Logs | one JSON object per line on stdout, with a string `level` (`debug`, `info`, `warn`, `error`) and the text in `message` |
| Local files | the `local` storage driver writes under `backend/.data/` and nowhere else |
| Volumes | none: the server keeps no state on disk in production (`STORAGE_DRIVER=s3`) |
| Replicas | 1 is enough; 2 or more work without any change (§1, §8.3, §9.3, §9.5) |
| Variables | §11.1 |

---

## 3. Database

PostgreSQL 17. One database per environment, one schema (`public`), no extensions. The whole schema
is one migration, `backend/migrations/0001_init.sql` (§3.2). It was executed as written against
PostgreSQL 17.11 (in a transaction that was rolled back) together with the statements of §3.5: 40
tables, 148 indexes (primary keys and unique constraints included), 3 named sequences. It was executed again,
the same way, after the final edit of 2026-11-20 (40 tables, 148 indexes; statement (m) of §3.5 was run against
a `processing` row with a pending duplicate key and finished it as `done` without error).

### 3.1 Conventions

**Identifiers.** Every id is `text`. UUIDs are version 4, lower case, 36 characters. Composite ids
keep the formats of MARKETPLACE §1.1: store order `{orderId}-{letter}`, product `{storeId}--{skuSlug}`,
store slug, support thread `{uid}` or `store_{storeId}`, payout `{payeeType}_{payeeId}_{runKey}`,
deterministic ledger ids. Ids that a client generates (`orders`, `quotes`, `issues`, `jobsites`,
`cards`, chat and support messages) carry a `CHECK (is_uuid4(id))`. Clients create them with
`api.newRequestId()` (`docs/CLIENTS.md`).

**Document tables.** A row of a document table has four kinds of columns:

| Class | What | Written by | In `doc`? | Example |
| --- | --- | --- | --- | --- |
| **key** | the primary key, plus `created_at` | `INSERT` only | no | `orders.id`, `products.store_id` |
| **owned** | fields whose only truth is the column: hot counters, stock, copies maintained by SQL, private data, `updated_at` | `INSERT` and `UPDATE` | no | `products.reserved`, `stores.settings`, `store_orders.meta` |
| **mirror** | `GENERATED ALWAYS AS (…) STORED` from `doc` (or `meta`): filters, sorts, foreign keys | PostgreSQL | computed from it | `store_orders.status`, `orders.customer_id` |
| `doc` | the shared TypeScript document **without** its primary key, `createdAt`, `updatedAt` and the owned fields of that table | `INSERT` and `UPDATE` | — | `store_orders.doc` |

Rules that follow:

1. To change a mirrored field, write `doc`. `UPDATE store_orders SET status = …` fails with SQLSTATE
   428C9; that is intended.
2. A mirror declared `NOT NULL` makes the key mandatory in `doc`. A document that lacks `status`
   cannot be stored. Documents never contain `undefined`: an absent optional value is `null`.
3. The serializer of a table (its `toX(row)` function in the repository) is the only place that
   builds the API shape: `{ id, ...doc, ...owned public fields, createdAt, updatedAt }`. §3.3 lists
   the exact composition per table.
4. Private columns (`meta`, `settings`, `workspace`, `notes`, authentication columns) are not selected
   by the public serializers. They have their own repository functions and their own endpoints.
5. A few small tables have no `doc` because every field is a typed column (`cards`, `favorites`,
   `devices`, `driver_locations`, `store_reviews`, chat and support tables, `ledger_entries`,
   `payouts`, `store_suggestions`, `notifications`, `files`). `cards` in particular has no column
   that could hold a card number.

**Money** is `bigint` whole cents (an order of 100 lines × 9 999 units × $100 000.00 does not fit in
32 bits). Counters and stock are `integer`.

**Time.**

- Inside `doc` and on the wire every `…At` value is epoch milliseconds (a JSON number).
  `TimestampLike` is `number` (P3).
- `created_at`, `updated_at` and the mirror columns are `timestamptz`.
- **One clock.** A command reads `const now = deps.clock.now()` once and uses it for every timestamp
  it writes: document fields, `created_at`, `updated_at`, outbox `run_at`. SQL never calls `now()`
  for business data (the statements of §3.5 take `$now` as a parameter). Tests inject a `FakeClock`;
  `runJobNow` passes its own `now`. No server code calls `getHours()` (MARKETPLACE §4.7).
- Repositories pass instants to SQL as `new Date(ms)` and get them back as numbers (see the type
  parsers below). Business dates (`YYYY-MM-DD`) and clock times (`HH:MM`) are text, always
  America/Toronto, computed by the shared helpers.

**Pool (`platform/db/pool.ts`).**

```ts
import pg from 'pg';

// bigint (cents, identity ids) → number. Every value we store fits in 2^53 − 1.
pg.types.setTypeParser(pg.types.builtins.INT8, (text) => {
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new RangeError(`bigint out of range: ${text}`);
  return value;
});
// timestamptz → epoch milliseconds (P3). The built-in parser returns a Date.
const parseTimestampTz = pg.types.getTypeParser(pg.types.builtins.TIMESTAMPTZ) as (text: string) => Date;
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (text) => parseTimestampTz(text).getTime());

export function createPool(config: Config): pg.Pool {
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_SSL === 'require' ? { rejectUnauthorized: false } : undefined,
    max: config.DATABASE_POOL_MAX,               // 10
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'instasupply-api',
    statement_timeout: 15_000,
    lock_timeout: 8_000,
    idle_in_transaction_session_timeout: 30_000,
    options: '-c TimeZone=UTC',
  });
  pool.on('error', (error) => log.error({ err: error }, 'idle database client failed'));   // required, see §13
  return pool;
}
```

- `TimeZone=UTC` is set on every connection. The development server on this machine runs with
  `TimeZone = Asia/Kolkata`; nothing may depend on the server's zone.
- `jsonb` parameters are always passed as `JSON.stringify(value)` with a `::jsonb` cast. node-postgres
  turns a JavaScript array into a PostgreSQL array literal, which is wrong for a `jsonb` column.
- `text[]` parameters are passed as JavaScript arrays (`search_terms`, `entry_ids`, `= ANY($1)`).
- `jsonb` results arrive parsed. `real` and `double precision` arrive as numbers. There is no
  `numeric` column, on purpose (it would arrive as a string).
- Isolation level is the default, READ COMMITTED. Correctness comes from row locks (§3.6), not from
  SERIALIZABLE.

**Repository shape (every document table follows it).**

```ts
// modules/stores/store-orders.repository.ts
type Row = { id: string; doc: Omit<StoreOrder, 'id' | 'createdAt' | 'updatedAt'>; created_at: number; updated_at: number };
const COLUMNS = 'id, doc, created_at, updated_at';                       // never `meta`

export const toStoreOrder = (row: Row): StoreOrder =>
  ({ id: row.id, ...row.doc, createdAt: row.created_at, updatedAt: row.updated_at });

export async function insertStoreOrder(tx: Tx, order: StoreOrder, meta: StoreOrderPrivateMeta): Promise<void> {
  const { id, createdAt, updatedAt, ...doc } = order;
  await tx.query(
    `INSERT INTO store_orders (id, doc, meta, created_at, updated_at) VALUES ($1, $2::jsonb, $3::jsonb, $4, $5)`,
    [id, JSON.stringify(doc), JSON.stringify(meta), new Date(createdAt), new Date(updatedAt)],
  );
}

/** The row must be locked by the caller (§3.6). Sets updated_at = tx.now. */
export async function saveStoreOrder(tx: Tx, order: StoreOrder): Promise<StoreOrder> {
  const { id, createdAt: _c, updatedAt: _u, ...doc } = order;
  await tx.query(`UPDATE store_orders SET doc = $2::jsonb, updated_at = $3 WHERE id = $1`,
    [id, JSON.stringify(doc), new Date(tx.now)]);
  return { ...order, updatedAt: tx.now };
}
```

### 3.2 Schema: `backend/migrations/0001_init.sql`

Paste the block below as the file. Do not reorder it: tables are created in dependency order.

```sql
-- =====================================================================================
-- InstaSupply · migration 0001_init · PostgreSQL 17
-- Conventions (docs/PLATFORM.md §3.1):
--   * ids are text; money is bigint cents; instants inside documents are epoch milliseconds.
--   * `doc` holds the shared TypeScript document without its primary key, without
--     createdAt/updatedAt and without the fields listed as "owned columns" for the table.
--   * GENERATED columns mirror `doc` (or `meta`) for filters, sorts, keys and foreign keys.
--     They cannot be written, so they cannot drift from the document.
--   * created_at / updated_at are written by the repositories from the application clock.
--   * No extension is required.
--   * In comments, "§n" is a section of docs/PLATFORM.md and "MARKETPLACE §n" one of docs/MARKETPLACE.md.
-- =====================================================================================

-- ---------- helper functions ----------

CREATE FUNCTION ms_to_ts(ms bigint) RETURNS timestamptz
  LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT
  AS $$ SELECT to_timestamp(ms::double precision / 1000.0) $$;

CREATE FUNCTION jsonb_text_array(j jsonb) RETURNS text[]
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT COALESCE(array_agg(e ORDER BY o), '{}'::text[])
        FROM jsonb_array_elements_text(j) WITH ORDINALITY AS t(e, o) $$;

CREATE FUNCTION is_uuid4(v text) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT
  AS $$ SELECT v ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' $$;

-- ---------- human numbers (MARKETPLACE §1.1) ----------

CREATE SEQUENCE order_number_seq START WITH 10001 MINVALUE 10001 NO CYCLE;  -- IS-10001: orders and manual deliveries
CREATE SEQUENCE quote_number_seq START WITH 10001 MINVALUE 10001 NO CYCLE;  -- Q-10001
CREATE SEQUENCE issue_number_seq START WITH 10001 MINVALUE 10001 NO CYCLE;  -- CASE-10001

-- =====================================================================================
-- Stores and catalogue
-- =====================================================================================

CREATE TABLE stores (
  id            text PRIMARY KEY
                CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(id) BETWEEN 3 AND 40),
  doc           jsonb NOT NULL,              -- Store (rating, ratingCount are computed from the two columns below)
  settings      jsonb NOT NULL,              -- PRIVATE: StorePrivateSettings
  rating_sum    integer NOT NULL DEFAULT 0 CHECK (rating_sum >= 0),
  rating_count  integer NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  name          text GENERATED ALWAYS AS (doc->>'name') STORED NOT NULL,
  status        text GENERATED ALWAYS AS (doc->>'status') STORED NOT NULL
                CHECK (status IN ('onboarding', 'coming_soon', 'live', 'closed')),
  market_id     text GENERATED ALWAYS AS (doc->>'marketId') STORED NOT NULL,
  city_id       text GENERATED ALWAYS AS (doc->>'cityId') STORED NOT NULL,
  accepting_orders boolean GENERATED ALWAYS AS ((doc->>'acceptingOrders')::boolean) STORED NOT NULL,
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL
);
CREATE INDEX stores_market_idx ON stores (market_id, status);

CREATE TABLE categories (
  id          text PRIMARY KEY,
  doc         jsonb NOT NULL,                -- Category without id
  sort_order  integer GENERATED ALWAYS AS ((doc->>'sortOrder')::integer) STORED NOT NULL,
  active      boolean GENERATED ALWAYS AS ((doc->>'active')::boolean) STORED NOT NULL,
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL
);
CREATE INDEX categories_sort_idx ON categories (sort_order, id);

CREATE TABLE products (
  id            text PRIMARY KEY,            -- `${storeId}--${skuSlug}`
  store_id      text NOT NULL REFERENCES stores(id),
  doc           jsonb NOT NULL,              -- Product without id, storeId and the owned columns below
  -- owned columns (never inside doc)
  stock_on_hand integer NOT NULL DEFAULT 0 CHECK (stock_on_hand BETWEEN 0 AND 1000000),
  reserved      integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  store_name    text NOT NULL,
  store_status  text NOT NULL CHECK (store_status IN ('onboarding', 'coming_soon', 'live', 'closed')),
  search_terms  text[] NOT NULL DEFAULT '{}',
  -- mirrors
  sku           text GENERATED ALWAYS AS (doc->>'sku') STORED NOT NULL,
  name_sort     text COLLATE "C" GENERATED ALWAYS AS (lower(doc->>'name')) STORED NOT NULL,
  category_id   text GENERATED ALWAYS AS (doc->>'categoryId') STORED NOT NULL REFERENCES categories(id),
  family_key    text GENERATED ALWAYS AS (doc->>'familyKey') STORED,
  price_cents   bigint GENERATED ALWAYS AS ((doc->>'priceCents')::bigint) STORED NOT NULL
                CHECK (price_cents BETWEEN 1 AND 10000000),
  active        boolean GENERATED ALWAYS AS ((doc->>'active')::boolean) STORED NOT NULL,
  featured      boolean GENERATED ALWAYS AS ((doc->>'featured')::boolean) STORED NOT NULL,
  listed        boolean GENERATED ALWAYS AS (((doc->>'active')::boolean) AND store_status = 'live') STORED NOT NULL,
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL,
  CONSTRAINT products_id_matches_store CHECK (id LIKE store_id || '--%'),
  CONSTRAINT products_store_sku_key UNIQUE (store_id, sku)
);
-- MARKETPLACE §6.5 #1..#7
CREATE INDEX products_search_idx         ON products USING gin (search_terms) WHERE listed;                     -- #1
CREATE INDEX products_category_idx       ON products (category_id, name_sort, id) WHERE listed;                 -- #2
CREATE INDEX products_featured_idx       ON products (name_sort, id) WHERE listed AND featured;                 -- #3
CREATE INDEX products_store_listed_idx   ON products (store_id, name_sort, id) WHERE listed;                    -- #4
CREATE INDEX products_store_category_idx ON products (store_id, category_id, name_sort, id) WHERE listed;       -- #5
CREATE INDEX products_store_idx          ON products (store_id, name_sort, id);                                 -- #6
CREATE INDEX products_family_idx         ON products (family_key, price_cents, id)
                                         WHERE listed AND family_key IS NOT NULL;                               -- #7
CREATE INDEX products_listed_name_idx    ON products (name_sort, id) WHERE listed;

-- =====================================================================================
-- Accounts, sessions and tokens
-- =====================================================================================

CREATE TABLE users (
  id             text PRIMARY KEY,           -- UUIDv4, generated by the server
  email          text NOT NULL,
  -- PRIVATE authentication state
  password_hash  text,                       -- NULL until an invited user sets a password
  failed_logins  integer NOT NULL DEFAULT 0,  -- consecutive wrong passwords; diagnostics only, never blocks (§6.3.4)
  password_changed_at timestamptz,
  last_login_at  timestamptz,
  -- account columns (the old custom claims; re-read on every request)
  role           text CHECK (role IN ('admin', 'dispatcher', 'driver', 'customer', 'supplier')),  -- NULL: signed up, no profile yet
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'suspended')),
  display_name   text NOT NULL DEFAULT '' CHECK (char_length(display_name) <= 80),
  phone_number   text CHECK (phone_number ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  phone_verified boolean NOT NULL DEFAULT false,
  store_id       text REFERENCES stores(id),
  store_role     text CHECK (store_role IN ('owner', 'staff')),
  city_id        text,
  doc            jsonb NOT NULL DEFAULT '{}',  -- the rest of UserProfile (see §3.3)
  capacity_class text GENERATED ALWAYS AS (doc #>> '{vehicle,capacityClass}') STORED,
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  CONSTRAINT users_supplier_store CHECK ((role IS NOT DISTINCT FROM 'supplier') = (store_id IS NOT NULL)),
  CONSTRAINT users_store_role CHECK ((store_id IS NULL) = (store_role IS NULL)),
  CONSTRAINT users_verified_phone CHECK (NOT phone_verified OR phone_number IS NOT NULL)
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE UNIQUE INDEX users_phone_key ON users (phone_number) WHERE phone_verified;
CREATE INDEX users_role_status_idx ON users (role, status, city_id, capacity_class);                 -- MARKETPLACE §6.5 #35, #36
CREATE INDEX users_store_idx ON users (store_id, role, status) WHERE store_id IS NOT NULL;          -- MARKETPLACE §6.5 #37

CREATE TABLE sessions (
  id              text PRIMARY KEY,          -- UUIDv4; the `sid` claim of the access token
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app             text NOT NULL CHECK (app IN ('customer', 'driver', 'console')),
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 8 AND 80),
  platform        text CHECK (platform IN ('ios', 'android', 'web')),   -- from the X-Client header, when sent
  app_version     text,
  device_name     text,
  user_agent      text,
  ip_hash         text,
  created_at      timestamptz NOT NULL,
  last_used_at    timestamptz NOT NULL,
  expires_at      timestamptz NOT NULL,      -- absolute end of the session
  revoked_at      timestamptz,
  revoked_reason  text CHECK (revoked_reason IN
                    ('logout', 'password_changed', 'password_reset', 'suspended', 'reuse_detected', 'removed', 'expired',
                     'admin'))
);
CREATE INDEX sessions_user_idx ON sessions (user_id, installation_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE refresh_tokens (
  id          text PRIMARY KEY,              -- UUIDv4; the public half of the refresh token
  session_id  text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token_hash  text NOT NULL,                 -- hex SHA-256 of the secret half
  created_at  timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,                   -- set when the token is rotated
  replaced_by text,                          -- the newest child issued for this token
  parent_id   text,                          -- the token this one was issued for (NULL for the first token of a session)
  superseded_at timestamptz                  -- set when a sibling (same parent) was used: presenting this token is reuse
);
CREATE INDEX refresh_tokens_session_idx ON refresh_tokens (session_id);
CREATE INDEX refresh_tokens_parent_idx  ON refresh_tokens (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX refresh_tokens_expires_idx ON refresh_tokens (expires_at);

CREATE TABLE auth_tokens (                   -- password reset codes and set-password links
  id          text PRIMARY KEY,              -- UUIDv4
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('password_reset', 'set_password')),
  secret_hash text NOT NULL,                 -- hex HMAC-SHA256 keyed with OTP_PEPPER
  attempts    integer NOT NULL DEFAULT 0,
  created_by  text REFERENCES users(id),
  created_at  timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
CREATE UNIQUE INDEX auth_tokens_active_key ON auth_tokens (user_id, purpose) WHERE used_at IS NULL;
CREATE INDEX auth_tokens_expires_idx ON auth_tokens (expires_at);

CREATE TABLE otp_challenges (                -- phone verification, one per user
  user_id           text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone_number      text NOT NULL,
  code_hash         text NOT NULL,           -- hex HMAC-SHA256 keyed with OTP_PEPPER
  attempts          integer NOT NULL DEFAULT 0,
  expires_at        timestamptz NOT NULL,
  last_sent_at      timestamptz NOT NULL,
  window_started_at timestamptz NOT NULL,
  send_count        integer NOT NULL
);
CREATE INDEX otp_challenges_expires_idx ON otp_challenges (expires_at);

-- =====================================================================================
-- Customer data
-- =====================================================================================

CREATE TABLE jobsites (
  id           text PRIMARY KEY CHECK (is_uuid4(id)),   -- client UUIDv4
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc          jsonb NOT NULL,               -- JobsiteFields
  is_default   boolean NOT NULL DEFAULT false,
  last_used_at timestamptz,                  -- written by placeOrder only
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL
);
CREATE INDEX jobsites_user_idx ON jobsites (user_id, created_at, id);
CREATE UNIQUE INDEX jobsites_default_key ON jobsites (user_id) WHERE is_default;

CREATE TABLE cards (                         -- no column can hold a card number or CVV
  id           text PRIMARY KEY CHECK (is_uuid4(id)),   -- client UUIDv4
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand        text NOT NULL CHECK (brand IN ('visa', 'mastercard', 'amex', 'discover', 'card')),
  last4        text NOT NULL CHECK (last4 ~ '^[0-9]{4}$'),
  exp_month    smallint NOT NULL CHECK (exp_month BETWEEN 1 AND 12),
  exp_year     smallint NOT NULL CHECK (exp_year BETWEEN 2024 AND 2100),
  holder       text NOT NULL CHECK (char_length(holder) BETWEEN 1 AND 80),
  is_default   boolean NOT NULL DEFAULT false,
  provider     text NOT NULL DEFAULT 'test' CHECK (provider IN ('test', 'stripe')),
  provider_ref text,
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL
);
CREATE INDEX cards_user_idx ON cards (user_id, created_at, id);
CREATE UNIQUE INDEX cards_default_key ON cards (user_id) WHERE is_default;

CREATE TABLE favorites (
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id text NOT NULL,                  -- no foreign key: a favourite may outlive the listing
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, product_id)
);
CREATE INDEX favorites_user_idx ON favorites (user_id, created_at DESC);

CREATE TABLE devices (                       -- push tokens, one per app install
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 8 AND 80),
  token           text NOT NULL CHECK (char_length(token) BETWEEN 10 AND 4096),
  provider        text NOT NULL CHECK (provider IN ('expo')),
  platform        text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  app             text NOT NULL CHECK (app IN ('customer', 'driver', 'console')),
  app_version     text,
  device_name     text,
  created_at      timestamptz NOT NULL,
  last_seen_at    timestamptz NOT NULL,
  PRIMARY KEY (user_id, installation_id)
);
CREATE UNIQUE INDEX devices_token_key ON devices (token);

CREATE TABLE carts (                         -- P1: signed-in cart
  user_id    text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  doc        jsonb NOT NULL,                 -- Cart without updatedAt
  updated_at timestamptz NOT NULL
);

-- =====================================================================================
-- Orders, store orders, deliveries
-- =====================================================================================

CREATE TABLE orders (
  id                  text PRIMARY KEY CHECK (is_uuid4(id)),   -- the client's checkoutId
  doc                 jsonb NOT NULL,        -- Order without id
  number              text GENERATED ALWAYS AS (doc->>'number') STORED NOT NULL UNIQUE,
  customer_id         text GENERATED ALWAYS AS (doc->>'customerId') STORED NOT NULL REFERENCES users(id),
  source              text GENERATED ALWAYS AS (doc->>'source') STORED NOT NULL
                      CHECK (source IN ('cart', 'quote', 'replacement')),
  status              text GENERATED ALWAYS AS (doc->>'status') STORED NOT NULL
                      CHECK (status IN ('placed', 'confirmed', 'preparing', 'ready', 'on_the_way', 'completed', 'cancelled')),
  needs_attention     boolean GENERATED ALWAYS AS ((doc->>'needsAttention')::boolean) STORED NOT NULL,
  jobsite_id          text GENERATED ALWAYS AS (doc #>> '{jobsite,jobsiteId}') STORED,
  payment_status      text GENERATED ALWAYS AS (doc #>> '{payment,status}') STORED NOT NULL
                      CHECK (payment_status IN ('authorized', 'capture_pending', 'captured', 'capture_failed',
                                                'partially_refunded', 'refunded', 'voided', 'not_required')),
  capture_deadline_at timestamptz GENERATED ALWAYS AS (ms_to_ts((doc #>> '{payment,captureDeadlineAt}')::bigint)) STORED,
  total_cents         bigint GENERATED ALWAYS AS ((doc #>> '{current,totalCents}')::bigint) STORED NOT NULL,
  created_at          timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL
);
CREATE INDEX orders_customer_idx        ON orders (customer_id, created_at DESC, id DESC);                    -- MARKETPLACE §6.5 #14
CREATE INDEX orders_customer_active_idx ON orders (customer_id, created_at DESC, id DESC)
                                        WHERE status NOT IN ('completed', 'cancelled');                       -- #15
CREATE INDEX orders_status_idx          ON orders (status, created_at DESC, id DESC);                         -- #16
CREATE INDEX orders_capture_sweep_idx   ON orders (payment_status, capture_deadline_at)
                                        WHERE payment_status IN ('authorized', 'capture_pending', 'capture_failed'); -- #17
CREATE INDEX orders_attention_idx       ON orders (created_at DESC, id DESC) WHERE needs_attention;           -- #18
CREATE INDEX orders_created_idx         ON orders (created_at DESC, id DESC);

CREATE TABLE store_orders (
  id             text PRIMARY KEY,           -- `${orderId}-${letter}`
  doc            jsonb NOT NULL,             -- StoreOrder without id
  meta           jsonb NOT NULL,             -- PRIVATE: StoreOrderPrivateMeta
  order_id       text GENERATED ALWAYS AS (doc->>'orderId') STORED NOT NULL REFERENCES orders(id),
  store_id       text GENERATED ALWAYS AS (doc->>'storeId') STORED NOT NULL REFERENCES stores(id),
  customer_id    text GENERATED ALWAYS AS (doc->>'customerId') STORED NOT NULL REFERENCES users(id),
  number         text GENERATED ALWAYS AS (doc->>'number') STORED NOT NULL UNIQUE,
  status         text GENERATED ALWAYS AS (doc->>'status') STORED NOT NULL
                 CHECK (status IN ('new', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered',
                                   'picked_up', 'failed', 'rejected', 'cancelled')),
  fulfilment     text GENERATED ALWAYS AS (doc->>'fulfilment') STORED NOT NULL
                 CHECK (fulfilment IN ('delivery', 'pickup')),
  version        integer GENERATED ALWAYS AS ((doc->>'version')::integer) STORED NOT NULL,
  delivery_id    text GENERATED ALWAYS AS (doc->>'deliveryId') STORED,
  respond_by     timestamptz GENERATED ALWAYS AS (ms_to_ts((doc #>> '{timing,respondBy}')::bigint)) STORED NOT NULL,
  ready_by       timestamptz GENERATED ALWAYS AS (ms_to_ts((doc #>> '{timing,readyBy}')::bigint)) STORED NOT NULL,
  ready_by_date  text GENERATED ALWAYS AS (doc #>> '{timing,readyByDate}') STORED NOT NULL,
  hold_until     timestamptz GENERATED ALWAYS AS (ms_to_ts((doc #>> '{pickup,holdUntil}')::bigint)) STORED,
  completed_at   timestamptz GENERATED ALWAYS AS (ms_to_ts((doc->>'completedAt')::bigint)) STORED,
  accept_overdue boolean GENERATED ALWAYS AS ((doc->>'acceptOverdue')::boolean) STORED NOT NULL,
  reminder_sent  boolean GENERATED ALWAYS AS ((doc->>'reminderSentAt') IS NOT NULL) STORED NOT NULL,
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  CONSTRAINT store_orders_id_matches_order CHECK (id ~ '-[A-E]$' AND left(id, -2) = order_id)
);
CREATE INDEX store_orders_board_idx     ON store_orders (store_id, status, ready_by, id);                     -- MARKETPLACE §6.5 #8
CREATE INDEX store_orders_store_idx     ON store_orders (store_id, created_at DESC, id DESC);                 -- #9
CREATE INDEX store_orders_completed_idx ON store_orders (store_id, completed_at DESC, id DESC)
                                        WHERE completed_at IS NOT NULL;                                       -- #10
CREATE INDEX store_orders_respond_idx   ON store_orders (respond_by) WHERE status = 'new';                    -- #11
CREATE INDEX store_orders_hold_idx      ON store_orders (hold_until)
                                        WHERE fulfilment = 'pickup' AND status = 'ready';                     -- #12
CREATE INDEX store_orders_status_idx    ON store_orders (status, created_at DESC, id DESC);                   -- #13
CREATE INDEX store_orders_order_idx     ON store_orders (order_id);
CREATE INDEX store_orders_created_idx   ON store_orders (created_at DESC, id DESC);

CREATE TABLE store_reviews (
  id             text PRIMARY KEY,           -- the storeOrderId (seed rows: `seed-${storeId}-${n}`)
  store_id       text NOT NULL REFERENCES stores(id),
  store_order_id text REFERENCES store_orders(id),   -- NULL for seed rows
  customer_id    text NOT NULL,
  author_name    text NOT NULL CHECK (char_length(author_name) BETWEEN 1 AND 40),
  rating         smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text           text NOT NULL DEFAULT '' CHECK (char_length(text) <= 1000),
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL
);
CREATE INDEX store_reviews_store_idx ON store_reviews (store_id, updated_at DESC, id DESC);

CREATE TABLE deliveries (
  id              text PRIMARY KEY,          -- UUIDv4, generated by the server
  doc             jsonb NOT NULL,            -- Delivery without id
  meta            jsonb NOT NULL,            -- PRIVATE: DeliveryPrivateMeta + codeAttempts + trackingLinkSentAt
  order_ref       text GENERATED ALWAYS AS (doc->>'orderId') STORED NOT NULL,   -- IS-10042-A or IS-10043
  kind            text GENERATED ALWAYS AS (doc->>'kind') STORED NOT NULL CHECK (kind IN ('marketplace', 'manual')),
  status          text GENERATED ALWAYS AS (doc->>'status') STORED NOT NULL
                  CHECK (status IN ('unassigned', 'assigned', 'accepted', 'picked_up', 'in_transit', 'arrived',
                                    'delivered', 'failed', 'cancelled')),
  driver_id       text GENERATED ALWAYS AS (doc->>'driverId') STORED REFERENCES users(id),
  customer_id     text GENERATED ALWAYS AS (doc->>'customerId') STORED REFERENCES users(id),
  source_order_id text GENERATED ALWAYS AS (doc->>'sourceOrderId') STORED REFERENCES orders(id),
  store_order_id  text GENERATED ALWAYS AS (doc->>'storeOrderId') STORED REFERENCES store_orders(id),
  store_id        text GENERATED ALWAYS AS (doc->>'storeId') STORED REFERENCES stores(id),
  offer_status    text GENERATED ALWAYS AS (doc->>'offerStatus') STORED
                  CHECK (offer_status IN ('held', 'scheduled', 'open', 'claimed', 'withdrawn')),
  unload_status   text GENERATED ALWAYS AS (doc #>> '{unload,status}') STORED,
  delivered_at    timestamptz GENERATED ALWAYS AS (ms_to_ts((doc->>'deliveredAt')::bigint)) STORED,
  tracking_token  text GENERATED ALWAYS AS (meta->>'trackingToken') STORED NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL
);
-- the six delivery indexes of the old firestore.indexes.json
CREATE INDEX deliveries_driver_status_idx    ON deliveries (driver_id, status, updated_at DESC, id DESC);
CREATE INDEX deliveries_driver_delivered_idx ON deliveries (driver_id, delivered_at) WHERE status = 'delivered';
CREATE INDEX deliveries_driver_created_idx   ON deliveries (driver_id, created_at DESC, id DESC);
CREATE INDEX deliveries_status_created_idx   ON deliveries (status, created_at DESC, id DESC);
CREATE INDEX deliveries_status_updated_idx   ON deliveries (status, updated_at DESC, id DESC);
CREATE INDEX deliveries_created_idx          ON deliveries (created_at DESC, id DESC);
CREATE UNIQUE INDEX deliveries_store_order_key ON deliveries (store_order_id) WHERE store_order_id IS NOT NULL;
CREATE INDEX deliveries_source_order_idx     ON deliveries (source_order_id) WHERE source_order_id IS NOT NULL;
CREATE INDEX deliveries_labourer_idx         ON deliveries (created_at) WHERE unload_status = 'needed';

CREATE TABLE delivery_events (               -- append-only audit trail
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_id text NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  at          timestamptz NOT NULL,
  doc         jsonb NOT NULL                 -- DeliveryEvent without id, deliveryId, at
);
CREATE INDEX delivery_events_delivery_idx ON delivery_events (delivery_id, id DESC);

CREATE TABLE job_offers (                    -- exists only while its delivery is unassigned and offered
  delivery_id text PRIMARY KEY REFERENCES deliveries(id) ON DELETE CASCADE,
  doc         jsonb NOT NULL,                -- JobOffer without deliveryId
  status      text GENERATED ALWAYS AS (doc->>'status') STORED NOT NULL CHECK (status IN ('scheduled', 'open')),
  audience    text[] GENERATED ALWAYS AS (jsonb_text_array(doc->'audience')) STORED NOT NULL,
  opens_at    timestamptz GENERATED ALWAYS AS (ms_to_ts((doc->>'opensAt')::bigint)) STORED NOT NULL,
  opened_at   timestamptz GENERATED ALWAYS AS (ms_to_ts((doc->>'openedAt')::bigint)) STORED,
  nudged      boolean GENERATED ALWAYS AS ((doc->>'nudgedAt') IS NOT NULL) STORED NOT NULL,
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL
);
CREATE INDEX job_offers_audience_idx ON job_offers USING gin (audience) WHERE status = 'open';               -- MARKETPLACE §6.5 #19
CREATE INDEX job_offers_opens_idx    ON job_offers (status, opens_at);                                       -- #20
CREATE INDEX job_offers_nudge_idx    ON job_offers (opened_at) WHERE status = 'open' AND NOT nudged;          -- #21

CREATE TABLE tracking (                      -- public tracking view, read by token only
  token           text PRIMARY KEY,
  delivery_id     text NOT NULL UNIQUE REFERENCES deliveries(id) ON DELETE CASCADE,
  doc             jsonb NOT NULL,            -- PublicTracking without updatedAt
  eta_computed_at timestamptz,               -- PRIVATE: last provider ETA
  updated_at      timestamptz NOT NULL
);

CREATE TABLE routes (
  driver_id   text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  doc         jsonb NOT NULL,                -- RoutePlan without driverId, computedAt
  signature   text,                          -- PRIVATE: hash of the planning inputs
  leased_at   timestamptz,                   -- PRIVATE
  computed_at timestamptz NOT NULL
);

CREATE TABLE driver_locations (
  driver_id  text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  lat        double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng        double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  heading    real,
  speed      real,
  accuracy   real,
  battery    real,
  online     boolean NOT NULL,
  synced_lat double precision,               -- PRIVATE: position at the last tracking sync
  synced_lng double precision,
  synced_at  timestamptz,
  updated_at timestamptz NOT NULL
);
CREATE INDEX driver_locations_online_idx ON driver_locations (updated_at) WHERE online;

-- =====================================================================================
-- Chat and support
-- =====================================================================================

CREATE TABLE chat_threads (                  -- dispatch <-> driver, one per driver
  driver_id        text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  driver_name      text NOT NULL,
  last_message     jsonb,
  unread_by_driver integer NOT NULL DEFAULT 0 CHECK (unread_by_driver >= 0),
  unread_by_staff  integer NOT NULL DEFAULT 0 CHECK (unread_by_staff >= 0),
  driver_read_at   timestamptz,
  staff_read_at    timestamptz,
  created_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL
);
CREATE INDEX chat_threads_updated_idx ON chat_threads (updated_at DESC, driver_id DESC);

CREATE TABLE chat_messages (
  id          text PRIMARY KEY CHECK (is_uuid4(id)),    -- client UUIDv4
  thread_id   text NOT NULL REFERENCES chat_threads(driver_id) ON DELETE CASCADE,
  seq         bigint GENERATED ALWAYS AS IDENTITY,
  sender_id   text NOT NULL REFERENCES users(id),
  sender_name text NOT NULL CHECK (char_length(sender_name) BETWEEN 1 AND 80),
  sender_role text NOT NULL CHECK (sender_role IN ('driver', 'staff')),
  text        text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 1000),
  delivery_id text,
  kind        text NOT NULL CHECK (kind IN ('text', 'quick_reply')),
  created_at  timestamptz NOT NULL
);
CREATE INDEX chat_messages_thread_idx ON chat_messages (thread_id, seq DESC);

CREATE TABLE support_threads (
  id              text PRIMARY KEY,          -- the customer's uid, or `store_${storeId}`
  kind            text NOT NULL CHECK (kind IN ('customer', 'store')),
  owner_id        text NOT NULL,             -- uid or storeId
  owner_name      text NOT NULL,
  company_name    text,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  assigned_to     text REFERENCES users(id),
  assigned_name   text,
  context         jsonb,
  last_message    jsonb,
  unread_by_owner integer NOT NULL DEFAULT 0 CHECK (unread_by_owner >= 0),
  unread_by_staff integer NOT NULL DEFAULT 0 CHECK (unread_by_staff >= 0),
  owner_read_at   timestamptz,
  staff_read_at   timestamptz,
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,
  CONSTRAINT support_threads_id_matches_owner
    CHECK ((kind = 'customer' AND id = owner_id) OR (kind = 'store' AND id = 'store_' || owner_id))
);
CREATE INDEX support_threads_kind_idx   ON support_threads (kind, updated_at DESC, id DESC);                  -- MARKETPLACE §6.5 #29
CREATE INDEX support_threads_status_idx ON support_threads (status, updated_at DESC, id DESC);                -- #30

CREATE TABLE support_messages (
  id          text PRIMARY KEY CHECK (is_uuid4(id)),    -- client UUIDv4
  thread_id   text NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  seq         bigint GENERATED ALWAYS AS IDENTITY,
  sender_id   text NOT NULL REFERENCES users(id),
  sender_name text NOT NULL CHECK (char_length(sender_name) BETWEEN 1 AND 80),
  sender_role text NOT NULL CHECK (sender_role IN ('customer', 'supplier', 'staff')),
  text        text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 1000),
  context     jsonb,
  created_at  timestamptz NOT NULL
);
CREATE INDEX support_messages_thread_idx ON support_messages (thread_id, seq DESC);

-- =====================================================================================
-- Quotes and issues
-- =====================================================================================

CREATE TABLE quotes (
  id                text PRIMARY KEY CHECK (is_uuid4(id)),   -- the client's requestId
  doc               jsonb NOT NULL,          -- Quote without id
  workspace         jsonb,                   -- PRIVATE: quote-builder draft and internal note
  number            text GENERATED ALWAYS AS (doc->>'number') STORED NOT NULL UNIQUE,
  customer_id       text GENERATED ALWAYS AS (doc->>'customerId') STORED NOT NULL REFERENCES users(id),
  status            text GENERATED ALWAYS AS (doc->>'status') STORED NOT NULL
                    CHECK (status IN ('submitted', 'in_review', 'quoted', 'accepted', 'declined', 'expired', 'cancelled')),
  respond_by        timestamptz GENERATED ALWAYS AS (ms_to_ts((doc->>'respondBy')::bigint)) STORED NOT NULL,
  offer_valid_until timestamptz GENERATED ALWAYS AS (ms_to_ts((doc->>'offerValidUntil')::bigint)) STORED,
  assigned_to       text GENERATED ALWAYS AS (doc->>'assignedTo') STORED,
  order_id          text GENERATED ALWAYS AS (doc->>'orderId') STORED,
  created_at        timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL
);
CREATE INDEX quotes_customer_idx ON quotes (customer_id, created_at DESC, id DESC);                           -- MARKETPLACE §6.5 #22
CREATE INDEX quotes_sla_idx      ON quotes (status, respond_by, id);                                          -- #23
CREATE INDEX quotes_status_idx   ON quotes (status, created_at DESC, id DESC);                                -- #24
CREATE INDEX quotes_expiry_idx   ON quotes (offer_valid_until) WHERE status = 'quoted';                       -- #25
CREATE INDEX quotes_created_idx  ON quotes (created_at DESC, id DESC);

CREATE TABLE issues (
  id             text PRIMARY KEY CHECK (is_uuid4(id)),      -- the client's issueId
  doc            jsonb NOT NULL,             -- Issue without id
  notes          jsonb,                      -- PRIVATE: internal notes
  number         text GENERATED ALWAYS AS (doc->>'number') STORED NOT NULL UNIQUE,
  customer_id    text GENERATED ALWAYS AS (doc->>'customerId') STORED NOT NULL REFERENCES users(id),
  store_id       text GENERATED ALWAYS AS (doc->>'storeId') STORED NOT NULL REFERENCES stores(id),
  order_id       text GENERATED ALWAYS AS (doc->>'orderId') STORED NOT NULL REFERENCES orders(id),
  store_order_id text GENERATED ALWAYS AS (doc->>'storeOrderId') STORED NOT NULL REFERENCES store_orders(id),
  status         text GENERATED ALWAYS AS (doc->>'status') STORED NOT NULL
                 CHECK (status IN ('open', 'in_review', 'resolved')),
  sla_due_at     timestamptz GENERATED ALWAYS AS (ms_to_ts((doc->>'slaDueAt')::bigint)) STORED NOT NULL,
  assigned_to    text GENERATED ALWAYS AS (doc->>'assignedTo') STORED,
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL
);
CREATE UNIQUE INDEX issues_open_key ON issues (store_order_id) WHERE status <> 'resolved';   -- ISSUE_ALREADY_OPEN
CREATE INDEX issues_customer_idx ON issues (customer_id, created_at DESC, id DESC);                           -- MARKETPLACE §6.5 #26
CREATE INDEX issues_store_idx    ON issues (store_id, created_at DESC, id DESC);                              -- #27
CREATE INDEX issues_status_idx   ON issues (status, created_at DESC, id DESC);                                -- #28
CREATE INDEX issues_order_idx    ON issues (order_id);
CREATE INDEX issues_created_idx  ON issues (created_at DESC, id DESC);

-- =====================================================================================
-- Money: payment journal, ledger, payouts
-- =====================================================================================

CREATE TABLE payment_authorizations (        -- journal of card holds, so that none is orphaned
  order_id       text PRIMARY KEY CHECK (is_uuid4(order_id)),
  customer_id    text NOT NULL REFERENCES users(id),
  amount_cents   bigint NOT NULL CHECK (amount_cents >= 0),
  card           jsonb NOT NULL,             -- { cardId, brand, last4 }
  provider       text NOT NULL CHECK (provider IN ('test', 'stripe')),
  status         text NOT NULL CHECK (status IN ('pending', 'authorized', 'declined', 'attached',
                                                 'void_pending', 'voided', 'captured')),
  attempt        integer NOT NULL DEFAULT 1 CHECK (attempt >= 1),   -- part of the gateway idempotency key after a retry
  intent_ref     text,
  capture_before timestamptz,
  decline_reason text,
  capture_breakdown jsonb,                   -- { storeOrderId: cents } fixed by Finalize step 1 together with pendingCaptureCents (§10.4)
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL
);
CREATE INDEX payment_authorizations_open_idx ON payment_authorizations (updated_at)
  WHERE status IN ('pending', 'authorized', 'void_pending');

CREATE TABLE payouts (
  id            text PRIMARY KEY,            -- `${payeeType}_${payeeId}_${runKey}`
  payee_type    text NOT NULL CHECK (payee_type IN ('store', 'driver')),
  payee_id      text NOT NULL,
  payee_name    text NOT NULL,
  run_key       text NOT NULL CHECK (run_key ~ '^[0-9]{8}-[0-9]{4}$'),
  period_date   text NOT NULL CHECK (period_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  entry_ids     text[] NOT NULL,
  entry_count   integer NOT NULL,
  credits_cents bigint NOT NULL,
  debits_cents  bigint NOT NULL,
  net_cents     bigint NOT NULL CHECK (net_cents > 0),
  status        text NOT NULL CHECK (status IN ('pending', 'paid', 'failed')),
  provider      text NOT NULL CHECK (provider IN ('test', 'stripe')),
  reference     text,
  created_at    timestamptz NOT NULL,
  paid_at       timestamptz
);
CREATE INDEX payouts_payee_idx   ON payouts (payee_type, payee_id, created_at DESC, id DESC);                 -- MARKETPLACE §6.5 #33
CREATE INDEX payouts_pending_idx ON payouts (created_at) WHERE status = 'pending';
CREATE INDEX payouts_created_idx ON payouts (created_at DESC, id DESC);

CREATE TABLE ledger_entries (                -- append-only; only payout_id and held_for_issue_id change
  id                text PRIMARY KEY,        -- deterministic: sale_{storeOrderId}, delivery_{deliveryId}_{attempt}, ...
  payee_type        text NOT NULL CHECK (payee_type IN ('store', 'driver')),
  payee_id          text NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('sale', 'commission', 'delivery', 'failed_attempt',
                                                  'cancellation', 'clawback', 'adjustment')),
  amount_cents      bigint NOT NULL,         -- signed
  order_id          text,
  store_order_id    text,
  delivery_id       text,
  issue_id          text,
  description       text NOT NULL,
  payout_id         text REFERENCES payouts(id),
  held_for_issue_id text,
  created_at        timestamptz NOT NULL
);
CREATE INDEX ledger_payee_idx       ON ledger_entries (payee_type, payee_id, created_at DESC, id DESC);       -- MARKETPLACE §6.5 #31
CREATE INDEX ledger_unpaid_idx      ON ledger_entries (payee_type, payee_id, created_at)
                                    WHERE payout_id IS NULL;                                                  -- #32
CREATE INDEX ledger_payout_idx      ON ledger_entries (payout_id) WHERE payout_id IS NOT NULL;
CREATE INDEX ledger_store_order_idx ON ledger_entries (store_order_id) WHERE store_order_id IS NOT NULL;
CREATE INDEX ledger_held_idx        ON ledger_entries (held_for_issue_id) WHERE held_for_issue_id IS NOT NULL;  -- resolveIssue releases holds

-- =====================================================================================
-- Suggestions, notifications, files
-- =====================================================================================

CREATE TABLE store_suggestions (
  id           text PRIMARY KEY,             -- UUIDv4, generated by the server
  store_name   text NOT NULL CHECK (char_length(store_name) BETWEEN 2 AND 80),
  city         text NOT NULL CHECK (char_length(city) BETWEEN 2 AND 60),
  interests    text[] NOT NULL DEFAULT '{}',
  email        text,
  suggested_by text REFERENCES users(id),
  source       text NOT NULL CHECK (source IN ('app', 'web')),
  status       text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'onboarding', 'dismissed')),
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL
);
CREATE INDEX store_suggestions_status_idx ON store_suggestions (status, created_at DESC, id DESC);            -- MARKETPLACE §6.5 #34

CREATE TABLE notifications (                 -- the in-app inbox
  id           text PRIMARY KEY,             -- UUIDv4, generated by the server
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dedupe_key   text,                         -- idempotency key of the producer
  type         text NOT NULL,
  title        text NOT NULL CHECK (char_length(title) <= 120),
  body         text NOT NULL CHECK (char_length(body) <= 500),
  data         jsonb NOT NULL DEFAULT '{}',
  read         boolean NOT NULL DEFAULT false,
  read_at      timestamptz,
  push_status  text NOT NULL CHECK (push_status IN ('pending', 'sent', 'partial', 'failed', 'no_devices', 'skipped')),
  push_success integer NOT NULL DEFAULT 0,
  push_failure integer NOT NULL DEFAULT 0,
  push_sent_at timestamptz,
  created_at   timestamptz NOT NULL
);
CREATE UNIQUE INDEX notifications_dedupe_key ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX notifications_user_idx   ON notifications (user_id, created_at DESC, id DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE NOT read;

CREATE TABLE push_tickets (                  -- Expo push tickets waiting for their receipt
  ticket_id       text PRIMARY KEY,
  notification_id text NOT NULL,
  user_id         text NOT NULL,
  token           text NOT NULL,
  created_at      timestamptz NOT NULL,
  check_after     timestamptz NOT NULL
);
CREATE INDEX push_tickets_check_idx ON push_tickets (check_after);

CREATE TABLE files (
  id            text PRIMARY KEY,            -- UUIDv4, generated by the server: the uploadId
  path          text NOT NULL UNIQUE,        -- final storage key, prefixes of MARKETPLACE §6.4; written only by the server (confirm copies here)
  upload_key    text NOT NULL UNIQUE,        -- `uploads/{id}`: the only key a presigned form can write; deleted after confirm
  purpose       text NOT NULL CHECK (purpose IN ('proof', 'quote_upload', 'issue_photo', 'store_photo',
                                                 'product_photo', 'avatar')),
  uploaded_by   text NOT NULL REFERENCES users(id),
  scope_id      text NOT NULL,               -- the request's ownerId: deliveryId | requestId | issueId | storeId | uid
  content_type  text NOT NULL,
  size_bytes    bigint CHECK (size_bytes > 0),
  max_bytes     bigint NOT NULL,
  original_name text,
  status        text NOT NULL CHECK (status IN ('pending', 'ready')),
  created_at    timestamptz NOT NULL,
  completed_at  timestamptz
);
CREATE INDEX files_scope_idx   ON files (purpose, scope_id);
CREATE INDEX files_uploader_idx ON files (uploaded_by, created_at DESC);
CREATE INDEX files_pending_idx ON files (created_at) WHERE status = 'pending';

-- =====================================================================================
-- Platform tables
-- =====================================================================================

CREATE TABLE dev_outbox (                    -- every SMS and email the system sent or stored
  id           text PRIMARY KEY,             -- UUIDv4
  channel      text NOT NULL CHECK (channel IN ('sms', 'email')),
  to_address   text NOT NULL,
  subject      text,
  body         text,                         -- NULL when redacted (sensitive message sent by a real provider)
  purpose      text NOT NULL CHECK (purpose IN ('otp', 'tracking_link', 'store_alert', 'other',
                                                'password_reset', 'invite')),
  provider     text NOT NULL CHECK (provider IN ('outbox', 'twilio', 'resend', 'smtp')),
  status       text NOT NULL CHECK (status IN ('stored', 'sent', 'failed')),
  provider_ref text,
  error        text,
  sensitive    boolean NOT NULL DEFAULT false,   -- admin-only rows
  created_at   timestamptz NOT NULL,
  expires_at   timestamptz NOT NULL
);
CREATE INDEX dev_outbox_created_idx ON dev_outbox (created_at DESC, id DESC);
CREATE INDEX dev_outbox_expires_idx ON dev_outbox (expires_at);

CREATE TABLE rate_limits (                   -- fixed-window counters
  bucket       text NOT NULL,
  subject      text NOT NULL,
  count        integer NOT NULL,
  window_start timestamptz NOT NULL,
  expires_at   timestamptz NOT NULL,
  PRIMARY KEY (bucket, subject)
);
CREATE INDEX rate_limits_expires_idx ON rate_limits (expires_at);

CREATE TABLE outbox (                        -- transactional outbox for network side effects
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event        text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  dedupe_key   text,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'dead')),
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  run_at       timestamptz NOT NULL,
  locked_at    timestamptz,
  locked_by    text,
  last_error   text,
  created_at   timestamptz NOT NULL,
  finished_at  timestamptz
);
CREATE UNIQUE INDEX outbox_dedupe_key   ON outbox (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending';
CREATE INDEX outbox_due_idx             ON outbox (run_at, id) WHERE status = 'pending';
CREATE INDEX outbox_processing_idx      ON outbox (locked_at) WHERE status = 'processing';
CREATE INDEX outbox_finished_idx        ON outbox (finished_at) WHERE status IN ('done', 'dead');
CREATE INDEX outbox_refund_open_idx     ON outbox ((payload->>'storeOrderId'))
                                        WHERE event = 'payment.refund' AND status IN ('pending', 'processing');  -- §9.2.12

CREATE TABLE scheduler_state (               -- one row per scheduled job
  job              text PRIMARY KEY,
  next_run_at      timestamptz NOT NULL,
  last_started_at  timestamptz,
  last_finished_at timestamptz,
  last_status      text CHECK (last_status IN ('ok', 'error')),
  last_error       text,
  last_result      jsonb
);

CREATE TABLE geocode_cache (
  query_key  text PRIMARY KEY,               -- hex SHA-256 of provider + normalized query + rounded bias point
  provider   text NOT NULL,
  results    jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX geocode_cache_expires_idx ON geocode_cache (expires_at);
```

Notes on the DDL:

- `listed` is generated from `active` and the owned copy `store_status`, so a product can never be
  listed while its store is not live (MARKETPLACE §1.4).
- `issues_open_key` is the database form of "one open issue per store order".
- `deliveries_store_order_key` is the database form of "one delivery per store order" (D1).
- `users_phone_key` is the database form of "a verified number belongs to one account".
- Sequences are not transactional: a rolled-back transaction leaves a gap. Call `nextNumber()` as the
  last read before the inserts, after every check has passed, so numbers stay dense in practice
  (the seed expects IS-10001 … IS-10006, Q-10001, Q-10002, CASE-10001).
- There is no `counters` table and no `schema_migrations` table in this file (the migrator creates
  the latter).

### 3.3 What each table returns, what it hides, who reads it

"Built from" is the exact composition the serializer must produce. `ms()` values are already numbers
(type parser). `mediaUrl(path)` is `publicOrigin + '/api/v1/media/' + path`, or `null` for a null path; `publicOrigin` is `API_URL` (production: set, or `https://` + `RAILWAY_PUBLIC_DOMAIN`) and, outside production without `API_URL`, the origin of the request being served (§11.1). Serializers receive it from the request context.
Every document that leaves the server carries `id` (the old document id), also where the shared type
declares none: that is `WithId<T>` in the table.

| Table | API shape | Built from | Private columns (never in the shape) | Read by (enforced in §7) |
| --- | --- | --- | --- | --- |
| `stores` | `Store` | `id`, `doc` without `photoPath`, `photoUrl = mediaUrl(doc.photoPath)`, `rating = rating_count ? round(rating_sum × 10 / rating_count) / 10 : 0`, `ratingCount`, `createdAt`, `updatedAt` | `settings` (`StorePrivateSettings`): staff and the owner of the store | public |
| `categories` | `Category` | `id`, `doc` | — | public |
| `products` | `Product` | `id`, `storeId`, `doc`, `stockOnHand`, `reserved`, `listed`, `storeName`, `storeStatus`, `searchTerms`, `imageUrl = mediaUrl(doc.imagePath)`, `createdAt`, `updatedAt` | — | public (stock is public: MARKETPLACE §15 question 11) |
| `users` | `UserProfile` | `uid = id`, `role`, `status`, `displayName`, `email`, `phoneNumber`, `phoneVerified`, `storeId`, `storeRole`, `cityId`, `doc` without `photoPath`, `photoURL = mediaUrl(doc.photoPath)`, `createdAt`, `updatedAt`. `doc` keys: `photoPath, preferences, companyName, accountType, stats, promoUses, vehicle, payoutAccount, vehicleDraft, vehicleReviewRequired, compliance, driverStats, suspendedReason, approvedBy, approvedAt` | `password_hash`, `failed_logins`, `password_changed_at`, `last_login_at`: nobody | the user, staff; a store owner lists the supplier users of that store only |
| `sessions` | `SessionInfo` (§5.4) | typed columns | `ip_hash`, `user_agent`, `installation_id`, `revoked_reason` | the user (own) |
| `refresh_tokens`, `auth_tokens`, `otp_challenges` | — | — | everything | nobody |
| `jobsites` | `Jobsite` | `id`, `doc`, `isDefault`, `lastUsedAt`, `createdAt`, `updatedAt` | — | the customer |
| `cards` | `SavedCard` | `id`, `brand`, `last4`, `expMonth`, `expYear`, `holder`, `isDefault`, `createdAt` | `provider`, `provider_ref` | the user |
| `favorites` | `WithId<Favorite>` (§5.4) | `id = productId`, `productId`, `createdAt` | — | the user |
| `devices` | — (write-only; only a count is exposed) | — | `token` | nobody |
| `carts` (P1) | `Cart` | `doc`, `updatedAt` | — | the customer |
| `orders` | `Order` | `id`, `doc`, `createdAt`, `updatedAt` | — (the document itself carries each store order's `trackingToken` and the customer's `pickupCode`; that is why suppliers and drivers never read `orders`) | the customer, staff |
| `store_orders` | `StoreOrder` | `id`, `doc`, `createdAt`, `updatedAt` | `meta` (`StoreOrderPrivateMeta`): staff | the customer (by id), members of the store, staff |
| `store_reviews` | `WithId<StoreReview>` | `id`, `storeId`, `storeOrderId = id`, `customerId`, `authorName`, `rating`, `text`, `createdAt`, `updatedAt` | — | public |
| `deliveries` | `Delivery` | `id`, `doc`, `createdAt`, `updatedAt` | `meta` = `DeliveryPrivateMeta` (`trackingToken`, `handoffCode`) + `codeAttempts`, `trackingLinkSentAt`: staff | staff, the assigned driver |
| `delivery_events` | `DeliveryEvent` | `id = String(id)`, `deliveryId`, `doc`, `at` | — | staff, the assigned driver |
| `job_offers` | `WithId<JobOffer>` | `id = deliveryId`, `deliveryId`, `doc`, `createdAt`, `updatedAt` | — (the document is free of customer data by construction, MARKETPLACE D9) | staff; an active driver whose audience key is in `audience`, while `status = 'open'` |
| `tracking` | `PublicTracking` | `doc`, `updatedAt` | `eta_computed_at` | anyone who holds the token |
| `routes` | `RoutePlan` | `driverId`, `doc`, `computedAt` | `signature`, `leased_at` | staff, the driver |
| `driver_locations` | `WithId<DriverLocation>` | `id = driver_id`, `lat`, `lng`, `heading`, `speed`, `accuracy`, `online`, `battery`, `updatedAt` | `synced_lat`, `synced_lng`, `synced_at` | staff, the driver |
| `chat_threads` | `WithId<ChatThread>` | `id = driver_id`, typed columns | — | staff, the driver |
| `chat_messages` | `ChatMessage` | typed columns | `seq` | staff, the driver |
| `support_threads` | `WithId<SupportThread>` | typed columns | — | staff, the owner (the customer, or the active members of the store) |
| `support_messages` | `SupportMessage` | typed columns | `seq` | same |
| `quotes` | `Quote` | `id`, `doc`, `createdAt`, `updatedAt` | `workspace` (the quote builder's draft, opaque JSON): staff | the customer, staff |
| `issues` | `Issue` | `id`, `doc`, `createdAt`, `updatedAt` | `notes` (`IssueNotes`: `{ notes, updatedAt, updatedBy }`): staff | the customer, members of its store, staff |
| `payment_authorizations` | — | — | everything | nobody (operators read `order.payment.events`) |
| `ledger_entries` | `WithId<LedgerEntry>` | typed columns | — | staff; the owner of the store (`payee_type = 'store'`); the driver (own) |
| `payouts` | `WithId<Payout>` | typed columns | — | same as ledger entries |
| `store_suggestions` | `WithId<StoreSuggestion>` | typed columns | — | staff |
| `notifications` | `AppNotification` | typed columns; `push = { status, successCount, failureCount, sentAt }` | `dedupe_key` | the recipient |
| `push_tickets` | — | — | everything | nobody |
| `files` | `PresignedUpload`, `UploadedFile` (§5.4); `id` is the `uploadId` | — | everything else | per purpose (§10.1) |
| `dev_outbox` | `OutboxMessage` (§5.4) | typed columns | rows with `sensitive = true` are returned to admins only | staff |
| `scheduler_state` | `JobState` (§5.4) | typed columns | — | staff |
| `outbox` | `OutboxEvent` (§5.4) | typed columns, `payload` only for admins | `payload` of sensitive events | admins |
| `rate_limits`, `geocode_cache` | — | — | everything | nobody |

### 3.4 Index map (MARKETPLACE §6.5 → SQL)

| # | Firestore index | SQL index | Query shape |
| --- | --- | --- | --- |
| 1 | products: listed, searchTerms CONTAINS | `products_search_idx` | `WHERE listed AND search_terms @> ARRAY[$key]` |
| 2 | products: listed, categoryId, name | `products_category_idx` | `WHERE listed AND category_id = $1 ORDER BY name_sort, id` |
| 3 | products: listed, featured, name | `products_featured_idx` | `WHERE listed AND featured ORDER BY name_sort, id` |
| 4 | products: storeId, listed, name | `products_store_listed_idx` | `WHERE store_id = $1 AND listed ORDER BY name_sort, id` |
| 5 | products: storeId, listed, categoryId, name | `products_store_category_idx` | `… AND category_id = $2 …` |
| 6 | products: storeId, name | `products_store_idx` | portal and ops catalogue: `WHERE store_id = $1 ORDER BY name_sort, id` |
| 7 | products: familyKey, listed, priceCents | `products_family_idx` | `WHERE listed AND family_key = $1 ORDER BY price_cents, id` |
| 8 | storeOrders: storeId, status, timing.readyBy | `store_orders_board_idx` | `WHERE store_id = $1 AND status = ANY($2) ORDER BY ready_by, id` |
| 9 | storeOrders: storeId, createdAt ↓ | `store_orders_store_idx` | portal history |
| 10 | storeOrders: storeId, completedAt ↓ | `store_orders_completed_idx` | "Done today", insights |
| 11 | storeOrders: status, timing.respondBy | `store_orders_respond_idx` | `escalateStoreOrders` |
| 12 | storeOrders: fulfilment, status, pickup.holdUntil | `store_orders_hold_idx` | `expirePickupHolds` |
| 13 | storeOrders: status, createdAt ↓ | `store_orders_status_idx` | ops store-order queue |
| 14 | orders: customerId, createdAt ↓ | `orders_customer_idx` | order history, "Buy again" |
| 15 | orders: customerId, status, createdAt ↓ | `orders_customer_active_idx` | active orders on Home (`status=placed,confirmed,preparing,ready,on_the_way`) |
| 16 | orders: status, createdAt ↓ | `orders_status_idx`, `orders_created_idx` | ops orders |
| 17 | orders: payment.status, payment.captureDeadlineAt | `orders_capture_sweep_idx` | `captureDuePayments` |
| 18 | orders: needsAttention, createdAt ↓ | `orders_attention_idx` | ops dashboard |
| 19 | jobOffers: status, audience CONTAINS, openedAt ↓ | `job_offers_audience_idx` | `WHERE status = 'open' AND audience @> ARRAY[$key] ORDER BY opened_at DESC` |
| 20 | jobOffers: status, opensAt | `job_offers_opens_idx` | publisher, ops `/jobs` |
| 21 | jobOffers: status, openedAt | `job_offers_nudge_idx` | unclaimed nudge |
| 22 | quotes: customerId, createdAt ↓ | `quotes_customer_idx` | customer list |
| 23 | quotes: status, respondBy | `quotes_sla_idx` | ops inbox by SLA |
| 24 | quotes: status, createdAt ↓ | `quotes_status_idx`, `quotes_created_idx` | ops tabs |
| 25 | quotes: status, offerValidUntil | `quotes_expiry_idx` | `expireQuotes` |
| 26 | issues: customerId, createdAt ↓ | `issues_customer_idx` | customer list |
| 27 | issues: storeId, createdAt ↓ | `issues_store_idx` | portal |
| 28 | issues: status, createdAt ↓ | `issues_status_idx`, `issues_created_idx` | ops queue |
| 29 | supportThreads: kind, updatedAt ↓ | `support_threads_kind_idx` | ops inbox tabs |
| 30 | supportThreads: status, updatedAt ↓ | `support_threads_status_idx` | ops inbox filter |
| 31 | ledgerEntries: payeeType, payeeId, createdAt ↓ | `ledger_payee_idx` | portal payouts, driver earnings |
| 32 | ledgerEntries: payoutId, createdAt | `ledger_unpaid_idx` | payout run (`payout_id IS NULL`) |
| 33 | payouts: payeeType, payeeId, createdAt ↓ | `payouts_payee_idx`, `payouts_created_idx` | portal, driver app, ops |
| 34 | storeSuggestions: status, createdAt ↓ | `store_suggestions_status_idx` | ops |
| 35 | users: role, status | `users_role_status_idx` | staff list, drivers list, notify staff |
| 36 | users: role, status, cityId | `users_role_status_idx` (same index, 4 columns) | job-offer fan-out |
| 37 | users: storeId, role, status | `users_store_idx` | store members, team page |
| — | deliveries: the existing six | `deliveries_driver_status_idx` (covers `driverId, status` and `driverId, status, updatedAt ↓`), `deliveries_driver_delivered_idx`, `deliveries_driver_created_idx`, `deliveries_status_created_idx`, `deliveries_status_updated_idx` | unchanged queries |
| — | notifications: the existing two | `notifications_user_idx`, `notifications_unread_idx` | inbox, unread count |
| — | driverLocations: online, updatedAt | `driver_locations_online_idx` | `markStaleDriversOffline` |
| — | events (collection group, `at` ↓) | primary key of `delivery_events` (`ORDER BY id DESC`) | ops activity feed |
| — | devices.token (collection group) | `devices_token_key` | one account per push token |
| — | TTL on `rateLimits`, `otpChallenges`, `devOutbox` | `*_expires_idx` | `purgeExpiredRows` |

The three removed grocery indexes have no successor. An index test (§12.4) runs every repository query
with `EXPLAIN` against a seeded database and fails on a sequential scan of a table with more than
1 000 rows.

### 3.5 Statements that must be written this way

```sql
-- (a) Row locks: one statement per table, ids sorted by the database, weakest sufficient lock (R1).
SELECT id, doc, created_at, updated_at FROM store_orders
 WHERE id = ANY($1::text[]) ORDER BY id COLLATE "C" FOR NO KEY UPDATE;

-- (b) Stock. The product rows are already locked (a). Missing products (deleted listings) match no row: that is fine.
UPDATE products SET reserved = reserved + $2, updated_at = $3 WHERE id = $1;                                -- reserve
UPDATE products SET reserved = GREATEST(reserved - $2, 0),                                                  -- release
       stock_on_hand = CASE WHEN $3 THEN LEAST(stock_on_hand, GREATEST(reserved - $2, 0)) ELSE stock_on_hand END,
       updated_at = $4 WHERE id = $1;                                    -- $3 = reason is out_of_stock (clamp)
UPDATE products SET stock_on_hand = GREATEST(stock_on_hand - $2, 0),                                        -- commit
       reserved = GREATEST(reserved - $2, 0), updated_at = $3 WHERE id = $1;
UPDATE products SET stock_on_hand = LEAST(stock_on_hand + $2, 1000000), updated_at = $3 WHERE id = $1;      -- restock

-- (c) Keyset page, newest first. $2/$3 come from the cursor; the first page omits the row comparison.
SELECT id, doc, created_at, updated_at FROM orders
 WHERE customer_id = $1 AND (created_at, id) < ($2, $3)
 ORDER BY created_at DESC, id DESC LIMIT $4;                              -- $4 = limit + 1

-- (d) Rate limit: one atomic upsert, autocommit, never inside the business transaction.
INSERT INTO rate_limits AS r (bucket, subject, count, window_start, expires_at)
VALUES ($1, $2, 1, $3, $4)                                               -- $3 = now, $4 = now + window
ON CONFLICT (bucket, subject) DO UPDATE SET
  count        = CASE WHEN r.expires_at <= EXCLUDED.window_start THEN 1 ELSE r.count + 1 END,
  window_start = CASE WHEN r.expires_at <= EXCLUDED.window_start THEN EXCLUDED.window_start ELSE r.window_start END,
  expires_at   = CASE WHEN r.expires_at <= EXCLUDED.window_start THEN EXCLUDED.expires_at ELSE r.expires_at END
RETURNING count, expires_at;                                             -- count > max → RATE_LIMITED

-- (e) Outbox: enqueue in the business transaction, coalescing on the dedupe key while a row is pending.
INSERT INTO outbox (event, payload, dedupe_key, max_attempts, run_at, created_at)
VALUES ($1, $2::jsonb, $3, $4, $5, $6)
ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
SELECT pg_notify('is_outbox', '');

-- (f) Outbox: claim a batch (short transaction of its own; the handlers run after it commits).
WITH due AS (
  SELECT id FROM outbox WHERE status = 'pending' AND run_at <= $1
   ORDER BY run_at, id LIMIT $2 FOR UPDATE SKIP LOCKED
)
UPDATE outbox o SET status = 'processing', locked_at = $1, locked_by = $3, attempts = o.attempts + 1
  FROM due WHERE o.id = due.id
RETURNING o.id, o.event, o.payload, o.attempts, o.max_attempts;

-- (g) Create-once rows (the old `create()`): ledger entries and keyed notifications.
INSERT INTO ledger_entries (id, payee_type, payee_id, kind, amount_cents, order_id, store_order_id, delivery_id,
                            issue_id, description, held_for_issue_id, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (id) DO NOTHING;
INSERT INTO notifications (id, user_id, dedupe_key, type, title, body, data, push_status, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING id;

-- (h) Store fan-out (was onStoreWritten): lock in id order first, then one UPDATE. `listed` follows by itself.
SELECT id FROM products WHERE store_id = $1 ORDER BY id COLLATE "C" FOR NO KEY UPDATE;
UPDATE products SET store_name = $2, store_status = $3, updated_at = $4 WHERE store_id = $1;

-- (i) Job board of a driver and the fan-out to drivers of an opened offer.
SELECT delivery_id, doc, created_at, updated_at FROM job_offers
 WHERE status = 'open' AND audience @> ARRAY[$1]::text[] ORDER BY opened_at DESC, delivery_id LIMIT 200;
SELECT u.id FROM users u JOIN driver_locations l ON l.driver_id = u.id
 WHERE u.role = 'driver' AND u.status = 'active' AND l.online
   AND (u.city_id || ':' || u.capacity_class) = ANY($1::text[])
 ORDER BY l.updated_at DESC LIMIT 20;

-- (j) Human numbers.
SELECT nextval('order_number_seq') AS n;                                 -- 'IS-' || n

-- (k) Realtime event, in the business transaction (§8.3). The payload must stay under 8000 bytes.
SELECT pg_notify('is_live', $1);

-- (l) Scheduler lock. Never SELECT the key itself: it does not fit a JavaScript number.
SELECT pg_try_advisory_lock(hashtextextended('instasupply:job:' || $1, 0)) AS locked;
SELECT pg_advisory_unlock(hashtextextended('instasupply:job:' || $1, 0));

-- (m) Outbox: give a claimed row back (handler failed, reaper, admin retry). Never a plain
--     `SET status = 'pending'`: a newer pending row with the same dedupe key may exist (enqueued while this one was
--     processing), and the partial unique index outbox_dedupe_key would reject the update (23505). A row that is
--     superseded that way is finished as `done`: the newer pending row redoes the same work from current state.
UPDATE outbox o SET
  status      = CASE WHEN o.dedupe_key IS NOT NULL AND EXISTS (
                       SELECT 1 FROM outbox p WHERE p.dedupe_key = o.dedupe_key AND p.status = 'pending' AND p.id <> o.id)
                     THEN 'done' ELSE $2 END,                             -- $2 = 'pending' (retry) or 'dead'
  run_at      = $3, locked_at = NULL, locked_by = NULL, last_error = $4,
  finished_at = CASE WHEN $2 = 'dead' THEN $5 ELSE NULL END
WHERE o.id = $1 AND o.status IN ('processing', 'dead');
-- The reaper selects `id FROM outbox WHERE status = 'processing' AND locked_at < $1 ORDER BY id` and runs (m) once
-- per row in its own statement, so one row can never abort the recovery of the others.

-- (n) Move a default flag (jobsites, cards). The partial unique indexes jobsites_default_key and cards_default_key are
--     not deferrable, so the old default is cleared first, under the owner's row lock.
SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE;
UPDATE jobsites SET is_default = false, updated_at = $3 WHERE user_id = $1 AND is_default AND id <> $2;
-- then the upsert of jobsite $2 with is_default = true. The same three statements for cards.
```

### 3.6 Transactions and the locking order

```ts
// platform/db/tx.ts
export interface Tx {
  /** The command's clock value (§3.1). */
  readonly now: number;
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[]; rowCount: number }>;
}
export class RetryTransaction extends Error {}
export function withTransaction<T>(deps: Deps, fn: (tx: Tx) => Promise<T>, options?: { now?: number }): Promise<T>;
```

`withTransaction` checks one client out of the pool, runs `BEGIN`, `fn`, `COMMIT` (or `ROLLBACK`
on a throw) and releases the client. It runs `fn` again, at most 3 times with 20 to 100 ms of jitter,
when the failure is a deadlock (SQLSTATE `40P01`), a serialization failure (`40001`) or a
`RetryTransaction`. A lock wait that exceeds `lock_timeout` (`55P03`) becomes `unavailable`. `fn` must
therefore have no effect outside the database: no network call, no file write, no in-memory state.

**Lock rank.** A transaction that needs several row locks takes them in ascending rank, and within a
table in ascending id (statement (a) of §3.5). No transaction ever takes a lock of a lower rank while
it holds one of a higher rank. With one total order, a lock cycle cannot form.

| Rank | Table | Locked rows |
| --- | --- | --- |
| 1 | `users` | the customer of every order the transaction touches, and every driver whose deliveries it changes, gains or loses |
| 2 | `quotes` | the quote |
| 3 | `issues` | the issue |
| 4 | `orders` | the orders |
| 5 | `store_orders` | the store orders the transaction **writes** |
| 6 | `deliveries` | their deliveries, and any other delivery of the driver that the transaction parks |
| 7 | `job_offers` | their offers |
| 8 | `stores` | a store whose document or rating changes (`FOR NO KEY UPDATE`); the store of a product being written (`FOR SHARE`) |
| 9 | `categories` | a category being edited; the category of a product being written (`FOR SHARE`) |
| 10 | `products` | the products whose stock or columns change |
| 11 | `support_threads` | the thread |
| 12 | `chat_threads` | the thread |
| 13 | `payouts` | the payout |
| 14 | `ledger_entries` | entries being stamped, held or released |
| 15 | everything else | single-row upserts at the end: `tracking`, `routes`, `driver_locations`, `jobsites`, `cards`, `notifications`, `devices`, `files`, `sessions`, `otp_challenges`, `payment_authorizations` |

**Rules**

1. **The customer row is the root lock of an order (R4).** Every transaction that inserts or updates
   an `orders` or `store_orders` row holds the lock on `users(customerId)`. Every transaction that
   writes a store order also holds the lock on its `orders` row. Sibling store orders can then be
   read without a lock: nobody can change them meanwhile.
2. **A driver's row guards the driver's set of deliveries.** Every transaction that changes a
   delivery which has, gets or loses a driver holds the lock on `users(driverId)`. The count of active
   jobs (`TOO_MANY_JOBS`) and the "only one trip in transit" rule are therefore race-free.
3. **Keys first, locks second.** A flow starts from one id (a store order, a delivery, an offer). It
   reads the keys it needs without locking (`order_id`, `customer_id`, `delivery_id`, `driver_id`),
   then locks in rank order, then re-reads state from the locked rows and validates. Keys are
   immutable, except `deliveries.driver_id`: if the locked delivery has another driver than the one
   read before, throw `RetryTransaction`.
4. `lockGraph` implements rule 3 and is the only way commands lock order data:

   ```ts
   // platform/db/locks.ts
   export interface GraphSeed { orderIds?: string[]; storeOrderIds?: string[]; deliveryIds?: string[];
     userIds?: string[]; quoteIds?: string[]; issueIds?: string[]; productIds?: string[]; withOffers?: boolean }
   export interface LockedGraph { users: Map<string, UserRow>; quotes: Map<string, QuoteRow>; issues: Map<string, IssueRow>;
     orders: Map<string, OrderRow>; storeOrders: Map<string, StoreOrderRow>; deliveries: Map<string, DeliveryRow>;
     offers: Map<string, JobOfferRow>; products: Map<string, ProductRow> }
   export function lockGraph(tx: Tx, seed: GraphSeed): Promise<LockedGraph>;
   export function lockRows<R>(tx: Tx, table: LockableTable, ids: readonly string[], mode?: 'update' | 'share'): Promise<R[]>;
   ```

   `lockGraph` resolves the closure with plain reads (store order → order, customer, delivery;
   delivery → store order, order, customer, driver), then issues one locking statement per table in
   rank order, then applies the check of rule 3.
5. **Bulk updates lock first** in id order (statement (h)), so they cannot interleave with a
   transaction that locks the same rows one statement earlier.
6. **Foreign keys.** A foreign-key check takes `FOR KEY SHARE` on the parent row. That lock does not
   conflict with `FOR NO KEY UPDATE`, so inserts of child rows (notifications, events, sessions) never
   wait for our row locks. Never use plain `FOR UPDATE` on a table that a foreign key references (the
   outbox claim, on a table nothing references, is its one use); never update a primary key; delete only rows
   that nothing references (`job_offers`, `favorites`, `devices`, `jobsites`, `cards`, `notifications`,
   expired tokens, and a `products` row with `reserved = 0`).
7. **Read-only requests** use `pool.query` directly, without a transaction.
8. A transaction stays short: every network call happens before it starts or after it commits (P8).

---

## 4. API conventions

### 4.1 Requests and responses

- Base path `/api/v1`. JSON only: `Content-Type: application/json; charset=utf-8` on every request
  with a body (the upload target of the `local` storage driver is the one multipart exception).
- **Authentication header:** `Authorization: Bearer <accessToken>` (§6.2). No cookies are used
  anywhere, so there is no CSRF surface. A request without the header is anonymous: public endpoints
  answer it, every other endpoint answers `unauthenticated`.
- Optional client header `X-Client: <name>/<version> (<platform>)`, for example
  `X-Client: customer/1.4.0 (android)`. It is logged, stored on the session as `platform` and
  `app_version`, and otherwise ignored.
- **Success:** HTTP 200 with the document itself as the JSON body, without a wrapper (204 without a
  body where §5 says so). A command that has nothing to return answers `{ "ok": true }`
  (`OkResponse`). Every list answers `Page<T>` (§4.4), also the small ones.
- **Instants** are epoch milliseconds (numbers), in bodies and in query parameters (`createdFrom`).
  Money is integer cents.
- Request bodies are parsed with strict zod objects: an unknown key is an `invalid-argument`. This is
  what rejects `number` or `cvv` on a card, `reserved` on a product, `senderRole` on a message.
- Strings are trimmed; where the legacy code used `cleanText(value, max)` the schema does the same
  (collapse whitespace, cut to the maximum).

### 4.2 Errors

One envelope for every failure, from every endpoint:

```ts
export type ApiStatus = 'invalid-argument' | 'unauthenticated' | 'permission-denied' | 'not-found' | 'already-exists'
  | 'failed-precondition' | 'resource-exhausted' | 'internal' | 'unavailable';
export interface ApiErrorBody {
  error: {
    status: ApiStatus;
    /** The ERROR_CODES value when the failure has one (MARKETPLACE §5.9), else null. */
    code: ErrorCode | null;
    /** Written for the user. Apps may show it as is. */
    message: string;
    /** Always an object. Carries what MARKETPLACE §5.9 lists per code (pricing, windows, version, remaining, …). */
    details: Record<string, unknown>;
  };
}
```

| `status` | HTTP | Used for |
| --- | --- | --- |
| `invalid-argument` | 400 | malformed or invalid input; `CODE_INCORRECT`, `PHOTO_REQUIRED`. Body too large keeps HTTP 413, wrong content type keeps HTTP 415, both with this status |
| `unauthenticated` | 401 | no token, bad token, expired token, revoked session, wrong credentials |
| `permission-denied` | 403 | the caller is known but may not do this; suspended account |
| `not-found` | 404 | the object does not exist; unknown route; unknown command name |
| `already-exists` | 409 | a client id that belongs to someone else (D17); an email or phone number that is taken |
| `failed-precondition` | 412 | the state does not allow it: every code of MARKETPLACE §5.9 with that status |
| `resource-exhausted` | 429 | `RATE_LIMITED`, `CODE_LOCKED`, `TOO_MANY_JOBS`, account lockout. When a wait helps: `details.retryAfterMs` and the `Retry-After` header (seconds) |
| `internal` | 500 | a bug. The message is always "Something went wrong on our side. Please try again." The real error is logged with the request id |
| `unavailable` | 503 | the database is unreachable or busy (lock timeout, deadlock after 3 tries), or the server is shutting down. Safe to retry. Sends `Retry-After: 1`. Platform only: domain code never throws it |

```ts
// platform/http/errors.ts
export class ApiError extends Error {
  constructor(readonly status: ApiStatus, message: string,
              readonly code: ErrorCode | null = null, readonly details: Record<string, unknown> = {}) { super(message); }
}
export function fail(status: ApiStatus, message: string, details?: Record<string, unknown>): never;
/** Throws with the status the shared table gives the code: ERROR_CODE_STATUS[code]. */
export function failCode(code: ErrorCode, message: string, details?: Record<string, unknown>): never;
export function invalidArgument(message: string, details?: Record<string, unknown>): never;
export function notFound(message: string): never;
export function permissionDenied(message?: string): never;            // "You don't have permission to do that."
export function failedPrecondition(message: string, details?: Record<string, unknown>): never;
export const HTTP_STATUS: Record<ApiStatus, number>;
```

Rules:

- `failCode` takes the status from `ERROR_CODE_STATUS` in `@instasupply/shared`, so the table of
  MARKETPLACE §5.9 has one source.
- A zod failure becomes `invalid-argument` with `details.fields = { "<path>": "<message>" }` and the
  first message as `message`.
- `unauthenticated` and suspended accounts carry `details.reason` (§6.4), so the client knows whether
  to refresh, to end the session or to show "account suspended".
- The body's `error.status` is the truth; the HTTP status is derived from it with the table above.
  Every response, success or failure, carries `X-Request-Id`.
- The legacy `deadline-exceeded` (expired OTP) is now `failed-precondition`.
- Framework errors go through the same handler: `FST_ERR_CTP_BODY_TOO_LARGE` → 413,
  `FST_ERR_CTP_INVALID_MEDIA_TYPE` → 415, JSON syntax error → 400, unknown route → 404, the limiter →
  429 with `code: 'RATE_LIMITED'`.
- PostgreSQL errors never reach the client. `23505` (unique violation) inside a handler that did not
  plan for it is an `internal`. Handlers that rely on a unique index catch it themselves and map it
  (`ISSUE_ALREADY_OPEN`, `already-exists`).

### 4.3 Request ids and logging

- `X-Request-Id`: the server uses the inbound value when it matches `^[A-Za-z0-9_-]{8,64}$`, else it
  generates a UUID. The value is echoed in the response header and is the `reqId` of every log line of
  the request. Railway's `X-Railway-Request-Id` is logged as `railwayRequestId`.
- Fastify is created with `disableRequestLogging: true`, so its built-in "incoming request" and
  "request completed" lines (which contain `req.url` and `remoteAddress`) never appear, and the pino `req`
  and `res` serializers are replaced by ones that keep only `method` and the route pattern. The single
  completion line below is written by an `onResponse` hook. URLs therefore never reach our logs.
  Railway's own HTTP log records the path and source address of every request at the edge; that is why
  no secret is ever placed in a URL: set-password tokens travel in the fragment and in POST bodies (§6.2),
  refresh tokens and codes in bodies. The tracking token is the one identifier that is in a path
  (`/tracking/{token}`, `/track/{token}`): it is the public link itself and grants only the public view.
- Logs are JSON lines on stdout (pino through Fastify), level `LOG_LEVEL`. One line per request at
  completion: `reqId`, `method`, `route` (the pattern, for example `/api/v1/call/:name`), `command`
  (for commands), `statusCode`, `responseTime`, `uid`, `role`, `ip` (HMAC, never the raw address),
  `client` (the `X-Client` value).
- Shape: every line has a **string** `level` (`debug`, `info`, `warn`, `error`) and its text in
  `message` (pino options `formatters.level = (label) => ({ level: label })`, `messageKey: 'message'`).
  That is the shape Railway's log explorer understands.
- Never logged: request and response bodies, the `Authorization` header (redacted), tokens, codes,
  PINs, passwords, phone numbers, email addresses, street addresses. A log line identifies people by
  uid only.
- 5xx responses log the error with its stack at `error`; 4xx at `info` with `status` and `code`.
- The outbox worker and the scheduler log `event` / `job`, `attempt`, `durationMs`, `outcome`.

### 4.4 Pagination

```ts
export interface Page<T> { items: T[]; nextCursor: string | null }
```

- Query parameters: `limit` (1 to 500, default 50) and `cursor` (opaque). `sort` is `<field>:asc` or
  `<field>:desc`, from the values §5.3 lists for the endpoint.
- Keyset pagination only. The cursor is `base64url(JSON.stringify([sortValue, id]))` of the last item;
  the server reads `limit + 1` rows to know whether a next page exists (statement (c) of §3.5). A
  cursor that does not parse is an `invalid-argument`.
- Every sort has an index that ends in `id`, so the order is total and pages never skip or repeat a
  row.
- There are no totals. Screens that need a number use a dedicated endpoint
  (`/notifications/unread-count`, `/ledger/balance`, `/deliveries/stats`, `/ops/dashboard`).

### 4.5 Idempotency

There is no `Idempotency-Key` header. Every write is safe to retry through one of five mechanisms:

| Mechanism | How | Used by |
| --- | --- | --- |
| **Client UUID as the row id** (D17) | the id is in the request; a retry finds the row and returns the first result; an id owned by another account → `already-exists` | `placeOrder` and `acceptQuote` (`checkoutId`), `submitMaterialList` (`requestId`), `reportIssue` (`issueId`), `PUT /me/jobsites/{id}`, `PUT /me/cards/{id}`, `POST …/messages` with a message `id` (chat and support) |
| **Natural key** | `PUT` on a path that is the identity | favourites (`productId`), devices (`installationId`), store reviews (`storeOrderId`), products (`productId`), `createStore` (`storeId`), location, read flags |
| **State check** | already in the target state → answer as if it had just happened | `updateDeliveryStatus` (same status), `completeDelivery` (already delivered), `checkInAtStore` (`arrivedAt` set once), `claimJob` by the driver who already holds the job, `cancelOrder` (already cancelled targets are reported, not failed), `closeQuote`, `setDriverStatus`, `setSupplierUserStatus`, logout |
| **Optimistic version** | `expectedVersion` must equal the current version, else `VERSION_CONFLICT { version }` (or `QUOTE_VERSION`); the client reloads | `acceptStoreOrder`, `updateStoreOrderStatus`, `rejectStoreOrder`, `completePickup`, `sendQuote`, `acceptQuote` (`version`) |
| **Deterministic keys downstream** | gateway keys `auth_`, `void_`, `capture_`, `refund_`, `payout_`; ledger ids; notification dedupe keys; outbox dedupe keys | payments, ledger, notifications |

`PATCH` endpoints are idempotent by nature (they set values). The one relative write,
`POST /products/{id}/stock-adjust`, is documented as not retry-safe: after a lost answer the portal
reloads the product before it adjusts again.

### 4.6 Rate limits

Two layers.

**In memory, per instance (`@fastify/rate-limit`, `keyGenerator: clientAddress`):** `RATE_LIMIT_PER_MINUTE`
(600) requests per minute per client address, on every route except `/api/v1/health`. It only stops floods; with two instances
the effective ceiling doubles.

**In the database (`consumeRateLimit(bucket, subject, max, windowSeconds)`, statement (d) of §3.5):**
exact, shared by all instances, fixed windows. `subject` is a uid or an HMAC, never a raw address,
phone number or email: `hmacHex('ip', address)`, `hmacHex('phone', e164)`, `hmacHex('email', lowercased)`,
all keyed with `OTP_PEPPER` (MARKETPLACE §1.1). Over the limit → `RATE_LIMITED` with
`details.retryAfterMs`.

| Bucket | Subject | Limit | Applied in |
| --- | --- | --- | --- |
| `signup_ip` | ip | 10 / hour | `POST /auth/register` |
| `login_ip` | ip | 30 / 15 min | `POST /auth/login` |
| `login_email` | email (whether or not an account has it) | 10 / 15 min; a caller trusted for the account is exempt (§6.3.4) | `POST /auth/login` |
| `refresh_ip` | ip | 120 / 15 min | `POST /auth/refresh` |
| `reset_ip` | ip | 10 / hour | `POST /auth/password/forgot` and `/reset` |
| `reset_email` | email | 3 / hour | `POST /auth/password/forgot` |
| `reset_fail_user` | uid | 10 wrong reset codes / 24 h, across all codes; past it `forgot` issues nothing for that account for 24 h (still 204) and admins get one `system` notification | `POST /auth/password/reset` |
| `otp_ip` | ip | 20 / hour | `requestPhoneOtp` |
| `otp_phone` | phone | 5 / hour | `requestPhoneOtp` |
| `otp_phone_day` | phone | 10 / day | `requestPhoneOtp` |
| `otp_global` | `global` | 200 / hour and 1 000 / day (two buckets: `otp_global`, `otp_global_day`) | `requestPhoneOtp`, every number together: caps SMS spend. Over it: `RATE_LIMITED`, and admins get one `system` notification per window (key `otp-global-{windowStart}`) |
| (challenge row) | uid | 5 sends / hour, 30 s between sends, 5 attempts per code | `requestPhoneOtp`, `verifyPhoneOtp` (kept from the legacy code) |
| `geocode` | uid, or ip for guests | 30 / hour; staff are exempt | `geocodeAddress` |
| `suggest` | uid, or ip for guests | 5 / hour | `suggestStore` |
| `material_list` | uid | 10 / day | `submitMaterialList` |
| `issue_report` | uid | 10 / day | `reportIssue` |
| `support_message` | uid | 60 / 10 min | `POST /support-threads/…/messages` |
| `chat_message` | uid | 120 / 10 min | `POST /threads/…/messages` |
| `file_ticket` | uid | 60 / hour | `POST /files/presign` |
| `invite` | uid | 30 / hour | `createStaffUser`, `inviteSupplierUser` |
| `provider_nominatim` | `global` | 1 / second | outbound Nominatim calls (waits up to 3 s for a slot) |
| `provider_osrm` | `global` | 1 / second | outbound OSRM calls (falls back to the estimate when no slot) |

Other limits that are not counters: account lockout (§6.5), `optimizeRoute` at most once per 15 s per
driver (kept: compares `routes.computed_at`), driver location reports at least 2 s apart (§5.3.3),
`RATE_LIMITS_DISABLED=true` switches both layers off in tests that are not about limits.

**The client address has exactly one source**, `clientAddress(req)` in `platform/http/client-address.ts`:

```ts
export function clientAddress(req: { headers: IncomingHttpHeaders; socket: { remoteAddress?: string } }): string {
  const real = config.TRUST_PROXY ? String(req.headers['x-real-ip'] ?? '').trim() : '';
  return real || req.socket.remoteAddress || 'unknown';
}
```

Railway's edge sets `X-Real-IP` to the client's address and does **not** add `X-Forwarded-For` (§13.1),
so any `X-Forwarded-For` a request carries was written by the client. Fastify's `trustProxy` is therefore
**off** (§4.8) and `request.ip` is never read anywhere: the in-memory limiter's `keyGenerator`, every
`consumeRateLimit(…_ip)` subject (`hmacHex('ip', clientAddress(req))`), the guest subjects of `geocode` and
`suggest`, the anonymous-socket cap of §8.1, `sessions.ip_hash` and the `ip` log field all call
`clientAddress`. A lint rule (`no-restricted-properties` on `request.ip` / `req.ip` in `backend/src`) keeps
it that way. Test (`rate-limit.test.ts`): requests with a random `X-Forwarded-For` and a fixed `X-Real-IP`
land in the same bucket.

### 4.7 Size limits

| Limit | Value |
| --- | --- |
| JSON body | 1 MiB (Fastify's `bodyLimit` default), 256 KiB for `/auth/*` |
| Upload through the `local` storage target | the `max_bytes` of the ticket, at most 15 MiB, one file |
| Upload to the bucket | enforced by the presigned form (`content-length-range`) |
| WebSocket message from a client | 16 KiB (`maxPayload`) |
| URL path parameter | 100 characters (Fastify's `maxParamLength` default; the longest id, a product id, has 82) |
| `limit` | 500 |
| `ids` query parameters | 100 ids |
| `NOTIFY` payload | 7 500 bytes; a larger live event is sent without `data` |

### 4.8 CORS and security headers

- **CORS:** allowed origins are exactly the entries of `CORS_ORIGINS` (the console origin and any
  Expo web origin). Outside production, origins on `localhost`, `127.0.0.1` and private LAN addresses
  (`10.*`, `172.16–31.*`, `192.168.*`), any port, are allowed as well, so Expo web and a phone on the
  same Wi-Fi work without configuration. Native apps send no `Origin` and are unaffected.
  `credentials: false`. Methods `GET, POST, PUT, PATCH, DELETE, OPTIONS`. Allowed headers
  `Authorization, Content-Type, X-Client, X-Request-Id`. Exposed headers `X-Request-Id, Retry-After`.
  Preflight `maxAge` 86 400 s.
- **WebSocket:** an upgrade request that carries an `Origin` header that CORS would not allow is
  refused with 403. A request without `Origin` (native apps, scripts) is accepted.
- **Headers on every response** (`@fastify/helmet`): `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`,
  `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`,
  `Cross-Origin-Resource-Policy: cross-origin` (the console is on another origin and loads media),
  and in production `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
- **Caching:** `Cache-Control: no-store` on every JSON response. Only `/api/v1/media/*` is cacheable
  (§10.1).
- **Fastify options:** `trustProxy: false` (the client address comes from `clientAddress()`, §4.6),
  `disableRequestLogging: true` (§4.3), `requestIdHeader: false` (the id is handled as in §4.3), `return503OnClosing: true` (the default), `bodyLimit: 1048576` (the default). Do not lower
  `keepAliveTimeout` below its default of 72 s: Railway's edge keeps idle HTTP/1.1 connections for
  60 s, and the server must outlive the proxy's idle timer.
- TLS ends at Railway's edge. The server speaks plain HTTP on `PORT`.

---

## 5. Endpoint catalogue

### 5.1 How to read it

All paths are relative to `/api/v1`. Types without a definition here are exported by
`@instasupply/shared` (MARKETPLACE §1.3 and §5.3; `packages/shared/src/api.ts`). Types of the REST
contract that shared does not have are defined in §5.4.

**Policy words used in the tables**

| Word | Meaning (helper in §7.1) |
| --- | --- |
| `public` | no token needed; a token, when present, is still verified |
| `auth` | any signed-in account, role may be null (`requireAuth`) |
| `customer` | role `customer`, status `active` (`requireCustomer`) |
| `supplier` | role `supplier`, status `active`, has a store (`requireSupplier`) |
| `member(S)` / `owner(S)` | supplier whose own store is S / with store role `owner` (`requireStoreAccess`) |
| `driver` / `driver*` | role `driver`, any status / status `active` (`requireActiveDriver`) |
| `staff` / `admin` | `admin` or `dispatcher`, active (`requireStaff`) / `admin` only (`requireAdmin`) |
| `self` | the uid in the path is the caller |
| "+ …" | an object-level check on the row that was loaded (§7.3) |

**Commands.** `POST /call/<name>` with the request type as the JSON body, the response type as the
JSON answer. A name that is not registered → `not-found`.

```ts
// platform/http/command.ts
export function defineCommand<Req, Res>(spec: {
  name: keyof typeof CALLABLES;
  /** Runs first. Throws unauthenticated / permission-denied. Returns the actor (null for public commands). */
  policy: (ctx: RequestContext) => Actor | null;
  schema: z.ZodType<Req>;
  /** Database-backed limits of §4.6, consumed before the handler. */
  limits?: (ctx: RequestContext, req: Req) => RateLimitUse[];
  handler: (ctx: RequestContext, req: Req, actor: Actor | null) => Promise<Res>;
}): void;
```

A test (`test/platform/commands.test.ts`) fails when a name of `CALLABLES` has no registration or a
registration has no entry in `CALLABLES`.

### 5.2 Commands

"Implements" names the row of MARKETPLACE §5.4 (and the flow of §5.5 where there is one). The
transaction of each command, with its locks, is in §9.2: in that column, what stands before "→" is
MARKETPLACE and what follows it is this document. Where MARKETPLACE §5.3 names no response type, the
response is `OkResponse`.

This is the complete list: 39 commands. On 2026-11-20 `CALLABLES` in `packages/shared/src/constants.ts`
holds exactly these 39 names and `api.ts` has their request and response types (`CallableContracts`),
`ScheduledJobName`, `ClaimJobResponse` and `RunJobNowResponse`. The remaining shared edits are §16.

| Command | Policy | Request → response | Retry safety · limits | Implements · platform notes |
| --- | --- | --- | --- | --- |
| `registerCustomer` | `auth`; role must be null or `customer` | `RegisterCustomerRequest` → `RegisterCustomerResponse` | state check | MARKETPLACE §5.4 row. Sets `role = 'customer'`, `status = 'active'`; replaces "claim `customer`". §6.3.2 |
| `registerDriver` | `auth`; role must be null or `driver` | `RegisterDriverRequest` → `RegisterDriverResponse` | state check | MARKETPLACE §5.4 row. `role = 'driver'`, `status = 'pending'`; admins get `driver_signup`. While `pending` a second call overwrites name, city and vehicle; afterwards only the name. §6.3.3 |
| `requestPhoneOtp` | `auth` with a role | `RequestPhoneOtpRequest` → `RequestPhoneOtpResponse` | `otp_*` limits, 30 s cooldown, 5 per hour | unchanged behaviour, +1 numbers only. `devCode` only when `EXPOSE_DEV_CODES=true`. §6.3.9 |
| `verifyPhoneOtp` | `auth` with a role | `VerifyPhoneOtpRequest` → `VerifyPhoneOtpResponse` | 5 attempts per code | §6.3.9 |
| `createStaffUser` | `admin` | `CreateStaffUserRequest` → `CreateStaffUserResponse` | `invite` limit; a repeat for a not-yet-activated account returns a fresh link | unchanged; the link is a set-password link (§6.3.8) |
| `inviteSupplierUser` | `staff` (any store, any role); `owner(storeId)` (role `staff` only) | `InviteSupplierUserRequest` → `InviteSupplierUserResponse` | same | MARKETPLACE §5.4 row |
| `setSupplierUserStatus` | `staff`; `owner` of the user's store, not on themselves | `SetSupplierUserStatusRequest` → `OkResponse` | state check | MARKETPLACE §5.4 row. Suspension revokes every session and closes live sockets (§6.4) |
| `setDriverStatus` | `admin` | `SetDriverStatusRequest` → `OkResponse` | state check | MARKETPLACE §5.4 row. `force` is honoured only when `ALLOW_TEST_JOBS=true` (was "emulator only"). Suspension: §9.2.9 |
| `updateDriverVehicle` | `driver*` | `UpdateDriverVehicleRequest` → `OkResponse` | overwrite | MARKETPLACE §5.4 row: writes `vehicleDraft`, `vehicleReviewRequired` |
| `reviewDriverVehicle` | `admin` | `ReviewDriverVehicleRequest` → `OkResponse` | state check (no draft → `failed-precondition`) | MARKETPLACE §5.4 row. `capacity_class` follows `doc.vehicle` by itself (mirror) |
| `placeOrder` | `customer` | `PlaceOrderRequest` → `PlaceOrderResponse` | `checkoutId` | MARKETPLACE §5.4 row, §5.5.1 → §9.2.1 |
| `cancelOrder` | `customer` + owns the order | `CancelOrderRequest` → `CancelOrderResponse` | state check | MARKETPLACE §5.4 row → §9.2.3 |
| `acceptStoreOrder` | `staff`; `member` of the store order's store | `AcceptStoreOrderRequest` → `StoreOrderActionResponse` | `expectedVersion` | MARKETPLACE §5.4 row, §2.1, §2.1.1 → §9.2.2 |
| `updateStoreOrderStatus` | same | `UpdateStoreOrderStatusRequest` → `StoreOrderActionResponse` | `expectedVersion` | MARKETPLACE §5.4 row → §9.2.2 |
| `rejectStoreOrder` | same | `RejectStoreOrderRequest` → `StoreOrderActionResponse` | `expectedVersion` | MARKETPLACE §5.4 row → §9.2.2 |
| `completePickup` | same; `overrideReason` is accepted from staff only | `CompletePickupRequest` → `CompletePickupResponse` | `expectedVersion`; 5 PIN attempts | MARKETPLACE §5.4 row, §5.5.2 → §9.2.4 |
| `updateStoreProfile` | `staff`; `owner(storeId)` for every field; any `member(storeId)` for `acceptingOrders` alone | `UpdateStoreProfileRequest` → `OkResponse` | overwrite | MARKETPLACE §5.4 row. `photoPath` must be a confirmed `store_photo` upload of that store (§10.1). Product fan-out in the same transaction |
| `createStore` | `admin` | `CreateStoreRequest` → `OkResponse` | natural key (`storeId`); an existing slug → `already-exists` | MARKETPLACE §5.4 row |
| `updateStoreSettings` | `admin` | `UpdateStoreSettingsRequest` → `OkResponse` | overwrite | MARKETPLACE §5.4 row. Product fan-out when name or status change |
| `createDeliveries` | `staff` | `CreateDeliveriesRequest` → `CreateDeliveriesResponse` | not retry-safe (as before); the console disables the button while it runs | unchanged, `kind: 'manual'`, no COD. Geocoding before the transaction |
| `assignDelivery` | `staff` | `AssignDeliveryRequest` (+ `force`) → `OkResponse` | state check (same driver → no-op) | MARKETPLACE §5.4 row → §9.2.7 |
| `updateDeliveryStatus` | `staff`; `driver*` + assigned to the delivery | `UpdateDeliveryStatusRequest` → `UpdateDeliveryStatusResponse` | state check | MARKETPLACE §5.4 row, §2.3, §5.5.4 → §9.2.6 |
| `completeDelivery` | same | `CompleteDeliveryRequest` (no `codCollected`) → `OkResponse` | state check; 5 code attempts | MARKETPLACE §5.4 row → §9.2.6. `photoPath` must be a confirmed `proof` upload of that delivery |
| `checkInAtStore` | `driver*` + assigned | `CheckInAtStoreRequest` → `OkResponse` | state check (`arrivedAt` once) | MARKETPLACE §5.4 row → §9.2.6 |
| `resolveFailedDelivery` | `staff` | `ResolveFailedDeliveryRequest` → `OkResponse` | state check (store order must be `failed`) | MARKETPLACE §5.4 row → §9.2.8 |
| `claimJob` | `driver*` | `ClaimJobRequest` → `ClaimJobResponse` | state check (already mine → same answer) | MARKETPLACE §5.4 row, §5.5.3 → §9.2.5 |
| `boostJobPayout` (P1) | `staff` | `BoostJobPayoutRequest` → `OkResponse` | not retry-safe (additive); the console confirms | MARKETPLACE §5.4 row |
| `optimizeRoute` | `staff` (any driver); `driver*` (own route) | `OptimizeRouteRequest` → `OptimizeRouteResponse` | recompute; drivers at most once per 15 s | unchanged; plans include pickup stops (MARKETPLACE §5.11). Provider calls happen outside any transaction |
| `geocodeAddress` | `public` | `GeocodeAddressRequest` → `GeocodeAddressResponse` | `geocode` limit | MARKETPLACE §5.4 row; §9.6 |
| `submitMaterialList` | `customer` | `SubmitMaterialListRequest` → `SubmitMaterialListResponse` | `requestId`; `material_list` limit | MARKETPLACE §5.4 row, §5.5.6 → §9.2.10 |
| `sendQuote` | `staff` | `SendQuoteRequest` → `OkResponse` | `expectedVersion` | MARKETPLACE §5.5.6 → §9.2.10 |
| `acceptQuote` | `customer` + owns the quote | `AcceptQuoteRequest` → `PlaceOrderResponse` | `checkoutId`, `version` | MARKETPLACE §5.5.6 → §9.2.10 |
| `closeQuote` | the customer who owns it (→ `declined`); `staff` (→ `cancelled`) | `CloseQuoteRequest` → `OkResponse` | state check | MARKETPLACE §5.4 row |
| `reopenQuote` | `customer` + owns the quote | `ReopenQuoteRequest` → `OkResponse` | state check | MARKETPLACE §5.4 row; posts the message into the support thread |
| `reportIssue` | `customer` + owns the store order | `ReportIssueRequest` → `ReportIssueResponse` | `issueId`; `issue_report` limit | MARKETPLACE §5.5.7 → §9.2.11 |
| `resolveIssue` | `staff` (a dispatcher refunds at most `DISPATCHER_REFUND_LIMIT_CENTS` per action) | `ResolveIssueRequest` → `ResolveIssueResponse` | state check (already resolved → `failed-precondition`) | MARKETPLACE §5.5.7 → §9.2.11 |
| `suggestStore` | `public` | `SuggestStoreRequest` → `OkResponse` | `suggest` limit | MARKETPLACE §5.4 row; `source` is `app` when the `X-Client` name is `customer` or `driver`, else `web` |
| `sendTestNotification` | `auth` | `{}` → `SendTestNotificationResponse` | — | unchanged |
| `runJobNow` | `admin`, and only when `ALLOW_TEST_JOBS=true` (else `permission-denied`) | `RunJobNowRequest` → `RunJobNowResponse` | — | MARKETPLACE §5.4 row → §9.5 |

### 5.3 REST endpoints

Columns: method and path · policy · request (query `?` or body) · response · rules. Paths and
parameter names are the ones `docs/CLIENTS.md` §4 calls (resource names are the old collection names
in kebab-case; the caller's own data is under `/me/…`). List parameters with several values are
comma-separated (`status=new,accepted`). Time filters end in `Since` and take epoch milliseconds.
`sort` is `<field>:asc` or `<field>:desc`, from the values listed per endpoint; the first one listed
is the default. Every list answers `Page<T>` (§4.4).

**Scoping rule for lists.** Staff may filter freely. Any other caller only ever gets their own rows:
the scoping parameter (`customerId`, `driverId`, `storeId`, `payeeId`) may be sent and must then be
the caller's own id or store, else `permission-denied`; when it is left out the server applies it.
A filter marked "staff" is an `invalid-argument` from anyone else.

#### 5.3.1 Platform

| Endpoint | Policy | Request | Response | Rules |
| --- | --- | --- | --- | --- |
| `GET /health` | `public` | — | `HealthResponse` | 200 `{ "status": "ok", … }` when `SELECT 1` answers within 2 s; else 503 `unavailable`. Not rate limited. |
| `GET /config` | `public` | — | `PublicConfig` | §11.2. No secret ever appears here. |
| `GET /live` | `public` | WebSocket upgrade | — | §8 |

#### 5.3.2 Auth and accounts (`modules/auth`)

| Endpoint | Policy | Request | Response | Rules |
| --- | --- | --- | --- | --- |
| `POST /auth/register` | `public` | `RegisterRequest` | `AuthSessionResponse` | §6.3.1. `app` must be `customer` or `driver`. The account has no role yet. |
| `POST /auth/login` | `public` | `LoginRequest` | `AuthSessionResponse` | §6.3.4 |
| `POST /auth/refresh` | `public` (the refresh token is the credential) | `{ refreshToken }` | `AuthSessionResponse` (always with `me`) | §6.3.5 |
| `POST /auth/logout` | `public` | `{ refreshToken }` | 204 | §6.3.6. Needs no access token. Always 204. |
| `POST /auth/logout-all` | `auth` | — | 204 | revokes every session of the caller, the current one included |
| `GET /auth/sessions` | `auth` | — | `Page<SessionInfo>` | active sessions of the caller |
| `DELETE /auth/sessions/{sessionId}` | `auth` + own session | — | 204 | revoke one device |
| `GET /users/{uid}/sessions` | `admin` | — | `Page<SessionInfo>` | the active sessions of any account (`current` is always false) |
| `POST /users/{uid}/sessions/revoke-all` | `admin` | — | 204 | revokes every session of that account with reason `admin`, with the clean-up of §6.3.6 and `drop_user`; the account stays usable (the user signs in again). Not on oneself (use `logout-all`) |
| `PATCH /users/{uid}/status` | `admin`; not on oneself | `UserStatusPatch` | `UserProfile` | for accounts whose role is `admin`, `dispatcher` or `customer` (drivers and supplier users keep `setDriverStatus` and `setSupplierUserStatus`; any other role → `failed-precondition`). `suspended` does what §6.4 "What suspension does" says; suspending the last active admin → `failed-precondition` "At least one administrator must stay active." `active` only sets the status back. Idempotent (state check). Notifies the other admins (`system`, key `status-{uid}-{now}`) |
| `POST /auth/password/forgot` | `public` | `{ email }` | 204 | always 204, whether or not the account exists (§6.3.7) |
| `POST /auth/password/reset` | `public` | `{ email, code, newPassword }` | 204 | §6.3.7 |
| `POST /auth/password/change` | `auth` | `{ currentPassword, newPassword }` | 204 | §6.3.7 |
| `POST /auth/invites/inspect` | `public` | `{ token }` | `InviteInfo` | `not-found` for an unknown, used or expired token. A POST, so the secret never appears in a URL. Limit `reset_ip`. |
| `POST /auth/password/setup` | `public` | `SetupPasswordRequest` | `AuthSessionResponse` | §6.3.8: sets the password of an invited account and signs it in |
| `GET /me` | `auth` | — | `MeResponse` | the session core of every client |
| `PATCH /me` | `auth` with a role | `ProfilePatch` | `MeResponse` | `displayName` 1–80; `preferences` is merged into the stored object and may only contain the six boolean keys of `UserPreferences`; `companyName` (null or 1–80) and `accountType` only for customers; `photoPath` must be a confirmed `avatar` upload of the caller (the server derives `photoURL`). Nothing else is client-writable. |
| `GET /users` | `staff`; `owner(S)` with `role=supplier&storeId=S` | `?role=&status=&cityId=&storeId=&sort=createdAt:desc&limit=&cursor=` | `Page<UserProfile>` | drivers list, staff list, and a store's team (the old rule: an owner lists the supplier users of their store, index 37). An owner asking for anything else → `permission-denied`. |
| `GET /users/{uid}` | `staff`; `self` | — | `UserProfile` | |
| `PATCH /users/{uid}/payout-account` | `admin` | `PayoutAccountPatch` | `UserProfile` | the user must be a driver. Fills a gap of MARKETPLACE §3.9: "a driver `payoutAccount` on the profile … set by ops" had no entry point. |

#### 5.3.3 The caller's own data (`modules/account`, `modules/notifications`, `modules/tracking`)

These replace the client writes that security rules validated (MARKETPLACE §6.3).

| Endpoint | Policy | Request | Response | Rules |
| --- | --- | --- | --- | --- |
| `GET /me/jobsites` | `customer` | — | `Page<Jobsite>` | the default first, then most recently used |
| `PUT /me/jobsites/{jobsiteId}` | `customer` | `JobsiteInput` | `Jobsite` | create or replace; `jobsiteId` is a client UUIDv4 (a body `id`, when sent, must equal it); an id of another user → `already-exists`. `validateJobsite` (shared): label 1–40, line1 3–160, line2 null or 1–60, city 1–60, province `ON`, postal code null or Ontario format, pin inside `SERVICE_AREA`, `cityId` one of the 15, area label 1–80, contact name 1–80, contact phone NANP, instructions null or 1–500, receiving, max vehicle class null or a class. At most 50 jobsites. `isDefault: true` clears the flag on the others in the same transaction, in the order of statement (n) of §3.5 (owner row lock, clear the old default, then upsert); the first jobsite is always the default. `lastUsedAt` and `createdAt` are not in the input and are kept by the server. |
| `DELETE /me/jobsites/{jobsiteId}` | `customer` + own | — | 204 | when the default is deleted, the most recently used remaining jobsite becomes the default |
| `GET /me/cards` | `customer` | — | `Page<SavedCard>` | |
| `PUT /me/cards/{cardId}` | `customer` | `CardInput` | `SavedCard` | only when `PAYMENTS_MODE=test` (in `disabled` → `PAYMENTS_DISABLED`). Brand in the five brands, `last4` 4 digits, month 1–12, year 2024–2100, holder 1–80. The strict schema has no field for a number or a CVV. At most 10 cards. Default handling as for jobsites. |
| `DELETE /me/cards/{cardId}` | `customer` + own | — | 204 | |
| `GET /me/favorites` | `customer` | — | `Page<WithId<Favorite>>` | newest first; `id` is the product id |
| `PUT /me/favorites/{productId}` · `DELETE …` | `customer` | — | 204 | idempotent; at most 500 |
| `GET /me/buy-again` | `customer` | — | `Page<Product>` | at most 12: the listed products of the caller's last 10 orders, most ordered first (the Home rail of MARKETPLACE §7.3) |
| `PUT /me/devices/{installationId}` | `auth` | `DeviceInput` | 204 | upsert; `provider` must be `expo`. `devices.app` is copied from the caller's session row (`sessions.app`); the body has no `app` field (an unknown key is `invalid-argument`). `installationId` must equal the session's `installation_id`, else `permission-denied`. The same statement deletes every other row with that `token` (a push token belongs to the account that registered it last: the old `onDeviceWritten`). |
| `DELETE /me/devices/{installationId}` | `auth` | — | 204 | logout does it too |
| `POST /me/location` | `driver*` | `LocationReport` | `LocationAck` | 1 to 20 fixes, oldest first (none allowed only with `online: false`); lat −90…90, lng −180…180. The newest fix becomes the driver's `DriverLocation`; `updatedAt` is the server clock. More than one report per 2 s → `RATE_LIMITED` with `details.retryAfterMs`, except a report whose `online` differs from the stored value, which is always accepted (going offline must never be refused). A caller who is not an active driver → `permission-denied`. Effects in §9.4 (was `onDriverLocationWritten`). |
| `GET /me/cart` · `PUT /me/cart` · `DELETE /me/cart` (P1) | `customer` | `CartInput` | `Cart` / 204 | lines ≤ 100, `unloadHelpStoreIds` ≤ 5, promo code null or 2–20, fulfilment in the two values |
| `GET /notifications` | `auth` | `?unread=true&limit=&cursor=` | `Page<AppNotification>` | the caller's inbox, newest first |
| `GET /notifications/unread-count` | `auth` | — | `{ count: number }` | |
| `POST /notifications/{id}/read` | `auth` + recipient | — | 204 | sets `read`, `readAt`; nothing else can change |
| `POST /notifications/read-all` | `auth` | — | 204 | |
| `DELETE /notifications/{id}` | `auth` + recipient | — | 204 | |

#### 5.3.4 Catalogue and stores (`modules/stores`)

| Endpoint | Policy | Request | Response | Rules |
| --- | --- | --- | --- | --- |
| `GET /categories` | `public` | — | `Page<Category>` | by `sortOrder` |
| `PUT /categories/{id}` · `PATCH /categories/{id}` | `staff` | `CategoryInput` · `Partial<CategoryInput>` | `Category` | `id` must be a `CategoryId`. A change of name or synonyms recomputes `search_terms` of that category's products in the same transaction. |
| `POST /categories/reorder` | `staff` | `{ ids: CategoryId[] }` | 204 | rewrites `sortOrder` 1…n in one transaction |
| `DELETE /categories/{id}` | `admin` | — | 204 | `failed-precondition` while a product uses it |
| `GET /stores` | `public` | `?marketId=gta&status=&limit=` (limit ≤ 500) | `Page<Store>` | every store of the market; the apps hide `closed` |
| `GET /stores/{storeId}` | `public` | — | `Store` | |
| `GET /stores/{storeId}/settings` | `staff`; `owner(storeId)` | — | `StorePrivateSettings` | the old `stores/{id}/private/settings` |
| `GET /stores/{storeId}/reviews` | `public` | `?sort=updatedAt:desc&limit=&cursor=` | `Page<WithId<StoreReview>>` | `id` is the store order id |
| `GET /stores/{storeId}/reviews/{storeOrderId}` | `public` | — | `WithId<StoreReview>` | `not-found` when that store order has no review |
| `PUT /stores/{storeId}/reviews/{storeOrderId}` | `customer` + the store order is theirs, belongs to `storeId`, and is `delivered` or `picked_up` | `ReviewInput` | `WithId<StoreReview>` | rating integer 1–5, text 0–1000. `authorName` is derived by the server ("Dana W."), `customerId` is the caller. Same transaction: `stores.rating_sum/rating_count` recomputed from `store_reviews`, store order `rated = true` (the old `onStoreReviewWritten`). |
| `DELETE /stores/{storeId}/reviews/{storeOrderId}` | the author; `staff` | — | 204 | rating recomputed |
| `GET /products` | `public` with `listed=true`; without it `staff`, or `member(storeId)` with `storeId` given | `?listed=true&ids=&q=&categoryId=&storeId=&familyKey=&featured=true&inStock=true&active=&lowStock=true&estimated=true&sort=name:asc\|priceCents:asc&limit=&cursor=` | `Page<Product>` | `listed=true` returns `listed` products only (index 1 to 5, 7). `ids` (≤ 100) returns those products whatever their `listed` flag and needs no other filter, so a cart can show a line that left the catalogue; unknown ids are left out. `q` → `searchKeyFor(q)` over name, brand, SKU, size, category names and synonyms; a null key returns an empty page. `sort=priceCents:asc` needs `familyKey`. Without `listed=true` (portal and ops catalogue, index 6) inactive and unlisted rows are included and `active`, `lowStock` (available < `LOW_STOCK_THRESHOLD`), `estimated` may be used. |
| `GET /products/{productId}` | `public` | — | `Product` | any product, listed or not (as the rules allowed) |
| `PUT /products/{productId}` | `staff`; `member` of the store in the id | `ProductInput` | `Product` | create. `productId` must equal `{storeId}--{skuSlug(sku)}`; an existing id → `already-exists`. `validateProduct` (shared, the old `isValidProduct`). A supplier may not set `featured`, `badge` or `familyKey` (must be false / null / null). `imagePath` must be a confirmed `product_photo` upload under `productPhotos/{storeId}/`. Server-set: `reserved = 0`, `searchTerms`, `storeName`, `storeStatus`, `updatedBy`. |
| `PATCH /products/{productId}` | `staff`; `member` of the product's store | `ProductPatch` | `Product` | same validation on the merged product. `sku` and the store cannot change. A supplier that sends `featured`, `badge` or `familyKey` different from the stored value → `permission-denied`. |
| `POST /products/{productId}/stock-adjust` | same | `{ delta: number }` | `Product` | adds `delta` (an integer, −1 000 000…1 000 000, not 0) to `stock_on_hand` in one statement; the result is clamped to 0…1 000 000. Not retry-safe. |
| `DELETE /products/{productId}` | `admin`; `owner` of the product's store | — | 204 | only when `reserved = 0`, else `failed-precondition` |

#### 5.3.5 Orders, store orders, deliveries, jobs (`modules/commerce`, `stores`, `deliveries`, `jobs`, `routing`, `tracking`)

| Endpoint | Policy | Request | Response | Rules |
| --- | --- | --- | --- | --- |
| `GET /orders` | `customer` (own); `staff` | `?customerId=&status=&jobsiteId=&storeId=&needsAttention=true&paymentStatus=&createdSince=&createdUntil=&sort=createdAt:desc&limit=&cursor=` | `Page<Order>` | scoping parameter `customerId`. `storeId`, `needsAttention`, `paymentStatus` are staff filters. `jobsiteId` matches `jobsite.jobsiteId` (the jobsite chip of the Orders tab). |
| `GET /orders/{orderId}` | the customer who owns it; `staff` | — | `Order` | |
| `GET /store-orders` | `customer` with `orderId` of an own order; `member(S)`; `staff` | `?orderId=&storeId=&customerId=&status=&acceptOverdue=true&readyByDate=&readyByDateAfter=&completedSince=&createdSince=&sort=createdAt:desc\|readyBy:asc\|completedAt:desc&limit=&cursor=` | `Page<StoreOrder>` | scoping parameter `storeId` for suppliers; a customer must send `orderId` (the store orders of one of their orders, by letter). `readyBy:asc` is the board (index 8), `completedAt:desc` with `completedSince` is "Done today" and insights (index 10); both need `storeId`. |
| `GET /store-orders/{storeOrderId}` | the customer who owns it; `member` of its store; `staff` | — | `StoreOrder` | never contains the PIN |
| `GET /store-orders/{storeOrderId}/private` | `staff` | — | `StoreOrderPrivateMeta` | the old `private/meta` |
| `GET /store-orders/{storeOrderId}/proof` | the customer who owns it; `staff` | — | `StoreOrderProof` | the customer's view of the drop-off photo: a short-lived `photoUrl` (null when there is none), the recipient name and the delivery time. The old Storage rule that let the customer read `proofs/`. |
| `GET /deliveries` | `staff`; `driver` (own) | `?driverId=&status=&kind=&storeId=&unloadStatus=&offerStatus=&createdSince=&updatedSince=&deliveredSince=&sort=createdAt:desc\|updatedAt:desc&limit=&cursor=` | `Page<Delivery>` | scoping parameter `driverId`. `kind`, `storeId`, `unloadStatus`, `offerStatus` are staff filters. |
| `GET /deliveries/stats` | `staff`; `driver` (own) | `?driverId=&since=` | `DeliveryStats` | counts of the driver's deliveries that became `delivered` or `failed` since `since` |
| `GET /deliveries/{deliveryId}` | `staff`; the assigned driver | — | `Delivery` | a driver who released or lost the job gets `permission-denied` |
| `GET /deliveries/{deliveryId}/events` | same | `?limit=&cursor=` | `Page<DeliveryEvent>` | newest first |
| `GET /deliveries/{deliveryId}/private` | `staff` | — | `DeliveryPrivateMeta` | tracking token and hand-off code; never for drivers |
| `PATCH /deliveries/{deliveryId}` | `staff` | `DeliveryPatch` | `Delivery` | exactly the staff-editable keys of MARKETPLACE §6.3; address 3–300, priority in the three values, valid pin, `unload` only `status`, `labourerName`, `labourerPhone`. Writes an `edited` event and runs the delivery effects (§9.4). |
| `GET /activity` | `staff` | `?limit=&cursor=` | `Page<DeliveryEvent>` | events across all deliveries, newest first (the old collection-group feed) |
| `GET /job-offers` | `driver*`: open offers whose `audience` contains the caller's `"{cityId}:{capacityClass}"`; `staff`: every offer | `?status=open\|scheduled,open&sort=openedAt:desc\|opensAt:asc&limit=` (limit ≤ 500) | `Page<WithId<JobOffer>>` | `id` is the delivery id. The audience key is built from the caller's row, never from the request (§7.4); a driver always gets `open` offers only. |
| `GET /job-offers/{deliveryId}` | `staff`; `driver*` + open + in the audience | — | `WithId<JobOffer>` | `not-found` once the offer is claimed or withdrawn |
| `GET /routes/{driverId}` | `staff`; `self` | — | `RoutePlan` | `not-found` while the driver has no plan |
| `GET /driver-locations` | `staff` | `?limit=` (limit ≤ 500) | `Page<WithId<DriverLocation>>` | live map; `id` is the driver's uid |
| `GET /driver-locations/{driverId}` | `staff`; `self` | — | `WithId<DriverLocation>` | `not-found` before the first fix |
| `GET /tracking/{token}` | `public` | — | `PublicTracking` | token `^[A-Za-z0-9]{12,64}$`; unknown → `not-found`. There is no list endpoint. |

#### 5.3.6 Chat and support (`modules/chat`, `modules/support`)

Message lists answer the newest `limit` messages **oldest first**; `nextCursor` pages into the past.

| Endpoint | Policy | Request | Response | Rules |
| --- | --- | --- | --- | --- |
| `GET /threads` | `staff` | `?sort=updatedAt:desc&limit=&cursor=` | `Page<WithId<ChatThread>>` | dispatch ↔ driver threads; `id` is the driver's uid |
| `GET /threads/{driverId}` | `staff`; `self` | — | `WithId<ChatThread>` | `not-found` until the first message |
| `GET /threads/{driverId}/messages` | `staff`; `self` | `?limit=&cursor=` (default 100) | `Page<ChatMessage>` | |
| `POST /threads/{driverId}/messages` | `staff`; `driver*` + `self` | `ChatMessageInput` | `ChatMessage` | `id` is a client UUIDv4: the same `id` again returns the stored message. Text 1–1000, kind `text` or `quick_reply`. `senderId`, `senderName`, `senderRole`, `createdAt` are set by the server. Same transaction: thread summary, unread counter of the other side, notifications (the old `onChatMessageCreated`). |
| `POST /threads/{driverId}/read` | `staff`; `self` | — | 204 | resets the caller's side only: staff → `unread_by_staff = 0`, `staff_read_at`; driver → `unread_by_driver = 0`, `driver_read_at` |
| `GET /support-threads` | `staff` | `?kind=customer\|store&status=open\|resolved&unread=true&sort=updatedAt:desc&limit=&cursor=` | `Page<WithId<SupportThread>>` | indexes 29, 30 |
| `GET /support-threads/{threadId}` | `staff`; the owner | — | `WithId<SupportThread>` | `threadId` is a customer uid or `store_{storeId}`. The owner check: `customer` and `threadId = uid`, or `supplier` and `threadId = 'store_' + own storeId`. `not-found` until the first message. |
| `GET /support-threads/{threadId}/messages` | same | `?limit=&cursor=` (default 100) | `Page<SupportMessage>` | |
| `POST /support-threads/{threadId}/messages` | same | `SupportMessageInput` | `SupportMessage` | client UUIDv4 `id`, idempotent. Text 1–1000; context null or `{ kind, id, label }` with id and label 1–80. `senderRole` is derived from the caller (`customer`, `supplier`, `staff`): it cannot be spoofed because it is not in the input. Same transaction: thread created on its first message, summary, unread counters, notifications (the old `onSupportMessageCreated`). |
| `POST /support-threads/{threadId}/read` | same | — | 204 | owner → `unread_by_owner = 0`, `owner_read_at`; staff → `unread_by_staff = 0`, `staff_read_at` |
| `PATCH /support-threads/{threadId}` | `staff` | `SupportThreadPatch` | `WithId<SupportThread>` | status `open` or `resolved`; `assignedTo` must be an active staff uid or null; `assignedName` is filled by the server |

#### 5.3.7 Quotes and issues (`modules/quotes`, `modules/issues`)

| Endpoint | Policy | Request | Response | Rules |
| --- | --- | --- | --- | --- |
| `GET /quotes` | `customer` (own); `staff` | `?customerId=&status=&assignedTo=&sort=createdAt:desc\|respondBy:asc&limit=&cursor=` | `Page<Quote>` | scoping parameter `customerId`; `respondBy:asc` is the ops inbox (index 23) |
| `GET /quotes/{quoteId}` | the customer who owns it; `staff` | — | `Quote` | |
| `PATCH /quotes/{quoteId}` | `staff` | `AssignPatch` | `Quote` | only `assignedTo` (active staff uid or null; name filled by the server) and `status: 'in_review'`, the latter only from `submitted` (MARKETPLACE §2.5) |
| `GET /quotes/{quoteId}/workspace` · `PUT …` | `staff` | the draft: any JSON object ≤ 200 KiB | the same object | the old `private/workspace` (builder draft and internal note); opaque to the server; `not-found` until the first save |
| `GET /issues` | `customer` (own); `member(S)` (own store); `staff` | `?customerId=&storeId=&orderId=&storeOrderId=&status=&sort=createdAt:desc&limit=&cursor=` | `Page<Issue>` | scoping parameter `customerId` for customers, `storeId` for suppliers |
| `GET /issues/{issueId}` | the customer who owns it; `member` of its store; `staff` | — | `Issue` | |
| `PATCH /issues/{issueId}` | `staff` | `AssignPatch` | `Issue` | only `assignedTo` and `status: 'in_review'` from `open` (MARKETPLACE §2.6) |
| `GET /issues/{issueId}/notes` · `PUT …` | `staff` | `{ notes: string }` (≤ 5 000) | `IssueNotes` | the old `private/notes`; `not-found` until the first save |

#### 5.3.8 Payouts and suggestions (`modules/payouts`, `modules/suggestions`)

| Endpoint | Policy | Request | Response | Rules |
| --- | --- | --- | --- | --- |
| `GET /ledger-entries` | `staff`; `owner(S)` for the store S; `driver` for themselves | `?payeeType=&payeeId=&unpaid=true&held=true&payoutId=&sort=createdAt:desc&limit=&cursor=` | `Page<WithId<LedgerEntry>>` | scoping parameters `payeeType` + `payeeId`. Store staff (not owner) → `permission-denied`. |
| `GET /ledger/balance` | same | `?payeeType=&payeeId=` | `LedgerBalance` | sums of unpaid and held entries |
| `GET /payouts` | same; `staff` may omit the payee | `?payeeType=&payeeId=&status=&runKey=&sort=createdAt:desc&limit=&cursor=` | `Page<WithId<Payout>>` | |
| `GET /payouts/{payoutId}` | same, on the payout's payee | — | `WithId<Payout>` | |
| `GET /store-suggestions` | `staff` | `?status=&sort=createdAt:desc&limit=&cursor=` | `Page<WithId<StoreSuggestion>>` | |
| `PATCH /store-suggestions/{id}` | `staff` | `{ status }` | `WithId<StoreSuggestion>` | only `status`, one of the four values |

#### 5.3.9 Files (`platform/storage`)

| Endpoint | Policy | Request | Response | Rules |
| --- | --- | --- | --- | --- |
| `POST /files/presign` | `auth` + the purpose's upload rule | `PresignRequest` | `PresignedUpload` | §10.1. Creates a `pending` file row and a presigned form. |
| `POST /files/local/{uploadId}` | the upload's own token (form field `token`) | multipart form: the `fields`, then `file` | 204 | exists only with `STORAGE_DRIVER=local` |
| `POST /files/confirm` | `auth` + owner of the upload | `{ uploadId }` | `UploadedFile` | verifies the stored object (exists, size, type, magic number), marks the row `ready`. Idempotent. |
| `GET /files/url` | `auth` + the purpose's read rule | `?path=` | `FileUrlResponse` | a short-lived download URL for a private file |
| `GET /files/local/{uploadId}` | signature in the query (`exp`, `sig`) | — | the bytes | only with `STORAGE_DRIVER=local`; the target of `FileUrlResponse.url` |
| `GET /media/*` | `public` | — | 302 to a signed URL (`s3`) or the bytes (`local`) | only for confirmed files of a public purpose (`store_photo`, `product_photo`, `avatar`); anything else → `not-found` |

#### 5.3.10 Ops (`modules/ops`)

| Endpoint | Policy | Request | Response | Rules |
| --- | --- | --- | --- | --- |
| `GET /ops/dashboard` | `staff` | — | `OpsDashboard` | counters computed by the server in one request (the console used to hold a dozen listeners); also feeds the sidebar badges |
| `GET /ops/stores` | `staff` | — | `Page<OpsStoreRow>` | every store with live products, orders in 7 days, median time to accept, open now |
| `GET /ops/jobs` | `staff` | — | `Page<JobState>` | scheduler state; the payouts page reads the last `runDailyPayouts` result here (payees skipped for a missing payout account) |
| `GET /dev-outbox` | `staff` | `?channel=sms\|email&limit=&cursor=` | `Page<OutboxMessage>` | the dev SMS and email outbox, newest first. Rows with `sensitive = true` (codes, links) are returned to admins only. |
| `GET /ops/outbox-events` | `admin` | `?status=pending\|processing\|dead&limit=&cursor=` | `Page<OutboxEvent>` | the transactional outbox, for diagnosis |
| `POST /ops/outbox-events/{id}/retry` | `admin` | — | 204 | puts a `dead` event back to `pending` with `attempts = 0`, through statement (m) of §3.5 (a newer pending row with the same key finishes it as `done` instead) |

### 5.4 Types of the REST contract

These shapes are the wire contract of §5.3. Their names and fields are the ones `docs/CLIENTS.md`
declares in `packages/api-client` (§1.5, §1.7, §1.8, §4.1, §5.2, §8.1 there). The backend declares
the same shapes in `backend/src/platform/http/contract.ts` (the backend may import only
`packages/shared`). When `packages/shared` gains them, both sides import from there instead. Every
`number` that ends in `At`, `Since`, `Until` or is called `serverTime` is epoch milliseconds.

```ts
// ---------- lists and ids ----------
export interface Page<T> { items: T[]; nextCursor: string | null }
/**
 * Every document the API returns carries `id`, also where the shared type has none: the old document id.
 * JobOffer → deliveryId · ChatThread, DriverLocation → the driver's uid · StoreReview → storeOrderId ·
 * Favorite → productId · SupportThread, LedgerEntry, Payout, StoreSuggestion → their id.
 * UserProfile keeps `uid`; PublicTracking, RoutePlan and Cart are fetched by key and carry no extra id.
 */
export type WithId<T> = T & { id: string };

// ---------- platform ----------
export interface HealthResponse { status: 'ok'; version: string; serverTime: number }
export interface PublicConfig {
  environment: 'development' | 'production';
  paymentsMode: 'test' | 'stripe' | 'disabled';
  /** required: checkout needs a verified phone. optional: offered, never blocking. off: hidden. */
  phoneVerification: 'required' | 'optional' | 'off';
  supportPhone: string | null;      // E.164
  supportEmail: string | null;
  hstNumber: string | null;
  map: { tileUrl: string; attribution: string; maxZoom: number };
  /** The public tracking link is `${trackingBaseUrl}/${token}`. */
  trackingBaseUrl: string;
  smsDriver: 'outbox' | 'twilio';
  emailDriver: 'outbox' | 'resend' | 'smtp';
  /** Shows "Run payouts now" and allows `runJobNow`. */
  allowTestJobs: boolean;
  serverTime: number;
}

// ---------- auth ----------
export type ClientApp = 'customer' | 'driver' | 'console';
export interface RegisterRequest { email: string; password: string; displayName: string; installationId: string; app: ClientApp }
export interface LoginRequest { email: string; password: string; installationId: string; app: ClientApp }
export interface SetupPasswordRequest { token: string; password: string; installationId: string; app: ClientApp }
export interface AuthTokens {
  accessToken: string;
  /** Lifetime in seconds (900). Clients keep their own deadline on their own clock. */
  accessTokenTtlSeconds: number;
  refreshToken: string;
  refreshTokenExpiresAt: number;
  sessionId: string;
}
export interface MeResponse {
  account: { uid: string; email: string; createdAt: number };
  /** Null until `registerCustomer` or `registerDriver` gave the account a role. */
  profile: UserProfile | null;
  /** Suppliers only: the public document of their store. */
  store: Store | null;
  serverTime: number;
}
/** The server always includes `me`. */
export interface AuthSessionResponse extends AuthTokens { me?: MeResponse }
export interface InviteInfo { email: string; displayName: string; role: Role; expiresAt: number }
export interface SessionInfo { id: string; app: ClientApp; platform: DevicePlatform | null; deviceName: string | null;
  createdAt: number; lastUsedAt: number; current: boolean }
export interface UserStatusPatch { status: 'active' | 'suspended'; reason: string | null /* 1–200, required for suspended */ }
export interface PayoutAccountPatch { payoutAccount: { provider: 'test' | 'stripe'; accountRef: string; label: string } | null }
/** `details.reason` of an auth failure (§6.4). */
export type AuthFailureReason = 'token_expired' | 'token_invalid' | 'session_revoked' | 'refresh_reused'
  | 'account_suspended' | 'credentials';

// ---------- the caller's own data ----------
export interface ProfilePatch {
  displayName?: string;
  /** A confirmed `avatar` upload of the caller, or null to remove the photo. The server derives `photoURL`. */
  photoPath?: string | null;
  /** Merged into the stored preferences. */
  preferences?: Partial<UserPreferences>;
  /** Customers only. */
  companyName?: string | null;
  accountType?: AccountType | null;
}
export type JobsiteInput = JobsiteFields & { id?: string; isDefault: boolean };
export interface CardInput { id?: string; brand: CardBrand; last4: string; expMonth: number; expYear: number; holder: string;
  isDefault: boolean }
export interface Favorite { productId: string; createdAt: number }
export interface DeviceInput { token: string; provider: 'expo'; platform: DevicePlatform; appVersion: string | null;
  deviceName: string | null }
export type CartInput = Omit<Cart, 'updatedAt'>;

// ---------- driver location (CLIENTS.md §5.2) ----------
export interface Fix { lat: number; lng: number; heading: number | null; speed: number | null; accuracy: number | null;
  /** When the device took the fix. */ at: number }
export type TrackingMode = 'normal' | 'live';
export interface LocationReport { online: boolean; mode: TrackingMode; battery: number | null; fixes: Fix[] }
export interface LocationAck { /** False when the server does not treat this driver as online. */ online: boolean; serverTime: number }

// ---------- catalogue ----------
export interface ProductInput {
  sku: string; name: string; brand: string | null; categoryId: CategoryId; unit: SellUnit; size: string | null;
  description: string; priceCents: number; compareAtCents: number | null; stockOnHand: number;
  maxPerOrder: number | null; weightKg: number; dimsCm: DimsCm; shipEstimated: boolean; active: boolean;
  imageKey: string | null; imagePath: string | null;
  /** Staff only (MARKETPLACE §6.3). */
  featured?: boolean; badge?: ProductBadge | null; familyKey?: string | null;
}
export type ProductPatch = Partial<Omit<ProductInput, 'sku'>>;
export type CategoryInput = Omit<Category, 'id'>;
export interface ReviewInput { rating: number; text: string }

// ---------- orders and deliveries ----------
export interface StoreOrderProof { photoUrl: string | null; expiresAt: number; recipientName: string | null;
  deliveredAt: number | null }
export interface DeliveryStats { delivered: number; failed: number }
export interface DeliveryPatch {
  customer?: CustomerContact; address?: string; location?: LatLng; addressNotes?: string | null; notes?: string | null;
  packageCount?: number; priority?: Priority; requireCode?: boolean; windowStart?: number | null; windowEnd?: number | null;
  unload?: { status: 'not_needed' | 'needed' | 'booked'; labourerName: string | null; labourerPhone: string | null };
}
export interface ClaimJobResponse { deliveryId: string; status: 'accepted' }
export interface RunJobNowResponse { job: ScheduledJobName; now: number; result: Record<string, number> }

// ---------- chat and support ----------
export interface ChatMessageInput { id: string; text: string; deliveryId: string | null; kind: 'text' | 'quick_reply' }
export interface SupportMessageInput { id: string; text: string; context: SupportContext | null }
export interface SupportThreadPatch { status?: 'open' | 'resolved'; assignedTo?: string | null }

// ---------- quotes and issues ----------
export interface AssignPatch { assignedTo?: string | null; status?: 'in_review' }
export interface IssueNotes { notes: string; updatedAt: number; updatedBy: string }

// ---------- money ----------
export interface LedgerBalance { payeeType: 'store' | 'driver'; payeeId: string; unpaidCents: number; unpaidCount: number;
  heldCents: number; heldCount: number; lastPaidAt: number | null }

// ---------- files (CLIENTS.md §1.8) ----------
export type UploadPurpose = 'proof' | 'quote_upload' | 'issue_photo' | 'store_photo' | 'product_photo' | 'avatar';
/** ownerId: proof → deliveryId · quote_upload → requestId · issue_photo → issueId ·
 *  store_photo, product_photo → storeId · avatar → the caller's uid. */
export interface PresignRequest { purpose: UploadPurpose; ownerId: string; fileName: string; contentType: string; sizeBytes: number }
export interface PresignedUpload {
  uploadId: string;
  /** The storage path to hand to a command afterwards. */
  path: string;
  /** The server always answers 'POST': a multipart form with `fields`, then the file as the last part, named `file`. */
  method: 'POST' | 'PUT';
  url: string;
  fields: Record<string, string>;
  headers: Record<string, string>;      // empty for 'POST'
  expiresAt: number;
}
export interface UploadedFile { path: string; name: string; contentType: string; sizeBytes: number }
export interface FileUrlResponse { url: string; expiresAt: number }

// ---------- ops ----------
export interface OpsDashboard {
  today: { orders: number; gmvCents: number };                 // Toronto date of generatedAt; sum of current totals
  storeOrdersByStatus: Partial<Record<StoreOrderStatus, number>>;   // store orders that are not final
  acceptOverdue: number;
  jobOffers: { scheduled: number; open: number; unclaimedOver15Min: number };
  activeDeliveries: number;
  failedDeliveries: number;                                    // store orders in `failed`
  liveStores: number;
  quotes: { waiting: number; nearRespondBy: number };          // submitted or in_review; respondBy within 10 min or past
  issues: { open: number; pastSla: number };                   // open or in_review; slaDueAt passed
  unreadSupport: number;                                       // support threads with unread_by_staff > 0
  captureFailures: number;
  pendingDrivers: number;
  unreadDriverChat: number;                                    // chat threads with unread_by_staff > 0
  generatedAt: number;
}
export interface OpsStoreRow { store: Store; liveProducts: number; ordersLast7Days: number;
  medianAcceptSeconds: number | null; openNow: boolean }
export interface JobState { job: string; schedule: string; nextRunAt: number; lastStartedAt: number | null;
  lastFinishedAt: number | null; lastStatus: 'ok' | 'error' | null; lastError: string | null;
  lastResult: Record<string, unknown> | null }
/** A superset of the shared `DevOutboxMessage` (which knows SMS only). */
export interface OutboxMessage { id: string; channel: 'sms' | 'email'; to: string; subject: string | null;
  /** Null when redacted: a sensitive message that a real provider delivered. */
  body: string | null;
  purpose: 'otp' | 'tracking_link' | 'store_alert' | 'other' | 'password_reset' | 'invite';
  provider: 'outbox' | 'twilio' | 'resend' | 'smtp'; status: 'stored' | 'sent' | 'failed'; createdAt: number }
export interface OutboxEvent { id: number; event: string; status: 'pending' | 'processing' | 'done' | 'dead';
  attempts: number; maxAttempts: number; runAt: number; lastError: string | null; createdAt: number;
  finishedAt: number | null; payload: unknown | null }
```

### 5.5 Coverage: every screen of MARKETPLACE §7 to §10

One row per row of the screen tables. "Live" lists the topics (§8.2) whose events make the screen
refetch. Commands are named without `POST /call/`. `docs/CLIENTS.md` §4 binds each screen to its
query descriptors; this table is the server-side check that nothing a screen needs is missing.

**Customer app (MARKETPLACE §7.3)**

| Screen | Reads and writes | Live |
| --- | --- | --- |
| `(intro)/intro` | — | — |
| `(auth)/welcome, login, signup, forgot-password` | `GET /config`; `POST /auth/register`, `registerCustomer`; `POST /auth/login`; `POST /auth/password/forgot`, `POST /auth/password/reset` | — |
| `(setup)/complete-profile, verify-phone, verify-code, wrong-account` | `GET /me`; `registerCustomer`; `requestPhoneOtp`, `verifyPhoneOtp`; `POST /auth/logout` | `user:{uid}` |
| Home | `GET /stores`, `GET /categories`, `GET /products?listed=true&featured=true`, `GET /orders?status=placed,confirmed,preparing,ready,on_the_way&limit=3`, `GET /me/buy-again`, `GET /tracking/{token}` for each store order that is out for delivery, `GET /me` (first-order banners) | `stores`, `categories`, `user:{uid}:orders`, `tracking:{token}`, `user:{uid}` |
| Stores | `GET /stores` | `stores` |
| `site` sheet | `GET /me/jobsites`; `geocodeAddress`; `PUT /me/jobsites/{id}` | — |
| Search | `GET /products?listed=true&q=…[&categoryId=][&inStock=true]`; grouping by `familyKey` and ranking by distance stay in the app | — |
| Categories, `category/[id]` | `GET /categories`, `GET /products?listed=true&categoryId=` | `categories` |
| `store/[id]` | `GET /stores/{id}`, `GET /products?listed=true&storeId=[&categoryId=][&q=]` | `store:{storeId}`, `store:{storeId}:products` |
| `store/[id]/reviews`, `store/[id]/review` | `GET /stores/{id}/reviews`, `GET /stores/{id}/reviews/{storeOrderId}`; `PUT`, `DELETE` the same path | — |
| `product/[id]` | `GET /products/{id}`, `GET /products?listed=true&familyKey=&sort=priceCents:asc` (Also at), `PUT`/`DELETE /me/favorites/{productId}` | `product:{productId}` |
| Cart | `GET /products?ids=`, `GET /stores`, `GET /me`, `GET /me/jobsites`; pricing is `priceCheckout` in the app | `store:{storeId}:products` per store in the cart, `stores`, `user:{uid}` |
| Saved | `GET /me/favorites`, `GET /products?ids=` | — |
| `checkout/index`, `window`, `jobsite`, `card` | the cart reads, `GET /me/jobsites`, `GET /me/cards`, `GET /config`; `PUT /me/jobsites/{id}`, `PUT /me/cards/{id}`; `placeOrder` | as the cart |
| `order-success` | `GET /orders/{id}` | `order:{orderId}` |
| Orders tab | `GET /orders?status=…` (active, past, optional `jobsiteId`), `GET /quotes` | `user:{uid}:orders`, `user:{uid}:quotes` |
| `orders/[id]` | `GET /orders/{id}`, `GET /store-orders?orderId=`, `GET /tracking/{token}`, `GET /store-orders/{id}/proof`, `GET /issues?orderId=`; `cancelOrder` | `order:{orderId}`, `tracking:{token}` |
| `orders/[id]/track/[storeOrderId]` | `GET /store-orders/{id}`, `GET /tracking/{token}` | `store-order:{id}`, `tracking:{token}` |
| `issues/new` | `POST /files/presign` (`issue_photo`), upload, `POST /files/confirm`; `reportIssue` | — |
| `issues/[id]` | `GET /issues/{id}`, `GET /files/url?path=` | `issue:{issueId}` |
| `quotes/new` | `POST /files/presign` (`quote_upload`), upload, confirm; `GET /me/jobsites`; `submitMaterialList` | — |
| `quotes/index`, `[id]`, `[id]/accept` | `GET /quotes`, `GET /quotes/{id}`, `GET /me/cards`; `acceptQuote`, `closeQuote`, `reopenQuote` | `user:{uid}:quotes`, `quote:{quoteId}` |
| Support | `GET /support-threads/{uid}`, `GET …/messages`, `POST …/messages`, `POST …/read` | `support-thread:{uid}` |
| `jobsites/index`, `edit` | `GET /me/jobsites`, `PUT`, `DELETE`; `geocodeAddress` | — |
| `cards/index`, `add` | `GET /me/cards`, `PUT`, `DELETE` | — |
| Account | `GET /me`, `PATCH /me`, `POST /files/presign` (`avatar`), `POST /auth/logout` | `user:{uid}` |
| Notifications, settings, help, about, suggest-store | `GET /notifications`, read, read-all, delete; `PATCH /me` (preferences); `PUT /me/devices/{installationId}`; `suggestStore`; `GET /config` | `user:{uid}:notifications` |

**Supplier portal (MARKETPLACE §8)**, store `S` = the caller's store

| Screen | Reads and writes | Live |
| --- | --- | --- |
| Sign-in, header | `POST /auth/login`, `GET /me` (with the store), `GET /notifications`; `updateStoreProfile` (`acceptingOrders`) | `user:{uid}`, `user:{uid}:notifications`, `store:{S}` |
| `/portal` board | `GET /store-orders?storeId=S&status=new,accepted,preparing,ready,out_for_delivery,failed&sort=readyBy:asc&limit=200`; Done today: `GET /store-orders?storeId=S&completedSince=<start of today>&sort=completedAt:desc`; Upcoming: `…&readyByDateAfter=<today>` | `store:{S}:orders` (a new order arrives as an event within the 2 s the portal promises) |
| `/portal/orders/{storeOrderId}` | `GET /store-orders/{id}`; `acceptStoreOrder`, `updateStoreOrderStatus`, `rejectStoreOrder`, `completePickup` | `store-order:{id}` |
| `/portal/catalog` | `GET /products?storeId=S&sort=name:asc&limit=500[&categoryId=][&lowStock=true][&active=false][&estimated=true]`, `GET /categories`; `PUT`, `PATCH`, `DELETE /products/{id}`, `POST /products/{id}/stock-adjust`; `POST /files/presign` (`product_photo`) | `store:{S}:products` |
| `/portal/store` | `GET /stores/{S}`, `GET /stores/{S}/settings` (owner); `updateStoreProfile`; `POST /files/presign` (`store_photo`) | `store:{S}` |
| `/portal/payouts` | `GET /ledger/balance`, `GET /ledger-entries?payeeType=store&payeeId=S[&held=true][&payoutId=]`, `GET /payouts?payeeType=store&payeeId=S`, `GET /payouts/{id}` | `store:{S}:payouts` |
| `/portal/insights` | `GET /store-orders?storeId=S&completedSince=&sort=completedAt:desc&limit=200`, following cursors up to 1 000 rows | — |
| `/portal/team` | `GET /users?role=supplier&storeId=S`; `inviteSupplierUser`, `setSupplierUserStatus` | — |
| `/portal/support` | `GET /support-threads/store_{S}`, messages, `POST`, read | `support-thread:store_{S}` |
| Issues of the store (from `store_issue` notifications) | `GET /issues?storeId=S`, `GET /issues/{id}`, `GET /files/url?path=` | `store:{S}:issues`, `issue:{issueId}` |

**Ops back office (MARKETPLACE §9)**

| Screen | Reads and writes | Live |
| --- | --- | --- |
| Dashboard, sidebar badges | `GET /ops/dashboard`; the "Needs attention" lists: `GET /store-orders?acceptOverdue=true&status=new`, `GET /store-orders?status=failed`, `GET /job-offers?status=open`, `GET /issues?status=open,in_review`, `GET /quotes?status=submitted,in_review&sort=respondBy:asc`, `GET /orders?paymentStatus=capture_failed` | `ops:orders`, `ops:store-orders`, `ops:deliveries`, `ops:job-offers`, `ops:quotes`, `ops:issues`, `ops:support-threads` |
| `/orders`, `/orders/{orderId}` | `GET /orders`, `GET /store-orders`; `GET /orders/{id}`, `GET /store-orders?orderId=`, `GET /store-orders/{id}/private`, `GET /deliveries/{id}`, `GET /issues?orderId=`, `GET /quotes/{id}`; the store-order commands, `resolveFailedDelivery` | `ops:orders`, `ops:store-orders`, `order:{orderId}`, `store-order:{id}` |
| `/stores`, `/stores/new`, `/stores/{storeId}` | `GET /ops/stores`, `GET /stores/{id}`, `…/settings`, `GET /users?role=supplier&storeId=`, `GET /products?storeId=`, `GET /store-orders?storeId=`, `GET /stores/{id}/reviews`; `createStore`, `updateStoreSettings`, `updateStoreProfile`, `inviteSupplierUser`, `setSupplierUserStatus`, `geocodeAddress`, `DELETE …/reviews/{storeOrderId}` | `stores`, `ops:store-orders`, `store:{storeId}` |
| `/catalog` | `GET /products?[storeId=][&categoryId=][&q=]&sort=name:asc`, `GET /categories`; product writes; `PUT`, `PATCH`, `DELETE /categories/{id}`, `POST /categories/reorder` | `categories` |
| `/quotes`, `/quotes/{quoteId}` | `GET /quotes?status=&sort=respondBy:asc`, `GET /quotes/{id}`, `PATCH /quotes/{id}`, `GET`/`PUT /quotes/{id}/workspace`, `GET /products?listed=true&q=`, `GET /stores`, `GET /files/url?path=`; `sendQuote`, `closeQuote` | `ops:quotes`, `quote:{quoteId}` |
| `/issues`, `/issues/{issueId}` | `GET /issues`, `GET /issues/{id}`, `PATCH`, `GET`/`PUT …/notes`, `GET /files/url?path=` (issue photos and the proof photo), `GET /store-orders/{id}`, `GET /deliveries/{id}`; `resolveIssue` | `ops:issues`, `issue:{issueId}` |
| `/support`, `/support/{threadId}` | `GET /support-threads`, `GET /support-threads/{id}`, messages, `POST`, read, `PATCH`; side panel `GET /orders?customerId=`, `GET /issues?customerId=` or `?storeId=`, `GET /quotes?customerId=` | `ops:support-threads`, `support-thread:{threadId}` |
| `/jobs` | `GET /job-offers?status=scheduled,open&sort=opensAt:asc`, `GET /users?role=driver&status=active`, `GET /deliveries?unloadStatus=needed`; `assignDelivery`, `boostJobPayout`, `PATCH /deliveries/{id}` (labourer) | `ops:job-offers`, `ops:deliveries` |
| `/deliveries`, `/deliveries/{id}` | `GET /deliveries` (open; `updatedSince`; `createdSince`), `GET /deliveries/{id}`, `…/events`, `…/private`, `GET /files/url?path=` (proof), `GET /activity`; `PATCH /deliveries/{id}`, `createDeliveries`, `assignDelivery`, `updateDeliveryStatus`, `completeDelivery`, `optimizeRoute`, `geocodeAddress` | `ops:deliveries`, `delivery:{id}` |
| Live map | `GET /driver-locations`, `GET /deliveries?status=<open statuses>`, `GET /routes/{driverId}`, `GET /users?role=driver` | `driver-locations`, `ops:deliveries`, `driver:{driverId}:route` |
| `/drivers`, `/drivers/{id}` | `GET /users?role=driver`, `GET /users/{uid}`, `GET /driver-locations/{uid}`, `GET /deliveries?driverId=`, `GET /deliveries/stats?driverId=&since=`, `GET /ledger/balance`, `GET /ledger-entries?payeeType=driver&payeeId=`; `setDriverStatus`, `reviewDriverVehicle`, `PATCH /users/{uid}/payout-account` | `ops:drivers`, `driver:{driverId}:deliveries`, `driver:{driverId}:earnings` |
| `/messages` | `GET /threads`, `GET /threads/{driverId}`, messages, `POST`, read | `ops:threads`, `thread:{driverId}` |
| `/payouts` | `GET /payouts`, `GET /ledger-entries`, `GET /ops/jobs`; `runJobNow` | `ops:payouts` |
| `/suggestions` | `GET /store-suggestions`, `PATCH` | `ops:suggestions` |
| Team, Dev SMS outbox | `GET /users?role=admin,dispatcher`, `createStaffUser`; `GET /dev-outbox` | `ops:outbox` |
| `/track/{token}` (public) | `GET /tracking/{token}` | `tracking:{token}` |

**Driver app (MARKETPLACE §10)**

| Screen | Reads and writes | Live |
| --- | --- | --- |
| Onboarding | `POST /auth/register`, `GET /me`, `registerDriver`, `requestPhoneOtp`, `verifyPhoneOtp` | `user:{uid}` (the approval arrives as an event) |
| Jobs | `GET /job-offers?status=open&sort=openedAt:desc`, `GET /driver-locations/{uid}`, `POST /me/location` (online switch and fixes) | `job-offers:{cityId}:{capacityClass}` |
| `job/[id]` | `GET /job-offers/{deliveryId}`; `claimJob` | `job-offers:{cityId}:{capacityClass}` |
| Today | `GET /deliveries?driverId={uid}&status=assigned,accepted,picked_up,in_transit,arrived`; `updateDeliveryStatus` (accept, decline) | `driver:{uid}:deliveries` |
| `delivery/[id]`, `complete`, `fail` | `GET /deliveries/{id}`, `GET /deliveries/{id}/events?limit=30`; `checkInAtStore`, `updateDeliveryStatus`, `POST /files/presign` (`proof`) then `completeDelivery` | `delivery:{id}` (the PIN card updates on the event) |
| Route | `GET /routes/{uid}`; `optimizeRoute` | `driver:{uid}:route` |
| Earnings | `GET /ledger/balance`, `GET /ledger-entries?payeeType=driver&payeeId={uid}`, `GET /payouts?payeeType=driver&payeeId={uid}`, `GET /deliveries/stats?driverId={uid}&since=` | `driver:{uid}:earnings` |
| Chat | `GET /threads/{uid}`, messages, `POST`, read | `thread:{uid}` |
| Profile, vehicle, history, notifications | `GET /me`, `PATCH /me`, `updateDriverVehicle`, `GET /deliveries?driverId={uid}&status=delivered,failed,cancelled&sort=updatedAt:desc`, the notification endpoints, `PUT /me/devices/{installationId}` | `user:{uid}`, `user:{uid}:notifications` |

### 5.6 Coverage: every former direct client write

| Rule block (MARKETPLACE §6.3, §6.4, legacy rules) | Endpoint |
| --- | --- |
| `users/{uid}` update of 5 fields | `PATCH /me` |
| `users/{uid}/jobsites` | `PUT`, `DELETE /me/jobsites/{jobsiteId}` |
| `users/{uid}/cards` | `PUT`, `DELETE /me/cards/{cardId}` |
| `users/{uid}/favorites` | `PUT`, `DELETE /me/favorites/{productId}` |
| `users/{uid}/devices` | `PUT`, `DELETE /me/devices/{installationId}` |
| `carts/{uid}` (P1) | `PUT`, `DELETE /me/cart` |
| `categories` (staff) | `PUT`, `PATCH`, `DELETE /categories/{id}`, `POST /categories/reorder` |
| `stores/{id}/reviews` | `PUT`, `DELETE /stores/{storeId}/reviews/{storeOrderId}` |
| `products` create, update, delete | `PUT`, `PATCH`, `DELETE /products/{productId}`, `POST /products/{productId}/stock-adjust` |
| `deliveries` staff edit | `PATCH /deliveries/{deliveryId}` |
| `driverLocations/{uid}` | `POST /me/location` |
| `notifications` read flag, delete | `POST /notifications/{id}/read`, `POST /notifications/read-all`, `DELETE /notifications/{id}` |
| `threads/{driverId}/messages` create; own unread reset | `POST /threads/{driverId}/messages`; `POST /threads/{driverId}/read` |
| `supportThreads/{id}/messages` create; own unread reset; staff status and assignee | `POST /support-threads/{threadId}/messages`; `POST …/read`; `PATCH /support-threads/{threadId}` |
| `quotes` staff assignment, `quotes/{id}/private` | `PATCH /quotes/{quoteId}`; `PUT /quotes/{quoteId}/workspace` |
| `issues` staff assignment, `issues/{id}/private` | `PATCH /issues/{issueId}`; `PUT /issues/{issueId}/notes` |
| `storeSuggestions` status | `PATCH /store-suggestions/{id}` |
| Storage `proofs/`, `quoteUploads/`, `issuePhotos/`, `storePhotos/`, `productPhotos/`, `avatars/` | `POST /files/presign`, upload, `POST /files/confirm` |

---

## 6. Auth

### 6.1 Tables and secrets

| Table | Role |
| --- | --- |
| `users` | the account: login (`email`, `password_hash`), the failure counter `failed_logins`, and the columns that used to be custom claims (`role`, `status`, `store_id`, `store_role`, `city_id`, `capacity_class`) |
| `sessions` | one row per signed-in device; revocable; carries `app` and `installation_id`, which ties the push device to the session |
| `refresh_tokens` | the rotation chain of a session; only hashes are stored |
| `auth_tokens` | password reset codes and set-password links; only hashes are stored |
| `otp_challenges` | the current phone code of a user; only a hash is stored |

| Secret | Used for |
| --- | --- |
| `JWT_SECRET` (≥ 32 random bytes) | HS256 signature of access tokens. `JWT_SECRET_PREVIOUS`, when set, is also accepted for verification, so the secret can be rotated without signing everyone out. |
| `OTP_PEPPER` (≥ 32 random bytes) | every HMAC that protects a low-entropy value or hides an identifier: OTP codes, reset codes, set-password secrets, rate-limit subjects (IP, phone, email), signed local file URLs. Each use has its own domain prefix: `hmacHex(domain, value) = HMAC-SHA256(OTP_PEPPER, domain + ':' + value)`. |

**Passwords.** `scrypt` from `node:crypto` with N = 2^15 (32 768), r = 8, p = 3, key length 32, a
16-byte random salt and `maxmem` 64 MiB. This is one of the equivalent settings of the OWASP Password
Storage Cheat Sheet (§13) and needs about 32 MiB per hash. Stored as one string:

```
scrypt$N=32768,r=8,p=3$<salt base64url>$<hash base64url>
```

`verifyPassword` reads the parameters from the string and compares with `timingSafeEqual`.
`needsRehash` is true when the stored parameters are weaker than the current ones; login then stores a
new hash. Hashing runs on the libuv thread pool (4 threads), which also caps the number of hashes in
flight. Password rule: `isStrongPassword` from shared (at least 8 characters, letters and a digit) and
at most 128 characters. Emails are trimmed and lower-cased before any comparison; `users_email_key`
is on `lower(email)`.

### 6.2 Token formats

| Token | Format | Lifetime | Stored |
| --- | --- | --- | --- |
| Access | JWT, header `{ "alg": "HS256", "typ": "JWT" }`, claims `{ iss: "instasupply", aud: "instasupply-api", sub: <uid>, sid: <sessionId>, iat, exp }` | `ACCESS_TOKEN_TTL_SECONDS` = 900; the answer states it as `accessTokenTtlSeconds` | nowhere (stateless signature; the session is checked on every request) |
| Refresh | `isr_<tokenId>.<secret>`: `tokenId` is a UUIDv4 (the row id), `secret` is 32 random bytes in base64url | `REFRESH_TOKEN_TTL_DAYS` = 60, sliding, never past the session's `expires_at` (`SESSION_MAX_DAYS` = 180 after sign-in) | `refresh_tokens.token_hash = sha256Hex(secret)` |
| Password reset code | 6 digits | 15 minutes, 5 attempts | `auth_tokens.secret_hash = hmacHex('reset', uid + ':' + code)` |
| Set-password link | `WEB_URL/set-password#token=isp_<tokenId>.<secret>`, 32 random bytes (fragment: never sent to the console's server, never in Railway's HTTP logs) | `INVITE_LINK_TTL_HOURS` = 72, single use | `auth_tokens.secret_hash = hmacHex('invite', secret)` |
| Phone code | 6 digits | 5 minutes, 5 attempts | `otp_challenges.code_hash = hmacHex('otp', uid + ':' + phone + ':' + code)` |

The access token carries **identity only**. Role, status, store, city and capacity class are never in
it; they are read from `users` on every request (§6.4). Clients never decode it. Verification uses
`jose.jwtVerify` with `algorithms: ['HS256']`, the issuer and audience above and a clock tolerance of
5 s.

**What the auth endpoints answer.** `register`, `login`, `refresh` and `password/setup` answer
`AuthSessionResponse`: the token pair plus `me`. `me` (`MeResponse`, also the answer of `GET /me` and
`PATCH /me`) is built from the database row on every call:

| Field | Value |
| --- | --- |
| `account` | `{ uid, email, createdAt }` |
| `profile` | `null` while `users.role IS NULL`, else the `UserProfile` of §3.3 (it carries role, status, store, city and the approved vehicle with its capacity class: everything the old claims carried) |
| `store` | for a supplier, the public `Store` of `users.store_id`; else `null` |
| `serverTime` | the server clock |

### 6.3 Flows

Every flow below validates its body with a strict schema and applies the limits of §4.6 first.
`app` is `customer`, `driver` or `console`; `installationId` is the per-install id the client also
uses as its push device id (8 to 80 characters).

#### 6.3.1 Register (`POST /auth/register`)

1. Limit `signup_ip`. Validate email, password, `displayName` (0–80), `app ∈ { customer, driver }`.
2. If an account with that email exists → `already-exists` "An account with this email already
   exists. Try signing in." (Registration necessarily reveals that an email is taken; the limit keeps
   it from being used to enumerate.)
3. Hash the password. Insert `users` with a new UUID, `role = NULL`, `status = 'active'`,
   `display_name = displayName`, `doc = '{}'`. A unique violation from a concurrent request → step
   2's error.
4. Create the session and the first refresh token (§6.3.5); sign the access token.
5. Answer `AuthSessionResponse` with `me.profile = null`.

The account now exists without a profile. The app calls `registerCustomer` or `registerDriver`
next; until then its session state is `needs_profile`.

#### 6.3.2 Register a customer (`registerCustomer`)

1. `requireAuth`. If `role` is neither null nor `customer` → `failed-precondition` "This email
   belongs to a staff, supplier or driver account. Use another email to order."
2. Validate name 1–80, company ≤ 80, account type.
3. Transaction, `users` row locked:
   - `role` null → `role = 'customer'`, `status = 'active'`, `display_name`, and in `doc`:
     `companyName`, `accountType`, `stats = { nonCancelledOrders: 0, completedOrders: 0, lastOrderAt: null }`,
     `promoUses = {}`, `preferences = { orderPush: true, chatPush: true, promoPush: marketingOptIn === true }`.
   - `role` already `customer` → update the name only (the call is safe to repeat).
4. Publish on `user:{uid}`. Answer `{ status }`.

There is no claim to set and no token to refresh: the next request sees the new role.

#### 6.3.3 Register a driver (`registerDriver`)

1. `requireAuth`. If `role` is neither null nor `driver` → `failed-precondition` (staff, customer
   and supplier accounts are refused).
2. Validate name, `cityId`, vehicle (`validateDriverVehicle`), attestations all `true`.
3. Transaction, `users` row locked:
   - `role` null → `role = 'driver'`, `status = 'pending'`, `display_name`, `city_id`, and in `doc`:
     `vehicle` with `capacityClass = capacityClassFor(vehicle)`, `compliance` with the three attest
     times = `now` and both `…Verified = false`, `preferences = { chatPush: true, deliveryPush: true, jobPush: true }`.
     Notify admins `driver_signup` (key `signup-{uid}`).
   - `status = 'pending'` → overwrite name, city and vehicle (the driver edits onboarding details).
   - `status` `active` or `suspended` → update the name only (vehicle changes go through
     `updateDriverVehicle`).
4. Answer `{ status }`.

A pending driver can sign in, verify the phone, read `/me` and notifications. Every operator endpoint
uses `requireActiveDriver` and answers `permission-denied` "Your driver account is waiting for
approval."

#### 6.3.4 Log in (`POST /auth/login`)

1. Limit `login_ip` (per address).
2. Load the user by `lower(email)` (may be none). Decide whether the caller is **trusted** for that account:
   the account exists and has a session (active or ended in the last 90 days) with the same
   `installation_id` as the request, or with `ip_hash = hmacHex('ip', clientAddress(req))` used in the last
   30 days. Unknown emails are never trusted.
3. Unless trusted, consume `login_email` (subject `hmacHex('email', lowercased)`, 10 per 15 minutes),
   **whether or not an account has that email**. Over the limit → `resource-exhausted`, code
   `RATE_LIMITED`, `details.retryAfterMs`: the same answer for an existing and an unknown email, so the
   limit reveals nothing. A flood against one email from other addresses therefore slows down attackers
   and never blocks the owner's own phone or browser.
4. No user, or `password_hash` is null (invited, password not set yet): run `verifyPassword` against a
   fixed dummy hash (same cost), then fail `unauthenticated`, reason `credentials`, "That email and
   password combination is incorrect."
5. Verify the password. Wrong → `failed_logins + 1` (a diagnostic counter; when it reaches 10, admins get
   one `system` notification, key `login-failures-{uid}-{YYYYMMDD}`), then fail as in step 4. There is no
   account lockout: a lock would let anyone lock out a driver or a supplier by email, and the lock answer
   would reveal that the account exists.
6. Right password, `status = 'suspended'` → `permission-denied`, reason `account_suspended`, "Your
   account is suspended. Contact InstaSupply support." (Only someone who knows the password learns
   this.)
7. Reset `failed_logins`, set `last_login_at`; rehash when `needsRehash`.
8. Create the session with `app`, `installation_id` and `ip_hash` (a previous active session of the same
   user and `installation_id` is revoked with reason `removed`; at most 10 active sessions per user, the
   least recently used one is revoked), mint tokens, answer `AuthSessionResponse`.

Login does not judge `app`. The apps decide what to do with a role that is not theirs (the customer
app's `wrong_account` state; the console's "This is a customer account. Order in the InstaSupply
app.").

#### 6.3.5 Refresh with rotation and reuse detection (`POST /auth/refresh`)

Every refresh token row of a session is kept until the session itself is purged (30 days after it
ended), so an old token is always recognized, however late it is replayed. A session issues at most one
token per refresh (about one per 15 minutes of use), so the chain stays small.

1. Limit `refresh_ip`. Parse `isr_<tokenId>.<secret>`; malformed → `unauthenticated`, reason
   `token_invalid`.
2. One transaction: lock the `refresh_tokens` row by id, then its `sessions` row (both
   `FOR NO KEY UPDATE`), then read the user. In this order:
   - no row, or `sha256Hex(secret)` differs (constant-time compare) → `unauthenticated`,
     `token_invalid`.
   - user `suspended`, or the session was revoked with reason `suspended` → `permission-denied`,
     `account_suspended` (revoke the session with reason `suspended` first if it is still active). This
     check comes **before** the revoked check, so a suspended user always learns why.
   - session revoked (any other reason) → `unauthenticated`, `session_revoked`.
   - the token or the session is past `expires_at` → `unauthenticated`, `token_expired`.
   - `superseded_at` is set → **reuse** (below).
   - **`used_at` is null** (normal case): set `used_at = now`; insert a child with `parent_id` = this
     token and `expires_at = min(now + 60 days, session.expires_at)`; set `replaced_by`; mark every other
     unused child of this token's own parent `superseded_at = now` (its siblings from earlier repeats);
     `sessions.last_used_at = now`.
   - **`used_at` is set and no child of this token has been used yet**: a **repeat**. The answer was lost
     (a phone in a tunnel, a background task whose batch was delayed), or two runtimes raced. Whatever the
     age, insert another child (as above) and answer normally. A token may have at most 5 children; a
     6th repeat is treated as reuse.
   - **`used_at` is set and one of its children has been used** (or the token is superseded): the token
     was replayed after the chain moved on. **Reuse:** revoke the session with reason `reuse_detected`
     (clean-up of §6.3.6, control message `drop_session`), fail `unauthenticated`, reason
     `refresh_reused`. Both the thief and the owner must sign in again.
3. Sign a new access token for the same `sid`. Answer `AuthSessionResponse` with `me`.

Why this detects theft in both orders. If the thief rotates first and then uses the child, the owner's
next refresh presents a token whose child was used: reuse. If the owner rotates and uses the child first,
the thief's replay meets the same condition. If one party holds an unused child while the other repeats,
both get children; as soon as either uses its child, the other's child is superseded, and presenting it is
reuse. Two browser tabs never race in practice: they refresh one after the other under the web lock and
read the stored token first (`docs/CLIENTS.md` §1.5 rules 3 and 5).

#### 6.3.6 Log out and revocation

`POST /auth/logout { refreshToken }` needs no access token: it finds the session through the refresh
token (also a used or expired one, as long as its hash matches). It sets `revoked_at`,
`revoked_reason = 'logout'` and runs the clean-up below. Unknown or already
revoked → still 204. `POST /auth/logout-all` does the same for every session of the caller.

**Every revocation does the same clean-up**, whatever its reason (logout, suspension, reuse
detection, password change or reset, `DELETE /auth/sessions/{id}`, the admin endpoints of §5.3.2, the
`revoke-sessions` CLI command): the session's refresh tokens are marked unusable (the session's
`revoked_at` is what is checked; the rows stay until the purge so a replay is still recognized), the
session's device row is deleted (no push to a signed-out phone), sockets are dropped, and for a driver's
`driver` session `driver_locations.online = false` with a publish on `driver-locations` (so a driver who
signs out stops getting job offers even if the app's last "offline" report failed).

#### 6.3.7 Change and reset a password

**Change (`POST /auth/password/change`, signed in):** verify `currentPassword` (wrong →
`invalid-argument` "Your current password is incorrect."; counts toward the lockout); validate the new
one; store the hash, `password_changed_at = now`; revoke every **other** session (reason
`password_changed`). The current session stays. 204.

**Forgot (`POST /auth/password/forgot`):** limits `reset_ip`, `reset_email`. Always answers 204 after
the same amount of work, whether or not the email has an account. When the account exists, is not
suspended and has not reached `reset_fail_user` in the last 24 hours: replace its active `password_reset` token (delete, insert) with a new 6-digit code that
expires in 15 minutes, and enqueue `mail.send` (purpose `password_reset`): "123456 is your InstaSupply
password reset code. It expires in 15 minutes."

**Reset (`POST /auth/password/reset`):** limit `reset_ip`. Load the user and the active token. Any
failure (no user, no token, expired, 5 attempts used, wrong code) answers the same `invalid-argument`
"That code is incorrect or has expired."; a wrong code first commits `attempts + 1` and consumes
`reset_fail_user` for that uid (10 wrong codes per 24 hours across all codes). The tenth wrong code
also deletes the active token and sends admins one `system` notification (key
`reset-locked-{uid}-{YYYYMMDD}`). An attacker therefore gets at most 10 guesses per account per day
against 10^6 codes (about one success in 270 years), and a staff member sees the attempt. On success: store
the new hash, mark the token used, `failed_logins = 0`, revoke **every**
session (reason `password_reset`). 204; the user then logs in.

With `EMAIL_DRIVER=outbox` the code is stored in `dev_outbox` as a sensitive row, visible to admins
only (§10.3). A dispatcher can therefore not take over another account by resetting its password.

#### 6.3.8 Invite and set a password

Used by `createStaffUser`, `inviteSupplierUser` and the CLI command `create-admin`.

1. Validate (`isValidEmail`, name 1–80, role). Limit `invite`.
2. Transaction: insert `users` with `password_hash = NULL`, the role, `status = 'active'`, the store
   and store role for suppliers, default preferences (`staff`: chat and delivery push; `supplier`:
   chat and store-order push). If the email exists:
   - same role (and same store), and `password_hash` is still null → reuse the row (a repeated
     invite);
   - anything else → `already-exists` "Someone with this email already has an account."
3. Replace the user's active `set_password` token; build the link
   `WEB_URL/set-password#token=isp_<tokenId>.<secret>`.
4. Enqueue `mail.send` (purpose `invite`) with the link, and return
   `{ uid, passwordSetupLink }` to the inviter, as MARKETPLACE §5.4 specifies.
5. The console page `/set-password` reads the token from `location.hash`, removes it from the address
   bar, calls `POST /auth/invites/inspect { token }` (shows whose password is being set) and `POST /auth/password/setup { token, password, installationId, app }`: verify the hash,
   not used, not expired; store the password hash; mark the token used; create a session and answer
   `AuthSessionResponse`, so the new user is signed in at once.

The same link mechanism is the only way to give a password to an account that has none.

#### 6.3.9 Phone verification (`requestPhoneOtp`, `verifyPhoneOtp`)

Ported from `legacy/…/auth/phone-otp.ts`; the numbers are unchanged.

**Request**

1. `requireAuth`; the account must have a role, else `failed-precondition` "Finish creating your
   profile first."
2. `normalizePhone` (NANP only) → `invalid-argument` when it is not a valid +1 number. Then
   `isCanadianNumber` (shared, §16: the area code is in `CANADIAN_AREA_CODES`) → otherwise
   `invalid-argument` "Use a Canadian mobile number." Caribbean and other non-Canadian +1 area codes,
   the usual targets of SMS pumping, are never sent a code. (Jobsite contact phones stay NANP-wide.)
3. `PHONE_VERIFICATION=off` → `failed-precondition` "Phone verification is switched off."
4. If no SMS can be delivered (`SMS_DRIVER=outbox`, `EXPOSE_DEV_CODES=false`, and the number is not in
   `OTP_TEST_NUMBERS`) → `failed-precondition` "Phone verification by SMS isn't available yet."
5. Limits `otp_ip`, `otp_phone`, `otp_phone_day`, then `otp_global` and `otp_global_day` (§4.6).
6. Transaction on the user's `otp_challenges` row (locked): less than 30 s since `last_sent_at` →
   `RATE_LIMITED` "Please wait N seconds…"; more than 5 sends in the hour window → `RATE_LIMITED`.
   Store the new hash, `attempts = 0`, `expires_at = now + 5 min`.
7. The code is the configured test code for a number in `OTP_TEST_NUMBERS`, else 6 random digits. For
   a real number enqueue `sms.send` (purpose `otp`): "123456 is your InstaSupply verification code. It
   expires in 5 minutes. Never share it."
8. Answer `{ phoneNumber, expiresInSeconds: 300, resendInSeconds: 30 }`, plus `devCode` when
   `EXPOSE_DEV_CODES=true`.

**No account enumeration:** step 6 does not look at whether the number already belongs to someone.
The answer and the SMS are the same either way.

**Verify**

1. Code must be 6 digits.
2. Transaction on the challenge row: missing → `failed-precondition` "Request a verification code
   first."; expired → `failed-precondition` "This code has expired. Request a new one."; 5 attempts
   used → `resource-exhausted` "Too many incorrect attempts. Request a new code."; wrong →
   `attempts + 1` is **committed**, then `invalid-argument` "That code is incorrect. N attempts left."
3. Right code: delete the challenge; `UPDATE users SET phone_number, phone_verified = true`. A
   violation of `users_phone_key` → `already-exists` "This mobile number is already linked to another
   account." (Only someone who controls the number can learn this.)
4. Publish on `user:{uid}`. Answer `{ phoneNumber }`.

`PHONE_VERIFICATION` decides what an unverified phone blocks: `required` → `placeOrder`,
`acceptQuote` and `submitMaterialList` (phone contact) fail with `PHONE_UNVERIFIED`; `optional` and
`off` → they do not check `phoneVerified`.

### 6.4 Enforcement on every request

`platform/auth/authenticate.ts` runs as an `onRequest` hook:

1. No `Authorization` header → `ctx.actor = null`. Public endpoints continue; `requireAuth` answers
   `unauthenticated`, reason `token_invalid`.
2. Verify the JWT. Bad signature or shape → `token_invalid`; expired → `token_expired` (the client
   refreshes and retries once).
3. One query by primary keys:

   ```sql
   SELECT u.id, u.email, u.role, u.status, u.display_name, u.phone_verified, u.store_id, u.store_role,
          u.city_id, u.capacity_class, s.revoked_at, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = $1 AND s.user_id = $2;
   ```

   First `status = 'suspended'`, or `revoked_reason = 'suspended'` → `permission-denied`, reason
   `account_suspended` (checked before the revocation, so a suspended user's apps show the suspension
   and not "session ended"). Then no row, `revoked_at` set or `expires_at` passed → `unauthenticated`,
   reason `session_revoked` (the client ends the session).
4. Build the actor. `sessions.last_used_at` is refreshed at most once per 5 minutes per session,
   without waiting for the write.

```ts
// platform/auth/actor.ts
export interface Actor {
  uid: string; sessionId: string; email: string;
  role: Role | null; status: AccountStatus; name: string;
  isStaff: boolean; isAdmin: boolean;
  /** status === 'active' (approved, not suspended). */
  isActive: boolean;
  phoneVerified: boolean;
  storeId: string | null; storeRole: StoreRole | null;
  cityId: CityId | null; capacityClass: VehicleClass | null;
}
```

| `details.reason` | Status | Meaning | What the client does |
| --- | --- | --- | --- |
| `token_expired` | `unauthenticated` | the access token (or, on refresh, the refresh token or the session) is too old | refresh and retry once; on refresh: the session ended |
| `token_invalid` | `unauthenticated` | missing, malformed or unknown token | the session ended |
| `session_revoked` | `unauthenticated` | signed out elsewhere, revoked by staff, password changed | the session ended |
| `refresh_reused` | `unauthenticated` | a refresh token was presented after its chain moved on (§6.3.5) | the session ended |
| `credentials` | `unauthenticated` | wrong email or password | show the message |
| `account_suspended` | `permission-denied` | the account is suspended; answered on every request, refresh, `GET /me`, live `auth` and login with the right password, before `session_revoked` | the session ended with `endReason: 'suspended'` |

Too many sign-in attempts are not an auth reason: they answer `resource-exhausted` with code `RATE_LIMITED`
and `details.retryAfterMs`, the same for every email (§6.3.4).

Because step 3 runs on every request, a suspension, a role change, a store change or a vehicle
approval takes effect on the very next request. There is nothing to cache and nothing to refresh.
The server publishes on `user:{uid}` whenever one of those columns changes, so clients reload
`GET /me`.

**What suspension does** (`setDriverStatus`, `setSupplierUserStatus`, `PATCH /users/{uid}/status`), in one transaction:
`users.status = 'suspended'`, `doc.suspendedReason`; every session of the user is revoked with reason
`suspended` (with the clean-up of §6.3.6); for a driver `driver_locations.online = false`; control
message `drop_user` so every instance closes that user's live sockets. Reactivation only sets the
status back; the user logs in again.

### 6.5 Lockout and limits in one place

| Protection | Value |
| --- | --- |
| Login attempts per address | 30 per 15 minutes |
| Login attempts per email | 10 per 15 minutes from untrusted callers, the same for unknown emails; the owner's known devices and addresses are exempt |
| Account lockout | none (10 consecutive wrong passwords only alert admins) |
| Registrations per address | 10 per hour |
| Reset codes per email / per address | 3 per hour / 10 per hour; 5 attempts per code; 15 minutes; 10 wrong codes per account per 24 hours, then no new code for 24 hours |
| Phone codes per user | 30 s between sends, 5 per hour, 5 attempts per code, 5 minutes |
| Phone codes per number / per address | 5 per hour and 10 per day / 20 per hour; Canadian area codes only |
| Phone codes in total | 200 per hour, 1 000 per day |
| Refresh calls per address | 120 per 15 minutes |
| Sessions per user | 10 active, one per install |
| Invites per inviter | 30 per hour |

---

## 7. Authorization

Deny by default: a route without a policy does not start (`defineRoute` and `defineCommand` require
one), and a test (§12.4) walks the route table and fails on any route that is neither in the public
list of §7.2 nor guarded.

Authorization has three layers, and every protected endpoint uses all three:

1. **Endpoint policy:** who may call it at all (role, status).
2. **Object check:** whether this caller may touch this row (ownership, store membership, assigned
   driver, audience).
3. **Serializer:** which columns leave the server (§3.3). Private columns have their own endpoints.

### 7.1 Policy helpers (`platform/auth/policies.ts`)

```ts
requireAuth(ctx): Actor                                   // signed in, not suspended; role may be null
requireRole(ctx, ...roles: Role[]): Actor                 // + role in the list and status 'active'
requireStaff(ctx): Actor                                  // admin or dispatcher, active
requireAdmin(ctx): Actor                                  // admin, active
requireCustomer(ctx): Actor                               // customer, active
requireSupplier(ctx): Actor & { storeId: string; storeRole: StoreRole }      // supplier, active, has a store
requireActiveDriver(ctx): Actor & { cityId: CityId; capacityClass: VehicleClass }   // driver, active, approved vehicle
requireOperator(ctx): Actor                               // staff, or an active driver
/** Staff pass. A supplier passes only for their own store (and only as owner when ownerOnly). Everyone else: permission-denied. */
requireStoreAccess(actor: Actor, storeId: string, opts?: { ownerOnly?: boolean }): void
/** The caller's store when they are a supplier (a different requested store → permission-denied); the requested store for staff. */
resolveStoreScope(actor: Actor, requested: string | undefined): string | undefined
isSelf(actor: Actor, uid: string): boolean
audienceKey(actor): string                                // `${cityId}:${capacityClass}`, from the database row
```

Messages keep the legacy wording: "Please sign in to continue." (`unauthenticated`), "This action is
only available to dispatch staff.", "Only administrators can do this.", "Sign in with a customer
account to do this.", "Your driver account is waiting for approval.", "You don't have permission to
do that."

Object checks answer `not-found` when the row does not exist and `permission-denied` when it exists
but is not the caller's. (Ids are UUID-based, so the difference leaks nothing useful, and the apps can
tell a deleted object from a wrong account.) The exceptions are `GET /tracking/{token}`,
`POST /auth/invites/inspect` and `GET /media/*`: always `not-found`.

### 7.2 Public endpoints (the complete list)

`GET /health`, `GET /config`, `GET /live` (public topics only until authenticated), `POST /auth/register`,
`POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/password/forgot`,
`POST /auth/password/reset`, `POST /auth/invites/inspect`, `POST /auth/password/setup`,
`GET /categories`, `GET /stores`, `GET /stores/{storeId}`, `GET /stores/{storeId}/reviews`,
`GET /stores/{storeId}/reviews/{storeOrderId}`, `GET /products` with `listed=true` or `ids`,
`GET /products/{productId}`, `GET /tracking/{token}`, `GET /media/*`,
`GET /files/local/{uploadId}` (signed URL), `POST /files/local/{uploadId}` (upload token),
`POST /call/geocodeAddress`, `POST /call/suggestStore`.

### 7.3 The role matrix of MARKETPLACE §6.2 as endpoint and object checks

R = read, W = write. "—" = denied.

| Collection (MARKETPLACE §6.2) | Endpoints | Public | Customer | Supplier of store S | Driver | Staff |
| --- | --- | --- | --- | --- | --- | --- |
| `users/{uid}` | `GET /me`, `PATCH /me`, `GET /users`, `GET /users/{uid}` | — | R own; W own 5 fields (`ProfilePatch`) | R own; W own `displayName`, `photoPath`, `preferences`; an **owner** lists the supplier users of S (`GET /users?role=supplier&storeId=S`) | R own; W own 3 fields | R all (`GET /users`) |
| `users/{uid}/jobsites` | `/me/jobsites`, `/me/buy-again` | — | R/W own, validated | — | — | — |
| `users/{uid}/cards`, `favorites` | `/me/cards`, `/me/favorites` | — | R/W own, validated | — | — | — |
| `users/{uid}/devices` | `/me/devices` | — | own | own | own | own |
| `carts/{uid}` (P1) | `/me/cart` | — | R/W own | — | — | — |
| `categories` | `/categories` | R | R | R | R | R; W |
| `stores` | `/stores`, `/stores/{id}` | R | R | R | R | R; W only through `createStore`, `updateStoreSettings`, `updateStoreProfile` |
| `stores/{id}/private` | `GET /stores/{id}/settings` | — | — | R if **owner** of S and `id = S` | — | R |
| `stores/{id}/reviews` | `/stores/{id}/reviews…` | R | R; create or update own after completion; delete own | R | R | R; delete |
| `products` | `/products…` | R | R | R; create and update for store S with locked fields; delete if **owner** and `reserved = 0` | R | R; W; delete only as admin |
| `orders` | `/orders…` | — | R own (`customer_id = uid`) | — (no endpoint returns an order to a supplier) | — | R |
| `storeOrders` | `/store-orders…` | — | get own (by id, or `?orderId=` of an own order); `proof` of an own store order | get and list where `store_id = S` | — | R |
| `storeOrders/{id}/private` | `GET /store-orders/{id}/private` | — | — | — | — | R |
| `deliveries` + events | `/deliveries…`, `/activity` | — | — | — | R where `driver_id = uid`, with its events and stats | R; limited update (`DeliveryPatch`); the activity feed |
| `deliveries/{id}/private` | `GET /deliveries/{id}/private` | — | — | — | — (never the hand-off code) | R |
| `jobOffers` | `/job-offers…` | — | — | — | R when active, the offer is `open` and `audienceKey(actor)` ∈ `audience` | R |
| `tracking` | `GET /tracking/{token}` | get | get | get | get | get |
| `routes` | `GET /routes/{driverId}` | — | — | — | R own | R |
| `driverLocations` | `/driver-locations…`, `POST /me/location` | — | — | — | R own; W own when active | R |
| `threads` + messages | `/threads…` | — | — | — | R own; post as `driver` when active; reset own unread | R all; post as `staff`; reset staff unread |
| `supportThreads` + messages | `/support-threads…` | — | R own (`threadId = uid`); post as `customer`; reset own unread | R `store_S`; post as `supplier`; reset own unread | — | R; post as `staff`; update status, assignee, unread |
| `quotes` | `/quotes…` | — | R own | — | — | R; limited update (`AssignPatch`) |
| `quotes/{id}/private` | `/quotes/{id}/workspace` | — | — | — | — | R/W |
| `issues` | `/issues…` | — | R own | R where `store_id = S` | — | R; limited update |
| `issues/{id}/private` | `/issues/{id}/notes` | — | — | — | — | R/W |
| `ledgerEntries`, `payouts` | `/ledger-entries`, `/ledger/balance`, `/payouts…` | — | — | R if **owner** and payee is store S | R own (payee is the driver) | R |
| `storeSuggestions` | `/store-suggestions…` | — (create only through `suggestStore`) | — | — | — | R; update `status` |
| `notifications` | `/notifications…` | — | R own; mark read; delete | same | same | same |
| `devOutbox` | `GET /dev-outbox` | — | — | — | — | R (sensitive rows: admin) |
| `counters`, `otpChallenges`, `rateLimits` | none | — | — | — | — | — |

Object checks, written once so every module uses the same predicate (`modules/*/access.ts` exports
them; routes never inline them):

| Predicate | True when |
| --- | --- |
| `canReadOrder(actor, order)` | staff, or `order.customerId === actor.uid` |
| `canReadStoreOrder(actor, so)` | staff, or `so.customerId === actor.uid`, or active supplier with `actor.storeId === so.storeId` |
| `canActOnStoreOrder(actor, so)` | staff, or active supplier with `actor.storeId === so.storeId` |
| `canReadDelivery(actor, d)` | staff, or driver with `d.driverId === actor.uid` |
| `canReadProof(actor, d)` | `canReadDelivery`, or `d.customerId === actor.uid` (used by `GET /store-orders/{id}/proof` and by `GET /files/url` for `proofs/…`) |
| `canSeeOffer(actor, offer)` | staff, or active driver and `offer.status === 'open'` and `offer.audience.includes(audienceKey(actor))` |
| `canReadQuote(actor, q)` | staff, or `q.customerId === actor.uid` |
| `canReadIssue(actor, i)` | staff, or `i.customerId === actor.uid`, or active supplier with `actor.storeId === i.storeId` |
| `canReadPayee(actor, type, id)` | staff; or `type = 'store'` and owner with `actor.storeId === id`; or `type = 'driver'` and `id === actor.uid` |
| `ownsSupportThread(actor, threadId)` | customer and `threadId === actor.uid`; or active supplier and `threadId === 'store_' + actor.storeId` |
| `canWriteProduct(actor, storeId)` | staff, or active supplier with `actor.storeId === storeId` |

### 7.4 Two rules that must hold everywhere

**A supplier of store A never sees store B.**

- The store of a supplier is `actor.storeId`, loaded from `users.store_id` on this request. No
  endpoint takes the caller's store from the body, the query or a header.
- List endpoints go through `resolveStoreScope` (the scoping rule of §5.3): a supplier's query is
  always `WHERE store_id = $actor.storeId`; asking for another store is a `permission-denied`, not an
  empty list.
- Every by-id read and every command loads the row first and applies the predicate of §7.3 to the
  row's own `storeId`.
- The places this applies: `GET /store-orders`, `GET /store-orders/{id}`, the four store-order
  commands, `GET /products` without `listed=true`, product `PUT`/`PATCH`/`DELETE` and `stock-adjust`,
  `GET /stores/{id}/settings`, `GET /users?role=supplier&storeId=`, `updateStoreProfile`,
  `inviteSupplierUser`, `setSupplierUserStatus`, `GET /issues`, `GET /issues/{id}`, ledger and payouts,
  the support thread `store_{id}`, presigned uploads for `store_photo` and `product_photo`,
  `GET /files/url` for issue photos, and the live topics `store:{id}:orders`, `store:{id}:issues`,
  `store:{id}:payouts`, `store-order:{id}`, `issue:{id}`, `support-thread:store_{id}`.
- A supplier never receives an `Order`, a `Delivery`, a private `meta`, another store's settings, a
  tracking token or a customer's pickup PIN: no endpoint with a supplier policy returns those shapes.
- `test/authorization/cross-store.authz.test.ts` calls every one of these as a supplier of store Y
  against objects of store X and expects `permission-denied` each time.

**The job-offer audience rule.**

- A driver sees an offer only when all of this is true at the time of the request: the driver's
  status is `active`; the offer's `status` is `open`; `"{users.city_id}:{users.capacity_class}"` is an
  element of the offer's `audience`.
- The key comes from the database row. A driver cannot ask for another city or class: `GET /job-offers`
  takes no audience parameter from drivers.
- `capacity_class` mirrors `doc.vehicle.capacityClass`, which changes only on approval
  (`setDriverStatus`) or vehicle review (`reviewDriverVehicle`), exactly like the old claim.
- `claimJob` checks the same rule again under lock, plus the draft-vehicle rule of MARKETPLACE §5.5.3.
- The offer document contains no customer name, phone or exact address by construction
  (`stageJobOffer` builds it from the delivery with a fixed field list; the drop-off is the area label
  and a pin rounded to 2 decimals). A fixture test asserts that the JSON of an offer contains none of
  the order's customer name, phone, address line or site contact.
- The live topic `job-offers:{cityId}:{capacityClass}` is granted only when the pair equals the
  caller's own.

---

## 8. Realtime

One WebSocket per client at `GET /api/v1/live`. The socket carries **invalidations**: "this thing
changed, fetch it again". It never replaces a REST read, so a client that misses events (offline,
reconnecting, socket blocked) loses nothing: it refetches. A few kinds of data also carry their
payload, because they change every few seconds or are appended to a list: tracking, driver
locations, chat and support messages, new notifications.

The frames and topic names below are the ones `packages/api-client` speaks (`docs/CLIENTS.md` §1.9,
§4.1). This section is their definition.

### 8.1 Protocol

Text frames, one JSON object per frame, field `type`.

**Client → server**

| Frame | Meaning |
| --- | --- |
| `{ "type": "auth", "token": "<access token>" }` | Authenticate the socket; sent again after every token refresh. Verified exactly like an HTTP request (§6.4). |
| `{ "type": "subscribe", "id": 7, "topics": ["order:6f1c…", "stores"] }` | At most 100 topics per frame, 300 per socket. `id` is the client's correlation number. |
| `{ "type": "unsubscribe", "topics": ["stores"] }` | No answer. |
| `{ "type": "ping" }` | Heartbeat. |

**Server → client**

| Frame | Meaning |
| --- | --- |
| `{ "type": "ready", "uid": "…" }` | Answer to `auth`. An anonymous socket never receives it and may subscribe to public topics without it. |
| `{ "type": "subscribed", "id": 7, "topics": ["stores"], "denied": [{ "topic": "order:6f1c…", "reason": "permission-denied" }] }` | Result per topic. `reason` is `unauthenticated`, `permission-denied` or `not-found` (unknown pattern, unknown tracking token). |
| `{ "type": "event", "topic": "order:6f1c…", "kind": "updated", "id": "6f1c…", "at": 1795109100000 }` | A change. `kind` is `created`, `updated`, `deleted` or `message`. `data` is present only where §8.2 says "payload". |
| `{ "type": "pong" }` | |
| `{ "type": "error", "status": "unauthenticated", "reason": "token_expired" }` | A frame was refused. The socket stays open unless a close follows. |

**Rules**

- **Anonymous sockets** are allowed, with or without an `Origin` header. Without `auth` a socket may
  subscribe to the public topics only; a private topic is answered in `denied` with
  `unauthenticated`. Signed-in clients send `auth`, wait for `ready`, then `subscribe`.
- **Token in a frame, never in the URL** (URLs end up in logs).
- **Re-authentication:** `auth` may be sent again at any time with a fresh token of the same user;
  another user → close 4403. At each `auth` the server re-evaluates every private subscription of
  the socket; for those it has to drop it sends one `subscribed` frame with `id: 0`, no topics and
  the dropped ones in `denied`.
- **Expiry:** a socket whose token expired more than 30 s ago without a new `auth` is closed with
  4401. An `auth` with a bad or expired token is answered with the `error` frame and close 4401.
- **Heartbeat:** the client sends `ping` every 25 s. The server closes a socket from which it has
  received no frame for **120 s** (browsers slow the timers of hidden tabs to one per minute). The
  server also sends WebSocket protocol pings every 30 s and terminates sockets that do not pong.
- **Limits:** 16 KiB per client frame; 10 sockets per user; 200 anonymous sockets per client address
  (`clientAddress()`, §4.6; carrier and office NATs put many guest apps and `/track` pages behind one
  address); 20 client frames per second per socket (more → close 1008). A client closed with 1008 waits
  5 minutes before it reconnects and polls meanwhile (`docs/CLIENTS.md` §1.9).
- **Close codes:** 4401 token expired or invalid (refresh, then reconnect at once) · 4403 session
  revoked or account suspended (the client checks its session through `GET /me`) · 1012 the server
  is restarting **or may have missed events** (reconnect with backoff; every query refetches after a
  reconnect) · 1008 too many frames or sockets · 1009 frame too large · 1011 internal error.
- **Ordering:** events of one transaction arrive in the order they were published, after the commit.
  Events are not replayed and carry no sequence number; clients treat an event as "refetch", which
  is idempotent, or apply a payload by id.

### 8.2 Topics

An event on a topic means "something this topic covers changed". Unless a row says **payload**, the
event carries no data.

**Public topics** (anyone, also without `auth`)

| Topic | Emitted when |
| --- | --- |
| `categories` | a category changes |
| `stores` | any store's public document changes (profile, status, pause, hours, rating) |
| `store:{storeId}` | that store's public document or its private settings change |
| `store:{storeId}:products` | a product of the store changes (price, stock, reserved, active, listing) |
| `product:{productId}` | that product changes |
| `tracking:{token}` | **payload**: the whole `PublicTracking` after each change (status, phase, driver position, ETA). The token must exist. |

**Private topics**

| Topic | May subscribe | Emitted when |
| --- | --- | --- |
| `user:{uid}` | that user | the account or profile changes (approval, suspension, phone verified, vehicle review, role, store, preferences) |
| `user:{uid}:notifications` | that user | **payload** on `kind: 'created'`: the `AppNotification`; `updated` when read flags change, `deleted` when one is removed |
| `user:{uid}:orders` | that customer | any of the customer's orders or store orders changes |
| `user:{uid}:quotes` · `user:{uid}:issues` | that customer | any of the customer's quotes · issues changes |
| `order:{orderId}` | its customer; staff | the order or one of its store orders changes |
| `store-order:{id}` | its customer; members of its store; staff | the store order changes, the driver summary included |
| `quote:{id}` | its customer; staff | the quote changes |
| `issue:{id}` | its customer; members of its store; staff | the issue changes |
| `support-thread:{threadId}` | the owner (the customer, or the active members of the store); staff | **payload** on `kind: 'message'`: the `SupportMessage`; `updated` when the summary, status, assignee or read flags change |
| `store:{storeId}:orders` | members of the store; staff | any store order of the store is created or changes |
| `store:{storeId}:issues` | members of the store; staff | an issue on the store is created or changes |
| `store:{storeId}:payouts` | the owner of the store; staff | a ledger entry or payout of the store is created or changes |
| `driver:{uid}:deliveries` | that driver; staff | a delivery is assigned to, changed for or taken from the driver |
| `driver:{uid}:route` | that driver; staff | the route plan was recomputed |
| `driver:{uid}:earnings` | that driver; staff | a ledger entry or payout of the driver is created or changes |
| `delivery:{id}` | the assigned driver; staff | the delivery changes or gets an event |
| `job-offers:{cityId}:{capacityClass}` | an active driver whose city and capacity class in the database are exactly these; staff | an offer whose audience contains this key opens, changes (ready at the store, boosted) or leaves the board |
| `thread:{driverId}` | that driver; staff | **payload** on `kind: 'message'`: the `ChatMessage`; `updated` for the summary and read flags |
| `driver-locations` | staff | **payload**: `WithId<DriverLocation>` (`id` is the driver's uid) on every accepted report |
| `ops:{area}` with area `orders`, `store-orders`, `deliveries`, `job-offers`, `quotes`, `issues`, `support-threads`, `threads`, `drivers`, `payouts`, `suggestions`, `outbox` | staff | anything in that area changes |

Subscriptions are authorized by `authorizeTopic(actor, topic)` with the predicates of §7.3 (a
per-object topic loads the row: `order:{id}` uses `canReadOrder`, `store-order:{id}`
`canReadStoreOrder`, `delivery:{id}` `canReadDelivery`, and so on), at subscribe time and again at
every re-authentication. A topic whose object does not exist is `not-found`. When an account is
suspended or a session revoked, the control message of §8.3 closes the sockets at once.

**Which change publishes what.** Commands and jobs never choose topics by hand. They call
`publishChange(tx, table, kind, row)`; `platform/live/topics.ts` owns this table, and every
repository function that writes one of these rows calls it, so a command cannot forget an event.

| Row written | Topics | Event `id` · payload |
| --- | --- | --- |
| `categories` | `categories` | category id |
| `stores` (`doc`, rating) | `stores`, `store:{id}` | store id |
| `stores` (`settings`) | `store:{id}` | store id |
| `products` | `store:{store_id}:products`, `product:{id}` | product id |
| `tracking` | `tracking:{token}` | token · the document |
| `users` | `user:{id}`; `ops:drivers` when the user is a driver | uid |
| `notifications` | `user:{user_id}:notifications` | notification id · the notification on `created` |
| `orders` | `order:{id}`, `user:{customer_id}:orders`, `ops:orders` | order id |
| `store_orders` | `store-order:{id}`, `order:{order_id}`, `user:{customer_id}:orders`, `store:{store_id}:orders`, `ops:store-orders` | store order id |
| `quotes` | `quote:{id}`, `user:{customer_id}:quotes`, `ops:quotes` | quote id |
| `issues` | `issue:{id}`, `user:{customer_id}:issues`, `store:{store_id}:issues`, `ops:issues` | issue id |
| `support_threads` | `support-thread:{id}`, `ops:support-threads` | thread id |
| `support_messages` | `support-thread:{thread_id}` (`kind: 'message'`), `ops:support-threads` (`updated`) | message id · the message on the thread topic |
| `chat_threads` | `thread:{driver_id}`, `ops:threads` | driver uid |
| `chat_messages` | `thread:{thread_id}` (`kind: 'message'`), `ops:threads` (`updated`) | message id · the message on the thread topic |
| `deliveries` | `delivery:{id}`, `driver:{driver_id}:deliveries` (also the previous driver when it changed), `ops:deliveries` | delivery id |
| `delivery_events` | `delivery:{delivery_id}`, `ops:deliveries` | delivery id |
| `routes` | `driver:{driver_id}:route` | driver uid |
| `job_offers` (insert, update, delete) | `job-offers:{key}` for every key of `audience` when the offer is or was `open`; `ops:job-offers` | delivery id |
| `ledger_entries`, `payouts` | `store:{payee_id}:payouts` or `driver:{payee_id}:earnings`; `ops:payouts` | entry or payout id |
| `driver_locations` | `driver-locations` | driver uid · the location |
| `store_suggestions` | `ops:suggestions` | suggestion id |
| `dev_outbox` | `ops:outbox` | message id |

Changes of `jobsites`, `cards`, `favorites`, `store_reviews` and a store's team publish nothing: only
their owner's own screens show them, and those refetch after their own write. A checkout of 100
lines publishes 100 product notifications in its transaction (each addresses two topics); they are
delivered together at commit.

### 8.3 Fan-out through `LISTEN/NOTIFY`

**Publishing.** `publish(tx, event)` runs `SELECT pg_notify('is_live', $1)` on the transaction's
connection. PostgreSQL delivers the notification only if and when the transaction commits, and keeps
the order within a transaction (§13). Outside a transaction (`POST /me/location`) `publishNow` uses
the pool. One notification can address several topics:

```json
{ "topics": ["store-order:…-A", "order:…", "user:8f…:orders", "store:kestrel-lumber:orders", "ops:store-orders"],
  "kind": "updated", "id": "…-A", "at": 1795109100000, "data": null }
```

`publish` serializes the event and checks its size. A payload over 7 500 bytes (the limit is 8 000)
is sent again without `data`; clients then refetch as for any invalidation. When different topics of
one change need different frames (a message is `message` with data on its thread topic and a plain
`updated` on the `ops:` topic), `publishChange` issues one notification per frame.

**Listening.** Every instance holds one dedicated `pg.Client` (not from the pool) that runs
`LISTEN is_live` and `LISTEN is_outbox`. For each `is_live` notification the hub looks up the sockets
subscribed to any of the topics and sends one `event` frame per matching topic. The connection uses
TCP keep-alive and a `SELECT 1` every 30 s. When it fails it reconnects with backoff (0.5 s to 10 s).
After a reconnect events may have been missed, so the hub **closes every socket with code 1012**:
clients reconnect and refetch, which is the behaviour they already have for a server restart.
`GET /api/v1/health` stays 200 while the listener reconnects (REST still works); the state is logged.

**Control messages** use the same channel and never reach clients:

```json
{ "ctl": "drop_user", "uid": "…" }        // suspension: close every socket of the user with 4403
{ "ctl": "drop_session", "sid": "…" }     // logout, reuse detection, password change: close that session's sockets with 4403
```

**Shutdown.** On SIGTERM the hub closes every socket with 1012 before the HTTP server stops.

**Cost.** One `NOTIFY` per changed row (two for messages). Driver locations are the busiest source:
one notification per accepted report (at most one per 2 s per online driver). `NOTIFY` serializes the
commit of notifying transactions on a short internal lock; at this scale (tens of writes per second)
that is not measurable.

### 8.4 What the server guarantees to a polling client

When the socket is down the client polls the same REST endpoints. Every screen of §5.5 can be kept
current that way, because no data exists only on the socket: every payload is a document that a REST
endpoint also returns (`GET /tracking/{token}`, `GET /driver-locations`, the message lists,
`GET /notifications`). The server is sized for one poll per screen every 5 s; the intervals
themselves are in `docs/CLIENTS.md` §4.1.

---

## 9. Transactions, projections, outbox and jobs

The rule of MARKETPLACE D7 becomes stricter and simpler: **every state change, every projection that
depends on it and every record of a side effect commit in one SQL transaction.** Nothing is "eventually
consistent" inside the database. Only work that needs the network leaves the transaction, as an outbox
row written in it.

```
command ─► plain reads, validation, gateway.authorize        (no transaction)
        ─► BEGIN
             lockGraph(...)                                   §3.6
             re-read and re-validate under lock
             write documents, stock, private columns
             projections: order aggregate, driver summary, tracking, job offers, ledger
             notifications (inbox rows)  +  outbox rows (push, SMS, email, payment, route)
             pg_notify (live events)
           COMMIT
        ─► answer;   worker: outbox handlers ─► network
```

### 9.1 Cross-module helpers (the successors of MARKETPLACE §5.2)

SQL transactions may read and write in any order, so the "stage helpers never read" rule is gone. A
helper that takes `tx` may read through it. Signatures are frozen; a module calls another module only
through these.

```ts
// platform
withTransaction<T>(deps, fn: (tx: Tx) => Promise<T>): Promise<T>
lockGraph(tx, seed: GraphSeed): Promise<LockedGraph>
lockRows<R>(tx, table, ids, mode?): Promise<R[]>
nextNumber(tx, counter: 'order' | 'quote' | 'issue'): Promise<number>
consumeRateLimit(deps, bucket: string, subject: string, max: number, windowSeconds: number): Promise<void>   // throws RATE_LIMITED
failCode(code: ErrorCode, message: string, details?: Record<string, unknown>): never
isRequestId(value: unknown): value is string                                   // UUIDv4
enqueue(tx, event: OutboxEventName, payload: object, opts?: { dedupeKey?: string; runAt?: number; maxAttempts?: number }): Promise<void>
publishChange(tx, table: LiveTable, kind: 'created' | 'updated' | 'deleted', row: object): Promise<void>   // §8.2
requireReadyFile(tx | pool, path: string, expect: { purpose: UploadPurpose; scopeId: string; uploadedBy?: string }): Promise<FileRow>

// commerce
loadCheckoutContext(deps, input: CheckoutContextInput): Promise<CheckoutContext>                // reads, outside the transaction
stageMarketplaceOrder(tx, plan: MarketplaceOrderPlan): Promise<StagedOrder>                     // placeOrder, acceptQuote, replacements
projectOrderAggregate(tx, graph: LockedGraph, orderId: string): Promise<Order>                  // was syncOrderAggregate
// payments
authorizeOrderPayment(deps, input: { orderId; amountCents; customerId; card }): Promise<{ intentRef: string; captureBefore: number }>   // journal + gateway, outside the transaction; throws CARD_DECLINED
voidOrderAuthorization(deps, orderId: string): Promise<void>                                    // only when orders/{orderId} does not exist
finalizeOrderPayment(deps, orderId: string, opts?: { deadline?: boolean }): Promise<void>       // the body of the payment.finalize handler
refundOrderPayment(deps, input: { orderId; storeOrderId; amountCents; reason; idempotencyKey; issueId: string | null }): Promise<{ ref: string }>   // the body of payment.refund

// stores
stageStoreOrderTransition(tx, graph, so: StoreOrder, to: StoreOrderStatus, actor: OrderActor,
  opts?: { adjustments?: LineAdjustment[]; reason?: string; note?: string; extra?: Partial<StoreOrder> }): Promise<StoreOrder>
stageStockReserve(tx, lines): Promise<void>
stageStockRelease(tx, lines, opts: { outOfStock: boolean }): Promise<void>
stageStockCommit(tx, lines): Promise<void>
stageStockReturn(tx, lines): Promise<void>
stagePickupCode(tx, storeOrderId: string, issuedTo: 'customer' | string): Promise<string>      // new 4-digit PIN, attempts reset
projectDriverOntoStoreOrder(tx, graph, delivery: Delivery): Promise<void>
applyStoreOrderEffects(tx, graph, before: StoreOrder | null, after: StoreOrder): Promise<void>  // was onStoreOrderWritten

// deliveries and jobs
stageMarketplaceDelivery(tx, input: MarketplaceDeliveryInput): Promise<{ deliveryId: string; trackingToken: string }>
stageDeliveryCancellation(tx, graph, delivery: Delivery, actor: EventActor, reason: string): Promise<Delivery>   // also deletes the offer
stageJobOffer(tx, delivery: Delivery, opts: { opensAt: number }): Promise<void>
deleteJobOffer(tx, deliveryId: string): Promise<void>
applyDeliveryEffects(tx, graph, before: Delivery | null, after: Delivery): Promise<void>        // was onDeliveryWritten
syncTracking(tx, delivery: Delivery): Promise<void>

// payouts and notifications
recordStoreOrderLedger(tx, orderId: string): Promise<void>
recordDeliveryLedger(tx, before: Delivery | null, after: Delivery): Promise<void>
recordClawback(tx, input: { issueId; payeeType; payeeId; amountCents; description }): Promise<void>
notify(tx, userId: string, input: NotificationInput): Promise<void>
notifyUsers(tx, userIds: readonly string[], input: NotificationInput): Promise<void>
notifyStaff(tx, input: NotificationInput, opts?: { adminsOnly?: boolean; exclude?: string | null }): Promise<void>
notifyStoreMembers(tx, storeId: string, input: NotificationInput, opts?: { ownersOnly?: boolean }): Promise<void>
notifyDrivers(tx, driverIds: readonly string[], input: NotificationInput): Promise<void>
```

`tx.now` is the command's clock value; helpers never call the clock themselves.

### 9.2 The flows of MARKETPLACE §5.5, as transactions

Each flow lists: what happens before the transaction, the rows `lockGraph` locks (in rank order), the
checks under lock, the writes, and what is enqueued. Checks and business rules are those of
MARKETPLACE; they are repeated here only where the platform changes how they are done.

#### 9.2.1 `placeOrder` (MARKETPLACE §5.5.1)

**Before the transaction**

1. `requireCustomer`. `PAYMENTS_MODE=disabled` → `PAYMENTS_DISABLED`. Validate the request (step 1 of
   MARKETPLACE §5.5.1).
2. Idempotency read: `SELECT customer_id FROM orders WHERE id = $checkoutId`. Found and mine → return
   the stored order's `PlaceOrderResponse`. Found and not mine → `already-exists`.
3. `loadCheckoutContext`: profile (`PHONE_VERIFICATION=required` and not verified → `PHONE_UNVERIFIED`),
   jobsite (own; pin inside `SERVICE_AREA` else `OUTSIDE_SERVICE_AREA`), card (own, future expiry),
   products, stores with their `settings`. `priceCheckout`; `resolveWindow` or `pickupReady`; every
   product `active && listed`; quantity ≤ available and ≤ `maxPerOrder` (`OUT_OF_STOCK`); `canPlace`
   (else the first blocker's code); total = `expectedTotalCents` (else `PRICE_CHANGED { pricing }`).
4. `authorizeOrderPayment` (R2):
   - `INSERT INTO payment_authorizations (order_id, …, status 'pending') ON CONFLICT (order_id) DO NOTHING`.
     An existing row of another customer → `already-exists`. Then, by the existing row's state (each change
     in its own short transaction with the journal row locked `FOR NO KEY UPDATE`):
     - `declined` or `voided` → reset to `pending` with `attempt + 1`, the new `amount_cents` and `card` (the
       customer fixed the cart and retries with the same `checkoutId`).
     - `void_pending` → wait for that void: run it now (the **void procedure** of §10.4 with the row's
       attempt), then reset as for `voided`.
     - `pending` or `authorized` with the same `amount_cents` and `card.cardId` as this request → reuse it
       (a retry of the same checkout; a concurrent call with the same `checkoutId` uses the same attempt and
       key and receives the same authorization).
     - `pending` or `authorized` with a different amount or card (an earlier attempt that ended in
       `PRICE_CHANGED`, `OUT_OF_STOCK` or a card change, whose void had failed) → void it synchronously with
       the void procedure, then reset to `pending` with `attempt + 1` and the new amount and card. A hold is
       therefore never reused for another amount or another card.
     - `attached` or `captured` → the order exists; step 2 already answered.
   - `gateway.authorize` with key `auth_{orderId}` (attempt 1) or `auth_{orderId}_r{attempt}`.
     Declined → journal `declined`, throw `CARD_DECLINED { reason }`; nothing else was written.
     Approved → journal `authorized` with `intent_ref`, `capture_before`.
   - A concurrent call with the same `checkoutId` sees the same journal row and attempt, uses the same
     key and receives the same authorization.

**Transaction**

| Step | Detail |
| --- | --- |
| Locks | `users(customer)` → `products(catalog lines, sorted)` |
| Re-check | `orders` by id again: if a concurrent call created it, write nothing and return it. Its authorization is the same one, so nothing is voided. |
| Re-validate | Stores are re-read (plain read). Products from the locked rows: `active`, `listed`, stock, `maxPerOrder`. Re-price with the locked profile's `stats.nonCancelledOrders` and `promoUses`: a concurrent first order has already committed, so this one sees `isFirstOrder = false` and fails `PRICE_CHANGED`. Re-resolve the window (`WINDOW_UNAVAILABLE { windows }`). |
| Number | `nextNumber(tx, 'order')` → `IS-{n}`, as the last read. |
| Inserts | `orders` (first, because of the foreign keys) · per store in letter order: `store_orders` (+ `meta`: `commissionBps`; pickup: `pickupCode` issued to `'customer'`), and for delivery `stageMarketplaceDelivery`: `deliveries` (+ `meta`: tracking token, hand-off code), `tracking`, `delivery_events` (`created`) |
| Updates | `products.reserved += quantity` · `users.doc`: `stats.nonCancelledOrders + 1`, `lastOrderAt`, `promoUses[code] + 1` · `jobsites.last_used_at` · the journal: `SELECT … FROM payment_authorizations WHERE order_id = $1 FOR NO KEY UPDATE` (rank 15, nothing references the table); it must be `authorized` with the attempt this call authorized, else `RetryTransaction` (a void is in flight, or another attempt replaced it); then `status = 'attached'` |
| Effects | `applyStoreOrderEffects(null, storeOrder)` per store order (store members `store_order_new`; SMS to `alertPhone` through `sms.send`, marker `meta.alertSmsSentAt`) · customer `order_placed` · staff `order_placed` (silent) |
| Enqueued | `push.send` per non-silent notification, `sms.send` per store alert |
| Live | through `publishChange` for every row written: the order, its store orders, deliveries and tracking documents, each product, the customer's `users` row, each notification (§8.2) |

**After the transaction.** Success → answer `PlaceOrderResponse`. Any failure → the void procedure of
§10.4 for this attempt (it voids only when no order exists and the journal is not `attached`); if the
void call itself fails the journal stays `void_pending` and `captureDuePayments` (4) voids it within 30
minutes. Then rethrow the original error.

**Why the races are safe.** Two checkouts of one customer queue on `users(customer)`. The second one
reads what the first committed: the same `checkoutId` → the order exists, nothing is written, nothing
is voided; another `checkoutId` → the first-order flag is gone, `PRICE_CHANGED`, its own authorization
is voided. Two customers buying the last units queue on the product rows; the second sees the new
`reserved` and fails `OUT_OF_STOCK`.

#### 9.2.2 Store-order actions: `acceptStoreOrder`, `updateStoreOrderStatus`, `rejectStoreOrder` (MARKETPLACE §2.1)

| Step | Detail |
| --- | --- |
| Before | Read the store order's keys (`store_id`, `order_id`, `customer_id`, `delivery_id`, line product ids). `canActOnStoreOrder`. |
| Locks | `users(customer, and the delivery's driver if any)` → `orders` → `store_orders(this one)` → `deliveries` → `job_offers` → `products(catalog lines)` |
| Checks | `expectedVersion` (`VERSION_CONFLICT { version }`); the shared table `canStoreOrderTransition(from, to, actor, ctx)`; adjustments per MARKETPLACE §2.1.1 (all lines to 0 becomes a reject or a store cancel with reason `out_of_stock`). |
| `accepted` | lines and `current = settleStoreOrder(…)`, `stageStockRelease` for the shorted units (clamp when `out_of_stock`); delivery: `offerOpensAt = max(now, targetPickupAt − 12 h)`, `offerStatus` `scheduled` or `open`, `stageJobOffer` (only while the delivery is `unassigned`; a delivery dispatch already assigned keeps its driver, `offerStatus: 'claimed'`). |
| `preparing` | status; from `ready`: `pickup.ready = false` on the delivery and the offer. |
| `ready` | adjustments; `pickup.readyAt = now`; delivery `pickup.ready = true`, `readyAt`; offer `pickup.ready = true`; pickup fulfilment: `holdUntil` (MARKETPLACE §4.5). |
| `rejected` / `cancelled` | `current` = all zero; `stageStockRelease` for every remaining unit; `stageDeliveryCancellation` (delivery `cancelled`, `offerStatus: 'withdrawn'`, offer deleted, event; a claimed driver gets cancellation pay when checked in or ≥ 15 min after acceptance, MARKETPLACE §3.9); `rejectReason`, `cancelReason`, `cancelledBy`. |
| Always | `version + 1`, history entry, `stageStoreOrderTransition`; `applyStoreOrderEffects`; `applyDeliveryEffects` when the delivery changed; `projectOrderAggregate`. |
| Enqueued | `push.send`; `payment.finalize` when the order settled (§9.2.12); `route.plan` for a driver who lost the job |

`escalateStoreOrders` (auto-reject) and `expirePickupHolds` run the same function with the `system`
actor (§9.5).

#### 9.2.3 `cancelOrder`

Locks: `users(customer, drivers of the target deliveries)` → `orders` → `store_orders(targets, sorted)`
→ `deliveries` → `job_offers` → `products`. Targets default to every store order of the order. Each
target that allows `→ cancelled` for a customer (`new`, `accepted`) goes through the reject/cancel row
of §9.2.2 with `cancelledBy: 'customer'`; the others are reported in `notCancellable`. None
cancellable → `failed-precondition`. One `projectOrderAggregate` at the end.

#### 9.2.4 `completePickup` (MARKETPLACE §5.5.2)

| Step | Detail |
| --- | --- |
| Locks | `users(customer, driver)` → `orders` → `store_orders` → `deliveries` → `products(catalog lines)` |
| Checks, in this order | access; `expectedVersion`; adjustments validated; status `ready`; delivery fulfilment: delivery `accepted` with a driver (`DRIVER_NOT_ASSIGNED`) and `meta.pickupCodeIssuedTo === delivery.driverId`; PIN, unless a staff `overrideReason`. |
| Wrong PIN | `meta.codeAttempts ≥ 5` → `CODE_LOCKED`. Otherwise the transaction writes **only** `meta.codeAttempts + 1` and commits; the handler then throws `CODE_INCORRECT { remaining }`. No version bump, no adjustment is saved. |
| Right PIN or override | adjustments applied; store order → `out_for_delivery` (delivery) or `picked_up` (pickup, `completedAt`); `pickup.collectedAt`, `collectedBy`; `meta.codeAttempts = 0`; delivery → `picked_up` with `pickedUpAt`, `pickup.collectedAt`, `payout.waitCents` (MARKETPLACE §3.10) and the event that names the store member (`actorRole: 'supplier'`) or the staff member and the reason; `stageStockCommit`. |
| Then | `applyDeliveryEffects`, `applyStoreOrderEffects`, `projectOrderAggregate`. Enqueued: `push.send`, `route.plan`. |

#### 9.2.5 `claimJob` (MARKETPLACE §5.5.3)

| Step | Detail |
| --- | --- |
| Before | Read the offer's and the delivery's keys. |
| Locks | `users(driver, customer)` → `orders` → `store_orders` → `deliveries` → `job_offers` |
| Checks | The delivery already belongs to the caller and is `accepted` → answer `{ deliveryId, status: 'accepted' }` (retry). Offer row exists and is `open`, delivery `unassigned` (else `OFFER_TAKEN`); audience key in `audience` (else `VEHICLE_TOO_SMALL`, or `permission-denied` for another city); draft vehicle fits while `vehicleReviewRequired`; fewer than `MAX_ACTIVE_JOBS_PER_DRIVER` active deliveries (`SELECT count(*) … WHERE driver_id = $1 AND status = ANY($2)`, stable because the driver row is locked); not released by this driver in the last 60 min (`RELEASED_RECENTLY`); target pickup within 2 h → location fresher than 10 min and `online` (`DRIVER_OFFLINE`). |
| Writes | delivery: `driverId`, `driverName`, `status: 'accepted'`, `assignedAt`, `acceptedAt`, `offerStatus: 'claimed'`, `pickup.pickupCode = stagePickupCode(tx, storeOrderId, uid)`; events `assigned` ("Claimed from the job board") and `status` with the driver as actor; `deleteJobOffer`. |
| Then | `applyDeliveryEffects`: `projectDriverOntoStoreOrder`, `projectOrderAggregate` (`driverFirstName`), `syncTracking`, store members notified. Enqueued: `push.send`, `route.plan`. |

Two drivers claiming at once queue on `users(customer)` and then on the delivery row. The second one
finds no offer and a delivery that is not `unassigned`: `OFFER_TAKEN`. Exactly one wins.

#### 9.2.6 `updateDeliveryStatus`, `completeDelivery`, `checkInAtStore` (MARKETPLACE §5.5.4 and §2.3)

| Step | Detail |
| --- | --- |
| Before | Read the delivery's keys. A driver moving to `in_transit`: read their other deliveries in `in_transit` or `arrived` (they will be parked). `completeDelivery` by a driver on a marketplace delivery: `requireReadyFile(photoPath, { purpose: 'proof', scopeId: deliveryId, uploadedBy: uid })`, else `PHOTO_REQUIRED`. |
| Locks | `users(driver(s), customer(s))` → `orders` → `store_orders` → `deliveries(target and parked, sorted)` → `job_offers` (release or decline) |
| Checks | after `lockGraph`, re-select the driver's deliveries in `in_transit` or `arrived`; if the set differs from the one read before, throw `RetryTransaction` (another device of the same driver moved a trip meanwhile); ownership (`canReadDelivery`); same status → answer without writing; `canTransition(from, to, actor, { requiresPickup })`; the marketplace restrictions on staff of MARKETPLACE §2.3; decline or release needs a reason from `DECLINE_REASONS`, failure one from `FAILURE_REASONS`; hand-off code when `requireCode` and the actor is a driver: 5 attempts in `deliveries.meta.codeAttempts` (`CODE_LOCKED`), a wrong code commits `codeAttempts + 1` alone and then throws `CODE_INCORRECT { remaining }`. |
| Writes | status and its timestamp field; `failed` → `failure`; `delivered` → `proof`; decline or release → driver fields cleared, `declinedBy`, `releasedBy[uid] = now`, `pickup.pickupCode = null`, then `stageJobOffer` with `opensAt = max(now, offerOpensAt)` or `offerStatus: 'held'` while the store order is still `new`; parked deliveries → `picked_up` with a `system` event; `checkInAtStore` → `pickup.arrivedAt = now` (once) and an event. |
| Coupling | `failed` → store order `failed`; `delivered` → store order `delivered` (`stageStoreOrderTransition` in the same transaction). |
| Then | `applyDeliveryEffects` for every changed delivery; `applyStoreOrderEffects` and `projectOrderAggregate` for every changed store order. Enqueued: `push.send`, `route.plan` per affected driver, `sms.send` (tracking link, once, at `in_transit`), `payment.finalize` on settlement. |

#### 9.2.7 `assignDelivery`

Locks: `users(new driver, previous driver, customer)` → `orders` → `store_orders` → `deliveries` →
`job_offers`. Checks: marketplace deliveries only in `unassigned`, `assigned` or `accepted` and not
collected; the driver is an active driver; `canCarry` unless `force` (`VEHICLE_TOO_SMALL`). Writes:
driver fields, `status: 'assigned'` (or `unassigned`), `offerStatus: 'claimed'`, `deleteJobOffer`,
`stagePickupCode` for the new driver; unassigning clears the PIN and re-creates the offer (MARKETPLACE §2.4).
Then `applyDeliveryEffects`.

#### 9.2.8 `resolveFailedDelivery`

Locks: `users(customer, driver)` → `orders` → `store_orders` → `deliveries` → `products`. Store order
must be `failed`. `reattempt`: delivery `failed → picked_up`, `attempts + 1`, optional new window;
store order `→ out_for_delivery`. `return_to_store`: delivery `→ cancelled`; store order `→ cancelled`;
`stageStockReturn` (`stock_on_hand += fulfilledQty`); `current` keeps the locked fees only when the
failure reason is site-caused and `refundDeliveryFee` is false, else it is void. Then the effects and
the aggregate.

#### 9.2.9 `setDriverStatus`, `reviewDriverVehicle`, `updateDriverVehicle`

One transaction on `users(driver)`: status, compliance flags, class override, `approvedBy/At` or
`suspendedReason`; on suspension the session work of §6.4. After it commits, a suspension releases
every uncollected marketplace delivery of the driver, **each in its own transaction** (the release
branch of §9.2.6 with a `system` event "Released: driver suspended"; the offer is re-created), and
sends staff one `system` notification that lists the deliveries already collected.

#### 9.2.10 Quotes (MARKETPLACE §5.5.6)

| Command | Locks | Notes |
| --- | --- | --- |
| `submitMaterialList` | none (insert) | Attachments are checked with `requireReadyFile` (purpose `quote_upload`, scope `requestId`, uploaded by the caller, ≤ 15 MB, allowed type) before the transaction; `name`, `contentType` and `sizeBytes` of each attachment are taken from the `files` row. Existing quote with this id: mine → same answer; not mine → `already-exists`. `nextNumber('quote')`, insert. A unique violation on the primary key (concurrent retry) → read and return. |
| `sendQuote` | `quotes` | Pricing and window resolution before the transaction. Under lock: status in `submitted, in_review, quoted, expired`; `expectedVersion` (`QUOTE_VERSION`). Writes the offer (version + 1), `offerValidUntil`, `offerHistory`, status `quoted`. Customer `quote_update`; `sms.send` when the contact preference is call or WhatsApp. |
| `acceptQuote` | `users(customer)` → `quotes` → `products` | Idempotent like `placeOrder` (D17): before anything, and again under lock, if an order with id `checkoutId` exists and is the caller's, or the quote is `accepted` with `orderId = checkoutId`, return that order's `PlaceOrderResponse`. An `accepted` quote with another `orderId` → `failed-precondition` "This quote was already accepted." (and this call's authorization, if any, goes through the void procedure). The client keeps `checkoutId` in screen state across retries (`docs/CLIENTS.md` §4.3). Otherwise the same shape as §9.2.1: journal and authorize before (with the journal rules of §9.2.1 step 4); under lock the quote must be `quoted`, the version must match, not past `offerValidUntil` (`QUOTE_EXPIRED`); re-price at the quoted unit prices; `stageMarketplaceOrder({ source: 'quote', quoteId })`; quote → `accepted` with `orderId`. |
| `closeQuote` | `quotes` | customer → `declined`, staff → `cancelled`; already there → `OkResponse`. |
| `reopenQuote` | `quotes` → `support_threads` | `quoted` or `expired` → `in_review`; posts the customer's message into the support thread with the quote as context. |

#### 9.2.11 Issues (MARKETPLACE §5.5.7)

| Command | Locks | Notes |
| --- | --- | --- |
| `reportIssue` | `users(customer)` → `issues` (insert) → `orders` → `store_orders` → `ledger_entries` | Photos checked with `requireReadyFile` (purpose `issue_photo`, scope `issueId`, uploaded by the caller). Existing issue with this id: mine → same answer. Under lock: window (`ISSUE_WINDOW_CLOSED`), lines. Insert; a unique violation on `issues_open_key` → `ISSUE_ALREADY_OPEN`. Store order `issueCount + 1`. `UPDATE ledger_entries SET held_for_issue_id = $1 WHERE store_order_id = $2 AND payee_type = 'store' AND payout_id IS NULL`. |
| `resolveIssue` | `users(customer)` → `issues` → `orders` → `store_orders` → `products` (replacement) → `ledger_entries` | Refund: `refundForLines`, capped by `current.totalCents − refundedByStoreOrder[id]` and by `capturedCents − refundedCents`, both reduced by refunds still pending in the outbox for this order; `REFUND_LIMIT` for dispatchers. Captured payment → enqueue `payment.refund` (key `refund_{issueId}`) and `recordClawback` per fault. Not captured → reduce the store order's `current` component-wise, and for a store at fault `storeValueCents`; a driver at fault still gets the clawback entry. Replacement: `stageMarketplaceOrder({ source: 'replacement', … })`, payment `not_required`. Always: resolution, status `resolved`, `UPDATE ledger_entries SET held_for_issue_id = NULL WHERE held_for_issue_id = $1`, notifications. |

#### 9.2.12 `projectOrderAggregate` (MARKETPLACE §5.5.5), called inside every transaction above

With `users(customer)` and the `orders` row locked: read all store orders of the order; rebuild
`storeOrders[]` (carrying `trackingToken` and `pickupCode` over from the stored summaries), `current`,
`status` (`orderStatusFromStoreOrders`), `statusAt`, `needsAttention`, `completedAt`. First time
`completed` → `users.doc.stats.completedOrders + 1`. Became `cancelled` while `countsTowardFirstOrder`
→ `stats.nonCancelledOrders − 1`, `promoUses[code] − 1`, flag false. Then, still in the transaction:

- every store order final and payment `authorized` → `enqueue('payment.finalize', { orderId, deadline: false }, { dedupeKey: 'payment.finalize:' + orderId })`;
- every store order final and payment `not_required` (a replacement order, §9.2.11) → `recordStoreOrderLedger(tx, orderId)`
  in this transaction: `sale_{storeOrderId}` (its `storeValueCents`; 0, and therefore skipped, when the original
  issue's `faultParty` is the store) and `commission_{storeOrderId}` as for a captured order (MARKETPLACE §3.9:
  "or a replacement store order settles"). The ids are deterministic, so a second call writes nothing;
- **automatic refund** (`checkAutomaticRefunds(tx, order)`), when the payment is `captured` or
  `partially_refunded`: per store order,
  `due = capturedByStoreOrder[id] − current.totalCents − adjustedByStoreOrder[id] − inFlight(id)`, where
  `inFlight(id)` = Σ `payload.amountCents` of `outbox` rows with `event = 'payment.refund'`,
  `status IN ('pending', 'processing')`, `payload->>'storeOrderId' = id` and an `idempotencyKey` starting
  with `refund_adj_` (index `outbox_refund_open_idx`). Only `due > 0` enqueues `payment.refund` for `due`
  with key `refund_adj_{storeOrderId}_v{version}`. Two store-order changes before the handler runs
  therefore refund once. The order row is locked, so no concurrent aggregate can compute the same `due`.

It recomputes from current rows every time, so calling it twice is harmless.

#### 9.2.13 The other writes

| Write | Locks | Same-transaction work |
| --- | --- | --- |
| `createStore`, `updateStoreSettings`, `updateStoreProfile` | `stores` → `products(of the store, sorted)` | fan-out of `store_name`, `store_status` (statement (h)); staff notified when a store pauses |
| product `PUT`, `PATCH`, `DELETE` | `stores` (`FOR SHARE`) → `categories` (`FOR SHARE`) → `products` | `search_terms = buildSearchTerms(name, [brand, sku, size, category name, …synonyms, familyKey])`, `store_name`, `store_status` (the old `onProductWritten`) |
| category `PUT` | `categories` → `products(of the category, sorted)` | recompute `search_terms` when name or synonyms changed |
| store review `PUT`, `DELETE` | `users(customer)` → `orders` → `store_orders` → `stores` | `rated`, rating sums |
| support and chat message `POST` | `support_threads` or `chat_threads` (the row is created with `INSERT … ON CONFLICT DO NOTHING` first) | the message (`ON CONFLICT (id) DO NOTHING`: a repeated `id` returns the stored message), summary, unread counter, notifications |
| `createDeliveries` | `users(pre-assigned driver)` first, when there is one | geocoding first; then batches of 80 deliveries per transaction: `nextNumber('order')` each, `stageNewDelivery`, tracking, events; `applyDeliveryEffects` for every new delivery (manual deliveries have no store order, so the projection onto a store order does nothing). The driver lock makes `TOO_MANY_JOBS` and "one trip in transit" hold |
| `boostJobPayout` (P1) | `lockGraph(tx, { deliveryIds: [id], withOffers: true })` | payout and offer updated; `applyDeliveryEffects`; drivers re-notified |
| `PATCH /deliveries/{deliveryId}` | `lockGraph(tx, { deliveryIds: [id], withOffers: true })` | the patch, an `edited` event, `applyDeliveryEffects` |
| `POST /me/location` | `driver_locations` (upsert) → `tracking` | §9.4 |

**Every writer of a delivery goes through `lockGraph`** (users → orders → store orders → deliveries →
offers), because `applyDeliveryEffects` may write the store order and the order. `projectDriverOntoStoreOrder`
writes the store order only when the projected driver object (name, phase, vehicle, ETA to store) differs
from the stored one, so offer-only changes never touch `store_orders`.

Inserting a new row is not a lock in the sense of §3.6: it can only wait for a concurrent insert of
the same key, and those are already serialized by the customer lock (same `checkoutId`) or handled as
a unique violation (same `requestId`, same `issueId`, same message id).

### 9.3 The outbox

**Table:** `outbox` (§3.2). **Enqueue:** `enqueue(tx, event, payload, opts)` runs statement (e) of
§3.5 in the business transaction. No transaction, no event: if the command rolls back, the side
effect never existed.

**Worker (`platform/outbox/worker.ts`)**, one loop per instance when `RUN_WORKER=true`:

1. Wake up every `OUTBOX_POLL_MS` (1 000) or at once on an `is_outbox` notification.
2. Claim up to `OUTBOX_BATCH` (20) due rows with statement (f): a short transaction that marks them
   `processing` with `locked_by = <instance id>` and commits. `SKIP LOCKED` lets two instances claim
   different rows without waiting.
3. Run the handlers, at most `OUTBOX_CONCURRENCY` (4) at a time, **outside any transaction**. A
   handler opens its own short transactions around its network calls.
4. Success → `status = 'done'`, `finished_at`; the payload of an event enqueued with
   `sensitive: true` is replaced by `{}`.
5. Failure → statement (m) of §3.5 with `last_error` (first 500 characters): `attempts < max_attempts` →
   back to `pending` with `run_at = now + backoff`, where `backoff = min(15 min, 5 s × 2^(attempts − 1))`
   with ±20 % jitter; otherwise `dead`, an `error` log line and one `system` notification to admins ("A
   background task failed: payment.finalize"), keyed by the event id. When a newer `pending` row with the
   same dedupe key exists, (m) finishes this row as `done` instead: the newer row redoes the work.
6. **Reaper**, once a minute: rows `processing` with `locked_at` older than 5 minutes are released with
   statement (m), **one row per statement** (the instance that claimed them died). A collision can never
   abort the reaper. This makes delivery **at least once**.
7. `drain()` repeats steps 2 to 5 until no due row is left. Tests, the seed and `runJobNow` call it.

**Handler contract**

```ts
type OutboxHandler<P> = (payload: P, ctx: { eventId: number; attempt: number; deps: Deps; now: number }) => Promise<void>;
registerHandler('push.send', handler);
```

A handler may run more than once for the same event (a crash after the network call, the reaper).
Every handler is written so that the second run changes nothing; the table says how.

| Event | Payload | Dedupe key (while pending) | Enqueued by | Handler | Why a second run is harmless | Max attempts |
| --- | --- | --- | --- | --- | --- | --- |
| `push.send` | `{ notificationId }` | `push:{notificationId}` | `notify()` for a notification that was inserted and is not silent | §10.2: preferences, devices, Expo send, tickets, result on the notification | It acts only while `push_status = 'pending'` and writes the final status with a conditional `UPDATE`; only a crash between the Expo call and that write can push twice | 5 |
| `sms.send` | `{ to, body, purpose, sensitive }` | given by the producer, or none | phone code, tracking link, store alert and reminder, quote SMS | §10.3: `SmsSender.send`, one `dev_outbox` row | SMS providers do not dedupe. Producers write their marker (`alertSmsSentAt`, `reminderSentAt`, `trackingLinkSentAt`, the challenge row) in the transaction that enqueues, so the event exists once; only a crash between the provider call and `done` can send twice | 5 |
| `mail.send` | `{ to, subject, text, html?, purpose, sensitive }` | none | reset code, invite | §10.3: `MailSender.send`, one `dev_outbox` row | Resend receives `Idempotency-Key: outbox-{eventId}` (kept 24 h); SMTP can duplicate after a crash | 5 |
| `payment.finalize` | `{ orderId, deadline }` | `payment.finalize:{orderId}` | `projectOrderAggregate` on settlement; `captureDuePayments` | §10.4 "Finalize" | driven by `payment.status`; gateway key `capture_{orderId}`; `capture_pending` reuses `pendingCaptureCents` | 12 |
| `payment.refund` | `{ orderId, storeOrderId, amountCents, reason, idempotencyKey, issueId }` | `payment.refund:{idempotencyKey}` | `resolveIssue`; `projectOrderAggregate` (automatic refund after a deadline capture) | §10.4 "Refund" | gateway key = `idempotencyKey`; the handler skips the bookkeeping when `payment.events` already holds that key | 12 |
| `payment.void` | `{ orderId }` | `payment.void:{orderId}` | finalize with amount 0; the orphan sweep | `gateway.void`, journal → `voided` | gateway key `void_…`; journal status | 12 |
| `payout.transfer` | `{ payoutId }` | `payout.transfer:{payoutId}` | `runDailyPayouts` | `gateway.transfer` (key `payout_{payoutId}`); payout → `paid` with the reference, payee `payout_sent`. A definite refusal → `failed`, `payout_id` cleared on its entries, staff alert | acts only while the payout is `pending`; gateway key | 12 |
| `route.plan` | `{ driverId }` | `route.plan:{driverId}` | `applyDeliveryEffects` when a driver's stops, their order inputs or their status change | §9.6: provider calls, `optimizeStops`, upsert `routes`, `syncTracking` for the driver's deliveries | recomputes from current rows; skipped when the input signature equals the stored one | 3 |
| `tracking.eta` | `{ deliveryId }` | `tracking.eta:{deliveryId}` | the location write, for a delivery in `in_transit`, when `eta_computed_at` is older than 60 s and a routing provider is configured | one provider call; writes `etaSeconds`, `distanceMeters`, `eta_computed_at` into `tracking` | recomputes | 2 |

A dedupe key coalesces only while a row with that key is `pending`. A change that arrives while a
`route.plan` is already `processing` therefore enqueues a new row and is not lost. That is also why a
`processing` row is never set back to `pending` with a plain `UPDATE` (statement (m)).

### 9.4 The triggers of MARKETPLACE §5.6

There are no triggers in the database and no background reactions to row changes. Each old trigger
became a function that the writers call inside their transaction, plus outbox events for the network.

| Old trigger | New home | Called by | Does (same content as MARKETPLACE §5.6) |
| --- | --- | --- | --- |
| `onStoreOrderWritten` | `store-orders/store-order-effects.ts` `applyStoreOrderEffects(tx, graph, before, after)` | every transaction that inserts or changes a store order (§9.2) | create → store members `store_order_new` and the SMS to `alertPhone` (once, `meta.alertSmsSentAt`); status change → customer message (§10.2) and store messages for a customer cancellation; driver summary change → store `store_order_update`; then the caller runs `projectOrderAggregate` |
| `onDeliveryWritten` | `deliveries/delivery-effects.ts` `applyDeliveryEffects(tx, graph, before, after)` | every transaction that inserts or changes a delivery | `projectDriverOntoStoreOrder` (phase mapping of MARKETPLACE §2.3; `driverSyncedAt = after.updatedAt`); `recordDeliveryLedger`; `syncTracking` (phase, pickup, deliver-by, timeline, hand-off code); driver and staff notifications (assigned, unassigned, declined, cancelled, failed, delivered, edited: the texts of the legacy `notifyChange`); customer heads-up at `arrived`; `sms.send` tracking link at `in_transit` (once, `meta.trackingLinkSentAt`, plus a `customer_notified` event); `route.plan` for the previous and the new driver when the driver, the status or a planning input changed |
| `onJobOfferWritten` | `jobs/offer-effects.ts` `notifyOfferOpened(tx, offer)` | `stageJobOffer` when it creates an `open` offer; `publishDueJobOffers` when it opens one | statement (i): up to 20 active, online drivers whose key is in `audience`; `job_offer` notification with key `offer-{deliveryId}-{openedAt}` |
| `onProductWritten` | `stores/product-derivation.ts` `deriveProductColumns(input, store, category)` | product `PUT` and `PATCH`; `seed --demo` | `search_terms`, `store_name`, `store_status`; `listed` and `imageUrl` need no code (generated column, serializer). No loop is possible: nothing reacts to the write |
| `onStoreWritten` | `stores/store-fanout.ts` `fanOutStore(tx, store)` | `createStore`, `updateStoreSettings`, `updateStoreProfile` | statement (h), one `UPDATE` instead of pages of 400 |
| `onStoreReviewWritten` | `stores/reviews.ts` | review `PUT`, `DELETE` | `UPDATE stores SET (rating_sum, rating_count) = (SELECT COALESCE(sum(rating), 0), count(*) FROM store_reviews WHERE store_id = $1)`; store order `rated = true` |
| `onSupportMessageCreated` | `support/messages.ts` `postSupportMessage(tx, …)` | `POST /support-threads/{threadId}/messages`, `reopenQuote` | thread created on the first message; `last_message` (140 characters), `unread_by_staff + 1` or `unread_by_owner + 1`, `context`; inbound → staff `support_message`; staff reply → the customer, or every active member of the store (`support_reply`); key `support-{messageId}` |
| `onChatMessageCreated` | `chat/messages.ts` `postChatMessage(tx, …)` | `POST /threads/{driverId}/messages` | thread summary, unread counter of the other side; driver → staff, staff → driver (`chat_message`); key `chat-{messageId}` |
| `onNotificationCreated` | `notifications/notify.ts` + the `push.send` handler | `notify()` | inbox row in the transaction; push through the outbox, with channels and preferences (§10.2) |
| `onDriverLocationWritten` | `tracking/location.ts` `reportLocation(deps, uid, report, now)` | `POST /me/location` | take the newest fix of the report (fixes older than the stored `updated_at` are ignored); upsert the row with `online` and `battery`; publish on `driver-locations`; when the driver moved ≥ 15 m or ≥ 20 s passed since `synced_at`, or `online` changed: update the `tracking` document of each delivery of the driver in `in_transit` or `arrived` (position, heading, estimated ETA from the class speed), publish `tracking:{token}`, set `synced_*`, and enqueue `tracking.eta` when due. `LocationAck.online` is false when the caller is not an active driver's session any more. P1: refresh `etaToStoreAt` for `accepted` jobs |
| `onDeviceWritten` | `account/devices.repository.ts` | `PUT /me/devices/{installationId}` | delete every other row with the same token in the same statement; `devices.app` is the session's `app` |
| `syncOrderFromDelivery` (legacy) | removed | — | replaced by the coupling of §9.2.6 and `projectOrderAggregate` |

**Field ownership of the `tracking` document.** Four writers touch `tracking.doc`; each owns its fields and
writes them with a partial update of the locked row, never by replacing the whole document from an earlier
read (`UPDATE tracking SET doc = doc || $patch::jsonb` for top-level fields, `jsonb_set(doc, '{driver,…}', …)`
for the nested driver fields, after `SELECT … FOR NO KEY UPDATE`):

| Writer | Owns |
| --- | --- |
| `syncTracking` (delivery transactions: `applyDeliveryEffects`) | `status`, `phase`, `timeline`, `pickup`, `deliverBy`, `handoffCode`, `driver.firstName`, `driver.vehicle`, and `driver = null` when the driver leaves |
| `reportLocation` (`POST /me/location`) | `driver.location`, `driver.heading`, `driver.updatedAt` (only while `driver` is not null), and the class-speed estimate of `etaSeconds`, `distanceMeters` |
| `route.plan` handler (`planRoute`) | `stopsBefore` |
| `tracking.eta` handler | `etaSeconds`, `distanceMeters` from the provider (and the private `eta_computed_at`). It shares these two fields with `reportLocation`; both compute them from the newest position, so whichever writes last is correct |

`planRoute` makes its provider calls with no transaction open, then writes in one short transaction: it
re-reads each delivery it planned on (`SELECT id, updated_at FROM deliveries WHERE id = ANY($1) FOR SHARE`)
and skips the `stopsBefore` patch, and the route upsert's signature, for any delivery whose `updated_at`
changed since the plan was computed (a newer `route.plan` is then already enqueued by that change). A
`tracking.eta` result for a delivery no longer `in_transit` is dropped. A delivered trip can therefore never
be shown "On the way" again.

### 9.5 Scheduled jobs (MARKETPLACE §5.7)

**Scheduler (`platform/scheduler/scheduler.ts`)**, one per instance when `RUN_SCHEDULER=true`:

- A timer ticks every 15 s. For every registered job whose `scheduler_state.next_run_at ≤ now`:
  check out one client, `pg_try_advisory_lock(hashtextextended('instasupply:job:' || name, 0))`
  (statement (l)). Not granted → another instance is running it; skip. Granted → read
  `next_run_at` again (the other instance may just have finished), and if it is still due: set
  `last_started_at`, run `job.run(now)`, write `last_finished_at`, `last_status`, `last_result` or
  `last_error`, and the next `next_run_at`; unlock; release the client. The lock is a session lock,
  so it disappears by itself if the process dies.
- Interval jobs: `next_run_at = now + interval`. The daily job: the next 21:00 America/Toronto after
  `now`, computed with the shared `fromLocal` (no `Intl`). A job that was due while the server was
  down runs once at the next tick.
- A job's first row is created at start-up with `next_run_at = now` (interval) or the next 21:00.
- A job body is `runX(deps, now): Promise<Record<string, number>>`. It selects candidate ids with the
  listed query (`LIMIT 200`, repeated until none is left), then handles **each row in its own
  transaction** with `lockGraph`, re-checking the condition under lock. A row that throws is logged
  and counted under `errors`; the others continue.

| Job | Every | Candidates | Per row (one transaction each) | Result keys |
| --- | --- | --- | --- | --- |
| `escalateStoreOrders` | 5 min | (1) `status = 'new' AND respond_by − 5 min ≤ now AND NOT reminder_sent`; (2) `status = 'new' AND respond_by ≤ now AND NOT accept_overdue`; (3) `status = 'new' AND respond_by + 20 min ≤ now` | (1) `reminderSentAt = now`; store members `store_order_reminder`; `sms.send` to `alertPhone`. (2) `acceptOverdue = true`; `projectOrderAggregate` (`needsAttention`); staff `store_order_late`. (3) the reject row of §9.2.2 with actor `system`, reason `no_response` | `reminded`, `overdue`, `rejected`, `errors` |
| `expirePickupHolds` | 30 min | `fulfilment = 'pickup' AND status = 'ready' AND hold_until ≤ now` | cancel row of §9.2.2, `cancelledBy: 'system'`; stock released; customer told they were not charged | `expired`, `errors` |
| `publishDueJobOffers` | 5 min | (1) `job_offers.status = 'scheduled' AND opens_at ≤ now`; (2) `status = 'open' AND opened_at ≤ now − 15 min AND NOT nudged` | (1) `lockGraph(tx, { deliveryIds: [id], withOffers: true })` (users → orders → store orders → deliveries → offers, §3.6); delivery no longer `unassigned` → delete the offer; else offer `open`, `openedAt = now`, delivery `offerStatus: 'open'`, `applyDeliveryEffects`, `notifyOfferOpened`. (2) `nudgedAt = now`; staff `job_unclaimed` | `opened`, `removed`, `nudged`, `errors` |
| `markStaleDriversOffline` | 5 min | `driver_locations.online AND updated_at < now − 10 min` | one `UPDATE … SET online = false`; publish on `driver-locations` per driver | `offline` |
| `expireQuotes` | 15 min | `quotes.status = 'quoted' AND offer_valid_until ≤ now` | lock the quote; still due → `expired`, `statusAt.expired` | `expired`, `errors` |
| `runDailyPayouts` | daily 21:00 Toronto | see below | see below | `payees`, `payouts`, `carriedOver`, `skippedNoAccount`, `resumed`, `errors` |
| `captureDuePayments` | 30 min | (1) orders `payment_status = 'capture_failed'`; (2) `capture_pending` with `updated_at < now − 10 min`; (3) `authorized` with `capture_deadline_at ≤ now`; (4) `payment_authorizations` in `pending`, `authorized` or `void_pending` with `updated_at < now − 15 min` and no order | (1), (2) enqueue `payment.finalize { deadline: false }`; (3) enqueue `payment.finalize { deadline: true }`; (4) enqueue `payment.void` (a `pending` row first repeats `authorize` with its key to learn the `intentRef`); the handler runs the void procedure of §10.4, which re-checks under the journal lock that no order exists | `retried`, `recovered`, `deadlineCaptured`, `orphansVoided` |

**`runDailyPayouts(now)`** (MARKETPLACE §3.9), `runKey` = `YYYYMMDD-HHMM` of `now` in Toronto:

1. **Resume:** for every payout with `status = 'pending'`, enqueue `payout.transfer` (the dedupe key
   and the gateway key make this safe).
2. **Payees:** `SELECT DISTINCT payee_type, payee_id FROM ledger_entries WHERE payout_id IS NULL AND
   held_for_issue_id IS NULL AND created_at ≤ $now`.
3. **Per payee, one transaction:** lock its unpaid, not held entries created up to `now`
   (`ORDER BY id FOR NO KEY UPDATE`); sum them. Net ≤ 0 → nothing is written, the entries carry over.
   In `stripe` mode a payee without a payout account carries over and is counted in
   `skippedNoAccount` (staff get one `system` notification per run). Net > 0 → insert the payout
   `{payeeType}_{payeeId}_{runKey}` as `pending` with its `entry_ids` (`ON CONFLICT (id) DO NOTHING`:
   a rerun with the same `now` creates nothing), stamp `payout_id` on those entries, enqueue
   `payout.transfer`.
4. The transfer, the `paid` mark and the payee's notification happen in the handler (§9.3).

Payout creation and the stamping of its entries are one transaction, so the state "payout created,
entries not stamped" of the Firestore design cannot occur; the resume step covers a crash before the
transfer returned.

**Internal jobs** (not in `ScheduledJobName`, not callable through `runJobNow`):

| Job | Every | Does |
| --- | --- | --- |
| `purgeExpiredRows` | 1 hour | Deletes: `rate_limits`, `geocode_cache`, `dev_outbox` past `expires_at` (7 days); `otp_challenges` expired for a day; `auth_tokens` used or expired for 7 days; `sessions` ended (revoked or expired) 30 days ago, with their `refresh_tokens` (cascade; refresh tokens of a live session are never deleted, §6.3.5); `outbox` rows `done` for 7 days and `dead` for 30 days; `push_tickets` older than 24 hours; `files` still `pending` after 24 hours (the stored object first, then the row). This replaces the Firestore TTL policies. |
| `checkPushReceipts` | 15 min | §10.2 |

**`runJobNow`** (admin, `ALLOW_TEST_JOBS=true`): `{ job, now? }`. Takes the job's advisory lock by
polling `pg_try_advisory_lock` every 500 ms for at most 60 s on one dedicated client (the pool's
`statement_timeout` of 15 s would cancel a blocking `pg_advisory_lock`); no lock after 60 s →
`unavailable` with `details.retryAfterMs: 5000`. Then it runs `runX(deps, now ?? clock.now())`, records the
run in `scheduler_state` without moving `next_run_at`, calls `outbox.drain()`, and answers
`{ job, now, result }`. `now` only changes what the job sees; documents written by the job carry that
`now`.

### 9.6 Routing and geocoding (ports of `legacy/…/routing` and `…/geocoding`)

| Piece | Rule |
| --- | --- |
| `planRoute(deps, driverId, opts)` | Reads (no transaction) the driver's deliveries in `ACTIVE_STATUSES` with their `updated_at`, the live position and the profile; builds stops per MARKETPLACE §5.11 (an uncollected marketplace delivery has a pickup stop `{deliveryId}:pickup` and a drop-off stop with `after`); speed from `VEHICLE_CLASSES[capacityClass].speedKmh`; `getTravelMatrix`; `optimizeStops` with `lockedFirstId`; `getRoutePolyline`; then, in one short transaction, the staleness check and field ownership of §9.4: upserts `routes` (`doc`, `signature`, `computed_at`) and patches `stopsBefore` on the tracking document of each unchanged delivery (it never calls `syncTracking` and never writes status or phase). Runs in the `route.plan` handler and in `optimizeRoute`. No transaction is open during provider calls. |
| Routing provider | `ROUTING_PROVIDER=auto`: Google Routes when `GOOGLE_MAPS_API_KEY` is set, else OSRM at `OSRM_URL`, else the estimate. `google`, `osrm`, `estimate` force one. Any provider error falls back to `buildEstimateMatrix`. OSRM calls take a slot from the `provider_osrm` limit (1 per second for all instances together) and send `User-Agent: GEO_USER_AGENT`; no slot → the estimate. Limits kept from the legacy code: Google 625 matrix elements and 25 intermediates, OSRM 100 points, 8 s timeout. |
| Live ETA | Estimate from the class speed on every location sync. A provider call (`tracking.eta`) at most once per 60 s per delivery. |
| `geocode(query, near)` | `GEOCODER=auto`: Google when the key is set, else Nominatim at `NOMINATIM_URL`; `none` returns nothing. GTA bias as MARKETPLACE §5.4: Google `components=country:CA` and `SERVICE_AREA` bounds; Nominatim `countrycodes=ca`, `viewbox` = `SERVICE_AREA`, `bounded=1`, `addressdetails=1`. Results are enriched with `line1`, `city`, `postalCode`, `cityId` (the municipality when it is one of the 15, else `nearestCity`) and `areaLabel`. |
| Geocode cache | `geocode_cache`, key = SHA-256 of provider, lower-cased trimmed query and the bias point rounded to 2 decimals; kept 30 days. A hit costs no provider call and no limit slot. |
| Nominatim policy | At most 1 request per second for all instances together (`provider_nominatim`, waiting up to 3 s for a slot), an identifying `User-Agent`, results cached, and no autocomplete: the apps search on submit only (MARKETPLACE §5.4). |
| `geocodeAddress` command | `query` ≥ 3 characters, cut to 300; non-staff callers consume the `geocode` limit (30 per hour per uid, or per address for guests). |

---

## 10. Files, notifications and push, SMS and email, payments

### 10.1 Files

**Interface (`platform/storage/storage.ts`)**

```ts
export interface Storage {
  readonly driver: 'local' | 's3';
  /** A form the client POSTs the file to. The driver enforces the exact key, the content type and the size. */
  createUpload(input: { uploadId: string; path: string; contentType: string; maxBytes: number; expiresInSeconds: number }):
    Promise<{ url: string; fields: Record<string, string> }>;
  /** Metadata of a stored object, or null when it does not exist. */
  head(path: string): Promise<{ sizeBytes: number; contentType: string } | null>;
  /** The first `bytes` bytes, for the magic-number check. */
  readStart(path: string, bytes: number): Promise<Buffer>;
  /** A URL that serves the object without further credentials until it expires. */
  signedUrl(input: { uploadId: string; path: string; expiresInSeconds: number; stable?: boolean;
    disposition?: 'inline' | 'attachment'; fileName?: string }): Promise<string>;
  /** Server-side copy inside the store (S3 CopyObject; a rename on disk for the local driver). */
  copy(fromKey: string, toKey: string): Promise<void>;
  /** Server-side write (seed, tests). */
  put(path: string, body: Buffer, contentType: string): Promise<void>;
  delete(path: string): Promise<void>;
  /** `storage-cors` CLI command. A no-op for the local driver. */
  setCors(origins: string[]): Promise<void>;
}
```

| | `local` driver (development, tests) | `s3` driver (production: the Railway bucket) |
| --- | --- | --- |
| Where | files under `STORAGE_LOCAL_DIR` (`backend/.data/files`), same relative paths | bucket `S3_BUCKET` at `S3_ENDPOINT`, virtual-hosted style unless `S3_FORCE_PATH_STYLE=true` |
| `createUpload` | `url = publicOrigin(req)/api/v1/files/local/{uploadId}` (§11.1), `fields = { token }`, token = expiry + `hmacHex('upload', uploadId + ':' + expiry)` | `createPresignedPost` with conditions: the bucket, `["eq", "$key", uploadKey]` (`uploads/{uploadId}`, never the final path), `["eq", "$Content-Type", contentType]`, `["content-length-range", 1, maxBytes]`; `Expires` 600 s |
| Upload target | `POST /files/local/{uploadId}` (`@fastify/multipart`, one file, `fileSize` limit = `max_bytes`, content type must equal the declared one) writes the file | the bucket itself; the API never sees the bytes |
| `signedUrl` | `API_URL/api/v1/files/local/{uploadId}?exp=…&sig=hmacHex('file', uploadId + ':' + exp)` | `getSignedUrl(GetObjectCommand)`; with `stable: true` the signing date is the start of the current UTC day and the lifetime 2 days, so every request that day yields the same URL and caches hit |
| CORS | the API's own CORS | the bucket needs a CORS rule: origins = `CORS_ORIGINS`, methods `POST` and `PUT`, all headers, `MaxAgeSeconds` 3000. `node dist/cli.js storage-cors` sets it (`setCors`). |

Both drivers answer the same `PresignedUpload` (`method: 'POST'`, `headers: {}`), so the client has
one upload path. Railway buckets are private; public buckets do not exist (§13). Everything is
therefore served through signed URLs.

**Purposes (`platform/storage/purposes.ts`)**. The path prefixes are those of MARKETPLACE §6.4. The
file name is chosen by the server: `<uuid>.<extension of the content type>`. A path can therefore not
be overwritten, and "no update, no delete" of the old rules holds by construction. In
`PresignRequest`, `ownerId` is the scope the file belongs to (stored as `files.scope_id`); the
uploader is always the caller (`files.uploaded_by`).

| Purpose | `ownerId` → path | May presign | Size · types | May read | Public |
| --- | --- | --- | --- | --- | --- |
| `proof` | deliveryId → `proofs/{deliveryId}/{file}` | the active driver assigned to that delivery | 10 MB · images | staff; the assigned driver; the customer of the delivery (`GET /store-orders/{id}/proof`, or `GET /files/url`) | no |
| `quote_upload` | requestId → `quoteUploads/{uid}/{requestId}/{file}` | a customer (the uid in the path is the caller's) | 15 MB · images, `application/pdf`, `text/csv`, `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | staff; the uploader | no |
| `issue_photo` | issueId → `issuePhotos/{issueId}/{file}` | a customer, when the issue does not exist yet or is theirs | 10 MB · images | staff; the uploader; members of the issue's store | no |
| `store_photo` | storeId → `storePhotos/{storeId}/{file}` | staff; the owner of that store | 5 MB · images | everyone | yes |
| `product_photo` | storeId → `productPhotos/{storeId}/{file}` | staff; members of that store | 5 MB · images | everyone | yes |
| `avatar` | the caller's uid → `avatars/{uid}/{file}` | the user | 5 MB · images | everyone who has the URL (see §14, question 6) | yes |

"Images" means `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`. SVG is not accepted
(it can carry script). Uploads per scope are capped: 5 proofs per delivery, 10 files per quote
request (a material list takes at most 5), 12 per issue (an issue takes at most 6), 20 store photos
and 300 product photos per store per day, 5 avatars per day. The sizes, types and caps are one constant,
`UPLOAD_LIMITS`, in `packages/shared/src/constants.ts` (§16); `POST /files/presign` enforces the caps with
a count on `files` by `(purpose, scope_id)` (index `files_scope_idx`) and the client re-exports the
constant for its form checks.

**Flow**

1. `POST /files/presign` → policy of the purpose, `file_ticket` limit, the scope cap of
   `UPLOAD_LIMITS`, declared size ≤ the purpose's maximum, content type allowed → insert `files`
   (`status = 'pending'`, `upload_key = 'uploads/' + uploadId`, `path` = the final path) →
   `PresignedUpload` (its `path` is the final path; it becomes usable after confirm).
2. The client POSTs the form to `url` (multipart: every entry of `fields`, then the file as the last
   part, named `file`). No `Authorization` header goes to storage.
3. `POST /files/confirm { uploadId }` (uploader only): `storage.head(uploadKey)` must exist, be no
   larger than `max_bytes` and have the declared content type; for images the first 32 bytes must be a
   JPEG, PNG, WebP or HEIC/HEIF signature. A failing object is deleted and the call fails
   `invalid-argument`. Success → `storage.copy(uploadKey, path)` to the final path, which no form can
   write; `head(path)` checks the copy's size; `storage.delete(uploadKey)`; `status = 'ready'`, real
   `size_bytes`, `completed_at`. The answer is `UploadedFile` with the original file name. A second call
   returns the same answer. Posting the still-valid form again afterwards can only rewrite
   `uploads/{uploadId}`, which nothing reads, so a confirmed file can never be replaced. The pending
   purge of §9.5 deletes left-over upload keys.
4. The path is then used in a command or write: `completeDelivery.photoPath`,
   `submitMaterialList.attachments[].path`, `reportIssue.photoPaths[]`, `updateStoreProfile.patch.photoPath`,
   `ProductInput.imagePath`, `ProfilePatch.photoPath`. Each of them calls `requireReadyFile`, which
   replaces the "exists in Storage, right size, right type, right owner" checks of MARKETPLACE §5.4
   and §5.5 with one indexed read of `files`.

**Reading**

- Private files: `GET /files/url?path=…` checks the purpose's read rule against the `files` row and
  the related object (delivery, issue) and answers a URL valid for `FILE_URL_TTL_SECONDS` (300).
  Documents are sent with `Content-Disposition: attachment`; images and PDFs inline.
  `GET /store-orders/{id}/proof` is the same check for the customer, starting from the store order.
- Public files: `imageUrl`, `photoUrl` and `photoURL` in API documents are
  `publicOrigin/api/v1/media/<path>` (§11.1), usable without a header. `GET /media/*` looks the path up in `files`
  (ready, public purpose) and answers 302 to a stable signed URL (`s3`) or streams the file
  (`local`), with `Cache-Control: public, max-age=3600`. The URL in a document never expires, which
  matters because order lines keep a copy of `imageUrl`.
- Files served by the API itself (`local`) carry `X-Content-Type-Options: nosniff` and
  `Content-Security-Policy: default-src 'none'; sandbox`.

Retention of proof photos, issue photos and quote uploads is MARKETPLACE §15 question 13; nothing
deletes ready files today.

### 10.2 Notifications and push

**Inbox.** A notification is a row of `notifications`. `notify(tx, userId, input)` inserts it in the
caller's transaction with statement (g):

```ts
export interface NotificationInput {
  type: NotificationType;
  title: string;                       // cut to 120
  body: string;                        // cut to 500
  data?: Record<string, string>;       // deep-link keys: customerOrderId, storeOrderId, deliveryId, quoteId, issueId, threadId, payoutId,
                                       // driverId (admin `driver_signup` and `vehicle_review`: the subject driver)
  silent?: boolean;                    // inbox only, push_status 'skipped'
  key?: string;                        // dedupe key; a second insert with the same key for the same user does nothing
}
```

When the row was inserted, `notify` publishes it on `user:{uid}:notifications` (`kind: 'created'`,
with the notification as payload) and, unless it is silent, enqueues `push.send`. `notifyStaff` reads active staff from `users` (index 35) inside the
transaction; `notifyStoreMembers` reads active suppliers of the store (index 37);
`notifyDrivers` takes ids.

**Keys.** There are no trigger event ids any more. A key is built from what happened:
`<what>-<entity id>-<state marker>`. The table fixes them so that a retried command or job cannot
notify twice.

| Recipient | When (MARKETPLACE §5.8) | Type | Key |
| --- | --- | --- | --- |
| Customer | order placed | `order_placed` | `order-placed-{orderId}` |
| Customer | store accepted (with shortage text), preparing, out for delivery, delivered, picked up, failed, rejected or cancelled by the store, hold expired | `order_store_update`; `order_delivered` for delivered; `order_cancelled` when the whole order ends cancelled | `so-{storeOrderId}-{status}-v{version}` |
| Customer | pickup ready (with the PIN and hold-until) | `pickup_ready` | `so-ready-{storeOrderId}-v{version}` |
| Customer | driver arrived | `order_update` | `dl-arrived-{deliveryId}-{attempts}` |
| Customer | order complete and charged | `order_update` | `order-complete-{orderId}` |
| Customer | refund issued | `refund_issued` | `refund-{idempotencyKey}` |
| Customer | quote ready; quote closed by staff | `quote_update` | `quote-sent-{quoteId}-v{version}`; `quote-closed-{quoteId}` |
| Customer | issue resolved | `issue_update` | `issue-resolved-{issueId}` |
| Customer or store members | staff replied in support | `support_reply` | `support-{messageId}` |
| Store members | new order (+ SMS) | `store_order_new` | `so-new-{storeOrderId}` |
| Store members | reminder (+ SMS) | `store_order_reminder` | `so-reminder-{storeOrderId}` |
| Store members | customer cancelled; driver heading to the store; driver at the counter | `store_order_update` | `so-cancelled-{storeOrderId}`; `so-driver-{storeOrderId}-{driverId}`; `so-checkin-{deliveryId}-{driverId}` |
| Store members | issue reported; resolved with the store at fault | `store_issue` | `issue-store-{issueId}`; `issue-store-resolved-{issueId}` |
| Store owners | payout sent | `payout_sent` | `payout-{payoutId}` |
| Drivers (online, fitting, ≤ 20) | offer opened | `job_offer` | `offer-{deliveryId}-{openedAt}` |
| Driver | store marked the order ready; job cancelled or withdrawn | `job_update` | `job-ready-{deliveryId}-v{version}`; `job-cancelled-{deliveryId}` |
| Driver | assigned by dispatch; removed; delivery cancelled; details edited | `delivery_assigned`, `delivery_unassigned`, `delivery_cancelled`, `delivery_updated` | `dl-{type}-{deliveryId}-{updatedAt}` |
| Driver | payout sent; vehicle reviewed; account approved | `payout_sent`, `vehicle_review`, `account_approved` | `payout-{payoutId}`; `vehicle-{uid}-{now}`; `approved-{uid}-{approvedAt}` |
| Staff | store order late | `store_order_late` | `so-late-{storeOrderId}` |
| Staff | job unclaimed | `job_unclaimed` | `offer-unclaimed-{deliveryId}-{openedAt}` |
| Staff | delivery failed, declined, delivered (silent) | `delivery_failed`, `delivery_declined`, `delivery_delivered` | `dl-{type}-{deliveryId}-{attempts}-{updatedAt}` |
| Staff | capture failed | `capture_failed` | `capture-failed-{orderId}-{attempt}` |
| Staff | new quote, reopened quote | `quote_new` | `quote-new-{quoteId}`; `quote-reopened-{quoteId}-{now}` |
| Staff | new issue | `issue_new` | `issue-new-{issueId}` |
| Staff | support message from a customer or a store; chat message from a driver | `support_message`; `chat_message` | `support-{messageId}`; `chat-{messageId}` |
| Staff | store suggestion (silent); order placed (silent) | `store_suggestion`; `order_placed` | `suggestion-{id}`; `order-placed-staff-{orderId}` |
| Admins | driver signed up; vehicle change to review (data `driverId`) | `driver_signup`; `vehicle_review` | `signup-{uid}`; `vehicle-draft-{uid}-{now}` |
| Staff | store paused; payee skipped for a missing payout account; payout failed; driver suspended with loads on board; outbox event dead | `system` | `store-paused-{storeId}-{now}`; `payout-skipped-{runKey}`; `payout-failed-{payoutId}`; `suspended-{uid}-{now}`; `outbox-dead-{eventId}` |
| Driver from dispatch | chat message | `chat_message` | `chat-{messageId}` |

The texts are those of MARKETPLACE §5.8 and of the legacy `notifyChange`; money is formatted with
`formatMoney`, times with the Toronto helpers.

**Channels and preferences (`platform/push/channels.ts`)**, unchanged rules of MARKETPLACE §5.8:

```ts
channelFor(type): 'jobs' | 'assignments' | 'orders' | 'store' | 'chat' | 'updates'
//  jobs: job_*            assignments: delivery_assigned | delivery_unassigned | delivery_cancelled
//  orders: order_* | pickup_ready | refund_issued | quote_update | issue_update
//  store: store_order_* | store_issue          chat: chat_message | support_*          updates: everything else
pushAllowed(type, role, preferences): boolean
//  jobPush gates channel 'jobs' · storeOrderPush gates 'store' · orderPush gates 'orders' · chatPush gates 'chat'
//  deliveryPush gates delivery_* for non-drivers · a missing preference means true · promoPush is opt-in (false by default)
```

**The `push.send` handler**

1. Read the notification. Stop unless `push_status = 'pending'` (an earlier run already finished).
2. `pushAllowed` false → `skipped`. No row in `devices` → `no_devices`. `PUSH_ENABLED=false` (tests)
   → `skipped`.
3. Build one Expo message per device: `to`, `title`, `body`, `sound: 'default'`, `priority: 'high'`,
   `channelId: channelFor(type)`, `data = { ...data, notificationId, type, userId }` (the app ignores
   a tap on a push that was meant for another account on the same phone).
4. Group the messages **by `devices.app`** (the customer app and the driver app are different Expo
   projects, and one request must not mix projects), chunk by 100, and `POST
   https://exp.host/--/api/v2/push/send` with `Authorization: Bearer EXPO_ACCESS_TOKEN` when it is set.
   HTTP 429 and 5xx are thrown (the outbox retries with backoff).
5. Per ticket: `ok` → count it, insert `push_tickets (ticket_id, notification_id, user_id, token,
   check_after = now + 15 min)`; `error` with `details.error = 'DeviceNotRegistered'` → delete that
   `devices` row; any other error → count a failure.
6. `UPDATE notifications SET push_status = $2, push_success = $3, push_failure = $4, push_sent_at = $5
   WHERE id = $1 AND push_status = 'pending'` (`sent`, `partial` or `failed`).

**`checkPushReceipts`** (every 15 minutes): take tickets with `check_after ≤ now` in chunks of 1 000,
`POST https://exp.host/--/api/v2/push/getReceipts { ids }`. `DeviceNotRegistered` → delete the
`devices` row with that token. `MessageTooBig`, `MessageRateExceeded`, `MismatchSenderId`,
`InvalidCredentials` → one `error` log line each (they are configuration problems, §13). Processed
tickets are deleted; tickets older than 24 hours are deleted unread (Expo keeps receipts for a day).

Only `provider: 'expo'` tokens are accepted. An Android build without `google-services.json` cannot
obtain a token; the app then never calls `PUT /me/devices/…` and its notifications end as
`no_devices`. Nothing on the server depends on Firebase.

`sendTestNotification` inserts a `test` notification for the caller and answers the number of
`devices` rows.

### 10.3 SMS and email

```ts
// platform/sms/sms.ts
export interface SmsSender { readonly driver: 'outbox' | 'twilio';
  send(message: { to: string; body: string }): Promise<{ providerRef: string | null }> }
// platform/mail/mail.ts
export interface MailSender { readonly driver: 'outbox' | 'resend' | 'smtp';
  send(message: { to: string; subject: string; text: string; html?: string; idempotencyKey: string }): Promise<{ providerRef: string | null }> }
```

| Driver | Selected by | Does |
| --- | --- | --- |
| SMS `outbox` | `SMS_DRIVER=outbox` (default) | sends nothing; the message is only stored (below) |
| SMS `twilio` | `SMS_DRIVER=twilio` + `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | `POST https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json` with basic auth and `To`, `From`, `Body` (port of `legacy/…/sms/sms.ts`); 10 s timeout; a non-2xx answer throws |
| Mail `outbox` | `EMAIL_DRIVER=outbox` (default) | stored only |
| Mail `resend` | `EMAIL_DRIVER=resend` + `RESEND_API_KEY`, `EMAIL_FROM` | `POST https://api.resend.com/emails` with `Authorization: Bearer …`, `Idempotency-Key`, body `{ from, to, subject, text, html }` |
| Mail `smtp` | `EMAIL_DRIVER=smtp` + `SMTP_URL`, `EMAIL_FROM` | nodemailer transport |

**The handlers** (`sms.send`, `mail.send`) call the driver and then insert **one `dev_outbox` row per
message, whatever the driver**:

| Column | Value |
| --- | --- |
| `provider`, `status` | `outbox` / `stored`, or the real provider with `sent` (or `failed` on the last attempt) |
| `body` | the full text, except for a sensitive purpose sent through a real provider: then `NULL` (we do not keep codes that were really delivered) |
| `sensitive` | true for `otp`, `password_reset`, `invite` |
| `expires_at` | `created_at + 7 days` |

`GET /api/v1/dev-outbox` shows these rows in the console ("Dev SMS outbox", now with email). Sensitive rows
are returned to admins only. With the `outbox` drivers this page is how a developer reads a phone code
or an admin reads a reset code for a user they have identified.

**Messages**

| Purpose | Channel | Text | Sent once because |
| --- | --- | --- | --- |
| `otp` | SMS | "{code} is your InstaSupply verification code. It expires in 5 minutes. Never share it." | one event per accepted `requestPhoneOtp` |
| `tracking_link` | SMS to the site contact | "InstaSupply: Hi {first name}, your order {number} is on the way with {driver}. Track it live: {WEB_URL}/track/{token}" | `deliveries.meta.trackingLinkSentAt` |
| `store_alert` | SMS to the store's `alertPhone` | new order: "InstaSupply: new order {number} · {n} items · {promise}. Accept in the portal."; reminder: "{number} is waiting. Accept or reject in InstaSupply." | `store_orders.meta.alertSmsSentAt`; `reminderSentAt` |
| `other` | SMS to the customer | "InstaSupply: your quote {number} is ready · {total} · valid until {time}." (contact preference call or WhatsApp) | one per `sendQuote` version (dedupe key `sms-quote-{quoteId}-v{version}`) |
| `password_reset` | email | subject "Your InstaSupply password reset code"; "{code} is your password reset code. It expires in 15 minutes." | one per request |
| `invite` | email | subject "Set up your InstaSupply account"; the set-password link, valid 72 hours | one per invite call |

**Phone verification without an SMS provider.** `PHONE_VERIFICATION` is `required`, `optional` or
`off` (§11.1). `loadConfig` refuses `required` in production when `SMS_DRIVER=outbox`: nobody could
ever verify. Development uses `required` with the `outbox` driver, `EXPOSE_DEV_CODES=true` and the
test numbers of MARKETPLACE §11.

### 10.4 Payments

`platform/payments/gateway.ts` contains the `PaymentGateway` interface of MARKETPLACE §3.8, unchanged.

| `PAYMENTS_MODE` | Gateway | Behaviour |
| --- | --- | --- |
| `test` | `TestGateway` | deterministic by the card's last 4: `0002` declined, `9995` insufficient funds, `0069` expired card, `0341` authorizes and then fails every capture, anything else succeeds. References `test_pi_{orderId}`, `test_ch_{orderId}`, `test_re_{key}`, `test_tr_{payoutId}`. `captureBefore = authorizedAt + 7 days`. No network. |
| `disabled` | none | `placeOrder` and `acceptQuote` fail with `PAYMENTS_DISABLED`; `PUT /me/cards` fails the same way |
| `stripe` | `StripeGateway` | not implemented: `loadConfig` refuses the value until the follow-up exists |

Card numbers never reach the server: `CardInput` has brand, last 4, expiry and holder, and the table
has no other column.

**Authorize** (in `placeOrder` and `acceptQuote`, outside the transaction): §9.2.1 step 4.
`captureDeadlineAt = min(authorizedAt + 6 days, captureBefore − 6 h)`.

**Finalize** (the `payment.finalize` handler; `finalizeOrderPayment(deps, orderId, { deadline })`):

1. Transaction, `orders` row locked: `payment.status` not in `authorized`, `capture_failed`,
   `capture_pending` → stop. Amount = Σ `current.totalCents` of all its store orders (rejected and
   cancelled count 0, except the retained fees of a returned failed delivery; in deadline mode
   unfinished store orders count at their current amount), clamped to `authorizedCents`;
   `capture_pending` reuses `pendingCaptureCents` and the stored breakdown. Amount 0 → `voided` with a
   `void` event, journal `void_pending`, enqueue `payment.void`. Otherwise `capture_pending`,
   `pendingCaptureCents`, and in the same transaction the journal's `capture_breakdown` = the amount per
   store order that makes up the capture (after the clamp, which is applied to the last store orders in
   letter order).
2. `gateway.capture` with key `capture_{orderId}` (no transaction open).
3. Transaction, `users(customer)` and `orders` row locked. If `payment.status` is no longer
   `capture_pending`, stop: another handler finished it (a `payment.finalize` enqueued while this one was
   processing). Success → `captured`, `capturedCents`, `capturedAt`, `capturedByStoreOrder` **from the
   journal's `capture_breakdown`** (what was really captured, not the store orders' amounts now), events
   `capture` and `release`; journal `captured`; then `checkAutomaticRefunds` (§9.2.12) in the same
   transaction, so a store order shorted or cancelled while the capture was in flight is refunded;
   `recordStoreOrderLedger(tx, orderId)` (`sale_…` and `commission_…` per delivered or picked-up store
   order, with `held_for_issue_id` when that store order has an open issue); customer `order_update`
   "Order complete · charged $X" (key `order-complete-{orderId}`). Failure → `capture_failed`, a `capture_failed` event, staff
   `capture_failed`; the handler ends normally and the sweep re-enqueues every 30 minutes.

**Refund** (the `payment.refund` handler): `gateway.refund` with the payload's `idempotencyKey`; then a
transaction on the `orders` row: skip if `payment.events` already contains that key; else append the
`refund` event, add to `refundedCents` and to `refundedByStoreOrder` (issue refunds) or
`adjustedByStoreOrder` (`refund_adj_…`), status `partially_refunded` or `refunded`, customer
`refund_issued` "Refunded $39.22 to Visa ••4242".

**Void procedure** (`voidOrderAuthorization`: the `payment.void` handler, the orphan sweep, the
synchronous void after a failed checkout, and the journal rules of §9.2.1 step 4):

1. Short transaction: lock the journal row (`FOR NO KEY UPDATE`). Proceed only when its status is not
   `attached` or `captured` **and** no `orders` row with that id exists; else stop (the order owns the
   hold). Set `void_pending` with the attempt being voided; commit.
2. `gateway.void` with key `void_{orderId}` (attempt 1) or `void_{orderId}_r{attempt}`, no transaction open.
3. Short transaction: journal `voided` (when still `void_pending` with that attempt).

Because `placeOrder` and `acceptQuote` attach only an `authorized` row of their own attempt under the same
row lock (§9.2.1), an order can never commit with a hold that is being voided, and a void never starts for
a hold an order already holds.

**Transfer** (the `payout.transfer` handler): §9.3.

Invariants checked by the payment module before every write: no amount below 0,
`capturedCents ≤ authorizedCents`, `refundedCents ≤ capturedCents`, `payment.events.length ≤ 30`.

---

## 11. Configuration

### 11.1 Environment variables

`config/env.ts` is the only reader of `process.env`. Everything else imports the typed `config`.
Development needs **no** `.env` file: every variable has a development default, and
`backend/.env.example` lists them all. A variable that is not set takes the "development default"
column, except when `NODE_ENV=production`, where it takes the "production" column if that column
gives a plain value (so production is safe even when a variable is forgotten). Production values are
set by `.railway/railway.ts` (`docs/DEPLOYMENT.md` §2.2); secrets are set once with the Railway CLI
and are never written to the repository (P17). The variable names are the ones that file uses.

| Variable | Purpose | Development default | Production | Secret |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | `development`, `test` or `production` | `development` | `production` | no |
| `PORT` | listen port | `4000` | set by Railway (`8080`) | no |
| `HOST` | listen address | `::` | `::` | no |
| `API_URL` | public origin of this API: media URLs, local upload URLs | not set: outside production `publicOrigin(req)` is the request's own origin (`http://` + the `Host` header), so a phone on the LAN (`http://192.168.1.20:4000`) or an Android emulator (`http://10.0.2.2:4000`) receives URLs it can reach; outbox handlers without a request use `http://localhost:4000`. When set (any environment), it is used as is | not set: derived as `https://` + `RAILWAY_PUBLIC_DOMAIN` (Railway injects that variable). Set it only when the API has a custom domain, for example `https://api.instasupply.ca` | no |
| `WEB_URL` | public origin of the console: set-password links, tracking links | `http://localhost:5173` | `https://<WEB_HOST>` | no |
| `CORS_ORIGINS` | comma-separated browser origins allowed to call the API | empty (local and LAN origins are allowed outside production, §4.8) | `https://<WEB_HOST>` (plus any other console origin) | no |
| `TRUST_PROXY` | read the client address from `X-Real-IP` | `false` | `true` | no |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` or `silent` | `debug` | `info` | no |
| `LOG_PRETTY` | human-readable logs through `pino-pretty` | `true` | `false` | no |
| `DATABASE_URL` | PostgreSQL connection string | `postgres://localhost:5432/instasupply_dev` (current OS user, no password) | reference to `Postgres.DATABASE_URL` (private network) | yes |
| `DATABASE_SSL` | `disable` or `require` | `disable` | `disable` (private network; `require` only through the public proxy) | no |
| `DATABASE_POOL_MAX` | pool size per instance | `10` | `10` | no |
| `DATABASE_AUTO_CREATE` | create the database when it is missing | `true` | `false` (enforced) | no |
| `MIGRATE_ON_START` | apply migrations when the server starts | `true` | `false` (the pre-deploy command migrates) | no |
| `JWT_SECRET` | HS256 key of access tokens | `dev-only-jwt-secret-change-me-0123456789abcdef` | 48 random bytes, set once | yes |
| `JWT_SECRET_PREVIOUS` | previous key, still accepted while rotating | empty | empty | yes |
| `ACCESS_TOKEN_TTL_SECONDS` | access token lifetime | `900` | `900` | no |
| `REFRESH_TOKEN_TTL_DAYS` | refresh token lifetime (sliding) | `60` | `60` | no |
| `SESSION_MAX_DAYS` | absolute session lifetime | `180` | `180` | no |
| `INVITE_LINK_TTL_HOURS` | lifetime of a set-password link | `72` | `72` | no |
| `OTP_PEPPER` | HMAC key for codes, link secrets, rate-limit subjects, local file URLs | `dev-only-pepper-change-me-0123456789abcdef` | 48 random bytes, set once | yes |
| `OTP_TEST_NUMBERS` | `phone:code` pairs that always verify | `+14165550199:123456,+16475550199:123456,+19055550199:123456` | empty | no |
| `PHONE_VERIFICATION` | `required`, `optional` or `off` | `required` | `optional` until `SMS_DRIVER=twilio`, then `required` | no |
| `EXPOSE_DEV_CODES` | return `devCode` from `requestPhoneOtp` | `true` | `false` (enforced) | no |
| `PAYMENTS_MODE` | `test` or `disabled` (`stripe` is refused until implemented) | `test` | set explicitly: `test` for the pilot, `disabled` to close checkout (§14 question 1). Not set → `disabled` | no |
| `ALLOW_TEST_JOBS` | enable `runJobNow` and `setDriverStatus.force` | `true` | `false` | no |
| `SEED_PASSWORD` | password of the demo accounts created by `seed --demo` | `Instasupply@123` | generated for the one seeding run; `seed` refuses the default in production | yes |
| `HST_NUMBER` | HST registration number printed on receipts | `000000000 RT0001` | the real number (§14 question 3); not set → `null` | no |
| `SUPPORT_PHONE` | support line shown by the apps (E.164) | `+14165550100` | the real number; not set → `null` | no |
| `SUPPORT_EMAIL` | support address shown by the apps | `support@instasupply.test` | the real address; not set → `null` | no |
| `MAP_TILE_URL` | Leaflet tile template | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | the same, or a commercial provider's template | no |
| `MAP_ATTRIBUTION` | attribution text for the tiles | `© OpenStreetMap contributors` | matching the provider | no |
| `MAP_MAX_ZOOM` | highest zoom the tiles serve | `19` | per provider | no |
| `STORAGE_DRIVER` | `local` or `s3` | `local` | `s3` (enforced) | no |
| `STORAGE_LOCAL_DIR` | root of the `local` driver | `backend/.data/files` | not used | no |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` | S3 API endpoint, region, bucket name | empty | references to the bucket's `ENDPOINT`, `REGION`, `BUCKET` | no |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | bucket credentials | empty | references to the bucket's `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY` | yes |
| `S3_FORCE_PATH_STYLE` | path-style URLs | `false` | `false` (Railway buckets are virtual-hosted by default) | no |
| `FILE_URL_TTL_SECONDS` | lifetime of a private download URL | `300` | `300` | no |
| `SMS_DRIVER` | `outbox` or `twilio` | `outbox` | `outbox` until Twilio is contracted, then `twilio` | no |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Twilio account, token, sender number (a Canadian number, E.164) | empty | from Twilio | yes |
| `EMAIL_DRIVER` | `outbox`, `resend` or `smtp` | `outbox` | `outbox` until a provider is set | no |
| `EMAIL_FROM` | sender, for example `InstaSupply <no-reply@instasupply.ca>` | `InstaSupply <no-reply@instasupply.test>` | a verified sender | no |
| `RESEND_API_KEY` | Resend key | empty | from Resend | yes |
| `SMTP_URL` | `smtps://user:pass@host:465` | empty | from the mail provider | yes |
| `PUSH_ENABLED` | call the Expo push service | `true` | `true` | no |
| `EXPO_ACCESS_TOKEN` | Expo "enhanced push security" token | empty | set when that option is enabled in Expo | yes |
| `GOOGLE_MAPS_API_KEY` | optional Google Routes and Geocoding | empty | empty, or a server key | yes |
| `ROUTING_PROVIDER` | `auto`, `google`, `osrm` or `estimate` | `auto` | `osrm` | no |
| `OSRM_URL` | OSRM base URL | `https://router.project-osrm.org` | the same, or an own instance | no |
| `GEOCODER` | `auto`, `google`, `nominatim` or `none` | `auto` | `nominatim` | no |
| `NOMINATIM_URL` | Nominatim base URL | `https://nominatim.openstreetmap.org` | the same, or an own instance | no |
| `GEO_USER_AGENT` | identifies us to OSRM and Nominatim | `InstaSupply-dev/1.0` | `InstaSupply/1.0 (+https://instasupply.ca)` | no |
| `RUN_WORKER` | run the outbox worker in this process | `true` | `true` | no |
| `RUN_SCHEDULER` | run the scheduler in this process | `true` | `true` | no |
| `OUTBOX_POLL_MS` · `OUTBOX_BATCH` · `OUTBOX_CONCURRENCY` | worker poll interval, rows claimed per poll, handlers in flight | `1000` · `20` · `4` | the same | no |
| `SHUTDOWN_GRACE_MS` | time to finish work after SIGTERM | `20000` | `20000` (Railway's draining time is 30 s) | no |
| `RATE_LIMIT_PER_MINUTE` | in-memory limit per client address | `600` | `600` | no |
| `RATE_LIMITS_DISABLED` | switch both limit layers off | `false` | `false` (enforced) | no |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` | the libpq variables, read **only by the test runner** (§12.1) to reach the maintenance database `postgres` | unset: `localhost`, `5432`, the OS user, no password | not used | — |

**What `loadConfig` refuses when `NODE_ENV=production`:** a `JWT_SECRET` or `OTP_PEPPER` shorter than
32 characters or equal to a development default; `EXPOSE_DEV_CODES=true`; `RATE_LIMITS_DISABLED=true`;
`DATABASE_AUTO_CREATE=true`; `STORAGE_DRIVER=local` (the service has no volume; files would vanish at
the next deployment); `CORS_ORIGINS` empty or containing `*`; `PHONE_VERIFICATION=required` with
`SMS_DRIVER=outbox`; `PAYMENTS_MODE=stripe`; no `API_URL` and no `RAILWAY_PUBLIC_DOMAIN`; a driver
whose credentials are missing (`twilio` without its three variables, `resend` without its key or
`EMAIL_FROM`, `smtp` without its URL, `s3` without its five variables). It warns, but starts, on
`ALLOW_TEST_JOBS=true` and on a non-empty `OTP_TEST_NUMBERS`.

In tests (`NODE_ENV=test`): `RUN_WORKER=false`, `RUN_SCHEDULER=false`, `PUSH_ENABLED=false`,
`RATE_LIMITS_DISABLED=true`, `STORAGE_DRIVER=local` in a temporary directory, the `outbox` SMS and
email drivers, `LOG_LEVEL=silent`.

### 11.2 `GET /api/v1/config`

Public, no token, `Cache-Control: no-store`. The type is `PublicConfig` (§5.4).

| Field | Source |
| --- | --- |
| `environment` | `production` when `NODE_ENV=production`, else `development` |
| `paymentsMode` | `PAYMENTS_MODE` |
| `phoneVerification` | `PHONE_VERIFICATION` |
| `supportPhone`, `supportEmail`, `hstNumber` | `SUPPORT_PHONE`, `SUPPORT_EMAIL`, `HST_NUMBER` (empty → `null`) |
| `map` | `MAP_TILE_URL`, `MAP_ATTRIBUTION`, `MAP_MAX_ZOOM` |
| `trackingBaseUrl` | `WEB_URL` + `/track` |
| `smsDriver`, `emailDriver` | `SMS_DRIVER`, `EMAIL_DRIVER` |
| `allowTestJobs` | `ALLOW_TEST_JOBS` |
| `serverTime` | the server clock |

How the apps use it: `paymentsMode = 'disabled'` → checkout shows "Card payments aren't available
yet"; `phoneVerification = 'off'` → the verify-phone step is skipped, `'optional'` → it is offered and
can be skipped; with `smsDriver = 'outbox'` in production a phone cannot be verified at all, so the
apps hide the step; `map` configures every `AppMap`; `trackingBaseUrl` builds the share link;
`allowTestJobs` shows "Run payouts now".

---

## 12. Testing

Tests run with Node's test runner through `tsx`, against a real PostgreSQL 17, through the real HTTP
layer (`app.inject`, no port). Nothing is mocked inside the server except what a test replaces in
`deps`: the clock (`FakeClock`), the payment gateway (a recording wrapper around `TestGateway`), and
the push sender (a recorder). Storage is the `local` driver in a temporary directory; SMS and mail are
the `outbox` drivers. The unit tests of MARKETPLACE §13.1 stay in `packages/shared/test` and are not
part of this document.

### 12.1 How a test gets a database

Many engineers and CI share one PostgreSQL server per machine, so every run and every test file gets
its own database.

`npm test` runs `test/support/run.ts`:

1. Connect to the maintenance database `postgres` with the libpq variables `PGHOST`, `PGPORT`,
   `PGUSER`, `PGPASSWORD` (node-postgres reads them; unset means `localhost:5432`, the OS user, no
   password, which is this machine's PostgreSQL). CI sets them for its `postgres:17` service
   container.
2. Drop left-overs of crashed runs: every database named `instasupply_test_<stamp>_…` whose `<stamp>`
   (`YYYYMMDDHHMM`, UTC) is more than 6 hours old.
3. Create the **template** `instasupply_test_<stamp>_<rand>_tpl` (`<rand>` = 6 hex characters), apply
   the migrations to it with `migrate()`, and close every connection to it.
4. Start `node --import tsx --test --test-concurrency=4 <files>` with `TEST_RUN=instasupply_test_<stamp>_<rand>`
   in the environment. Node runs each test file in its own process.
5. When the tests end (or on SIGINT/SIGTERM): `DROP DATABASE … WITH (FORCE)` for every database whose
   name starts with `TEST_RUN`. Exit with the tests' exit code.

In a test file:

```ts
// test/support/database.ts
export async function createTestContext(options?: { clock?: FakeClock; deps?: Partial<Deps> }): Promise<TestContext>;
export interface TestContext { app: FastifyInstance; deps: Deps; pool: pg.Pool; clock: FakeClock; gateway: RecordingGateway;
  drainOutbox(): Promise<number>; runJob(name: ScheduledJobName, now?: number): Promise<Record<string, number>>;
  close(): Promise<void> }
```

`createTestContext` runs `CREATE DATABASE "<TEST_RUN>_<n>" TEMPLATE "<TEST_RUN>_tpl"` (copying the
migrated template takes a fraction of a second; SQLSTATE `55006` "object in use" is retried up to 5
times), builds `deps` and the app on it, and `close()` ends the pool and drops the database. Each file
therefore starts with empty tables and its own sequences (the first order is always `IS-10001`), and
jobs that scan whole tables (`runJob('escalateStoreOrders')`) only see that file's rows.

- A file runs its tests one after another; files run in parallel (4 by default, `TEST_CONCURRENCY`).
  Each file's pool has `max: 6`, so a run uses about 30 of the server's 100 connections.
- Nothing listens on a port, so parallel runs cannot collide on ports either.
- CI (`docs/DEPLOYMENT.md` §7): a `postgres:17` service container; the job runs
  `npm ci --ignore-scripts`, `npm run typecheck`, `npm run test --workspace @instasupply/backend`.
- When `TEST_RUN` is not set (a single file started by hand with `tsx --test`), `createTestContext`
  creates and migrates a private database itself.

### 12.2 Fixtures and helpers (`test/support`)

| File | Provides |
| --- | --- |
| `clock.ts` | `FakeClock`: `now()`, `set(ms)`, `advance(ms)`. Default start **Thu 2026-11-19 12:25 America/Toronto** (`1795109100000`), the reference time of MARKETPLACE §4.8, when every seed store is open and ASAP is valid. |
| `fixtures.ts` | `seedCatalog(ctx)`: the 25 categories, the stores and products the vectors V1 to V9 need (Kestrel, Bluestone, Boltbin, Voltway, Copperline, Glassmoor, Grainline, Slatebridge, plus one `coming_soon` store), imported from `src/cli/seed/*.ts` so tests and the seed share one data set. `seedAccounts(ctx)`: admin, dispatcher, Dana (verified phone, three jobsites, cards ••4242, ••4444, ••0002, ••9995, ••0069, ••0341), Sam, Kestrel's owner and staff, the other owners, the drivers Marco, Aisha, Tom, Gurpreet, Devon (active, online at their seed positions) and Lena (pending). Rows are written through repositories; passwords are hashed with the test cost (below). |
| `actors.ts` | `as(ctx, 'dana')` → `{ uid, token, call(name, body), get(path), post(path, body), put(path, body), patch(path, body), del(path), live() }`. Tokens come from the real `POST /auth/login`. `expectError(promise, status, code?)`. |
| `flows.ts` | Building blocks reused by workflows: `placeV1(ctx)`, `acceptAll`, `markReady`, `claim`, `checkIn`, `handOver` (reads the PIN with a staff `GET /store-orders/{id}/private`), `deliver` (uploads a proof through the file endpoints, reads the hand-off code with `GET /deliveries/{id}/private`). |
| `outbox.ts` | `drainOutbox(ctx)`; `outboxEvents(ctx, event)` to assert what was enqueued. |
| `live.ts` | `connectLive(ctx, token?)` on `app.injectWS('/api/v1/live')`: `auth()`, `subscribe(topics)`, `nextEvent(topic)`, `close()`. |
| `race.ts` | `race(fns)` and `hold(ctx, point)` (§12.3). |

In `NODE_ENV=test`, `hashPassword` uses N = 2^10 (the parameters are stored in the hash string, so
verification needs no special case). The worker and the scheduler do not run by themselves: a test
calls `ctx.drainOutbox()` and `ctx.runJob(name, now)` at the point it wants them, which makes every
workflow deterministic.

### 12.3 Concurrency cases

Two requests sent with `Promise.all` over `app.inject` run on two pool connections, so they contend on
real row locks. Two techniques, both used:

- **Repeat:** `race([a, b])` runs the pair 25 times on fresh data and asserts the invariant every
  time. Whatever the interleaving, the invariant must hold.
- **Hold points:** `deps.hooks.at(name)` is awaited at named places (a no-op in production).
  `hold(ctx, 'placeOrder:afterAuthorize')` returns a gate; the test holds request A there, lets
  request B finish, then releases A. This makes the hard interleavings reproducible. The points:
  `placeOrder:afterAuthorize`, `placeOrder:locked`, `claimJob:beforeTransaction`, `claimJob:locked`,
  `completePickup:locked`, `finalize:afterCapture`, `payouts:afterPayoutInsert`, `outbox:afterHandler`,
  `refresh:afterRotate`.

| Case | Setup | Must hold |
| --- | --- | --- |
| The same `checkoutId` twice | Dana sends one `placeOrder` body twice at once (and again with A held after its authorization while B completes) | both answers are the same order; `orders` has 1 row, `store_orders` 2, `deliveries` 2; each product's `reserved` rose once; the gateway recorded one distinct intent (`test_pi_{orderId}`) and **zero voids**; `stats.nonCancelledOrders = 1` |
| Two first orders | Sam sends two different `checkoutId`s at once, both priced as a first order | exactly one succeeds with the welcome discount and $0 delivery; the other fails `PRICE_CHANGED` with `details.pricing` that has no welcome discount; the loser's authorization was voided; `stats.nonCancelledOrders = 1`; stock reserved once |
| Two claims | Marco and Devon call `claimJob` for the same open offer at once | one answer is `{ status: 'accepted' }`, the other `OFFER_TAKEN`; the delivery has one driver; `job_offers` has no row; one PIN was issued and it is the winner's |
| The last units | two customers order the last 4 units of one product at once | one order; the other `OUT_OF_STOCK { available: 0 }`; `reserved = 4` |
| Claim against the limit | a driver with 3 active jobs claims 2 offers at once | exactly one succeeds; the other `TOO_MANY_JOBS` |
| Hand-over against release | the store enters the PIN while the driver releases the job | either the hand-over wins (store order `out_for_delivery`, delivery `picked_up`) or the release wins (delivery `unassigned`, the PIN fails with `DRIVER_NOT_ASSIGNED`); never a mix |
| Accept twice | two store members accept the same store order at once | one `accepted`; the other `VERSION_CONFLICT`; one job offer |
| Payout run twice | `runDailyPayouts` with the same `now` on two connections (the advisory lock is bypassed through the body function) | one payout per payee; every entry stamped once; one transfer per payout |
| Refresh repeat | a refresh answer is dropped; the client repeats with the old token after 2 minutes | the repeat succeeds (its child was never used); the session stays |
| Refresh reuse | token T rotated to C, C used; T presented 2 days later | the session is revoked (`refresh_reused`); the rows were still there |
| Refresh siblings | T repeated twice (children C1, C2); C1 used; then C2 used | C2 is superseded: the session is revoked (`refresh_reused`) |
| Outbox claim | two workers claim at once | every event is handled by one worker; none is skipped |
| Outbox release with a coalesced row | a `route.plan` handler fails while a newer `route.plan` row with the same key is pending; then the reaper runs over a crashed instance's rows, one of which has a pending duplicate | no 23505; the failed row ends `done`, the pending one runs; every other stuck row is back to `pending` |
| Refund once | after a deadline capture, a store order is shorted (v5) and then moves to `out_for_delivery` (v6) before the refund handler runs | exactly one `payment.refund` row for that store order; the gateway records one refund of the difference |
| Reduction during capture | `hold(ctx, 'finalize:afterCapture')`; the store shorts a line of an unfinished store order (deadline mode); release | `capturedByStoreOrder` equals the captured breakdown; an automatic refund of the reduction is enqueued in step 3 |
| Void against attach | `hold(ctx, 'placeOrder:locked')` on attempt 1 while the orphan sweep voids the same journal row; release | either the order commits and the void stops (journal `attached`), or the void runs and `placeOrder` retries with attempt 2; never an order holding a voided authorization |
| Finalize twice | two `payment.finalize` rows for one order run at once | one capture, one `capture` event, one "Order complete" notification |
| Default flag | two `PUT /me/jobsites/{id}` with `isDefault: true` for different jobsites at once | both succeed or one is retried; exactly one default; no 23505 |
| Parked trips | the same driver moves two deliveries to `in_transit` from two devices at once | at most one delivery `in_transit`; the other is parked as `picked_up` |
| Accept a quote twice | `acceptQuote` with the same `checkoutId` twice, the second after the first committed | the same `PlaceOrderResponse` both times; one order |

### 12.4 Test files

**Platform (`test/platform`)**

| File | Cases |
| --- | --- |
| `migrations.test.ts` | a fresh database migrates; a second run does nothing; a changed applied file is refused; two concurrent `migrate()` calls apply each file once |
| `schema.test.ts` | every mirror column is generated (writing one fails with 428C9); every statement of §3.5 runs; **index test**: every repository query is explained against a seeded database and none scans a table of more than 1 000 rows sequentially |
| `errors.test.ts` | the envelope and HTTP status of every `ApiStatus`; zod failures list fields; unknown errors become `internal` without leaking; 404 for unknown routes and commands; 413 and 415 |
| `commands.test.ts` | every name of `CALLABLES` is registered and nothing else; every route has a policy or is in the public list of §7.2 |
| `pagination.test.ts` | keyset pages neither skip nor repeat while rows are inserted; bad cursor → `invalid-argument`; `limit` bounds |
| `rate-limit.test.ts` | window arithmetic of `consumeRateLimit`; `RATE_LIMITED` with `details.retryAfterMs`; subjects are HMACs (no raw address, phone or email in `rate_limits`); a forged `X-Forwarded-For` with a fixed `X-Real-IP` hits the same bucket; with `TRUST_PROXY=false` `X-Real-IP` is ignored |
| `outbox.test.ts` | enqueue is rolled back with its transaction; coalescing while pending; backoff schedule; `dead` after `max_attempts`; the reaper returns stuck rows one by one; statement (m) with a pending duplicate finishes the row as `done`; handlers survive a second run |
| `scheduler.test.ts` | a job runs once across two schedulers; `next_run_at` arithmetic incl. the 21:00 Toronto job across the DST changes; a failing job records `error` and runs again; `runJobNow` is refused without `ALLOW_TEST_JOBS` and for non-admins |
| `logging.test.ts` | no log line contains a request URL, a query string, `remoteAddress`, a token or an email; one completion line per request |
| `live.test.ts` | every frame of §8.1; anonymous sockets get public topics only; an event is published only when its transaction commits; a rolled-back transaction publishes nothing; a payload over the limit is sent without `data`; sockets are closed with 1012 after the listener reconnects; `drop_user` closes sockets with 4403; an expired token closes with 4401; 120 s without a frame closes the socket |
| `storage.test.ts` | presign → upload → confirm for every purpose; wrong size, wrong type and wrong magic number are refused and the object is deleted; a re-post of the form after confirm leaves the confirmed file unchanged; the scope caps of `UPLOAD_LIMITS`; signed local URLs expire; `media/*` serves public purposes only; outside production URLs carry the request's origin |
| `config.test.ts` | development defaults load without any variable; every production refusal of §11.1; `GET /config` contains no secret |
| `health.test.ts` | 200 with the database; 503 when it does not answer |

**Auth (`test/auth`)**

| File | Cases |
| --- | --- |
| `signup-login.test.ts` | register, duplicate email, weak password; `registerCustomer` and `registerDriver` from a role-less account, and their refusals for other roles; login success, generic failure for unknown email and wrong password; after 10 attempts on one email from other addresses an unknown email and an existing one get the identical `RATE_LIMITED` answer, while the owner's known installation still signs in; suspended account; hashes carry their parameters and are rehashed |
| `refresh.test.ts` | rotation; a repeat after a lost answer works at any age while the child is unused; replay after the child was used revokes the session, also 2 days later; a superseded sibling revokes; at most 5 repeats; expiry; sliding lifetime capped by the session; suspension answers `account_suspended`, never `session_revoked`; logout, logout-all, `revoke-all` and `revoke-sessions` set the driver offline and delete the device; at most 10 sessions |
| `password.test.ts` | change (other sessions revoked); `password/forgot` never reveals whether the email exists; reset codes: expiry, 5 attempts, single use, all sessions revoked; after 10 wrong codes in 24 h `forgot` issues no code (still 204) and admins are notified; the reset mail is a sensitive outbox row |
| `invites.test.ts` | `createStaffUser`, `inviteSupplierUser` (owner may invite `staff` only, own store only), repeated invite reuses the account; `POST /auth/invites/inspect`; the link carries the token in the fragment; `password/setup` works once and signs the user in; expired link; the `create-admin` command |
| `phone-otp.test.ts` | Canadian area codes only (+1 876 and +1 268 refused); the global hourly and daily caps; test numbers; cooldown, hourly cap, per-phone and per-address limits; wrong code counts and the count survives; expiry; the number of another account is only revealed after a correct code; `PHONE_VERIFICATION` modes |
| `enforcement.test.ts` | a suspension takes effect on the next request (`account_suspended`) and closes sockets; `PATCH /users/{uid}/status` for a dispatcher and a customer, never the last admin; a role or store change needs no new token; a revoked session's access token is refused before it expires; `JWT_SECRET_PREVIOUS` is accepted |

**Authorization (`test/authorization`): the rules tests of MARKETPLACE §13.2.** Each file has, per
endpoint, one allowed and one denied case for the actors of MARKETPLACE §13.2: anonymous, customer A and B,
supplier owner and staff of store X, supplier of store Y, a driver in the offer's city and class, a
driver in another city, a car driver against a pickup offer, a pending driver, a dispatcher, an admin.

| File | Collections of MARKETPLACE §6.2 | Cases that MARKETPLACE §13.2 names explicitly |
| --- | --- | --- |
| `users.authz.test.ts` | `users` | a user edits only the five profile fields; never role, status, store or stats; an owner lists only the supplier users of their own store; staff read all |
| `customer-data.authz.test.ts` | jobsites, cards, favourites, devices, cart | jobsite validation (postal code, NANP, province, service area, pin-only new build); a client-set `lastUsedAt` or `createdAt` is rejected (unknown key); cards reject `number`, `cvv` and brand `rupay`; another user's rows are unreachable |
| `catalogue.authz.test.ts` | categories, stores, store settings, reviews, products | stores are not client-writable; settings: staff and the owner only (store staff denied); a supplier writes only allowed product fields of their own store, never `reserved`, `listed`, `featured`, `familyKey`, `storeId`, `sku`, `imageUrl`, unknown keys, or an `imagePath` outside `productPhotos/{storeId}/`; delete needs the owner and `reserved = 0`; a review needs an own completed store order |
| `orders.authz.test.ts` | orders, store orders, private meta | customers read only their own orders and store orders; a supplier's list is always scoped to their store and another `storeId` is denied; drivers never read store orders; `private` is staff-only; a store order never contains the PIN |
| `cross-store.authz.test.ts` | everything store-scoped | the list of §7.4, as the supplier of store Y against store X |
| `deliveries.authz.test.ts` | deliveries, events, private, routes, driver locations | a driver sees only assigned deliveries and their events, never `private` (the hand-off code); only staff edit, and only the editable keys; an approved driver writes only their own location; pending drivers cannot |
| `job-offers.authz.test.ts` | job offers | visible only when open and in the audience (city, class, site maximum); a car driver against a pickup offer; another city; pending driver; scheduled offers hidden; the fixture proves an offer contains no customer name, phone or exact address |
| `tracking.authz.test.ts` | tracking | anyone with the token reads; no listing; unknown token is `not-found` |
| `support-chat.authz.test.ts` | support threads, chat threads | `senderRole` cannot be spoofed; a customer reads only their thread, a supplier only `store_{own}`; only the own unread counter can be reset; staff alone change status and assignee; a driver posts only in their own thread and only when active |
| `quotes-issues.authz.test.ts` | quotes, issues, their private parts | customers read their own; store members read their store's issues; staff updates are limited to assignee and the one status step; workspace and notes are staff-only |
| `finance.authz.test.ts` | ledger entries, payouts | per payee: the owner of the store, the driver; store staff denied; another store or driver denied |
| `suggestions-outbox.authz.test.ts` | store suggestions, dev outbox, ops | suggestions are created only through `suggestStore`; staff read and set `status`; sensitive outbox rows only for admins; `/ops/*` staff-only |
| `notifications.authz.test.ts` | notifications | the recipient reads, marks read and deletes; nobody else; nothing else can be changed |
| `files.authz.test.ts` | the Storage rules of MARKETPLACE §6.4 | proof: upload by the assigned driver only, read by staff, that driver and the delivery's customer; quote uploads: customers, types and size; issue photos: customer role, own issue, store member reads; store and product photos by role |
| `live-topics.authz.test.ts` | live topics | every topic pattern of §8.2 against every actor, the per-object topics included (`order:{id}` of another customer, `store-order:{id}` of another store, `job-offers:` of another city or class) |

**Workflows (`test/workflows`): the files of MARKETPLACE §13.3, same names, same owners.**

| File | Covers (unchanged from MARKETPLACE §13.3, on the new platform) |
| --- | --- |
| `checkout-workflow.test.ts` | multi-store placement equals `priceCheckout`; `PRICE_CHANGED`, `WINDOW_UNAVAILABLE`, `OUT_OF_RANGE`, `OUT_OF_STOCK`; the same `checkoutId` twice, serially and concurrently (§12.3); decline card ••0002 writes nothing but a `declined` journal row; two concurrent first orders; whole and partial cancel; capture once at settlement, clamped; capture failure ••0341 → staff alert → sweep retry; deadline capture, then the automatic refund; an authorization orphaned by a crash (journal `authorized`, no order) is voided by `captureDuePayments` |
| `store-order-workflow.test.ts` | accept with a shortage (V4: `current`, `reserved`, stock clamp, customer message); reject cascade (delivery cancelled, offer deleted, stock released); ready gating; wrong PIN ×5 → `CODE_LOCKED`, staff override; a wrong PIN saves nothing but the attempt; customer pickup; hold expiry through `runJob`; reminder → overdue → auto-reject |
| `catalogue-workflow.test.ts` | product derivation (`search_terms`, `listed`), store fan-out, category edits recompute search terms, store rating from reviews |
| `delivery-workflow.test.ts` | manual deliveries: assignment → trip → live tracking → proof; decline and reassign; only one trip in transit per driver; tracking, routes, hand-off code (port of `legacy/firebase/tests/delivery-workflow.test.ts`, no COD, +1 numbers) |
| `tracking-routing.test.ts` | location reports (2-second rule, online-change exemption, stale fixes ignored); tracking field ownership: a `route.plan` computed before a delivery completed never writes status or phase; ETA patches; route plans with pickup stops; geocoder cache and provider limits |
| `job-board-workflow.test.ts` | offer `scheduled` → `open` through `runJob`; two concurrent claims; class, city and 4-job limits; a pending vehicle downgrade refuses bigger jobs; release reopens the offer, clears the PIN (the old PIN fails at the counter) and `RELEASED_RECENTLY`; suspension releases uncollected jobs; a driver cannot mark `picked_up`; the hand-over moves both rows; route plans put each pickup before its drop-off; photo required; tracking phases; route stops with `kind`; failure → reattempt and return; ledger entries are created once when the same transition is retried |
| `quotes-issues-workflow.test.ts` | submit (attachment checks) → send → accept at quoted prices with a custom line; version and expiry errors; reopen; issue window; refund after capture (V5) and credit before capture; clawback per fault; replacement order |
| `payouts-support-workflow.test.ts` | the daily run nets entries, carries negatives over, skips held entries; a replacement order whose store was not at fault produces `sale_` and `commission_` entries when it settles, one whose store was at fault only `commission_`; a rerun with the same `now` creates nothing; a run interrupted after the payout insert is finished by the next run without paying twice; support messages update summaries and notify the customer and every store member; the suggestion rate limit |
| `device-tokens.test.ts` | a push token moves to the account that registered it last; other tokens are left alone; re-registering changes nothing (port of the legacy file) |
| `notifications-push.test.ts` | every row of the notification table in §10.2 is produced once, with its key; preferences and channels; Expo tickets and receipts; `DeviceNotRegistered` removes the device |
| `seed-smoke.test.ts` | runs `seed --demo --at 2026-11-19T12:25:00-05:00` in-process against a fresh database (no `ALLOW_TEST_JOBS`); a second run is refused because `orders` is not empty; with `NODE_ENV=production` the staff accounts have no password and get links; and asserts the end states of MARKETPLACE §11.5 (IS-10001 completed and captured 38 825, payouts 17 083 / 12 677 / 4 775 / 4 200, CASE-10001 open, Q-10002 quoted at 129 970, IS-10006 cancelled with its authorization voided) |

The rule from the old plan stays: a workstream is done when its workflow file, its authorization
files and `seed-smoke` are green.

---

## 13. Verified platform facts, assumptions and the port map

### 13.1 What was verified, and where (all on 2026-11-19)

| Fact this document relies on | Source |
| --- | --- |
| Railway's edge speaks HTTP/1.1 and HTTP/2; WebSockets work over HTTP/1.1 and are exempt from duration and inactivity limits; idle HTTP/1.1 connections are closed after 60 s; headers ≤ 32 KB; a request may run 15 minutes while data flows and is closed after 5 minutes without data; request bodies must arrive within 5 minutes | docs.railway.com/networking/public-networking/specs-and-limits |
| The edge adds `X-Real-IP` (the client's address), `X-Forwarded-Proto` (always `https`), `X-Forwarded-Host`, `X-Railway-Request-Id`, `X-Railway-Edge`, `X-Request-Start`. `X-Forwarded-For` is not in the list, which is why the client address is read from `X-Real-IP` | same page |
| A pre-deploy command runs between build and deploy, in its own container from the service image, with the service variables and the private network, without volumes; a non-zero exit stops the deployment; it is not retried | docs.railway.com/deployments/pre-deploy-command |
| A health check needs any 2xx from the configured path on `PORT`, is called from host `healthcheck.railway.app`, waits 300 s by default and runs only at deployment, not continuously | docs.railway.com/deployments/healthchecks |
| The old deployment gets SIGTERM, then SIGKILL after the draining time; `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` and `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS` default to 0 | docs.railway.com/deployments/deployment-teardown, docs.railway.com/variables/reference |
| The PostgreSQL service exposes `DATABASE_URL` and the `PG*` variables; `DATABASE_PUBLIC_URL` exists only with public access (a TCP proxy, billed egress); the image is the official one with SSL enabled; no extension is added to it | docs.railway.com/databases/postgresql |
| Reference variables are written `${{Service.VAR}}` and `${{ shared.VAR }}`; sealed variables cannot be read back | docs.railway.com/variables |
| Buckets are private (no public buckets), S3-compatible, expose `BUCKET`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `REGION`, `ENDPOINT` (`https://t3.storageapi.dev`), use virtual-hosted URLs by default, support put, get, head, delete, list, copy, presigned URLs, tagging and multipart, and do **not** support lifecycle rules, versioning, object locks or server-side encryption settings | docs.railway.com/storage-buckets |
| Presigned URLs may live up to 90 days; uploads with `createPresignedPost` and a `content-length-range` condition are the documented pattern; browser uploads need a bucket CORS rule (`put-bucket-cors`); downloads through presigned URLs cost no service egress | docs.railway.com/storage-buckets/uploading-serving |
| `railway.json` / `railway.toml` ("config as code") is deprecated in favour of `.railway/railway.ts`, and existing files stop working for legacy services on 2026-12-01. This document therefore names settings, not a config file | docs.railway.com/config-as-code/reference, docs.railway.com/infrastructure-as-code/reference |
| Fastify 5 defaults: `bodyLimit` 1 MiB, `keepAliveTimeout` 72 s, `return503OnClosing` true, `listen` host `localhost` (containers must bind `0.0.0.0` or `::`); `close()` does not track upgraded sockets by itself | fastify.dev/docs/latest/Reference/Server |
| `@fastify/websocket`: the handler is `(socket, request)`; `onRequest` and `preValidation` hooks run on the upgrade request; message handlers must be attached synchronously; every socket is closed when the server closes; `fastify.injectWS` exists for tests; `options.maxPayload` is passed to `ws` | github.com/fastify/fastify-websocket README |
| node-postgres: pool defaults (`max` 10, `idleTimeoutMillis` 10 000), the need for `pool.on('error')`, one client per transaction, `LISTEN` with the `notification` event (`channel`, `payload`), client options `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout`, `application_name`, `options`; `json`/`jsonb` are parsed and objects are stringified; `timestamptz` arrives as `Date` | node-postgres.com/apis/pool, /apis/client, /features/types |
| `NOTIFY`: payload shorter than 8 000 bytes; delivered only if and when the transaction commits; identical notifications in one transaction are collapsed; order is kept | postgresql.org/docs/17/sql-notify.html |
| Row locks: `FOR KEY SHARE` conflicts only with `FOR UPDATE`; `FOR NO KEY UPDATE` is what an `UPDATE` of non-key columns takes; deadlocks are detected and one transaction is aborted; consistent lock order is the defence; advisory locks at session level are released when the session ends | postgresql.org/docs/17/explicit-locking.html |
| Generated columns are stored only, use immutable expressions, and cannot be written | postgresql.org/docs/17/ddl-generated-columns.html |
| On PostgreSQL 17.11: the full DDL of §3.2 and every statement of §3.5 run; a foreign key on a generated column is enforced; writing a generated column fails with 428C9; `to_timestamp(double precision)`, `->>` and `lower` are immutable; `ms_to_ts` round-trips milliseconds exactly | run locally in a transaction that was rolled back (nothing was created) |
| This machine: PostgreSQL 17.11 (Homebrew) accepts the current OS user without a password on `localhost:5432` and on the socket in `/tmp`; the user may create databases; the server's `TimeZone` is `Asia/Kolkata`; `max_connections` is 100. Node 22.23.1, npm 10.9.8, Railway CLI 5.71.0 | `psql`, `node --version`, `railway --version` |
| Package versions of §2.3 exist on the npm registry; the Fastify plugins depend on `fastify-plugin ^6`; `fastify@5.12.8` depends on `pino ^9.14.0 \|\| ^10.1.0`; the root workspace has `tsx 4.23.15`, `typescript 6.0.3`, `esbuild 0.28.2` installed | `npm view`, `node_modules` |
| Expo push: send `https://exp.host/--/api/v2/push/send` (≤ 100 messages per request), receipts `…/push/getReceipts` (≤ 1 000 ids), receipts ready after about 15 minutes and kept 24 hours, 600 notifications per second per project, `DeviceNotRegistered` means stop sending, a request must not mix projects, an access token is sent as `Authorization: Bearer` | docs.expo.dev/push-notifications/sending-notifications |
| scrypt with N = 2^15, r = 8, p = 3 is one of OWASP's equivalent minimum settings; rehash at next login when the cost is raised | cheatsheetseries.owasp.org Password Storage Cheat Sheet |
| Nominatim: at most 1 request per second, an identifying User-Agent, results cached, no autocomplete | operations.osmfoundation.org/policies/nominatim |
| The public OSRM server allows no excessive use, gives no guarantee and wants an identifying User-Agent | github.com/Project-OSRM/osrm-backend/wiki/Api-usage-policy |
| Resend: `POST https://api.resend.com/emails`, bearer key, `Idempotency-Key` kept 24 hours | resend.com/docs/api-reference/emails/send-email |
| The repository's top level is split into `backend/`, `frontend/`, `app/customer`, `app/driver` and `packages/*`, each an npm workspace of the root `package.json`; `.env` files are ignored by `.gitignore`; ESLint 10.15.0's `no-restricted-imports` accepts `regex` patterns and tests them against the import string (case-insensitive unless `caseSensitive` is set), type imports included; the backend image copies only the root manifests, `backend/` and `packages/shared` | `ls` and the root `package.json`; `.gitignore`; `node_modules/eslint/lib/rules/no-restricted-imports.js`; `docs/DEPLOYMENT.md` §2.3 |

**Checked again on 2026-11-20 by the finalizing pass**

| Fact | Source |
| --- | --- |
| The DDL of §3.2 after the final edits: 40 tables, 148 indexes; statement (m) of §3.5 finishes a `processing` row as `done` when a pending row has the same dedupe key, without 23505; `ledger_held_idx` serves `held_for_issue_id = $1` (EXPLAIN with sequential scans disabled) | `psql` against the local PostgreSQL 17.11, inside `BEGIN … ROLLBACK` in a temporary schema; nothing was left on the server |
| A custom domain can be declared on a service in `.railway/railway.ts` (`domains: ["app.example.com"]` or `[{ domain, port }]`); generated `*.up.railway.app` domains are not part of the file | docs.railway.com/infrastructure-as-code/reference ("Custom domains") |
| `railway up --ci` streams build logs only and exits when the build completes; attached mode (no flag) exits with the deployment's terminal status (0 only on `SUCCESS`) | docs.railway.com/cli/up |
| expo-location 58 throws `ForegroundServiceStartNotAllowedException` when `startLocationUpdatesAsync` is called with `foregroundService` while the app is not in the foreground | `node_modules/expo-location/android/src/main/java/expo/modules/location/LocationModule.kt` line 330 |
| MARKETPLACE §11 requires the seed to work at any time of day (ASAP when possible, else the earliest valid window; amounts never depend on time) | `docs/MARKETPLACE.md` §11, introduction |

### 13.2 What is assumed and must be confirmed by the first build or run

| Assumption | Confirmed by |
| --- | --- |
| `npm ci --workspace @instasupply/backend` installs only that workspace's dependencies inside the image (`docs/DEPLOYMENT.md` §2.3 relies on it) | the first image build |
| esbuild bundles the server as ESM with the dependencies external (§2.5) | `npm run build` |
| `tsx` passes `--env-file-if-exists` to Node 22 | `npm run dev` |
| node-postgres returns `bigint` as a string unless a parser is set, and `pg.types.getTypeParser` returns the built-in `timestamptz` parser | `test/platform/schema.test.ts` |
| Several processes may run `CREATE DATABASE … TEMPLATE` from the same template at once (§12.1 retries `55006` in case they may not) | the first parallel test run |
| The presigner accepts a `signingDate`, so "stable" media URLs are identical during a day; if not, media URLs are signed per request and only the redirect is cached | `test/platform/storage.test.ts` against a real bucket |
| The Railway bucket enforces the conditions of a presigned POST (`content-length-range`, `Content-Type`) and accepts `PutBucketCors` | the first deployment; `POST /files/confirm` re-checks size and type in any case |
| The Twilio request and the Google Routes limits are as in the legacy code | they are ported unchanged |
| `packages/shared` will export what MARKETPLACE §1.3, §2, §4 and §13.1 name and this document calls: `torontoOffsetMinutes`, `toLocal`, `fromLocal`, `resolveWindow`, `pickupReady`, `canStoreOrderTransition`, `orderStatusFromStoreOrders`, `settleStoreOrder`, `refundForLines`, `priceCheckout`, `validateJobsite`, `validateProduct`, `validateStoreProfile`, `validateDriverVehicle`, `buildSearchTerms`, `searchKeyFor`, `audienceFor`, `capacityClassFor`, `canCarry`, `nearestCity`, `summarizeLoad`. On 2026-11-20 every one of them is exported (checked with `grep` over `packages/shared/src`); some bodies may still be stubs, which the shared workstream's unit tests (MARKETPLACE §13.1) catch. The missing items are listed in §16 | the shared workstream |

### 13.3 Port map: legacy code → new home

| Legacy (`legacy/firebase/functions/src/…`) | New (`backend/src/…`) | What changes |
| --- | --- | --- |
| `lib/errors.ts` | `platform/http/errors.ts` | `HttpsError` → `ApiError`; `failCode` |
| `lib/functions.ts` (`callable`, `settleAll`) | `platform/http/command.ts` | same sanitizing of unknown errors; `settleAll` is gone (side effects are outbox events) |
| `lib/guards.ts` | `platform/auth/policies.ts` | the actor comes from the database, not from token claims; `supplier` added |
| `lib/ids.ts` | `platform/ids.ts`, `platform/db/sequences.ts` | counters → sequences; tokens and codes unchanged |
| `lib/users.ts` | `modules/auth/users.repository.ts`, `serializers.ts` | the 60 s staff cache is dropped (one indexed query in the transaction) |
| `config/runtime.ts` | `config/env.ts` | §11.1 |
| `modules/auth/phone-otp.ts` | `modules/auth/phone-otp.ts` | same numbers; per-phone and per-address limits; no enumeration |
| `modules/auth/register-driver.ts`, `driver-status.ts`, `staff.ts` | `modules/drivers/register-driver.ts`, `driver-status.ts`; `modules/auth/staff.ts` | claims → columns; invites → set-password links |
| `modules/commerce/register-customer.ts` | same name | role column |
| `modules/commerce/place-order.ts`, `cancel-order.ts` | same names | rewritten per MARKETPLACE §5.5.1 |
| `modules/commerce/order-sync.ts`, `reviews.ts` | deleted; `stores/reviews.ts` | replaced by `order-aggregate.ts` and store reviews |
| `modules/deliveries/delivery-writer.ts`, `repository.ts`, `update-status.ts`, `assign-delivery.ts`, `create-deliveries.ts` | same names | SQL repository; marketplace coupling; no COD |
| `modules/deliveries/on-delivery-written.ts` | `modules/deliveries/delivery-effects.ts` | called in the transaction; texts kept |
| `modules/routing/planner.ts`, `providers.ts`, `optimize-route.ts` | same names | pickup stops; `VEHICLE_CLASSES`; OSRM as the default provider; the lease becomes outbox coalescing plus the signature |
| `modules/tracking/tracking-service.ts`, `triggers.ts` | `tracking-service.ts`, `location.ts` | phases, pickup, deliver-by; same 15 m / 20 s and 60 s thresholds |
| `modules/geocoding/geocoder.ts` | same name | open to all callers, limits, cache, GTA bias, enriched results |
| `modules/sms/sms.ts` | `platform/sms/*` | driver interface; one `dev_outbox` row per message |
| `modules/notifications/notify.ts` | `modules/notifications/notify.ts` | takes `tx`; keys from business identity |
| `modules/notifications/push.ts`, `triggers.ts` | `platform/push/expo.ts`, `push.handler.ts`, `channels.ts`, `modules/notifications/test-notification.ts` | the FCM branch is deleted; receipts are checked |
| `modules/notifications/device-tokens.ts` | `modules/account/devices.repository.ts` | one statement |
| `modules/chat/on-message-created.ts` | `modules/chat/messages.ts` | in the write's transaction |
| `modules/maintenance/scheduled.ts` | `modules/drivers/stale-drivers.ts` | a scheduler job |
| `legacy/firebase/firestore.rules`, `storage.rules` | §7, `platform/storage/purposes.ts` | policies and object checks |
| `legacy/firebase/firestore.indexes.json` | `backend/migrations/0001_init.sql` | §3.4 |
| `legacy/firebase/tests/*` | `backend/test/**` | §12.4 |
| `legacy/scripts/seed.ts`, `create-admin.ts`, `data/` | `backend/src/cli/seed.ts`, `create-admin.ts`, `seed/` | commands of `dist/cli.js`; repositories and `app.inject` instead of the Admin SDK |
| `legacy/scripts/simulate-driver.ts` | `backend/scripts/simulate-driver.ts` | signs in and drives over HTTP |

### 13.4 Reconciliation with the sibling documents

`docs/CLIENTS.md` and `docs/DEPLOYMENT.md` were written at the same time as this document. Each of
them lists what it assumes about the server. This section answers those lists line by line. After
the alignment done here, almost everything matches; the rows marked **differs** are the only places
where a sibling still has to follow this document.

**`docs/CLIENTS.md`, Appendix A**

| # | Their assumption | Here |
| --- | --- | --- |
| B1 | development API on port 4000, creates its database, CORS for local and LAN origins | matches (§2.6, §4.8). The server binds `::`, which accepts IPv4 too |
| B2 | `/api/v1`, JSON, the envelope, no wrapper on success, `x-request-id` | matches (§4.1, §4.2) |
| B3 | `POST /auth/register` creates a role-less account; `registerCustomer` / `registerDriver` add the role; `registerCustomer` is repeatable | matches (§6.3.1 to §6.3.3) |
| B4 | `AuthSessionResponse`, `MeResponse`, `PATCH /me` with `ProfilePatch`, preferences merged | matches: `ProfilePatch.photoPath` (a confirmed `avatar` upload); CLIENTS.md now declares `photoPath` too |
| B5 | bearer JWT, 900 s, `accessTokenTtlSeconds`, never decoded by the client | matches (§6.2) |
| B6 | a refresh can be repeated after a lost answer | matches (§6.3.5): a repeat is accepted at any age while the token's child is unused |
| B7 | `details.reason` values | matches exactly; there is no `account_locked` (sign-in floods answer `RATE_LIMITED`, §6.3.4) |
| B8 | suspension revokes sessions; the apps learn `account_suspended` | matches (§6.4): `account_suspended` is answered before `session_revoked` on requests, refresh, `/me` and login |
| B9 | the push device belongs to the session's `installationId`; logout and every revocation delete it; device upsert removes the token elsewhere | matches (§6.3.6, §5.3.3) |
| B10 | MARKETPLACE shapes, epoch ms, always an `id`, private parts on their own endpoints | matches (§3.3, §5.4). `UserProfile` keeps `uid`; `PublicTracking`, `RoutePlan`, `Cart` carry no extra id |
| B11 | `{ items, nextCursor }`, kebab-case resources, `/me/…`, scoping filters | matches (§5.3). **Differs** slightly: *every* list is a `Page<T>`, also the small ones the client treats as arrays (take `.items`); a scoping filter that is left out is applied by the server instead of being refused; message lists answer the newest `limit` messages oldest first |
| B12 | frames, `auth` first, acknowledgements, close codes 4401 and 4403 | matches (§8.1). The server also uses 1012 (restart, or events may have been missed) and 1008 (limits; the client waits 5 minutes) |
| B13 | anonymous sockets and public topics | matches |
| B14 | topic names of their §4.1 | matches (§8.2) |
| B15 | payload events; 120 s without a client frame | matches (§8.1, §8.2) |
| B16 | `/ops/dashboard`, `/ops/stores`, `/me/buy-again`, `/store-orders/{id}/proof`, `/deliveries/stats`, `/activity` | all exist (§5.3), with the shapes of §5.4 |
| B17 | `POST /me/location`, `LocationReport`, `LocationAck`, one report per 2 s | matches (§5.3.3) |
| B18 | `POST /files/presign`, `POST /files/confirm`, `GET /files/url`; public image URLs need no header; bucket CORS | matches (§10.1). The server always answers `method: 'POST'`, also with the local driver |
| B19 | `GET /config` → `PublicConfig` | matches (§11.2) |
| B20 | set-password link on the console; 6-digit reset code; `password/forgot` never reveals | matches (§6.3.7, §6.3.8): the link is `WEB_URL/set-password#token=…` and the page calls `POST /auth/invites/inspect` |
| B21 | `POST /call/<name>`; idempotent creations | matches (§4.5, §5.2) |
| B22 | CORS with `Authorization`, `Content-Type`, `X-Client`; WebSocket origins | matches (§4.8) |
| B23 | `GET /products?q=` on the server, `listed=true` | matches. The search is the prefix-key search of MARKETPLACE §5.6 (`searchKeyFor`), not full text |
| B24 | push message: `channelId`, string `data` with `notificationId`, `type`, `userId` | matches (§10.2) |

Also defined here and not assumed there, free for the clients to use: `GET /notifications/unread-count`,
`GET /ledger/balance`, `GET /auth/sessions`, `POST /auth/invites/inspect`, `GET /ops/jobs`,
`DELETE /notifications/{id}`. `GET /dev-outbox` answers `OutboxMessage` (a superset of
`DevOutboxMessage`: email rows, `body` may be null). `failed-precondition` travels with HTTP 412,
`already-exists` with 409, as their fallback table expects.

**`docs/DEPLOYMENT.md`, §2.1 "Backend"**

| Their expectation | Here |
| --- | --- |
| build writes `backend/dist/server.js` and `backend/dist/cli.js`, bundles that contain `@instasupply/shared` | matches (§2.5) |
| start `node dist/server.js` from `backend/`, `PORT`, host `::`, no migrations in production | matches (§2.6, §2.7) |
| shutdown within 30 s | matches (`SHUTDOWN_GRACE_MS` 20 000) |
| CLI: `migrate` (with reference data), `create-admin`, `seed --demo` with `SEED_PASSWORD`, `storage-cors`, `revoke-sessions` | matches (§2.6); `seed --demo` may run next to the live server and gives staff accounts links, not the shared password (§2.2) |
| migrations found relative to the built file | matches (§2.5) |
| health, public config, the 401 envelope of `GET /me` | match (§5.3.1, §11.2, §4.2) |
| WebSocket without token and without `Origin` | matches (§8.1) |
| client address in `X-Real-IP` | matches (§4.6): read by `clientAddress()`; Fastify's `trustProxy` is off |
| logs with a string `level` and a `message` field | matches (§4.3) |
| tests reach PostgreSQL through `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` | matches (§12.1) |
| local files under `backend/.data/` | matches |
| variable names of `.railway/railway.ts` | match (§11.1). Variables that file does not set have safe production defaults here. One note: `API_URL` is derived from `RAILWAY_PUBLIC_DOMAIN`; when the API gets a custom domain, `API_URL` must be added to the backend's variables, or media URLs keep the Railway host name |
| smoke test: `GET /categories` answers a non-empty list | matches: `{ items: [...] }`, filled by `migrate` |

---

## 14. Open questions (only the owner can decide)

1. **Payments on the one Railway environment.** P17 names a single `production` environment and the
   APKs point at it. MARKETPLACE §3.8 says production runs `PAYMENTS_MODE=disabled` until Stripe is
   wired, which makes checkout fail by design. For a working pilot it must be `test` (test cards, no
   money moves). Which one is set?
2. **Pilot tools on the one environment.** MARKETPLACE assumed staging and production (seed data,
   test OTP numbers, `ALLOW_TEST_JOBS=true` on staging). There is only production (P17). May it hold
   the demo data (`seed --demo`), test phone numbers and the "Run payouts now" tool during the pilot?
   This document's defaults say no to the last two.
3. **Production contact values:** HST registration number, support phone and email (MARKETPLACE §15
   question 9).
4. **SMS and email providers.** Until Twilio is contracted, phone verification is `optional` and
   nobody outside development can verify a phone. Until a mail provider is set, password reset codes
   and invite links exist only in the console, visible to admins. Is that acceptable for launch, and
   which mail provider (Resend or SMTP)?
5. **Email ownership is not verified at sign-up** (the Firebase build did not verify it either).
   Should sign-up require a confirmation code once a mail provider exists?
6. **Avatars** were readable by any signed-in user; they are now readable by anyone who has the
   unguessable URL, so that plain image tags work. Accept, or require authorized URLs for avatars too?
7. **Suspending staff and customers** (resolved here, confirm): MARKETPLACE has `setDriverStatus` and
   `setSupplierUserStatus` only. This document adds the admin-only REST endpoint
   `PATCH /users/{uid}/status` for admin, dispatcher and customer accounts (never the last active
   admin), `GET /users/{uid}/sessions`, `POST /users/{uid}/sessions/revoke-all` and the CLI command
   `revoke-sessions`. No command name was added to `CALLABLES`.
8. **Driver payout account:** this document adds `PATCH /users/{uid}/payout-account` (admin) because
   MARKETPLACE §3.9 needs the value and names no way to set it. Confirm.
9. **File retention** (MARKETPLACE §15 question 13, 24 months proposed). Railway buckets have no
   lifecycle rules, so a retention job would have to be written. Decide the period, or keep files
   indefinitely for now.
10. **Maps and routing in production.** The public OpenStreetMap tile, Nominatim and OSRM servers are
    for light use and give no guarantee. Acceptable for the pilot; a paid provider or own instances
    are needed once there is real volume. Who decides when?
11. **Data residency.** MARKETPLACE D13 placed all data in Toronto for Canadian residency. Railway
    has no Canadian region; `docs/DEPLOYMENT.md` uses US East (Virginia) for the services, the
    database and the bucket, and a bucket's region cannot be changed later. Is storing customer data
    in the United States acceptable (a question for the owner's privacy adviser), or is another host
    needed for the data?
12. **Access token lifetime.** 15 minutes is fixed by P5. Because account state is re-read on every
    request anyway, a longer token would not weaken suspension; it would only reduce refresh traffic
    on mobile networks. Keep 15 minutes?
13. **Phone codes for Canadian numbers only.** `requestPhoneOtp` accepts Canadian area codes only
    (SMS-pumping protection). Should US numbers be accepted too (contractors from across the border)?
14. **Twilio geo-permissions:** when Twilio is contracted, allow SMS to Canada only in the Twilio
    console (`docs/DEPLOYMENT.md` §8.3).

---

## 15. Work breakdown

This section replaces MARKETPLACE §14. Workstreams build in parallel from these three documents without
talking to each other, so every file and folder of the repository has **exactly one owner**: only the owner
edits it; everyone else reads it or asks. `docs/MARKETPLACE.md` is frozen and owned by nobody.

**Rules that make the split work**

1. **Frozen interfaces first.** The helper signatures of §9.1, the types of §5.4 and the names of §1.3 are
   frozen. On its first day every wave-2 backend owner pushes its exported §9.1 helpers and its command
   registrations as stubs that throw `ApiError('internal', 'not implemented')`, so the other modules compile
   and their tests can be written against the real call sites.
2. **One module folder, one owner.** `app.ts` (platform) calls each module's `register(app, deps)`; a
   module never edits another module's files and calls it only through §9.1. MARKETPLACE §5.1's `stores/`
   is split into `stores/` (catalogue) and `store-orders/`, and the driver account commands moved from
   `auth/` to `drivers/` (§2.1), so that ownership follows folders.
3. **Each owner's tests run on their own throwaway database** (§12.1) and are named in the owner's row.
   A workstream is done when its rows' acceptance checks pass and the whole suite is still green.
4. **Lockfile.** Only `repo` commits `package-lock.json`; other owners change their own `package.json` and
   ask `repo` to regenerate the lockfile (one change at a time).
5. **Schema.** `backend/migrations/0001_init.sql` is written once by `platform` from §3.2. A wave-2 owner
   who needs a schema change asks `platform` for a new numbered migration (forward only, §2.6); nobody else
   writes in `backend/migrations/`.
6. **Docs.** `docs/PLATFORM.md` → `platform`, `docs/CLIENTS.md` → `api-client`, `docs/DEPLOYMENT.md` →
   `infra`. A change of a shared name is made in the owning document first (§1.3 for the API).

**Waves**

- **Wave 1, foundation.** It ends with a backend that boots on the local PostgreSQL, migrates, answers
  `GET /api/v1/health` (the backend's health check; `/healthz` is the console image's), registers and
  signs in a user, and passes its own tests; `packages/api-client` passing its test kit against it; the
  images building; the test harness in place.
- **Wave 2, in parallel.** The backend domain modules, each with its integration tests, and the three
  clients replacing Firebase with `packages/api-client`.
- **Wave 3, integration.** Seed scenarios, the end-to-end check, the first Railway deployment, the APKs,
  and the removal of the last Firebase package.

### 15.1 Wave 1

| Key | Workstream | Owns (exclusive) | Depends on | Must read | Done when |
| --- | --- | --- | --- | --- | --- |
| `shared` | Shared domain package (the other team) | `packages/shared/**` | — | MARKETPLACE §1 to §4, §5.3, §5.9, §13.1; PLATFORM §16 | Every edit of PLATFORM §16 applied; npm --workspace @instasupply/shared test green (MARKETPLACE §13.1 vectors); tsc --noEmit passes for packages/shared; no export, type or comment names Firebase, Firestore, Cloud Functions, claims or the emulator |
| `repo` | Repository tooling and local development | `package.json` (root)<br>`package-lock.json`<br>`eslint.config.mjs`<br>`.prettierrc.json`<br>`.prettierignore`<br>`.editorconfig`<br>`.nvmrc`<br>`.gitignore`<br>`README.md`<br>`scripts/check-legacy.mjs`<br>`backend/scripts/db.ts`<br>`legacy/**` (read-only reference; nobody edits it)<br>`packages/art/**` (no change expected) | — | PLATFORM §2 (folder boundaries, §2.2 scripts), §11.1; DEPLOYMENT §2.7; CLIENTS §0, §9.4 | root scripts dev:backend, build:backend, test:backend, railway:plan, railway:apply, deploy:backend, deploy:frontend, smoke, lint, format:check, check:legacy, typecheck exist and run; the backend boundary block of PLATFORM §2 and the request.ip rule of §4.6 are in eslint.config.mjs and npm run lint passes; railway@3.17.0 pinned in root devDependencies; firebase-tools and @firebase/rules-unit-testing removed; npm run db -- reset \| status works against the local PostgreSQL 17 without Docker; every other workstream changes only its own package.json; repo regenerates package-lock.json on request, one change at a time |
| `platform` | Backend platform, schema and auth | `backend/package.json`<br>`backend/tsconfig.json`<br>`backend/build.mjs`<br>`backend/.env.example`<br>`backend/migrations/**`<br>`backend/src/server.ts`<br>`backend/src/cli.ts`<br>`backend/src/cli/migrate.ts`<br>`backend/src/cli/create-admin.ts`<br>`backend/src/cli/revoke-sessions.ts`<br>`backend/src/cli/storage-cors.ts`<br>`backend/src/app.ts`<br>`backend/src/container.ts`<br>`backend/src/config/**`<br>`backend/src/platform/**`<br>`backend/src/modules/auth/**`<br>`backend/src/modules/maintenance/**`<br>`backend/test/platform/**`<br>`backend/test/auth/**`<br>`backend/test/authorization/users.authz.test.ts`<br>`backend/test/authorization/files.authz.test.ts`<br>`backend/test/authorization/live-topics.authz.test.ts`<br>`docs/PLATFORM.md` | `shared`, `repo` | PLATFORM §1 to §8, §9.1, §9.3, §9.5 (scheduler, runJobNow, purge), §10.1 to §10.4 (platform halves), §11, §12, §13; MARKETPLACE §0, §5.1, §5.9, §6.2, §6.4; legacy/firebase/functions/src/lib/*, modules/auth/*, modules/sms/*, modules/notifications/push.ts | npm run dev:backend on a machine with only Homebrew PostgreSQL 17: creates instasupply_dev, applies 0001_init.sql (40 tables, 148 indexes) and serves GET /api/v1/health → 200 {status:"ok"} (the backend's /healthz); POST /auth/register, POST /auth/login, POST /auth/refresh and GET /api/v1/me work end to end over HTTP; node dist/cli.js migrate is idempotent; create-admin prints a #token= link; revoke-sessions works; GET /api/v1/live accepts an anonymous socket and an auth frame; the outbox worker, statement (m) and the scheduler with advisory locks pass test/platform; npm run test:backend green for test/platform and test/auth (run on the harness of the `harness` workstream, built in the same wave); commands.test.ts lists every CALLABLES name as registered or as a not-implemented stub owned by its wave-2 module; stub registrations for the 39 commands answer internal "not implemented" until their owner replaces them |
| `harness` | Backend test harness | `backend/test/support/**` | `platform` | PLATFORM §12.1 to §12.3; MARKETPLACE §11 (accounts, stores and products used by fixtures), §13.2, §13.3 | npm run test:backend creates the template `instasupply_test_<stamp>_<rand>_tpl`, one database per file, drops them at the end, and removes left-overs older than 6 hours; two runs started at the same time on one server do not interfere; createTestContext, FakeClock, as(ctx, name), drainOutbox, runJob, connectLive, race and hold work and have their own tests; fixtures import the data files of backend/src/cli/seed/* once the seed workstream has written them; until then they read a minimal in-file set |
| `api-client` | packages/api-client | `packages/api-client/**`<br>`docs/CLIENTS.md` | `shared` | CLIENTS §1, §2, §4.1, §4.2, §5.2, §6.3, §8.1; PLATFORM §4, §5, §6.2, §6.3, §8 | the entry points `.`, `/react`, `/web`, `/native` and `/testing` build and type-check; the test kit of CLIENTS §1.13 passes without a network: single-flight refresh, repeat after a lost answer, proactive refresh at deadline − 60 s keeps an open socket, 1008 waits 5 minutes, account_suspended ends with endReason suspended, non-paged descriptors follow nextCursor; every path and topic it uses is defined in PLATFORM §5 and §8 (scripted comparison); run against the wave-1 backend: register, sign in, refresh, GET /me, live auth and subscribe succeed |
| `infra` | Images, Railway configuration and CI | `backend/Dockerfile`<br>`frontend/Dockerfile`<br>`frontend/Caddyfile`<br>`.railway/railway.ts`<br>`.railwayignore`<br>`.dockerignore`<br>`scripts/smoke.mjs`<br>`.github/workflows/ci.yml`<br>`.github/workflows/deploy.yml`<br>`.github/workflows/customer-app.yml` (deleted)<br>`.github/workflows/driver-app.yml` (deleted)<br>`.github/dependabot.yml`<br>`docs/DEPLOYMENT.md` | `platform`, `repo` | DEPLOYMENT §1, §2, §5, §7; PLATFORM §2.5, §2.7, §11 | docker build -f backend/Dockerfile . produces an image whose node dist/cli.js migrate and node dist/server.js work against a local database; GET /api/v1/health is 200; frontend image serves /healthz and /build-info.json (with a placeholder console build until the console workstream lands); railway config plan evaluates .railway/railway.ts without errors (read-only, against the real project once it exists); ci.yml passes lint, format, types, backend tests on a postgres:17 service and the image smoke test; node scripts/smoke.mjs passes against the local images |

### 15.2 Wave 2

| Key | Workstream | Owns (exclusive) | Depends on | Must read | Done when |
| --- | --- | --- | --- | --- | --- |
| `catalog` | Catalogue and stores | `backend/src/modules/stores/**`<br>`backend/test/workflows/catalogue-workflow.test.ts`<br>`backend/test/authorization/catalogue.authz.test.ts`<br>`backend/test/authorization/cross-store.authz.test.ts` | `platform`, `harness` | MARKETPLACE §1.3 (stores, categories, products, reviews), §1.5, §5.4 (store commands), §5.6 (onProductWritten, onStoreWritten, onStoreReviewWritten), §6.2, §6.3, §8, §11.3; PLATFORM §3.2 to §3.5 (stores, categories, products, store_reviews), §5.3.4, §7.3, §7.4, §9.2.13, §9.4, §10.1 (store_photo, product_photo) | every endpoint of PLATFORM §5.3.4 and the commands createStore, updateStoreSettings, updateStoreProfile; catalogue-workflow.test.ts (product derivation and search_terms, listed, store fan-out, store rating, category edits) on its own throwaway database; catalogue.authz and cross-store.authz green |
| `commerce` | Commerce, payments and the customer's own data | `backend/src/modules/commerce/**`<br>`backend/src/modules/payments/**`<br>`backend/src/modules/account/**`<br>`backend/test/workflows/checkout-workflow.test.ts`<br>`backend/test/authorization/customer-data.authz.test.ts`<br>`backend/test/authorization/orders.authz.test.ts` | `platform`, `harness` | MARKETPLACE §0 (D1 to D7, D17, D18), §1.3 (orders, jobsites, cards, carts), §3 (all of money, §3.8 above all), §4.4 to §4.8, §5.5.1, §5.5.5, §5.10, §7.3 (checkout); PLATFORM §4.5, §5.3.3, §5.3.5 (orders), §9.1, §9.2.1, §9.2.3, §9.2.12, §9.5 (captureDuePayments), §10.4, §12.3 | placeOrder, cancelOrder, registerCustomer-dependent flows and every /me/* endpoint except devices and location; payment.finalize, payment.refund, payment.void handlers with the void procedure and the capture breakdown of PLATFORM §10.4; checkout-workflow.test.ts and the concurrency cases same checkoutId, two first orders, last units, refund once, reduction during capture, void against attach, finalize twice, default flag green on a throwaway database |
| `store-orders` | Store orders | `backend/src/modules/store-orders/**`<br>`backend/test/workflows/store-order-workflow.test.ts` | `platform`, `harness`, `catalog` | MARKETPLACE §1.3 (storeOrders), §2.1, §2.1.1, §4.5, §5.4 (store-order commands), §5.5.2, §5.6 (onStoreOrderWritten), §5.7 (escalate, hold expiry), §8; PLATFORM §3.6, §5.3.5 (store orders), §9.2.2, §9.2.4, §9.4, §9.5 | acceptStoreOrder, updateStoreOrderStatus, rejectStoreOrder, completePickup, the stock helpers and projectDriverOntoStoreOrder (writes only when the projection changes); escalateStoreOrders and expirePickupHolds through runJob; store-order-workflow.test.ts and the cases accept twice and hand-over against release green |
| `deliveries` | Deliveries, job board and drivers | `backend/src/modules/deliveries/**`<br>`backend/src/modules/jobs/**`<br>`backend/src/modules/drivers/**`<br>`backend/test/workflows/delivery-workflow.test.ts`<br>`backend/test/workflows/job-board-workflow.test.ts`<br>`backend/test/authorization/deliveries.authz.test.ts`<br>`backend/test/authorization/job-offers.authz.test.ts` | `platform`, `harness`, `store-orders` | MARKETPLACE §0 (D8, D9), §1.3 (deliveries, jobOffers), §2.3, §2.4, §3.9 and §3.10 (driver pay), §5.4, §5.5.3, §5.5.4, §5.6 (onDeliveryWritten, onJobOfferWritten), §5.7, §10; PLATFORM §3.6, §5.3.5, §6.3.3, §6.4 (suspension), §7.4, §9.2.5 to §9.2.9, §9.2.13, §9.4, §9.5 | the delivery, job and driver commands, PATCH /deliveries/{id}, GET /job-offers, PATCH /users/{uid}/payout-account, markStaleDriversOffline and publishDueJobOffers, every writer through lockGraph; delivery-workflow, job-board-workflow and the cases two claims, claim against the limit, parked trips green; deliveries.authz and job-offers.authz green |
| `routing` | Routing, tracking, location and geocoding | `backend/src/modules/routing/**`<br>`backend/src/modules/tracking/**`<br>`backend/src/modules/geocoding/**`<br>`backend/test/authorization/tracking.authz.test.ts`<br>`backend/test/workflows/tracking-routing.test.ts` | `platform`, `harness`, `deliveries` | MARKETPLACE §1.3 (tracking, routes, driverLocations), §5.4 (geocodeAddress, optimizeRoute), §5.6 (onDriverLocationWritten), §5.11; PLATFORM §5.3.3 (POST /me/location), §5.3.5 (routes, tracking, driver-locations), §9.3 (route.plan, tracking.eta), §9.4 (field ownership of tracking), §9.6; legacy/firebase/functions/src/modules/routing/*, tracking/*, geocoding/* | POST /me/location with the 2-second rule and its online-change exemption, GET /tracking/{token}, GET /routes/{driverId}, GET /driver-locations, optimizeRoute, geocodeAddress with cache and provider limits; route.plan never overwrites status or phase; a delivered trip never shows On the way again (test); tracking.authz green; no provider call inside a transaction (asserted with a recording provider) |
| `quotes-issues` | Quotes and issues | `backend/src/modules/quotes/**`<br>`backend/src/modules/issues/**`<br>`backend/test/workflows/quotes-issues-workflow.test.ts`<br>`backend/test/authorization/quotes-issues.authz.test.ts` | `platform`, `harness`, `commerce`, `store-orders` | MARKETPLACE §0 (D16), §1.3 (quotes, issues), §2.5, §2.6, §3.9 (clawbacks), §5.5.6, §5.5.7, §5.7 (expireQuotes); PLATFORM §5.3.7, §9.2.10, §9.2.11, §10.1 (quote_upload, issue_photo) | submitMaterialList, sendQuote, acceptQuote (idempotent on checkoutId), closeQuote, reopenQuote, reportIssue, resolveIssue, expireQuotes; resolveIssue releases holds through ledger_held_idx; quotes-issues-workflow and the case accept a quote twice green |
| `money-comms` | Ledger, payouts, notifications, support, chat, suggestions and ops | `backend/src/modules/payouts/**`<br>`backend/src/modules/notifications/**`<br>`backend/src/modules/support/**`<br>`backend/src/modules/chat/**`<br>`backend/src/modules/suggestions/**`<br>`backend/src/modules/ops/**`<br>`backend/test/workflows/payouts-support-workflow.test.ts`<br>`backend/test/workflows/notifications-push.test.ts`<br>`backend/test/workflows/device-tokens.test.ts`<br>`backend/test/authorization/finance.authz.test.ts`<br>`backend/test/authorization/support-chat.authz.test.ts`<br>`backend/test/authorization/notifications.authz.test.ts`<br>`backend/test/authorization/suggestions-outbox.authz.test.ts` | `platform`, `harness` | MARKETPLACE §0 (D11), §1.3 (ledgerEntries, payouts, notifications, supportThreads, threads), §3.9, §3.11, §5.6 (message and notification triggers), §5.7 (runDailyPayouts), §5.8, §9; PLATFORM §5.3.6, §5.3.8, §5.3.10, §9.1 (notify*, record*Ledger), §9.2.12 (replacement ledger), §9.5 (runDailyPayouts), §10.2 | notify, notifyUsers, notifyStaff, notifyStoreMembers, notifyDrivers with the keys of PLATFORM §10.2 (driverId on driver_signup and vehicle_review); recordStoreOrderLedger, recordDeliveryLedger, recordClawback, runDailyPayouts, payout.transfer; every endpoint of §5.3.6, §5.3.8, §5.3.10 and the notifications endpoints of §5.3.3; payouts-support-workflow (with the replacement-ledger case), notifications-push and device-tokens green |
| `seed` | Seed data and developer scripts | `backend/src/cli/seed.ts`<br>`backend/src/cli/seed/categories.ts`<br>`backend/src/cli/seed/stores.ts`<br>`backend/src/cli/seed/products.ts`<br>`backend/src/cli/seed/accounts.ts`<br>`backend/src/cli/seed/jobsites.ts`<br>`backend/scripts/simulate-driver.ts` | `platform`, `catalog` | MARKETPLACE §11.1 to §11.4, §11.5 (only to know what scenarios need); PLATFORM §2.2 (seed row), §2.6, §12.2; legacy/scripts/seed.ts, data/*, simulate-driver.ts | seed --demo writes accounts, categories, stores, products, jobsites, cards and reviews; staff demo accounts get links in production mode; refuses a non-empty orders table; --reset and --at refused in production; holds every job advisory lock while it runs; simulate-driver signs in over HTTP and drives a seeded driver; the harness fixtures import these data files |
| `customer-app` | Customer app on the API | `app/customer/**` | `api-client`, `shared` | MARKETPLACE §7; CLIENTS §2.2, §2.4, §2.5, §3.1, §3.2, §4.3, §6, §7, §8.2, §9.1; PLATFORM §5.5 (customer rows) | no file imports firebase or @instasupply/expo-firebase; firebase removed from app/customer/package.json; every screen row of CLIENTS §4.3 works against a local backend with the seed data; tsc, lint and npx expo export --platform android --platform web pass; a build without google-services.json starts and works without push |
| `driver-app` | Driver app on the API | `app/driver/**` | `api-client`, `shared` | MARKETPLACE §10; CLIENTS §2.3, §2.4, §2.5, §3.1, §3.3, §4.6, §5, §6, §7, §8.2, §9.2; PLATFORM §5.3.3 (location), §5.5 (driver rows) | no file imports firebase or @instasupply/expo-firebase; every screen row of CLIENTS §4.6 works against a local backend, including going online and offline, claiming a job and the background location task; mode changes are applied only while the app is active (CLIENTS §5.4); tsc, lint and npx expo export --platform android pass |
| `console` | Web console: ops back office, supplier portal and tracking page | `frontend/** except frontend/Dockerfile and frontend/Caddyfile` | `api-client`, `shared` | MARKETPLACE §8, §9, the tracking page of §7; CLIENTS §2.7, §3.4, §4.4, §4.5, §6.4, §7.5, §8.3, §9.3; PLATFORM §5.5 (console rows), §6.3.8 (set-password) | no file imports firebase; VITE_FIREBASE_* and VITE_USE_EMULATORS gone; every route of CLIENTS §4.4 and §4.5, /set-password reading #token= and calling POST /auth/invites/inspect, /reset-password, /track/:token; driver payout account, held entries, ledger balance, user status and session revocation screens exist; VITE_API_URL=http://localhost:4000 npm run build --workspace @instasupply/frontend passes; vite refuses a build without VITE_API_URL |

### 15.3 Wave 3

| Key | Workstream | Owns (exclusive) | Depends on | Must read | Done when |
| --- | --- | --- | --- | --- | --- |
| `scenarios` | Seed scenarios A to K | `backend/src/cli/seed/scenarios.ts`<br>`backend/test/workflows/seed-smoke.test.ts` | `seed`, `commerce`, `store-orders`, `deliveries`, `routing`, `quotes-issues`, `money-comms` | MARKETPLACE §11.5; PLATFORM §2.2 (seed row), §9.5, §12.4 (seed-smoke) | seed --demo --at 2026-11-19T12:25:00-05:00 reaches the end states of MARKETPLACE §11.5 (IS-10001 captured 38 825, payouts 17 083 / 12 677 / 4 775 / 4 200, CASE-10001 open, Q-10002 quoted 129 970, IS-10006 cancelled and voided); seed --demo with the real clock succeeds at any hour (run at night and on a Sunday); seed-smoke.test.ts green; the whole backend suite green |
| `e2e` | End-to-end check across the three clients | `scripts/e2e.mjs` | `scenarios`, `customer-app`, `driver-app`, `console`, `infra` | MARKETPLACE §11.5 (scenario B as the script), §7 to §10; CLIENTS Appendix C; DEPLOYMENT §5 | node scripts/e2e.mjs --api http://localhost:4000 signs in as seeded customer, supplier and driver over HTTP and the live socket, places an order, accepts, readies, claims, hands over with the PIN, delivers with a proof upload, and sees each step on the other actors' live topics; refuses to run against a production URL unless --allow-writes is given; a manual pass of the customer app, the driver app (emulator) and the console against the local stack is recorded in the pull request |
| `deploy` | First production deployment on Railway | `no repository files` (the Railway project instasupply, environment production; changes to .railway/railway.ts go through infra) | `infra`, `scenarios`, `console` | DEPLOYMENT §3, §4.1, §4.2, §5, §8.3 | DEPLOYMENT §3.3 to §3.12 done: both services SUCCESS (attached railway up), Postgres has no TCP proxy, backups scheduled, bucket CORS set, first admin signed in through a #token= link; npm run smoke passes against production with EXPECT_PAYMENTS_MODE and EXPECT_PHONE_VERIFICATION set; demo data loaded only if the owner said yes (§3.13) |
| `android` | Android release APKs against production | `scripts/android-release.sh`<br>`scripts/patch-android-release.mjs`<br>`.github/workflows/android.yml`<br>`.build/**` (git-ignored build image and APKs) | `customer-app`, `driver-app`, `deploy` | DEPLOYMENT §6, §7.5; CLIENTS §6.7, §8.2, §8.4, §8.5 | scripts/android-release.sh customer and driver produce signed APKs from /Volumes/isbuild with EXPO_PUBLIC_API_URL = the production origin; keystores under ~/.instasupply/android-signing; GOOGLE_SERVICES_JSON pointing outside the repository is copied into the build copy; both APKs install on an emulator, sign in to production and complete scenario B steps; without google-services.json they run without push |
| `release` | Firebase removal and documentation | `packages/expo-firebase/**` (deleted)<br>`docs/ARCHITECTURE.md` | `customer-app`, `driver-app`, `console` | CLIENTS §3.5; PLATFORM (whole); DEPLOYMENT §1 | packages/expo-firebase deleted and removed from the workspaces; grep finds no "firebase" import in backend, frontend, app or packages; docs/ARCHITECTURE.md rewritten for the Railway, PostgreSQL and api-client build and links the three specs |

### 15.4 Files nobody owns

None. Everything not listed above is either generated (`node_modules/`, `**/dist/`, `backend/.data/`,
`.build/`) or local to one machine (`.claude/`, `.env` files, keystores outside the repository), and is never
committed or uploaded (`.railwayignore`, `.gitignore`).

## 16. What changes in `packages/shared`

The shared package is being rebuilt by its own team; this document does not edit it. Checked on 2026-11-20
with `grep` over `packages/shared/src`: the 39 `CALLABLES`, `CallableContracts`, `ScheduledJobName`,
`TimestampLike = number` and every function §13.2 names already exist. These edits remain. Until they land,
the backend declares the missing types once in `platform/http/contract.ts` and the client in
`packages/api-client` (§5.4); both delete their copies when `rest.ts` exists.

| # | File | Edit |
| --- | --- | --- |
| 1 | `types.ts` | `TimestampLike` stays `export type TimestampLike = number` (done on 2026-11-20). Every `…At` field is epoch milliseconds; `format.ts` (`formatInstant` and friends) accepts a number only and drops the `Date` branch, so no client can pass a Firestore-style object. |
| 2 | `types.ts` | Delete `AuthClaims` ("Custom claims set on Firebase Auth users by Cloud Functions"). Role, status, store, city and capacity class are `users` columns re-read on every request (PLATFORM §6.4) and reach clients inside `UserProfile` (`GET /me`). |
| 3 | `types.ts` | `PushProvider` becomes `'expo'` only (drop `'fcm'`). Replace `DeviceRegistration` by `DeviceInput { token; provider: 'expo'; platform: DevicePlatform; appVersion: string \| null; deviceName: string \| null }` (no `app`, no timestamps: PLATFORM §5.4). The comment on `AppNotification.data` says "strings, as the Expo push service carries them" instead of FCM. |
| 4 | `types.ts` | Replace `DevOutboxMessage` (SMS only) by `OutboxMessage` exactly as PLATFORM §5.4 (`channel: 'sms' \| 'email'`, `subject`, `body: string \| null`, purposes plus `password_reset` and `invite`, `provider`, `status`). |
| 5 | `types.ts` | `UserProfile` comment: the user edits `displayName`, `photoPath` (an `avatar` upload; the server derives `photoURL`), `preferences`, and as a customer `companyName`, `accountType`, through `PATCH /api/v1/me`; "functions write everything else" becomes "the server writes everything else". |
| 6 | `constants.ts` | Delete `COLLECTIONS` (Firestore collection names) and `DEFAULT_FUNCTIONS_REGION`. Keep `STORAGE_FOLDERS` with the comment "storage path prefixes of MARKETPLACE §6.4 (PLATFORM §10.1)". |
| 7 | `constants.ts` | `CALLABLES` comment: "Command names: `POST /api/v1/call/<name>` (PLATFORM §5.2)". The 39 names stay exactly as they are; no name is added (staff and customer suspension is REST: `PATCH /users/{uid}/status`). |
| 8 | `constants.ts` | `NOTIFICATION_DATA_KEYS` gains `'driverId'` (admin `driver_signup` and `vehicle_review`, PLATFORM §10.2). |
| 9 | `constants.ts` | Add `UPLOAD_LIMITS: Record<UploadPurpose, { maxBytes: number; contentTypes: readonly string[]; perScope: { max: number; perDay: boolean } }>` with the numbers of PLATFORM §10.1 (proof 10 MB images, 5 per delivery; quote_upload 15 MB images/PDF/CSV/XLS/XLSX, 10 per request; issue_photo 10 MB, 12 per issue; store_photo 5 MB, 20 per store per day; product_photo 5 MB, 300 per store per day; avatar 5 MB, 5 per day; images = jpeg, png, webp, heic, heif, never SVG) and `export type UploadPurpose = 'proof' \| 'quote_upload' \| 'issue_photo' \| 'store_photo' \| 'product_photo' \| 'avatar'`. `validation.ts` (`MAX_LIST_FILE_BYTES`, the quote attachment types) reads these values instead of its own copies. |
| 10 | `validation.ts` | Add `CANADIAN_AREA_CODES` (204, 226, 236, 249, 250, 257, 263, 289, 306, 343, 354, 365, 367, 368, 382, 387, 403, 416, 418, 428, 431, 437, 438, 450, 460, 468, 474, 506, 514, 519, 548, 579, 581, 584, 587, 604, 613, 639, 647, 672, 683, 705, 709, 742, 753, 778, 780, 782, 807, 819, 825, 867, 873, 879, 902, 905, 942; the shared team checks the list against the CNA numbering plan before release) and `isCanadianNumber(e164: string): boolean` for `requestPhoneOtp` (PLATFORM §6.3.9). `normalizePhone` stays NANP-wide for jobsite contacts. |
| 11 | `rest.ts (new, exported from index.ts)` | Move the REST contract of PLATFORM §5.4 here, names and fields unchanged: `Page`, `WithId`, `ApiStatus` (the eight HttpsError-style statuses plus `unavailable`), `ApiErrorBody`, `HealthResponse`, `PublicConfig`, `ClientApp`, `RegisterRequest`, `LoginRequest`, `SetupPasswordRequest`, `AuthTokens`, `MeResponse`, `AuthSessionResponse`, `InviteInfo`, `SessionInfo`, `PayoutAccountPatch`, `UserStatusPatch`, `AuthFailureReason`, `ProfilePatch`, `JobsiteInput`, `CardInput`, `Favorite`, `DeviceInput`, `CartInput`, `Fix`, `TrackingMode`, `LocationReport`, `LocationAck`, `ProductInput`, `ProductPatch`, `CategoryInput`, `ReviewInput`, `StoreOrderProof`, `DeliveryStats`, `DeliveryPatch`, `ChatMessageInput`, `SupportMessageInput`, `SupportThreadPatch`, `AssignPatch`, `IssueNotes`, `LedgerBalance`, `PresignRequest`, `PresignedUpload`, `UploadedFile`, `FileUrlResponse`, `OpsDashboard`, `OpsStoreRow`, `JobState`, `OutboxEvent`. Then `backend/src/platform/http/contract.ts` and `packages/api-client/src/resources/*` delete their copies and import these. |
| 12 | `api.ts` | Header: "Request and response contracts of the commands, `POST /api/v1/call/<name>`" instead of "callable Cloud Functions". `RequestPhoneOtpResponse.devCode`: "only when the server runs with `EXPOSE_DEV_CODES=true`" instead of "local emulator". `SetDriverStatusRequest.force` and `AssignDeliveryRequest.force` comments: `setDriverStatus.force` is honoured only when `ALLOW_TEST_JOBS=true`; `assignDelivery.force` overrides `VEHICLE_TOO_SMALL` for staff. |
| 13 | `errors.ts` | Comments: codes travel as the top-level `error.code` of the envelope `{ error: { status, code, message, details } }` (PLATFORM §4.2), not as `details.code`; `ErrorCodeStatus` is "the `ApiStatus` a code travels with" (no HttpsError). Values unchanged. |
| 14 | `status.ts` | `EntryPoint`: `'direct_write'` becomes `'rest_write'` (a REST write endpoint of PLATFORM §5.3 that runs the old rule's checks); comment "a command, a scheduled job, or a REST write". |
| 15 | `catalog.ts, market.ts, jobs.ts, support.ts, validation.ts, money.ts, vehicles.ts, polyline.ts` | Rewrite the comments that cite security rules, Storage rules, claims or Firestore storage quirks ("The security rules repeat this list", "the rules match them against the driver's claims", "Firestore stores it as a double", "small enough for Firestore") to name the server check instead (PLATFORM §7 policies, the strict zod schemas of §4.1, the `users` columns). Behaviour unchanged; the integer and -0 guards stay because amounts are integer columns. |

Nothing in the list changes a domain rule, a price, a state machine or a time computation of MARKETPLACE
§1 to §4. The shared unit tests of MARKETPLACE §13.1 must stay green after every edit.
