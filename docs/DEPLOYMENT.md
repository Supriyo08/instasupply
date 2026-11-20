# Deploying InstaSupply: Railway and the Android apps

This is the runbook for production. It covers the Railway project (API server, PostgreSQL, object
storage, web console), the release builds of the two Android apps, and CI. It replaces the Firebase
guide that used to live in this file: nothing of the Firebase procedure is left.

Companion documents: `docs/PLATFORM.md` (the API server and the database) and `docs/CLIENTS.md` (the web
console, the apps and `packages/api-client`). `docs/MARKETPLACE.md` stays the specification of the domain.

**Status.** Written on 2026-11-19 from the platform documentation, the Railway CLI source and the packages
installed in this repository. On 2026-11-20 the infra workstream wrote the files of §2 and §5 and checked them
on this machine against the real backend (§2.8): both images build, the API image migrates and serves against
the local PostgreSQL 17, and the smoke test passes except for the one endpoint whose module is not written
yet. Nothing was deployed or created on Railway. A separate trial of the Android build ran on this machine at
the same time; §6.12 says what it had shown.
[Appendix A](#appendix-a-what-was-verified-and-where) lists every platform fact that was checked and where;
[Appendix B](#appendix-b-what-was-not-verified) lists what was not and must be confirmed on the first run.

## Names used in this document

| Name | Value |
| --- | --- |
| `REPO` | `/Volumes/Supriyo disk /supriyo project /instasupply`. The path contains spaces: always quote it. |
| Railway project · environment | `instasupply` · `production` |
| Railway services | `backend` (API server), `frontend` (web console) |
| Railway database | `Postgres` (PostgreSQL 17, image `ghcr.io/railwayapp-templates/postgres-ssl:17`) |
| Railway bucket | `uploads` (region `iad`) |
| Railway region | `us-east4-eqdc4a` (US East, Virginia) |
| `<API_HOST>` · `API_URL` | Host name of the backend's public domain · `https://<API_HOST>` |
| `<WEB_HOST>` · `WEB_URL` | Host name of the frontend's public domain · `https://<WEB_HOST>` |
| Custom domains (proposed) | `api.instasupply.ca` (backend), `app.instasupply.ca` (console). The owner confirms them in §8.3. |
| Android packages | `com.instasupply.shop` (customer app), `com.instasupply.driver` (driver app) |
| `BUILD_ROOT` | `/Volumes/isbuild`: where Android builds run, a path without spaces. It is the disk image `REPO/.build/android-build.sparseimage` (§6.2). Finished APKs are copied to `REPO/.build/apk/`. |

Two facts shape everything below. Read them before anything else.

1. **Railway's per-service config files are gone.** `railway.json` and `railway.toml` ("Config as Code")
   are deprecated: new services cannot use them, and Railway stops reading existing files on 2026-12-01.
   The replacement is one file for the whole project, `.railway/railway.ts` ("Infrastructure as Code"),
   which the Railway CLI evaluates on this machine and applies with `railway config apply`. This repository
   therefore has **one** Railway config file, not one per service (§2.2).
2. **`.railwayignore` must exclude everything by itself.** The CLI only applies `.gitignore` inside a git
   repository. This folder was not one when this document was written; on 2026-11-20 a `.git` folder with a
   first commit appeared, so today the CLI applies `.gitignore` as well. Do not rely on that: a copy of the
   folder without `.git` (a backup, a fresh checkout without history) would upload every file that is not
   under `node_modules` or `.git`, including `.env` files and keystores. `.railwayignore` (§2.6) is written to
   be the only filter.

---

## 1. Production topology

```
        browsers                                   Android / iOS apps
  ops · suppliers · tracking page                  customer · driver
        │  HTTPS                                     │  HTTPS + WSS
        ▼                                            ▼
┌────────────────────────── Railway edge (TLS, HTTP/1.1, HTTP/2, WebSocket) ─────────────────────────┐
│     https://<WEB_HOST>                                https://<API_HOST>                           │
└─────────┬──────────────────────────────────────────────────────┬───────────────────────────────────┘
          │ HTTP :8080                                           │ HTTP + WebSocket :8080
          ▼                                                      ▼
  ┌───────────────────┐                             ┌─────────────────────────────────┐
  │ frontend          │                             │ backend                         │
  │ Caddy, static     │                             │ Node 22 · Fastify               │
  │ files of the      │                             │ REST + commands /api/v1/*       │
  │ console           │                             │ WebSocket /api/v1/live          │
  │ (no outbound      │                             │ outbox worker · scheduled jobs  │
  │  connections)     │                             └───────┬──────────────────┬──────┘
  └───────────────────┘                                     │                  │
                                 private network (WireGuard)│                  │ outbound HTTPS
                          postgres.railway.internal:5432    │                  ├──► bucket "uploads" (S3 API)
                                                            ▼                  ├──► exp.host (Expo push)
                                                   ┌──────────────────┐        ├──► Nominatim · OSRM (or Google)
                                                   │ Postgres         │        ├──► Twilio · Resend (when enabled)
                                                   │ PostgreSQL 17    │        └──► payment gateway (later)
                                                   │ + volume         │
                                                   └──────────────────┘

  browsers and apps ── presigned uploads and downloads, HTTPS ──► bucket "uploads" (not through the backend)
```

### 1.1 Services

| Resource | What it is | Source | Listens on | Public | Replicas |
| --- | --- | --- | --- | --- | --- |
| `backend` | API server: REST, commands, WebSocket, outbox worker, scheduled jobs, all in one process | `backend/Dockerfile`, built from the repository root | `PORT=8080`, host `::` | `https://<API_HOST>` | 1 (2 when needed, §4.8) |
| `frontend` | Static build of the console (ops back office, supplier portal at `/portal`, tracking page `/track/:token`) served by Caddy | `frontend/Dockerfile`, built from the repository root | `PORT=8080` | `https://<WEB_HOST>` | 1 |
| `Postgres` | PostgreSQL 17 with a volume mounted at `/var/lib/postgresql/data` | Railway's image `postgres-ssl:17` | 5432 | **no** (private network only, §3.5) | 1 |
| `uploads` | S3-compatible object storage for drop-off photos, quote uploads, issue photos, store and product photos | Railway bucket | `https://t3.storageapi.dev` | private; reached with presigned URLs | n/a |
| Customer web app (Expo web) | **not deployed in this release.** The customer app's web target is exported in CI (§7.3) only to catch bundling errors. Deploying it later means a third static service built like `frontend` (`npx expo export --platform web`), its origin added to `CORS_ORIGINS` in `.railway/railway.ts`, and `storage-cors` run again | — | — | — | — |

### 1.2 What talks to what

| From | To | How | Notes |
| --- | --- | --- | --- |
| Browser (console) | `frontend` | HTTPS | Static files only. `frontend` never calls `backend`. |
| Browser (console), apps | `backend` | HTTPS `https://<API_HOST>/api/v1/*` | Browsers are cross-origin: `backend` allows the origins in `CORS_ORIGINS`. Apps send no `Origin` header. |
| Browser (console), apps | `backend` | WebSocket `wss://<API_HOST>/api/v1/live` | Railway keeps WebSocket connections open without an idle limit. Clients still send heartbeats (mobile networks drop idle connections). |
| `backend` | `Postgres` | `DATABASE_URL` → `postgres.railway.internal:5432` | Private network, encrypted by WireGuard. No TLS on this hop. Not reachable from the internet. |
| `backend` | `uploads` | S3 API over public HTTPS | Buckets are not on the private network. `backend` signs URLs; it does not relay file bytes. |
| Browser, apps | `uploads` | Presigned uploads (`POST` or `PUT`) and presigned `GET` | Browsers need CORS on the bucket (§3.9). The URLs expire after minutes. |
| `backend` | Expo push, Nominatim, OSRM, Twilio, Resend | Outbound HTTPS from the outbox worker | Never inside a database transaction. |
| Operator's laptop | Railway | Railway CLI over HTTPS; `railway ssh` and `railway connect` through `ssh.railway.com` | No inbound port is opened for operations. |

### 1.3 Public URLs

| URL | Who uses it |
| --- | --- |
| `https://<API_HOST>/api/v1/…` | Console, apps, the smoke test |
| `wss://<API_HOST>/api/v1/live` | Console, apps |
| `https://<API_HOST>/api/v1/health` | Railway's deploy health check, the smoke test |
| `https://<WEB_HOST>/` | Ops back office |
| `https://<WEB_HOST>/portal` | Supplier portal |
| `https://<WEB_HOST>/track/:token` | Public tracking page (the link sent by SMS) |
| `https://<WEB_HOST>/healthz` | Railway's deploy health check for the console |
| `https://<bucket>.t3.storageapi.dev/…?X-Amz-…` | Presigned file URLs, valid for minutes |

Nothing else is public. In particular PostgreSQL has no public port after §3.5.

### 1.4 Where the data lives

Railway has four regions: US West (California), US East (Virginia), EU West (Amsterdam) and Southeast Asia
(Singapore). **There is no Canadian region.** Everything runs in US East (Virginia), the closest one to
Toronto: `backend`, `frontend` and `Postgres` in `us-east4-eqdc4a`, the bucket in `iad`. A bucket's region
can never be changed. The owner must know that personal information is stored in the United States (§8.2).

---

## 2. Files to add to the repository

| File | Status | Purpose |
| --- | --- | --- |
| `.railway/railway.ts` | new | The whole Railway environment: database, bucket, both services, their settings and variables (§2.2) |
| `backend/Dockerfile` | new | Image of the API server (§2.3) |
| `frontend/Dockerfile` | new | Image of the console: Vite build served by Caddy (§2.4) |
| `frontend/Caddyfile` | new | Static server configuration (§2.5) |
| `.railwayignore` | new | What `railway up` must not upload (§2.6) |
| `.dockerignore` | new | The same rules in Docker's syntax, for `docker build` on a laptop and in CI (§2.6) |
| `scripts/smoke.mjs` | new | Post-deploy smoke test, also used by CI (§5) |
| `scripts/android-release.sh`, `scripts/patch-android-release.mjs` | new | Android release builds (§6) |
| `.github/workflows/ci.yml`, `deploy.yml`, `android.yml` | replaced / new | CI (§7) |
| `package.json` (root) | changed | `railway` SDK and a few scripts (§2.7) |

Where they live. The backend, the frontend and the apps each keep their own folder, and each deployable
is built from a Dockerfile inside its own folder:

```
instasupply/
├── backend/                    the API server (PLATFORM.md) → Railway service "backend"
│   └── Dockerfile              §2.3
├── frontend/                   the web console (CLIENTS.md) → Railway service "frontend"
│   ├── Dockerfile              §2.4
│   └── Caddyfile               §2.5
├── app/                        the two Expo apps (CLIENTS.md) → APKs; never uploaded to Railway
│   ├── customer/
│   └── driver/
├── packages/                   code the three share: shared, art, api-client
├── .railway/
│   └── railway.ts              §2.2: Railway reads one file per repository, at this path
├── .railwayignore              §2.6
├── .dockerignore               §2.6
├── scripts/                    tools that span folders
│   ├── smoke.mjs               §5
│   ├── android-release.sh      §6.5
│   └── patch-android-release.mjs   §6.6
├── .github/workflows/          §7: ci.yml, deploy.yml, android.yml
└── .build/                     git-ignored: the Android build image and the finished APKs (§6)
```

The separation holds inside the images too. The backend image contains `backend/` and `packages/shared`;
the console image contains the build of `frontend/` with `packages/shared`, `packages/art` and
`packages/api-client`; neither contains a file of the other or of `app/`. The apps are built from `app/` and
`packages/`; of `backend/` and `frontend/` the build copy takes the `package.json` alone, which npm needs to
read the lockfile. Only what cannot belong to one folder sits at the root: Railway's project file, the two
ignore files (they filter the root, which is the upload and the build context of both services), the
scripts and the workflows.

There is **no** `railway.json` or `railway.toml` anywhere, and there must never be one: a service that reads
such a file cannot be managed by `.railway/railway.ts`.

### 2.1 What these files expect from the other workstreams

The Dockerfiles, the Railway config and the scripts rely on the names below. They are the contract between
this document, `docs/PLATFORM.md` and `docs/CLIENTS.md`. When one of those documents uses another name, change
it here or there, but in one place only.

Both siblings were read when this document was finished and reconciled again on 2026-11-20. PLATFORM.md
§2.7 states the backend's side of this table and its §13.4 goes through it line by line: every row matches,
including the start-up and demo-data rows. CLIENTS.md §8 uses the same names for the console and the apps.

**Backend (`@instasupply/backend`)**

| What | Expected |
| --- | --- |
| Build | `npm run build --workspace @instasupply/backend` writes `backend/dist/server.js` and `backend/dist/cli.js`. Both are ES-module **bundles that contain `@instasupply/shared`** and import every other dependency from `node_modules`. (`packages/shared` is TypeScript source with extension-less imports, so Node cannot load it directly.) The build tool is a `devDependency` of `backend` or of the root. |
| Start | `node dist/server.js` from `backend/`. Listens on `process.env.PORT` (8080 on Railway, 4000 in development) on host `::`, which is what Railway asks of Fastify so that the service answers on IPv4 and IPv6, publicly and on the private network. Applies **no** migrations when `NODE_ENV=production`: the pre-deploy command does that. |
| Shutdown | On `SIGTERM`: stop accepting requests, close WebSocket connections, stop the timers and the outbox worker, exit within 30 seconds. |
| CLI | `node dist/cli.js <command>`: `migrate` (apply pending SQL migrations and upsert reference data such as the 25 categories; idempotent; exit code 0 or 1), `create-admin --email <e> --name <n>` (creates or finds the admin and prints a one-time set-password link to standard output, nowhere else), `seed --demo` (the demo data of MARKETPLACE §11; password from `SEED_PASSWORD`, and it refuses to run with `NODE_ENV=production` when `SEED_PASSWORD` is unset or is the development default), `storage-cors` (sets the bucket's CORS rules from `CORS_ORIGINS`). |
| Migrations | `backend/migrations/*.sql`, found relative to the built file (`dist/../migrations`), not relative to the working directory. |
| Health | `GET /api/v1/health` → `200` and `{ "status": "ok" }` only when the database answers. No authentication. |
| Public config | `GET /api/v1/config` → `200` and at least `{ "paymentsMode": "test" \| "stripe" \| "disabled", "phoneVerification": "required" \| "optional" \| "off" }`. |
| Auth errors | `GET /api/v1/me` without a token → `401` and `{ "error": { "status": "unauthenticated", "code", "message", "details" } }`. |
| WebSocket | `/api/v1/live` accepts a connection without a token and without an `Origin` header (authorization happens per subscription). |
| Client address | Behind Railway the caller's address is in the `X-Real-IP` header, read by the backend's `clientAddress()` because `TRUST_PROXY=true`. Fastify's own `trustProxy` is off: Railway's edge does not set `X-Forwarded-For`, so that header is whatever the client sent (PLATFORM.md §4.6). |
| Logs | One JSON object per line with a string `level` (`debug`, `info`, `warn`, `error`) and a `message` field: that is the shape Railway's log explorer understands. |
| Tests | `npm run test --workspace @instasupply/backend` creates and drops its own databases through the libpq variables `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` and the maintenance database `postgres`. |
| Local files | The `local` storage driver writes under `backend/.data/`. |
| Variables | The names in the table of §2.2; all of them are in PLATFORM.md §11.1. |
| Own public origin | `API_URL` when set, otherwise `https://` + `RAILWAY_PUBLIC_DOMAIN` (a variable Railway injects). Media URLs start with it. |
| Production checks | With `NODE_ENV=production` the server and every CLI command stop on an unsafe configuration (PLATFORM.md §11.1): among others `STORAGE_DRIVER=local`, an empty `CORS_ORIGINS`, a secret shorter than 32 characters, `PHONE_VERIFICATION=required` without an SMS provider, and neither `API_URL` nor `RAILWAY_PUBLIC_DOMAIN`. A wrong variable therefore fails the pre-deploy command, and the previous version keeps serving. |
| Start-up | The server does not call the bucket, the SMS or mail provider or Expo when it starts (PLATFORM.md §2.7): CI starts the image with stand-in bucket values (§7.3). |
| Demo data next to a live server | `seed --demo` may run inside the live container: it holds the advisory lock of every scheduled job while it runs, calls the job bodies itself (so `ALLOW_TEST_JOBS` stays `false`), refuses a non-empty `orders` table and gives the demo staff accounts set-password links instead of `SEED_PASSWORD` in production (PLATFORM.md §2.2). `--at <ISO>` (a fixed clock) is for development and CI only. |
| Revoking access | `node dist/cli.js revoke-sessions --email <e>`, and for admins in the console `POST /users/{uid}/sessions/revoke-all` and `PATCH /users/{uid}/status` (PLATFORM.md §5.3.2). |

**Frontend (`@instasupply/frontend`)**

| What | Expected |
| --- | --- |
| Build | `npm run build --workspace @instasupply/frontend` writes `frontend/dist/`. It needs `packages/shared`, `packages/art` and `packages/api-client` (package `@instasupply/api-client`). |
| API address | Read from `import.meta.env.VITE_API_URL` and from nowhere else. Everything else the console needs (payments mode, map tiles, support phone) comes from `GET /api/v1/config` at run time. |
| Routes | Client-side routes, including `/portal`, `/track/:token` and `/set-password`. The static server answers every unknown path with `index.html`. |
| Reserved paths | `/healthz` and `/build-info.json` are served by the image, not by the app. |

**Apps (`app/customer`, `app/driver`)**

| What | Expected |
| --- | --- |
| API address | `process.env.EXPO_PUBLIC_API_URL`, inlined by Metro at build time: the origin of the API, `https://host`, with no path and no trailing slash. Its default for release bundles is in `app/<app>/.env.production` (CLIENTS.md §8.2); a value in the shell wins over that file. |
| Build variables read by `app.config.ts` | `APP_VARIANT` (`production` gives the package ids above), `EAS_PROJECT_ID`, `GOOGLE_SERVICES_JSON` (path of `google-services.json`). All three already exist in today's `app.config.ts`. |
| Push | A build without `google-services.json` must start and work without push (§6.10). |
| EAS | A build profile named `production-apk` in each `eas.json` (§6.9). |

### 2.2 `.railway/railway.ts`

One file describes the environment. The Railway CLI evaluates it with Node's type stripping
(`node --experimental-strip-types`), so keep it to plain TypeScript: no enums, no decorators. It imports
`railway/iac` from the npm package `railway`, which must be a root `devDependency` (§2.7).

How the file is used:

```bash
railway config plan     # read-only: what would change
railway config apply    # shows the same plan, asks, then applies
```

Three rules:

- **The file owns what it declares, and what it does not declare is deleted.** A service, a bucket or a
  variable that exists on Railway but is missing from the file is planned for deletion. The plan marks such
  changes as destructive. Read every plan before applying it.
- **Secrets are never written in the file.** They are set once with `railway variable set NAME --stdin`
  (§3.7) and appear in the file as `preserve()`, which means "keep whatever Railway has".
- **Generated domains are not in the file; custom domains are.** Railway-provided `*.up.railway.app`
  domains are created with `railway domain` and are never part of the file (the IaC reference says so).
  Custom domains are declared on their service with `domains: [{ domain, port }]`, the syntax of
  docs.railway.com/infrastructure-as-code/reference ("Custom domains"). Because the file owns what it
  declares, a custom domain added only with the CLI could be planned for removal by the next apply. If the
  installed CLI refuses `domains` in the file (an earlier reading of the CLI source suggested it might,
  Appendix A5), follow the fallback of §4.9 and the hard rule of §4.2.
- **The database's public TCP proxy comes back.** A database declared in the file is compiled with a public
  TCP proxy on 5432 (Appendix A6), and no option to leave it out is documented. §3.5 deletes it, and every
  `railway config apply` is followed by the check of §4.2.

```ts
/**
 * InstaSupply on Railway: the whole production environment.
 *
 *   railway config plan     # read-only: what would change
 *   railway config apply    # shows the plan, asks, then applies
 *
 * - This file owns everything it declares. A service, bucket or variable that exists on Railway but is
 *   missing here is planned for DELETION. Read every plan before applying it.
 * - Secrets are never written here. They are set once with `railway variable set NAME --stdin` and are
 *   listed below as preserve() ("keep whatever Railway has").
 * - Railway-provided domains are managed with `railway domain`; custom domains are declared below (§4.9).
 * - After every apply: `railway tcp-proxy list --service Postgres` must be empty (§4.2).
 *
 * Evaluated by the Railway CLI with Node's type stripping: plain TypeScript only. See docs/DEPLOYMENT.md §2.2.
 */
import { bucket, database, defineRailway, preserve, project, ref, service } from 'railway/iac';

/** US East (Virginia), the Railway region closest to Toronto. Railway has no Canadian region. */
const REGION = 'us-east4-eqdc4a';

/** Buckets have their own region codes. A bucket's region can never be changed. */
const BUCKET_REGION = 'iad';

/**
 * PostgreSQL major version. NEVER change this tag to upgrade: a new image does not run pg_upgrade and the
 * database will not start. Upgrade in the dashboard (Postgres → Database → Config → Major Version Upgrade),
 * then change the tag here to match what is running.
 */
const POSTGRES_IMAGE = 'ghcr.io/railwayapp-templates/postgres-ssl:17';

/**
 * Public host names, without a scheme. They start as references to the Railway-provided domains. Before a
 * custom domain is added they are replaced with literals: first the Railway host names, then
 * 'api.instasupply.ca' and 'app.instasupply.ca' (§4.9).
 */
const API_HOST = '${{backend.RAILWAY_PUBLIC_DOMAIN}}';
const WEB_HOST = '${{frontend.RAILWAY_PUBLIC_DOMAIN}}';

/**
 * The API's own public origin, which the server puts into media URLs. On its Railway-provided domain the
 * server derives it from RAILWAY_PUBLIC_DOMAIN, a variable Railway injects, so nothing is set. With a custom
 * domain it has to be told: this adds API_URL as soon as API_HOST is a literal.
 */
const API_URL_OVERRIDE: Record<string, string> = API_HOST.includes('${{')
  ? {}
  : { API_URL: 'https://' + API_HOST };

/** More browser origins that may call the API, for example the old console URL during a domain change. */
const EXTRA_WEB_ORIGINS: string[] = [];

/**
 * Custom domains (§4.9). Empty until DNS access exists. Every APK and console build made against a custom
 * domain depends on it: never remove an entry once a build uses it.
 */
const API_CUSTOM_DOMAINS: string[] = []; // later: ['api.instasupply.ca']
const WEB_CUSTOM_DOMAINS: string[] = []; // later: ['app.instasupply.ca']

/**
 * 'test'     pilot: card payments are simulated and no money moves (MARKETPLACE §3.8). Team and demo use only.
 * 'disabled' checkout is closed.
 * 'stripe'   real payments. The server refuses to start with this value until the gateway is built.
 */
const PAYMENTS_MODE = 'test';

/** Number of API instances. Read §4.8 before changing it. */
const BACKEND_REPLICAS = 1;

export default defineRailway(() => {
  const db = database('Postgres', 'postgres', {
    image: POSTGRES_IMAGE,
    output: 'DATABASE_URL',
    defaultMountPath: '/var/lib/postgresql/data',
    region: REGION,
  });

  const uploads = bucket('uploads', { region: BUCKET_REGION });

  const backend = service('backend', {
    build: {
      builder: 'DOCKERFILE',
      dockerfilePath: 'backend/Dockerfile',
      // Only used once the service deploys from GitHub: `railway up` always builds.
      watchPatterns: ['/backend/**', '/packages/shared/**', '/package.json', '/package-lock.json'],
    },
    domains: API_CUSTOM_DOMAINS.map((domain) => ({ domain, port: 8080 })),
    // Runs in a separate container of the new image, before the new version starts. A failure stops the
    // deployment and the previous version keeps serving.
    preDeploy: 'node dist/cli.js migrate',
    healthcheck: '/api/v1/health',
    healthcheckTimeout: 120,
    replicas: { [REGION]: BACKEND_REPLICAS },
    deploy: {
      preDeployTimeoutSeconds: 600,
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 10,
      // Time between SIGTERM and SIGKILL for the old version: WebSockets close, requests finish.
      drainingSeconds: 30,
      // Never let the API sleep: it runs the scheduled jobs and holds WebSocket connections.
      sleepApplication: false,
    },
    env: {
      // --- process ---------------------------------------------------------------------------------
      NODE_ENV: 'production',
      PORT: '8080',
      LOG_LEVEL: 'info',
      TRUST_PROXY: 'true',

      // --- database (private network; no TLS on this hop) --------------------------------------------
      DATABASE_URL: db.env.DATABASE_URL,
      DATABASE_POOL_MAX: '10',

      // --- public addresses ----------------------------------------------------------------------------
      // Links in SMS and email (tracking page, set-password, password reset) start with WEB_URL.
      WEB_URL: 'https://' + WEB_HOST,
      CORS_ORIGINS: ['https://' + WEB_HOST, ...EXTRA_WEB_ORIGINS].join(','),
      ...API_URL_OVERRIDE,

      // --- files ---------------------------------------------------------------------------------------
      STORAGE_DRIVER: 's3',
      S3_ENDPOINT: ref(uploads, 'ENDPOINT'),
      S3_REGION: ref(uploads, 'REGION'),
      S3_BUCKET: ref(uploads, 'BUCKET'),
      S3_ACCESS_KEY_ID: ref(uploads, 'ACCESS_KEY_ID'),
      S3_SECRET_ACCESS_KEY: ref(uploads, 'SECRET_ACCESS_KEY'),

      // --- product switches ----------------------------------------------------------------------------
      PAYMENTS_MODE,
      PHONE_VERIFICATION: 'optional', // 'required' once SMS_DRIVER is 'twilio'
      SMS_DRIVER: 'outbox', // 'twilio' once the three TWILIO_* variables are set
      EMAIL_DRIVER: 'outbox', // 'resend' once RESEND_API_KEY and EMAIL_FROM are set
      ALLOW_TEST_JOBS: 'false',

      // --- maps ----------------------------------------------------------------------------------------
      GEOCODER: 'nominatim',
      ROUTING_PROVIDER: 'osrm',
      GEO_USER_AGENT: 'InstaSupply/1.0 (+https://instasupply.ca)',
      MAP_TILE_URL: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      MAP_ATTRIBUTION: '© OpenStreetMap contributors',

      // --- set with `railway variable set NAME --stdin --service backend` (§3.7, §8.3) ------------------
      JWT_SECRET: preserve(),
      JWT_SECRET_PREVIOUS: preserve(), // only during a rotation (§4.7)
      OTP_PEPPER: preserve(),
      SUPPORT_PHONE: preserve(),
      SUPPORT_EMAIL: preserve(),
      HST_NUMBER: preserve(),
      TWILIO_ACCOUNT_SID: preserve(),
      TWILIO_AUTH_TOKEN: preserve(),
      TWILIO_FROM: preserve(),
      RESEND_API_KEY: preserve(),
      SMTP_URL: preserve(),
      EMAIL_FROM: preserve(),
      GOOGLE_MAPS_API_KEY: preserve(),
      EXPO_ACCESS_TOKEN: preserve(),
    },
  });

  const frontend = service('frontend', {
    build: {
      builder: 'DOCKERFILE',
      dockerfilePath: 'frontend/Dockerfile',
      watchPatterns: [
        '/frontend/**',
        '/packages/shared/**',
        '/packages/art/**',
        '/packages/api-client/**',
        '/package.json',
        '/package-lock.json',
      ],
    },
    domains: WEB_CUSTOM_DOMAINS.map((domain) => ({ domain, port: 8080 })),
    healthcheck: '/healthz',
    healthcheckTimeout: 60,
    replicas: { [REGION]: 1 },
    deploy: {
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 10,
      drainingSeconds: 5,
      sleepApplication: false,
    },
    env: {
      PORT: '8080',
      // Build time: Railway passes it to the Dockerfile as a build argument and Vite writes it into the
      // bundle. After changing it, run `railway up --service frontend` (a redeploy may reuse the image).
      VITE_API_URL: 'https://' + API_HOST,
      // Run time: the Caddyfile puts it in the Content-Security-Policy.
      API_HOST,
    },
  });

  return project('instasupply', { resources: [db, uploads, backend, frontend] });
});
```

**Every variable, and where its value comes from**

| Service | Variable | Kind | Value |
| --- | --- | --- | --- |
| backend | `NODE_ENV`, `PORT`, `LOG_LEVEL`, `TRUST_PROXY`, `DATABASE_POOL_MAX` | literal in the file | `production`, `8080`, `info`, `true`, `10` |
| backend | `DATABASE_URL` | reference | `${{Postgres.DATABASE_URL}}` = `postgresql://postgres:…@postgres.railway.internal:5432/railway` |
| backend | `WEB_URL`, `CORS_ORIGINS` | reference inside a literal | `https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}` |
| backend | `API_URL` | literal, **only with a custom domain** | Not set on the Railway-provided domain: the server derives its public origin from `RAILWAY_PUBLIC_DOMAIN`, which Railway injects into the service. With a custom domain: `https://api.instasupply.ca` (§4.9) |
| backend | `STORAGE_DRIVER` | literal | `s3` |
| backend | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | reference | `${{uploads.ENDPOINT}}`, `${{uploads.REGION}}`, `${{uploads.BUCKET}}`, `${{uploads.ACCESS_KEY_ID}}`, `${{uploads.SECRET_ACCESS_KEY}}` |
| backend | `PAYMENTS_MODE`, `PHONE_VERIFICATION`, `SMS_DRIVER`, `EMAIL_DRIVER`, `ALLOW_TEST_JOBS` | literal | `test`, `optional`, `outbox`, `outbox`, `false` |
| backend | `GEOCODER`, `ROUTING_PROVIDER`, `GEO_USER_AGENT`, `MAP_TILE_URL`, `MAP_ATTRIBUTION` | literal | see the file |
| backend | `JWT_SECRET`, `OTP_PEPPER` | **generated secret** | 48 random bytes each, set in §3.7, never displayed |
| backend | `JWT_SECRET_PREVIOUS` | secret, temporary | the previous `JWT_SECRET`, for the 15 minutes of a rotation (§4.7); unset otherwise |
| backend | `SUPPORT_PHONE`, `SUPPORT_EMAIL`, `HST_NUMBER` | owner's value | set with `railway variable set` when known (§8.3) |
| backend | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `RESEND_API_KEY`, `SMTP_URL`, `EMAIL_FROM`, `GOOGLE_MAPS_API_KEY`, `EXPO_ACCESS_TOKEN` | provider secret, optional | unset until the provider exists |
| backend | every other variable of PLATFORM.md §11.1 | not set | the server's production default applies (token lifetimes, pool and worker settings, `MAP_MAX_ZOOM`, `PUSH_ENABLED`, …) |
| frontend | `PORT` | literal | `8080` |
| frontend | `VITE_API_URL` | reference inside a literal, **build time** | `https://${{backend.RAILWAY_PUBLIC_DOMAIN}}` |
| frontend | `API_HOST` | reference, run time | `${{backend.RAILWAY_PUBLIC_DOMAIN}}` |
| Postgres | `POSTGRES_PASSWORD`, `DATABASE_URL`, `PGHOST`, … | created by Railway | The password is generated by Railway (32 characters). Do not edit these variables. |

`RAILWAY_PUBLIC_DOMAIN` is the bare host name of a service's public domain. It exists as soon as the domain
is generated, before the first deployment. That is what removes the chicken-and-egg problem between the two
URLs (§3.6).

### 2.3 `backend/Dockerfile`

Three stages: build with every dependency, install the production dependencies alone, copy both into a
runtime image that runs as the unprivileged user `node`. The base is Debian (`bookworm-slim`), not Alpine
and not distroless: it has a shell, which `railway ssh` and the pre-deploy command need, and it avoids the
DNS quirks of musl on the private network.

```dockerfile
# syntax=docker/dockerfile:1
#
# InstaSupply API server. Build from the REPOSITORY ROOT (the server bundles packages/shared):
#
#   docker build --file backend/Dockerfile --tag instasupply-backend .
#
# What the build must produce is listed in docs/DEPLOYMENT.md §2.1:
#   backend/dist/server.js and backend/dist/cli.js, ES-module bundles that contain @instasupply/shared,
#   and backend/migrations/*.sql, read at run time relative to the built file.

ARG NODE_IMAGE=node:22-bookworm-slim

# ---- build: every dependency, then the bundle -----------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /repo
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false

# Manifests first, so this layer is rebuilt only when a dependency changes. Only the workspaces copied here
# are installed: npm skips workspace folders that are absent. `tsconfig*.json` may match nothing; naming
# package.json in the same COPY keeps that legal.
COPY package.json package-lock.json tsconfig*.json ./
COPY backend/package.json backend/
COPY packages/shared/package.json packages/shared/
RUN npm ci --ignore-scripts --workspace @instasupply/backend --include-workspace-root

COPY packages/shared packages/shared
COPY backend backend
RUN npm run build --workspace @instasupply/backend \
 && test -f backend/dist/server.js \
 && test -f backend/dist/cli.js \
 && test -d backend/migrations

# ---- prod-deps: production node_modules only ------------------------------------------------------------
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /repo
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY packages/shared/package.json packages/shared/
# @instasupply/shared is inside the bundle, so its workspace link is removed: a bundle that left it out
# fails at start, and therefore at the health check, instead of half-working.
RUN npm ci --ignore-scripts --omit=dev --workspace @instasupply/backend \
 && rm -rf node_modules/@instasupply \
 && mkdir -p backend/node_modules

# ---- runtime ----------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
# Stack traces in the logs point at src/ files, not at lines of the bundle; this also covers the pre-deploy
# `node dist/cli.js migrate`, which runs in the same image.
ENV NODE_OPTIONS=--enable-source-maps
WORKDIR /app/backend
COPY --from=prod-deps /repo/node_modules /app/node_modules
COPY --from=prod-deps /repo/backend/node_modules /app/backend/node_modules
COPY --from=build /repo/backend/package.json /app/backend/package.json
COPY --from=build /repo/backend/dist /app/backend/dist
COPY --from=build /repo/backend/migrations /app/backend/migrations
# Only the "local" storage driver writes to disk (development, CI). Production uses the bucket.
RUN mkdir -p /app/backend/.data && chown node:node /app/backend/.data
# The official Node image ships the unprivileged user "node" (uid 1000).
USER node
EXPOSE 8080
# Node is started directly, not through npm, so that SIGTERM reaches the server.
CMD ["node", "dist/server.js"]
```

Notes:

- `npm ci --ignore-scripts` follows the rule the repository already had in CI: install scripts of
  dependencies are not run. No dependency of the server needs one.
- `--include-workspace-root` installs the root `devDependencies` (TypeScript, tsx) in the build stage only,
  so the build works whether the backend's build script calls `tsc`, `tsx` or a bundler of its own.
- No `HEALTHCHECK` instruction: the health check that gates a deployment is the path set in
  `.railway/railway.ts`.
- Do not attach a volume to `backend`. Volumes are mounted as root (the image runs as `node`), are not
  mounted during the pre-deploy command, and a service with a volume cannot have two replicas.
- Measured on 2026-11-20 (§2.8): `npm ci` installs 301 packages in the build stage and 116 in `prod-deps`,
  the bundles are `dist/server.js` 208.5 kB and `dist/cli.js` 106.3 kB, and the image is 409 MB on disk
  (85.7 MB compressed). The process runs as `uid=1000(node)`.

### 2.4 `frontend/Dockerfile`

The console is a static build. Railway passes the service variable `VITE_API_URL` to the build as a build
argument (a Dockerfile only sees variables it declares with `ARG`), Vite writes it into the bundle, and the
result is served by Caddy from an Alpine image of about 60 MB that runs as an unprivileged user.

`--build-arg CONSOLE_PLACEHOLDER=true` replaces the Vite build with a one-page stand-in of the same shape
(`index.html` with `#root`, one `/assets/*.js` file). It was added because the console does not compile yet
(the console workstream is still replacing Firebase), and the image, the Caddyfile and the smoke test still
had to be checked. Railway never sets it, so a production build is always the real console. Remove the
argument once the console builds.

```dockerfile
# syntax=docker/dockerfile:1
#
# InstaSupply web console (ops back office, supplier portal, tracking page). Build from the REPOSITORY ROOT:
#
#   docker build --file frontend/Dockerfile --build-arg VITE_API_URL=https://api.instasupply.ca \
#     --tag instasupply-frontend .
#
# The API address is baked into the bundle at build time. A different API address needs a new build.
#
# --build-arg CONSOLE_PLACEHOLDER=true replaces the Vite build with a one-page stand-in that has the same
# shape (index.html with #root, one fingerprinted /assets/*.js). It exists so that the image, the Caddyfile
# and the smoke test can be checked while the console does not compile yet; Railway never sets it.

ARG NODE_IMAGE=node:22-bookworm-slim
ARG CADDY_IMAGE=caddy:2.11-alpine
ARG ALPINE_IMAGE=alpine:3.24

# ---- build: Vite ------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /repo
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false

# Manifests first. Add a line here when the console gains another workspace dependency.
COPY package.json package-lock.json tsconfig*.json ./
COPY frontend/package.json frontend/
COPY packages/shared/package.json packages/shared/
COPY packages/art/package.json packages/art/
COPY packages/api-client/package.json packages/api-client/
RUN npm ci --ignore-scripts --workspace @instasupply/frontend --include-workspace-root

COPY packages/shared packages/shared
COPY packages/art packages/art
COPY packages/api-client packages/api-client
COPY frontend frontend

# Railway hands service variables to the build as build arguments.
ARG VITE_API_URL
RUN case "${VITE_API_URL}" in \
      https://?* | http://localhost*) ;; \
      *) echo "VITE_API_URL must be the https:// address of the API (got '${VITE_API_URL}')." >&2; exit 1 ;; \
    esac
ENV VITE_API_URL=${VITE_API_URL}

# 1. regenerate the artwork module from packages/art/svg, 2. type-check and build the console (or write the
# stand-in), 3. keep source maps out of the public image, 4. record what this build points at (read by the
# smoke test).
ARG CONSOLE_PLACEHOLDER=false
RUN if [ "${CONSOLE_PLACEHOLDER}" = "true" ]; then \
      mkdir -p frontend/dist/assets \
      && printf 'document.getElementById("root").textContent = "InstaSupply console placeholder";\n' \
           > frontend/dist/assets/placeholder-00000000.js \
      && printf '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>InstaSupply</title>%s</head><body><div id="root"></div></body></html>\n' \
           '<script type="module" src="/assets/placeholder-00000000.js"></script>' > frontend/dist/index.html; \
    else \
      npm run build --workspace @instasupply/art \
      && npm run build --workspace @instasupply/frontend; \
    fi \
 && find frontend/dist -name '*.map' -delete \
 && printf '{"apiUrl":"%s","builtAt":"%s"}\n' "${VITE_API_URL}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      > frontend/dist/build-info.json

# ---- caddy: validate the configuration, take the binary ---------------------------------------------------
FROM ${CADDY_IMAGE} AS caddy
COPY frontend/Caddyfile /etc/caddy/Caddyfile
# A broken Caddyfile fails the build. `install` makes a plain copy of the binary: the official image gives
# it the file capability cap_net_bind_service, which an unprivileged process on port 8080 does not need.
RUN PORT=8080 API_HOST=api.example.invalid caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
 && install -m 0755 /usr/bin/caddy /caddy

# ---- runtime ------------------------------------------------------------------------------------------------
FROM ${ALPINE_IMAGE} AS runtime
# mailcap provides /etc/mime.types (content types for fonts and other files Go does not know by itself).
RUN apk add --no-cache mailcap \
 && addgroup -S -g 10001 web \
 && adduser -S -D -H -u 10001 -G web web
COPY --from=caddy /caddy /usr/local/bin/caddy
COPY frontend/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/frontend/dist /srv
ENV PORT=8080 XDG_CONFIG_HOME=/tmp/caddy/config XDG_DATA_HOME=/tmp/caddy/data
USER 10001:10001
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
```

### 2.5 `frontend/Caddyfile`: the static server

**Choice: Caddy.** It is one static binary, uses about 20 to 30 MB of memory, reads `$PORT` from the
environment, and is what Railway's own guide for single-page apps uses. The alternatives were nginx (needs a
template step for `$PORT` and a special image to run unprivileged) and a Node static server (three times
the memory and a 200 MB image for the same job).

What the server does: answers Railway's health check, serves fingerprinted files under `/assets/` with a
one-year cache, serves every other existing file without caching, and answers every other path with
`index.html` so that `/portal` and `/track/:token` work on reload. It sets the security headers that the old
hosting set, with a Content-Security-Policy that allows exactly the API (HTTPS and WebSocket), Railway's
bucket host, Google Fonts and HTTPS images (map tiles, photos).

```caddyfile
# Static server for the InstaSupply web console.
# Railway terminates TLS at its edge and forwards plain HTTP to $PORT.
{
	admin off
	persist_config off
	auto_https off
}

:{$PORT:8080} {
	root * /srv
	encode zstd gzip

	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "DENY"
		Referrer-Policy "strict-origin-when-cross-origin"
		Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
		Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://{$API_HOST} wss://{$API_HOST} https://*.storageapi.dev; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests"
		-Server
	}

	# Railway's deploy health check.
	handle /healthz {
		respond "ok" 200
	}

	# Fingerprinted build output: cache for a year. A missing file is a 404, never the app shell.
	handle /assets/* {
		header Cache-Control "public, max-age=31536000, immutable"
		file_server
	}

	# Everything else is the single-page app: the file if it exists, otherwise index.html.
	handle {
		header Cache-Control "no-cache"
		try_files {path} /index.html
		file_server
	}
}
```

`Referrer-Policy` must stay at `strict-origin-when-cross-origin` or looser: the OpenStreetMap tile servers
refuse requests without a `Referer`.

### 2.6 `.railwayignore` and `.dockerignore`

`railway up` packs the linked directory (the repository root) into one archive and uploads it; the service's
Dockerfile is then built with that archive as its build context. What the CLI leaves out:

- `node_modules` and `.git` directories, always;
- everything matched by `.railwayignore` (gitignore syntax), always;
- everything matched by `.gitignore`, **only inside a git repository**. This folder became one on
  2026-11-20 (see fact 2 at the top), but `.railwayignore` does not count on it;
- nothing else: hidden files are uploaded, and symbolic links are followed.

`.railwayignore` therefore lists everything itself. Both services upload the same archive (about 2 MB); each
Dockerfile copies only what it needs.

```gitignore
# What `railway up` must NOT upload. Gitignore syntax.
# The Railway CLI also applies .gitignore while this folder has a .git (it has one since 2026-11-20), but this
# file is the filter that is relied on: it must exclude everything by itself. Keep it in step with .gitignore
# so that nothing the build needs is dropped by a .gitignore pattern (for example a source folder named logs/).
# Keep .dockerignore in step (same rules, Docker's syntax).

# --- never leaves this machine -------------------------------------------------------------------------
.env
.env.*
!.env.example
*.keystore
*.jks
*.p8
*.p12
*.pem
*.mobileprovision
credentials.json
service-account*.json
google-services.json
GoogleService-Info.plist
*.apk
*.aab

# --- not needed to build the backend or the frontend image ------------------------------------------------
node_modules/
# The Android build workspace holds a disk image of several gigabytes.
/.build/
/app/
/legacy/
/docs/
/scripts/
/.github/
/.claude/
/.railway/
/README.md
/backend/.data/
/.pgdata/
/packages/art/preview/
/packages/expo-firebase/

# --- build output and caches ------------------------------------------------------------------------------
dist/
web-build/
coverage/
.expo/
*.tsbuildinfo
*.log
.DS_Store
```

`.dockerignore` carries the same rules for `docker build` on a laptop and in CI, plus `.git` (the Railway
CLI always leaves `.git` out of its upload; Docker has to be told), where `node_modules`
(1.2 GB) and `.build/` would otherwise be sent to the Docker daemon. It is **not** a copy: Docker's syntax
differs from git's. A pattern without `**/` in front only matches at the root of the build context, so
`node_modules` alone would leave `packages/shared/node_modules` in.

```gitignore
# What `docker build` must not send to the Docker daemon (the build context is the repository root).
# Docker's syntax, not git's: a pattern only matches at the root of the context unless it starts with **/
# Keep in step with .railwayignore.

# --- never leaves this machine -------------------------------------------------------------------------
**/.env
**/.env.*
!**/.env.example
**/*.keystore
**/*.jks
**/*.p8
**/*.p12
**/*.pem
**/*.mobileprovision
**/credentials.json
**/service-account*.json
**/google-services.json
**/GoogleService-Info.plist
**/*.apk
**/*.aab

# --- not needed to build the backend or the frontend image ------------------------------------------------
**/node_modules
# The Railway CLI always leaves .git out of its upload; docker build has to be told.
.git
.build
app
legacy
docs
scripts
.github
.claude
.railway
README.md
backend/.data
.pgdata
packages/art/preview
packages/expo-firebase

# --- build output and caches ------------------------------------------------------------------------------
**/dist
**/web-build
**/coverage
**/.expo
**/*.tsbuildinfo
**/*.log
**/.DS_Store
```

The CLI has no dry run. On the first `railway up`, watch two things: the upload must take a second or two
(a slow upload means a large folder slipped through, most likely `.build/`), and the build log must show a
build context of a few megabytes (`transferring context`). Two entries of the list matter more than the
others: `/.build/`, because the Android build image is several gigabytes, and the `.env` and keystore
patterns, because those files must never reach a build server.

### 2.7 Root `package.json`

Add the Railway SDK, pinned, and seven scripts (`build:backend` and `test:backend` are the two that
PLATFORM.md §2.2 asks of this file):

```bash
cd "/Volumes/Supriyo disk /supriyo project /instasupply"
npm install --save-dev --save-exact railway@3.17.0
```

```json
{
  "scripts": {
    "build:backend": "npm --workspace @instasupply/backend run build",
    "test:backend": "npm --workspace @instasupply/backend run test",
    "railway:plan": "railway config plan",
    "railway:apply": "railway config apply",
    "deploy:backend": "railway up --service backend",
    "deploy:frontend": "railway up --service frontend",
    "smoke": "node scripts/smoke.mjs"
  }
}
```

Both deploy scripts run `railway up` attached (no `--ci`): attached mode exits with the deployment's terminal
status, 0 only on `SUCCESS` (docs.railway.com/cli/up), whereas `--ci` exits when the build completes, before
the pre-deploy migration and the health check.

The SDK is pinned on purpose. Its `postgres()` helper carries a default image (`postgres-ssl:18` in 3.17.0);
`.railway/railway.ts` does not use that helper and names the image itself, so an SDK upgrade can never
propose a different PostgreSQL major. `firebase-tools` and `@firebase/rules-unit-testing` leave the root
`devDependencies` with the rest of Firebase.

### 2.8 Checked locally on 2026-11-20

Run on this machine against the backend as the platform workstream delivered it, with Docker Desktop started
for the occasion (`open -a Docker`, then `docker info` answers within seconds) and stopped afterwards. The
local PostgreSQL 17 is reached from a container as `host.docker.internal:5432` (its `pg_hba.conf` trusts
`127.0.0.1`, which is where Docker Desktop's connections arrive), with the CI variables of §7.3.

| Check | Result |
| --- | --- |
| `docker build --file backend/Dockerfile --tag instasupply-backend:local .` | Builds; the bundle step prints `dist/server.js 208.5kb`, `dist/cli.js 106.3kb` |
| `docker run … node dist/cli.js migrate` (production mode, empty database) | `applied 0001_init.sql`, `migrations: 1 applied; categories inserted: 25`, exit 0; a second run `nothing pending; categories inserted: 0`, exit 0 |
| `docker run … instasupply-backend:local` | `Server listening at http://[::]:4000`, JSON log lines with `level` and `message`; `GET /api/v1/health` → `{"status":"ok",…}`; `id` → `uid=1000(node)` |
| `docker stop` (SIGTERM) | `shutting down`, `stopped`, exit code 0 |
| `docker build --file frontend/Dockerfile --build-arg VITE_API_URL=https://api.example.invalid --build-arg CONSOLE_PLACEHOLDER=true …` | Builds; `caddy validate` prints `Valid configuration`; image 77.6 MB; runs as `uid=10001(web)`; `/healthz` → `200 ok` with every header of §2.5; `/build-info.json` → `{"apiUrl":"https://api.example.invalid",…}` |
| The same without `CONSOLE_PLACEHOLDER` | Fails in `tsc` with the console's own type errors (console workstream, not the image) |
| `node scripts/smoke.mjs` against both containers (`EXPECT_API_URL=https://api.example.invalid`, `SMOKE_CORS_ORIGIN=https://console.example.invalid`, `EXPECT_PAYMENTS_MODE=test`, `EXPECT_PHONE_VERIFICATION=optional`) | On 2026-11-19, before the catalogue module existed: 12 of 13 lines `ok` and `FAIL API reference data (/api/v1/categories): status 404`. `GET /api/v1/categories` is now served (`modules/stores`), and a run against a local build passes every check, check 4 included (`(25 items)`), with no `SMOKE_SKIP` |
| `node scripts/smoke.mjs` against `node dist/server.js` started outside Docker in development mode (`API_URL=http://localhost:4000 SMOKE_CORS_ORIGIN=http://localhost:5173`) | Every API check `ok`, check 4 included (`All checks passed.`, exit 0) |
| `.railway/railway.ts` | Type-checks with `tsc --strict` against `railway@3.17.0` (including `domains`); evaluated with `node --experimental-strip-types` and the SDK's `createRailwayContext` and `project` it yields the four resources with the settings and variables of §2.2. Not run through `railway config plan`: that needs the Railway project, which this workstream must not touch |

---

## 3. First deployment

Run everything from the repository root on this machine. The folder is linked to the Railway project in
§3.3; `railway up` always uploads the linked folder, whatever the current directory is.

```bash
cd "/Volumes/Supriyo disk /supriyo project /instasupply"
```

### 3.1 What this machine has

Checked on 2026-11-19.

| Tool | Found | Needed for |
| --- | --- | --- |
| Railway CLI | 5.71.0 (`/opt/homebrew/bin/railway`); `railway whoami` must show the owner's account | everything in §3 and §4 |
| Node · npm | v22.23.1 · 10.9.8 | evaluating `.railway/railway.ts`, the smoke test |
| PostgreSQL client | `psql`, `pg_dump`, `pg_restore` 17.11 (Homebrew); a local server 17.11 is running | `railway connect`, backups, restore drills. Same major as production, which `pg_dump` requires |
| OpenSSL · jq | present | generating secrets |
| SSH key | `~/.ssh/id_ed25519.pub` | `railway ssh` (registered once in §3.4) |
| Docker | Docker Desktop with CLI 29.2.1; the daemon is normally off and starts with `open -a Docker` (ready in seconds, quit it afterwards) | optional: building the images locally before the first upload (§2.8) |
| `aws` CLI · `gh` | not installed | not needed |

### 3.2 Two decisions before you start

**1. Pilot mode.** `.railway/railway.ts` sets `PAYMENTS_MODE = 'test'`: card payments are simulated by the
`TestGateway` of MARKETPLACE §3.8 and no money moves. That is the only mode in which an order can be placed
today, and the demo data needs it. It also means that a real supplier would hand over real goods for a
payment that never happens. So: in pilot mode only the team and demo accounts use the system. Before real
customers or suppliers are invited, set `'disabled'` (checkout closed) or wire the real gateway (§8.3).

**2. Host names.** The API address is written into the console at build time and into every APK for good.
`docs/CLIENTS.md` puts `https://api.instasupply.ca` in `app/<app>/.env.production`. Either attach the
custom domains during the first deployment (§4.9, needs access to the DNS of `instasupply.ca`) and build
the APKs against them, or change `.env.production` to the Railway-provided address. Do not hand out an APK
before this is settled: an APK built against an address that later disappears is dead.

### 3.3 Prepare the repository and create the project

The files of §2 exist, the SDK is installed (§2.7), and the code passes its checks:

```bash
ls .railway/railway.ts backend/Dockerfile frontend/Dockerfile frontend/Caddyfile .railwayignore .dockerignore
npm run lint && npm run typecheck && npm test
```

Create the project. This also links the folder to the project's default environment, `production`:

```bash
railway whoami
railway init --name instasupply
railway status
```

`railway status` must show project `instasupply` and environment `production`. With more than one workspace
on the account, add `--workspace "<workspace name>"` to `railway init`. If the project already exists, link
it instead: `railway link --project instasupply --environment production`.

### 3.4 Create the database, the bucket and the two services

```bash
railway config plan
```

The plan must list four additions and nothing else: the database `Postgres`, the bucket `uploads`, the
services `backend` and `frontend`. Variable values are shown as `«hidden»`. Then:

```bash
railway config apply
```

Confirm when asked. Railway provisions PostgreSQL (image, volume, generated password) and creates two empty
services with their settings and variables. The services have nothing to run yet: that is expected.

Register this machine's SSH key once (it is what `railway ssh` and `railway connect` use), then check the
database version:

```bash
railway ssh keys add --key ~/.ssh/id_ed25519.pub --name "ops-laptop"
railway ssh --service Postgres -- psql -U postgres -d railway -Atc "select version()"
```

It must print `PostgreSQL 17.…`. **If it prints 18, stop.** Railway's own template is at 18 today and this
project pins 17 on purpose (same major as development, CI and the `pg_dump` on this machine); a database
cannot be downgraded, so delete the still-empty project (`railway delete`), find out why the pin was ignored
and start again.

### 3.5 Close the database to the internet and schedule backups

A database created from `.railway/railway.ts` by CLI 5.71 gets a public TCP proxy on port 5432. Nothing in
this design uses it (`backend` connects over the private network; operators use `railway connect`, which
tunnels through SSH), so remove it:

```bash
railway tcp-proxy list --service Postgres
railway tcp-proxy delete 5432 --service Postgres --yes     # only when the list shows a proxy
railway tcp-proxy list --service Postgres                  # must now be empty
```

The proxy is re-created by any later `railway config apply` (the file declares the database, and no
option to leave the proxy out is documented). §4.2 therefore ends every apply with this same check.

Turn on volume backups (daily backups are kept 6 days, weekly ones 27 days):

```bash
railway postgres pitr schedule set --daily --weekly --service Postgres
railway postgres pitr schedule list --service Postgres
```

### 3.6 Generate the two public domains, before any deployment

```bash
railway domain --service backend --port 8080
railway domain --service frontend --port 8080
railway domain list --service backend
railway domain list --service frontend
```

Each service gets one `*.up.railway.app` domain. Keep the two addresses in this terminal for the rest of
the section:

```bash
export API_URL="https://<API_HOST>"      # for example https://backend-production-1a2b.up.railway.app
export WEB_URL="https://<WEB_HOST>"
```

**Why this order.** The console must know the API's URL when it is built, and the API must know the
console's URL for CORS and for the links it sends. Neither needs the other to be *deployed*: both only need
the other's *domain*, and a domain exists from the moment it is generated. The variables in
`.railway/railway.ts` are references (`${{backend.RAILWAY_PUBLIC_DOMAIN}}`,
`${{frontend.RAILWAY_PUBLIC_DOMAIN}}`) that Railway resolves when a deployment starts. With both domains in
place first, the backend's first deployment already has the right `CORS_ORIGINS` and the console's first
build already has the right `VITE_API_URL`. Nothing is deployed twice.

If `railway domain` refuses because a service has no deployment yet, deploy that service first (§3.8 or
§3.10), generate its domain, then deploy **both** services once more so that each picks up the other's
address.

A Railway-provided domain can be renamed (`railway domain update <domain> --domain instasupply-api
--service backend`). Do it now or never: renaming changes the address, and every console build and APK made
before the change stops working.

### 3.7 Set the secrets

Two secrets are generated here. Each is 48 random bytes, piped straight into the CLI: the value is never
shown, never stored on this machine and never written to the repository. `--skip-deploys` keeps Railway from
trying to deploy a service that has no code yet.

```bash
openssl rand -hex 48 | railway variable set JWT_SECRET --stdin --service backend --skip-deploys
openssl rand -hex 48 | railway variable set OTP_PEPPER --stdin --service backend --skip-deploys
```

| Secret | Used for | If it changes |
| --- | --- | --- |
| `JWT_SECRET` | Signing access tokens (HS256, 15 minutes) | Every access token becomes invalid; clients fetch a new one with their refresh token (§4.7) |
| `OTP_PEPPER` | Keyed hashes of one-time codes and of caller addresses in rate limits | Codes already sent stop working; rate-limit counters start again |

List the variable **names** to confirm (never run `railway variable list` without the `cut`: it prints
values):

```bash
railway variable list --service backend --kv | cut -d= -f1 | sort
```

The owner's values, when known (§8.3), are set the same way. They are not secrets, so they may be typed:

```bash
railway variable set SUPPORT_PHONE=+1XXXXXXXXXX SUPPORT_EMAIL=XXXX@instasupply.ca HST_NUMBER=XXXXXXXXXRT0001 \
  --service backend --skip-deploys
```

Optional hardening: in the dashboard, open `backend` → Variables and choose **Seal** in the menu of
`JWT_SECRET` and `OTP_PEPPER`. A sealed value is still given to deployments but can never be read back, by
anyone, in the dashboard, the API or the CLI. Sealing cannot be undone.

### 3.8 Deploy the backend

```bash
railway up --service backend -m "first deployment"
```

Run it **attached** (no `--ci`, no `--detach`). Attached, the command streams the logs and its exit code comes
from the deployment's terminal status: 0 only when the deployment reached `SUCCESS`, that is after the
migration and the health check; 1 when it failed or crashed (docs.railway.com/cli/up). `--ci` would exit as
soon as the build completes, before steps 3 to 5, and the next steps (§3.9, §3.11) would then meet an old or
missing instance. When the stream is cut off early, wait for the verdict explicitly:

```bash
until s=$(railway deployment list --service backend --json | jq -r '.[0].status'); \
  [ "$s" = SUCCESS ] || [ "$s" = FAILED ] || [ "$s" = CRASHED ]; do sleep 5; done; [ "$s" = SUCCESS ]
```

(`railway deployment list --json` lists newest first; check the field name `status` on the first run.)
What happens on Railway, in order:

1. The folder is uploaded (about 2 MB, filtered by `.railwayignore`).
2. `backend/Dockerfile` is built with the upload as its context.
3. The pre-deploy command `node dist/cli.js migrate` runs in a fresh container of the new image, on the
   private network, with the service's variables. A failure stops here.
4. The new container starts. Railway calls `GET /api/v1/health` on port 8080 until it answers `200`, for at
   most 120 seconds.
5. Traffic moves to the new container.

```bash
curl -fsS "$API_URL/api/v1/health"
```

If the deployment fails:

```bash
railway logs --service backend --build --latest --lines 200     # build errors
railway logs --service backend --latest --lines 200             # migration and start-up errors
```

### 3.9 Allow browser uploads to the bucket

The console uploads files straight to the bucket with presigned requests. Those are cross-origin, and a
Railway bucket only accepts them after CORS rules are set through the S3 API. The backend does it:

```bash
railway ssh --service backend -- node /app/backend/dist/cli.js storage-cors
```

Run it again whenever `CORS_ORIGINS` changes (§4.9). The apps are not affected: native uploads do not use
CORS.

### 3.10 Deploy the frontend

```bash
railway up --service frontend -m "first deployment"      # attached: exits 0 only on SUCCESS
curl -fsS "$WEB_URL/build-info.json"
```

The second command must print the API address this build was made for, equal to `$API_URL`:
`{"apiUrl":"https://<API_HOST>","builtAt":"…"}`.

### 3.11 Create the first admin account

```bash
railway ssh --service backend -- node /app/backend/dist/cli.js create-admin \
  --email "<the admin's email>" --name "<Full Name>"
```

The command prints one link, `https://<WEB_HOST>/set-password#token=…`, in this terminal and nowhere else:
it is not written to the service's logs. The token is in the fragment (after `#`), which the browser never
sends to the console's server, so it does not appear in Railway's HTTP logs either. Open it, choose the password in the browser, sign in. The link
works once and expires. No password is ever typed on a command line. If the link is lost or has expired, run
the command again: it issues a new link for the same account.

Every other member of staff, and every supplier user, is invited from the console (Team → Invite), which
shows the inviter a link of the same kind (MARKETPLACE §5.4).

### 3.12 Smoke test

```bash
EXPECT_PAYMENTS_MODE=test EXPECT_PHONE_VERIFICATION=optional npm run smoke
```

It reads `API_URL` and `WEB_URL` from the environment. Every line must start with `ok` (§5).

### 3.13 Demo data, when wanted

The demo data of MARKETPLACE §11 (14 stores, 80 products, customers, drivers, orders in every state) is for
the pilot only. It needs `PAYMENTS_MODE=test` and an empty `orders` table (the seed refuses otherwise, so
run it right after §3.11 or after §4.10). It is safe to run inside the live container: while it runs it holds
the lock of every scheduled job, so the running scheduler cannot interleave, and it calls the job bodies
itself, so `ALLOW_TEST_JOBS` stays `false` (PLATFORM.md §2.2). It uses the real clock; every scenario is
valid at any time of day. Afterwards the scenarios age in real time: for example Voltway's store order that
was left `new` is reminded and then auto-rejected when its deadline passes, as a real one would be.

Passwords. Demo customers, drivers and supplier users get `SEED_PASSWORD`, which must **not** be the
development password printed in this repository. The two demo staff accounts (`admin@instasupply.test`,
`dispatch@instasupply.test`) get **no** password in production: the seed prints a one-time set-password link
for each. So the password handed to testers never opens the console as staff. Generate the password in the
container:

```bash
railway ssh --service backend
```

```sh
# inside the container. The fixed parts make sure the password has letters and a digit, as the server requires.
export SEED_PASSWORD="Demo-$(node -p "require('node:crypto').randomBytes(12).toString('base64url')")-7"
node /app/backend/dist/cli.js seed --demo
echo "$SEED_PASSWORD"     # write it into the password manager now: it is stored nowhere else
exit
```

The command prints the two staff links: open them only if a staff demo account is wanted, otherwise let them
expire (72 hours). Never add `--reset` (it is refused in production anyway) or `--at`.

Demo data and real data must not mix: before launch, empty the database (§4.10).

### 3.14 Guard the bill and get alerts

```bash
railway usage                                             # what the workspace has used this billing period
railway usage limit set --target workspace --soft 25     # email alert at US$25; the owner picks the amount (§8.1)
railway usage limit status
```

`--soft` only sends an email. There is also `--hard <dollars>`: **a hard limit takes every workload
offline** when it is reached, production included. Leave it unset, or set it far above the expected bill.

In the dashboard, Project Settings → Webhooks, add a Slack or Discord webhook for failed deployments and
crashes. Railway checks the health path only while deploying; it does not monitor it afterwards. An
external uptime check on `https://<API_HOST>/api/v1/health` is a good idea before launch.

---

## 4. Operations

### 4.1 Later deployments

```bash
cd "/Volumes/Supriyo disk /supriyo project /instasupply"
npm run lint && npm run typecheck && npm test
railway config plan                                   # must say the configuration is already up to date
railway up --service backend -m "<what changed>"     # attached: exits 0 only when the deployment is SUCCESS
railway up --service frontend -m "<what changed>"
npm run smoke                                         # with API_URL and WEB_URL exported
```

Deploy only the service that changed, one at a time, the backend first. Rules that keep a deployment safe:

- **Migrations only go forward and must work with the previous version of the code.** The old container
  keeps serving until the new one is healthy, and a rollback (§4.3) runs old code on the new schema. Add
  columns and tables first; remove or rename in a later release, after the code that used the old shape is
  gone.
- **The API stays compatible with APKs already installed.** An APK cannot be recalled. Add fields and
  endpoints; do not remove or repurpose them.
- **A failed deployment changes nothing.** If the build, the migration or the health check fails, the
  previous deployment keeps serving. Fix and deploy again.
- **`railway up` is the only command that is certain to rebuild.** `railway redeploy` may reuse the existing
  image. Anything baked in at build time (the console's `VITE_API_URL`) needs `railway up`.
- **Railway may restart a service at any time** to move it to another host. The server must come back by
  itself: scheduled jobs are idempotent and the outbox is retried (decisions P8 and P9).

### 4.2 Changing configuration

| What | How |
| --- | --- |
| A value written in `.railway/railway.ts` (a switch, a setting, the number of replicas) | Edit the file, `railway config plan`, read the plan, `railway config apply`. The plan says which services are redeployed. |
| A secret or an owner's value (`preserve()` in the file) | `printf '%s' "<value>" \| railway variable set NAME --stdin --service backend`. Railway redeploys the service; add `--skip-deploys` to wait for the next deployment. For a secret, pipe it from where it is stored instead of typing it. |
| `VITE_API_URL` or anything else the console reads at build time | Change it as above, then `railway up --service frontend`. |
| A new variable | Add it to the `env` block of the file (as a literal, a reference or `preserve()`) **before** setting it with the CLI. A variable that exists on Railway but not in the file is deleted by the next `railway config apply`. |
| A setting changed by hand in the dashboard | Do not. The next `railway config apply` reverts it. Change the file. |

`railway config plan` never changes anything. Changes that delete something are marked as destructive and
are asked about separately. If a plan shows a deletion you did not intend, stop: the file is missing
something that exists on Railway.

Two hard rules for every apply:

1. **Never apply a plan that lists the removal of a domain.** A removed custom domain breaks every APK and
   console build that uses it. Add the domain to the file (§4.9) and plan again.
2. **After every `railway config apply`, close the database again:**

   ```bash
   railway tcp-proxy list --service Postgres
   railway tcp-proxy delete 5432 --service Postgres --yes     # only when the list shows a proxy
   railway tcp-proxy list --service Postgres                  # must be empty
   ```

   The file declares the database, and the CLI compiles a declared database with a public TCP proxy on 5432
   (Appendix A6). `deploy.yml` (§7.4) fails when the list is not empty.

### 4.3 Rollback

A rollback puts a previous deployment's image **and its variables** back, without building. It takes
seconds.

1. Dashboard → project `instasupply` → the service → **Deployments**.
2. Find the last good deployment, open its menu (three dots), choose **Rollback**, confirm.
3. `npm run smoke`.

CLI 5.71 has no rollback command; the dashboard is the only place. Limits and consequences:

- Railway keeps the image of a removed deployment for 72 hours on the Hobby plan and 120 hours on Pro. After
  that there is no Rollback entry, and the old version has to be built again from its source. Railway does
  not keep that source for you. The folder has had a `.git` since 2026-11-20: commit what is deployed (and
  push it, §7) so that any earlier state can be checked out and deployed with `railway up`.
- A rollback does not undo migrations. That is why migrations must work with the previous code (§4.1). When
  a migration itself is the problem, restore the database (§4.6).
- Roll the two services back independently. The console's build carries its API address; an old console
  build still points at the same API.
- Diagnose afterwards: the failed deployment and its logs stay available
  (`railway deployment list --service backend`, then `railway logs <deployment id>`).

Before a deployment with a risky migration, take a backup first:

```bash
railway postgres pitr backup create --name "before-<what>" --service Postgres
```

### 4.4 Logs and status

```bash
railway status                                             # project, environment, services
railway service status --service backend                   # state of the latest deployment
railway deployment list --service backend --limit 10       # ids, statuses, times

railway logs --service backend                             # live application logs (Ctrl+C to stop)
railway logs --service backend --lines 200                 # the last 200 lines
railway logs --service backend --since 1h --filter "@level:error"
railway logs --service backend --build --latest            # build log of the latest deployment
railway logs --service backend --http --lines 100 --filter "@httpStatus:>=500"
railway logs --service frontend --lines 100
railway logs --service Postgres --lines 100
railway logs <deployment id>                               # one deployment, also a failed one

railway metrics --service backend                          # CPU, memory, network
railway usage                                              # money
```

Logs are kept 7 days on the Hobby plan and 30 days on Pro. Railway drops log lines above 500 per second per
replica. Every request through the edge carries an `X-Railway-Request-Id` header, which also appears in the
HTTP logs.

### 4.5 Running a one-off command

One-off commands run **inside the running container** of the service, with its variables and on the private
network:

```bash
railway ssh --service backend -- node /app/backend/dist/cli.js migrate        # normally done by every deployment
railway ssh --service backend -- node /app/backend/dist/cli.js storage-cors
railway ssh --service backend -- node /app/backend/dist/cli.js create-admin --email "<email>" --name "<name>"
railway ssh --service backend                                                  # an interactive shell
railway connect Postgres                                                       # psql on the production database
```

Do not use `railway run` for these. It runs the command on **this laptop** with the service's variables, and
`DATABASE_URL` points at `postgres.railway.internal`, which only exists inside Railway.

`railway connect Postgres` is a superuser session on production. Read-only questions are fine; changes go
through migrations.

### 4.6 Database backups and restore

Three layers. Use all three before real customers arrive.

| Layer | What it gives | Restores to | Set up |
| --- | --- | --- | --- |
| Volume backups | A snapshot per day (kept 6 days) and per week (kept 27 days), plus manual ones | The same database, in place | §3.5 |
| Point-in-time recovery | Any second of roughly the last 4 weeks | A new database next to the original | Below; before launch |
| Logical dumps (`pg_dump`) | A file that survives the deletion of the volume or the project | Anywhere | Below; weekly and before every risky change |

**Volume backups**

```bash
railway postgres pitr backup list --service Postgres
railway postgres pitr backup create --name "before-<what>" --service Postgres
railway postgres pitr backup restore <backup id> --service Postgres    # OVERWRITES the database
railway restart --service backend --yes                               # reconnect after a restore
```

A restore in place puts the whole database back to the moment of the backup; everything written since is
gone. Wiping or deleting the volume deletes its backups too. That is what the dumps are for.

**Point-in-time recovery (PITR)**

```bash
railway postgres pitr enable --service Postgres     # restarts PostgreSQL once
railway postgres pitr status --service Postgres
railway bucket info --bucket Postgres-PITR          # note its region
```

Enabling PITR creates a second bucket, `Postgres-PITR`, that this repository does not know about. Declare it
in `.railway/railway.ts` **before the next `railway config apply`**, or the plan will propose to delete it:

```ts
const pitr = bucket('Postgres-PITR', { region: '<the region printed above>' });
// …
return project('instasupply', { resources: [db, uploads, pitr, backend, frontend] });
```

`railway config plan` must then report no changes. To recover:

```bash
railway postgres pitr restore --service Postgres --at "2026-12-01 14:05"
```

This creates a new service named `Postgres-restored-<date>-<time>` and leaves production untouched. Connect
to it (`railway connect "Postgres-restored-…"`), copy back what was lost, then delete the restored service
in the dashboard. It is not in `.railway/railway.ts`, so a plan run while it exists lists it for deletion:
do not apply that plan until you are done with it.

**Logical dump to this machine**

```bash
mkdir -p "/Volumes/Supriyo disk /instasupply-backups"

# terminal 1: open a tunnel; it prints host, port, user and password, and stays open
railway connect Postgres --tunnel-only --port 15432

# terminal 2: pg_dump asks for the password printed in terminal 1
pg_dump --host localhost --port 15432 --username postgres --dbname railway \
  --format=custom --no-owner \
  --file "/Volumes/Supriyo disk /instasupply-backups/instasupply-$(date +%Y%m%d-%H%M%S).dump"
```

The dump contains personal information. Keep it off shared folders and out of the repository. The folder
above is on the external disk because the internal one is nearly full.

**Restore drill** (do it once now and after every change to how backups are made; a backup that was never
restored is not a backup). It uses the PostgreSQL 17 server on this machine:

```bash
createdb instasupply_restore_drill
pg_restore --dbname instasupply_restore_drill --no-owner --exit-on-error "<the .dump file>"
psql -d instasupply_restore_drill -c '\dt'                             # the tables are there
psql -d instasupply_restore_drill -c 'select count(*) from <a table>'  # compare a few counts with production
dropdb instasupply_restore_drill
```

Write down how long the restore took and how old the dump was: those are the real recovery time and the
real data loss.

**Files in the bucket** have no backup: Railway buckets have no versioning, no snapshots and no lifecycle
rules. A deleted bucket can be restored from the project's activity feed for 52 hours. The retention rule
proposed in MARKETPLACE §15 (delete photos after 24 months) has to be a scheduled job of the backend.

### 4.7 Rotating secrets

**`JWT_SECRET`, planned rotation.** The server also accepts access tokens signed with
`JWT_SECRET_PREVIOUS` (PLATFORM.md §6.1), so nobody notices the change. The old value is copied into that
variable without being shown or typed:

```bash
OLD="$(railway variable list --service backend --json | jq -r '.JWT_SECRET // empty')"
if [ "${#OLD}" -ge 32 ]; then
  printf '%s' "$OLD" | railway variable set JWT_SECRET_PREVIOUS --stdin --service backend --skip-deploys
  openssl rand -hex 48 | railway variable set JWT_SECRET --stdin --service backend
else
  echo "JWT_SECRET cannot be read back (is it sealed?). Use the emergency procedure." >&2
fi
unset OLD
```

The last `variable set` redeploys the backend (no `--skip-deploys`) with both values. Access tokens live 15
minutes. After 20 minutes remove the old secret and make sure the running server forgets it:

```bash
railway variable delete JWT_SECRET_PREVIOUS --service backend
railway redeploy --service backend --yes
```

A sealed `JWT_SECRET` (§3.7) cannot be read back, so this procedure is not available for it: use the
emergency one.

**`JWT_SECRET`, emergency (the secret may have leaked).** Do not keep the old one:

```bash
openssl rand -hex 48 | railway variable set JWT_SECRET --stdin --service backend
```

From the redeployment on, every access token signed with the old secret is refused with `401`. Nobody is
signed out: each client answers the `401` by exchanging its refresh token, which is an opaque value stored
hashed in the database and does not depend on the JWT secret. Expect a short burst of refresh requests. Then
revoke the sessions concerned: in the console (admin) `POST /users/{uid}/sessions/revoke-all` for each
account concerned, or from this machine:

```bash
railway ssh --service backend -- node /app/backend/dist/cli.js revoke-sessions --email "<email>"
```

A forged access token would need the leaked secret and an existing session id; the server checks the session
on every request, so revoking the sessions also ends whatever was forged for them.

In both cases open WebSocket connections are closed by the restart and reconnect by themselves.

**`OTP_PEPPER`**: `openssl rand -hex 48 | railway variable set OTP_PEPPER --stdin --service backend`. There
is no second slot for this one. Everything derived from it stops matching: phone codes, password-reset codes
and set-password links sent before the rotation (users ask for a new one; invite again), and the rate-limit
counters start from zero. Passwords and refresh tokens are not affected.

**Bucket credentials**

```bash
railway bucket credentials --bucket uploads --reset --yes > /dev/null
railway redeploy --service backend --yes
```

The command prints the new keys, which nobody needs to see: hence `> /dev/null`. The old credentials die at
once and the backend only gets the new ones (through the `${{uploads.…}}` references) when it is redeployed.
Uploads and downloads fail for the seconds in between.

**Database password**: the database has no public port, so rotation is rare. When needed, follow Railway's
guide "Rotate API Keys and Database Credentials Without Downtime" (a second role, then switch, then drop the
old role). Do not edit `POSTGRES_PASSWORD` by hand.

**Provider keys** (Twilio, Resend, Google): create the new key at the provider, set it with
`railway variable set NAME --stdin`, check that messages go out, then revoke the old key. Never the other
way around.

### 4.8 Scaling to two instances

Set `BACKEND_REPLICAS = 2` in `.railway/railway.ts`, then `railway config plan` and `railway config apply`.
Railway starts the second instance from the same image and spreads requests randomly; there are no sticky
sessions. The pre-deploy command still runs once per deployment, not once per instance.

What in the design allows it:

| Concern | Why two instances are safe |
| --- | --- |
| Sessions | Access tokens are verified with `JWT_SECRET`; refresh tokens, roles and account status are read from the database on every request (P5). No instance holds session state. |
| Realtime | A WebSocket stays on the instance it connected to. Events reach every instance through PostgreSQL `LISTEN`/`NOTIFY` (P7). |
| Coupled state changes | One SQL transaction with row locks (P8); it does not matter which instance runs it. |
| Outbox worker | Each instance takes rows with `FOR UPDATE SKIP LOCKED`; handlers are idempotent by event id (P8). |
| Scheduled jobs | Timers run on every instance; a PostgreSQL advisory lock lets one of them do each run (P9). |
| Files | In the bucket, not on a disk (P10). `backend` has no volume, which is also what Railway requires for replicas. |
| Rate limits, OTP attempts | The limits that matter (sign-in, codes, uploads, outbound provider calls) are counted in the database and shared by all instances. Only the coarse flood limit per client address is kept in memory; with two instances its ceiling doubles, which is harmless (PLATFORM.md §4.6). |

Check before scaling:

- **Connections.** Each instance uses up to `DATABASE_POOL_MAX` (10) connections plus one that listens.
  PostgreSQL's default limit is 100 (`railway connect Postgres`, then `show max_connections;`). Two
  instances are far below it. Beyond a handful, add PgBouncer (`railway postgres pgbouncer add`).
- **Outside rate limits.** The public Nominatim and OSRM servers allow one request per second *for the whole
  application*, not per instance (§8.2). The server's limiter for them is a counter in the database
  (`provider_nominatim`, `provider_osrm`), so a second instance does not double the rate.
- **Nothing cached in memory that must be the same everywhere.**

The console can run with two replicas too (`replicas` of `frontend`); it is stateless. PostgreSQL cannot be
scaled this way: high availability is a separate Railway feature (`railway postgres ha`).

### 4.9 Custom domains

Needed: access to the DNS of `instasupply.ca`. The Hobby plan allows 2 custom domains per service, Pro 20.

**Step 1. Pin the current addresses.** While a service has only its Railway-provided domain,
`RAILWAY_PUBLIC_DOMAIN` is that domain. Railway describes the variable as "the public service or customer
domain" and does not say which of the two it names once a service has both. So the file must stop depending
on it **before** a custom domain is added. Copy the two host names:

```bash
railway domain list --service backend
railway domain list --service frontend
```

Write them into `.railway/railway.ts` as plain text, and apply:

```ts
const API_HOST = '<backend host>.up.railway.app';
const WEB_HOST = '<frontend host>.up.railway.app';
```

```bash
railway config plan && railway config apply
```

The plan shows the same addresses, now as literals, and one new variable on `backend`: `API_URL`. Both
services restart; nothing changes for users.

**Step 2. Declare the domains in the file and create their DNS records.** In `.railway/railway.ts`:

```ts
const API_CUSTOM_DOMAINS: string[] = ['api.instasupply.ca'];
const WEB_CUSTOM_DOMAINS: string[] = ['app.instasupply.ca'];
```

```bash
railway config plan        # must list two domains to add and nothing to remove
railway config apply
railway domain status api.instasupply.ca --service backend    # prints the CNAME and TXT records to create
railway domain status app.instasupply.ca --service frontend
```

Then run the database check of §4.2. **Fallback**, only if `railway config plan` refuses `domains` (an
earlier reading of the CLI 5.71 source suggested it might, Appendix A5): leave both lists empty, add the
domains with `railway domain api.instasupply.ca --service backend --port 8080` and
`railway domain app.instasupply.ca --service frontend --port 8080`, and from then on obey rule 1 of §4.2:
never apply a plan that lists a domain removal. Before doing either on production, try the chosen path once
with a throwaway domain on the `frontend` service and run `railway config plan` afterwards to see how the
CLI treats it.

Each domain needs two DNS records, a `CNAME` and a `TXT`. Create both exactly as printed: the `CNAME`
routes traffic, the `TXT` proves ownership, and without the `TXT` the domain answers `404`. With Cloudflare,
either leave the records unproxied (grey cloud) or, if proxied, set SSL/TLS mode to **Full**, not Full
(strict). Then wait until the domain is verified and has a certificate (usually within the hour):

```bash
railway domain status api.instasupply.ca --service backend
railway domain status app.instasupply.ca --service frontend
curl -fsS https://api.instasupply.ca/api/v1/health
```

**Step 3. Switch over.** In `.railway/railway.ts`:

```ts
const API_HOST = 'api.instasupply.ca';
const WEB_HOST = 'app.instasupply.ca';
// Keep the old console address working for a while.
const EXTRA_WEB_ORIGINS: string[] = ['https://<frontend host>.up.railway.app'];
```

The plan must show three changed variables on `backend` (`WEB_URL`, `CORS_ORIGINS` and `API_URL`; with a
wrong `API_URL` the server would keep building media URLs with the Railway host name) and two on `frontend`
(`VITE_API_URL`, `API_HOST`).

```bash
railway config plan && railway config apply          # backend restarts with WEB_URL, CORS_ORIGINS and API_URL
railway ssh --service backend -- node /app/backend/dist/cli.js storage-cors
railway up --service frontend -m "console on app.instasupply.ca"     # rebuild: the API address is baked in
API_URL=https://api.instasupply.ca WEB_URL=https://app.instasupply.ca npm run smoke
```

Then put `https://api.instasupply.ca` in `app/customer/.env.production` and `app/driver/.env.production`
(it is their default already) and build the APKs (§6).

**Do not delete the Railway-provided domains.** They keep working next to the custom ones. Any console tab
or APK built against them depends on them, and so do the image addresses that were copied into orders placed
before the change.

### 4.10 Emptying the pilot database before launch

This deletes every order, account and product. Take a dump first (§4.6) if anything must be kept.

```bash
railway connect Postgres
```

```sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
\q
```

```bash
railway ssh --service backend -- node /app/backend/dist/cli.js migrate
railway restart --service backend --yes
railway ssh --service backend -- node /app/backend/dist/cli.js create-admin --email "<email>" --name "<name>"
npm run smoke
```

Order numbers start again at `IS-10001`. Files of the pilot stay in the bucket until someone deletes them
(dashboard → bucket `uploads` → Files). Set `PAYMENTS_MODE` to its launch value (§3.2) in the same change.

### 4.11 Upgrades

| What | How |
| --- | --- |
| PostgreSQL minor version | Automatic: the `:17` tag follows Railway's rebuilds; a restart of the database picks up the newest image. |
| PostgreSQL major version | Dashboard → `Postgres` → Database → Config → **Major Version Upgrade** (it runs `pg_upgrade`, takes a backup before and after, and can be reverted). Afterwards change `POSTGRES_IMAGE` in `.railway/railway.ts` to the same major and check that `railway config plan` reports no changes. Never change the tag first. Upgrade development, CI and the PostgreSQL client on this machine at the same time. |
| Railway CLI | `brew upgrade railway`. Read `railway config plan` afterwards: it must still report no changes. |
| `railway` SDK | Change the pinned version in the root `package.json`; same check. |
| Node, Caddy, Alpine images | The `ARG` lines at the top of the two Dockerfiles; then `railway up`. |

---

## 5. Smoke test

`scripts/smoke.mjs` answers one question after a deployment: is the stack up, wired together and pointing at
the right addresses? It is read-only: it needs no account and creates nothing, so it can run against
production at any time. CI runs the same script against the container images (§7). It uses only Node 22
(`fetch`, `WebSocket`), no dependencies.

```bash
API_URL=https://<API_HOST> WEB_URL=https://<WEB_HOST> npm run smoke
```

### 5.1 What it calls and what it must see

| # | Request | Must see | Proves |
| --- | --- | --- | --- |
| 1 | `GET {API}/api/v1/health` | `200`, JSON with `status: "ok"` | The API runs and reaches PostgreSQL |
| 2 | `GET {API}/api/v1/config` | `200`; `paymentsMode` is `test`, `stripe` or `disabled`; `phoneVerification` is `required`, `optional` or `off`; both equal `EXPECT_PAYMENTS_MODE` / `EXPECT_PHONE_VERIFICATION` when those are set | The public flags the apps read; that production is in the mode you think it is |
| 3 | `GET {API}/api/v1/me` without a token | `401`, body `{ error: { status: "unauthenticated", message, … } }` | Authentication is enforced; errors use the one envelope |
| 4 | `GET {API}/api/v1/categories` | `200`, a non-empty list (an array, or `{ items: [...] }`) | Migrations ran and the reference data is there |
| 5 | `OPTIONS {API}/api/v1/me` with `Origin: {WEB}` | `access-control-allow-origin` equals `{WEB}` | `CORS_ORIGINS` contains the console's address |
| 6 | The same with `Origin: https://smoke-test.invalid` | no `access-control-allow-origin` for that origin, and not `*` | CORS is not open to everyone |
| 7 | WebSocket `{API}/api/v1/live` | the connection opens | WebSockets pass through Railway's edge to the server |
| 8 | `GET {WEB}/healthz` | `200` | The console's server runs |
| 9 | `GET {WEB}/` | `200`, HTML with the `#root` element, `cache-control: no-cache`, `x-content-type-options: nosniff`, `strict-transport-security`, a Content-Security-Policy that names the API's host | The console is served with its security headers, and its policy lets it call this API |
| 10 | `GET {WEB}/portal`, `GET {WEB}/track/smoke-test` | `200`, the same HTML | Deep links survive a reload |
| 11 | `GET {WEB}/build-info.json` | `apiUrl` equals `{API}` | The console was **built** for this API |
| 12 | The first `/assets/*.js` named in the HTML, then `GET {WEB}/assets/smoke-test-missing.js` | `200` with `cache-control` containing `immutable`; then `404` | Assets are cached for a year; a missing asset is not answered with the app shell |

Checks 1 to 7 run when `API_URL` is set, 8 to 12 when `WEB_URL` is set. `EXPECT_API_URL` replaces `{API}` in
checks 9 and 11 (CI builds the console for an address that is not the one it tests against), and
`SMOKE_CORS_ORIGIN` replaces `{WEB}` in check 5. The path of check 4 can be changed with
`SMOKE_PUBLIC_LIST_PATH`.

Every line names its check in brackets: `health`, `config`, `auth`, `reference-data`, `cors`, `cors-refuse`,
`live`, `console-health`, `console-index`, `deep-link`, `build-info`, `assets`. `SMOKE_SKIP` takes a
comma-separated list of these keys and prints `skip` for each, so a skipped check is never silent. It exists
for local runs while a module is missing or switched off; no check needs it today (check 4 passes since the
catalogue module serves `GET /api/v1/categories`). Never set it against production or in CI.

What it does not cover: signing in, placing an order, uploads, push. Those are covered by the backend's
integration tests and, in the pilot, by the demo data, which goes through the real commands.

### 5.2 `scripts/smoke.mjs`

```js
#!/usr/bin/env node
/**
 * Smoke test for a running InstaSupply stack. Read-only: it needs no account and writes nothing.
 *
 *   API_URL=https://api.instasupply.ca WEB_URL=https://app.instasupply.ca node scripts/smoke.mjs
 *   API_URL=http://localhost:4000 SMOKE_CORS_ORIGIN=http://localhost:5173 node scripts/smoke.mjs   # API only
 *   WEB_URL=http://localhost:8080 EXPECT_API_URL=https://api.example.invalid node scripts/smoke.mjs  # console only
 *
 * Optional: EXPECT_PAYMENTS_MODE, EXPECT_PHONE_VERIFICATION, SMOKE_PUBLIC_LIST_PATH (default
 * /api/v1/categories), SMOKE_TIMEOUT_MS (default 10000), SMOKE_SKIP (comma-separated check keys, printed in
 * brackets on every line, for an endpoint whose module is not written yet; never set it against production).
 * Exit code 0 when every check that ran passes, otherwise 1. What each check proves: docs/DEPLOYMENT.md §5.1.
 */
const origin = (value) => (value ? value.trim().replace(/\/+$/, '') : '');

const API = origin(process.env.API_URL);
const WEB = origin(process.env.WEB_URL);
const EXPECT_API = origin(process.env.EXPECT_API_URL) || API;
const CORS_ORIGIN = origin(process.env.SMOKE_CORS_ORIGIN) || WEB;
const LIST_PATH = process.env.SMOKE_PUBLIC_LIST_PATH || '/api/v1/categories';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS) || 10_000;
const SKIP = new Set(
  (process.env.SMOKE_SKIP ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean),
);

if (!API && !WEB) {
  console.error('Set API_URL, WEB_URL or both.');
  process.exit(1);
}

let failures = 0;
let skipped = 0;

/** `key` names the check for SMOKE_SKIP; a skipped check is printed, so a report never hides one. */
async function check(key, name, run) {
  if (SKIP.has(key)) {
    skipped += 1;
    console.log(`skip  ${name} [${key}]`);
    return;
  }
  try {
    const note = await run();
    console.log(`ok    ${name} [${key}]${note ? ` (${note})` : ''}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${name} [${key}]: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function request(url, init = {}) {
  return fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), ...init });
}

const header = (response, name) => response.headers.get(name) ?? '';

function preflight(fromOrigin) {
  return request(`${API}/api/v1/me`, {
    method: 'OPTIONS',
    headers: {
      Origin: fromOrigin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,content-type,x-client',
    },
  });
}

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`no connection within ${TIMEOUT_MS} ms`));
    }, TIMEOUT_MS);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      socket.close(1000);
      resolve();
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('the connection was refused or dropped'));
    });
  });
}

if (API) {
  await check('health', 'API health', async () => {
    const response = await request(`${API}/api/v1/health`);
    expect(response.status === 200, `status ${response.status}`);
    const body = await response.json();
    expect(body.status === 'ok', `body ${JSON.stringify(body)}`);
  });

  await check('config', 'API public configuration', async () => {
    const response = await request(`${API}/api/v1/config`);
    expect(response.status === 200, `status ${response.status}`);
    const { paymentsMode, phoneVerification } = await response.json();
    expect(['test', 'stripe', 'disabled'].includes(paymentsMode), `paymentsMode is ${paymentsMode}`);
    expect(
      ['required', 'optional', 'off'].includes(phoneVerification),
      `phoneVerification is ${phoneVerification}`,
    );
    const wantPayments = process.env.EXPECT_PAYMENTS_MODE;
    const wantPhone = process.env.EXPECT_PHONE_VERIFICATION;
    expect(
      !wantPayments || paymentsMode === wantPayments,
      `paymentsMode is ${paymentsMode}, expected ${wantPayments}`,
    );
    expect(
      !wantPhone || phoneVerification === wantPhone,
      `phoneVerification is ${phoneVerification}, expected ${wantPhone}`,
    );
    return `payments ${paymentsMode}, phone verification ${phoneVerification}`;
  });

  await check('auth', 'API refuses anonymous callers with the error envelope', async () => {
    const response = await request(`${API}/api/v1/me`);
    expect(response.status === 401, `status ${response.status}`);
    const body = await response.json();
    expect(body?.error?.status === 'unauthenticated', `body ${JSON.stringify(body)}`);
    expect(typeof body.error.message === 'string', 'error.message is missing');
  });

  await check('reference-data', `API reference data (${LIST_PATH})`, async () => {
    const response = await request(`${API}${LIST_PATH}`);
    expect(response.status === 200, `status ${response.status}`);
    const body = await response.json();
    const items = Array.isArray(body) ? body : body?.items;
    expect(Array.isArray(items) && items.length > 0, 'the list is empty');
    return `${items.length} items`;
  });

  if (CORS_ORIGIN) {
    await check('cors', `CORS allows ${CORS_ORIGIN}`, async () => {
      const response = await preflight(CORS_ORIGIN);
      expect(response.status < 300, `status ${response.status}`);
      const allowed = header(response, 'access-control-allow-origin');
      expect(allowed === CORS_ORIGIN, `access-control-allow-origin is "${allowed}"`);
    });

    await check('cors-refuse', 'CORS refuses an unknown origin', async () => {
      const stranger = 'https://smoke-test.invalid';
      const allowed = header(await preflight(stranger), 'access-control-allow-origin');
      expect(allowed !== stranger && allowed !== '*', `access-control-allow-origin is "${allowed}"`);
    });
  }

  await check('live', 'Live WebSocket opens', () => openSocket(`${API.replace(/^http/, 'ws')}/api/v1/live`));
}

if (WEB) {
  let indexHtml = '';

  await check('console-health', 'Console health', async () => {
    const response = await request(`${WEB}/healthz`);
    expect(response.status === 200, `status ${response.status}`);
  });

  await check('console-index', 'Console index and security headers', async () => {
    const response = await request(`${WEB}/`);
    expect(response.status === 200, `status ${response.status}`);
    expect(
      header(response, 'content-type').includes('text/html'),
      `content-type ${header(response, 'content-type')}`,
    );
    indexHtml = await response.text();
    expect(indexHtml.includes('id="root"'), 'index.html has no #root element');
    expect(header(response, 'cache-control').includes('no-cache'), 'index.html may be cached');
    expect(header(response, 'x-content-type-options') === 'nosniff', 'x-content-type-options is missing');
    expect(header(response, 'strict-transport-security') !== '', 'strict-transport-security is missing');
    const policy = header(response, 'content-security-policy');
    expect(policy.includes("frame-ancestors 'none'"), 'content-security-policy is missing');
    expect(
      !EXPECT_API || policy.includes(new URL(EXPECT_API).host),
      `the policy does not allow ${EXPECT_API}`,
    );
  });

  for (const path of ['/portal', '/track/smoke-test']) {
    await check('deep-link', `Console deep link ${path}`, async () => {
      const response = await request(`${WEB}${path}`);
      expect(response.status === 200, `status ${response.status}`);
      expect((await response.text()).includes('id="root"'), 'the app shell was not served');
    });
  }

  await check('build-info', 'Console was built for this API', async () => {
    const response = await request(`${WEB}/build-info.json`);
    expect(response.status === 200, `status ${response.status}`);
    const info = await response.json();
    expect(
      !EXPECT_API || origin(info.apiUrl) === EXPECT_API,
      `built for ${info.apiUrl}, expected ${EXPECT_API}`,
    );
    return `built ${info.builtAt} for ${info.apiUrl}`;
  });

  await check('assets', 'Console assets', async () => {
    const asset = indexHtml.match(/["'](\/assets\/[^"']+\.js)["']/)?.[1];
    expect(asset, 'index.html names no /assets/*.js file');
    const response = await request(`${WEB}${asset}`);
    expect(response.status === 200, `${asset} answered ${response.status}`);
    expect(header(response, 'cache-control').includes('immutable'), `${asset} is not cached as immutable`);
    const missing = await request(`${WEB}/assets/smoke-test-missing.js`);
    expect(missing.status === 404, `a missing asset answered ${missing.status}`);
  });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log(skipped > 0 ? `\nAll checks that ran passed (${skipped} skipped).` : '\nAll checks passed.');
```

---

## 6. Android APKs

The two apps are built on this machine with Gradle, from a copy of the repository in a path without
spaces, and signed with a keystore that lives outside the repository. Expo's cloud build (EAS) stays
available as a second path (§6.9). iOS is not part of this release.

| App | Folder | Application id | Name on the phone |
| --- | --- | --- | --- |
| Customer | `app/customer` | `com.instasupply.shop` | InstaSupply |
| Driver | `app/driver` | `com.instasupply.driver` | InstaSupply Driver |

### 6.1 What this machine has, and what a build needs

The requirements come from the packages installed in this repository (`react-native` 0.88.1, `expo`
58.0.26 and its native template 58.0.35), not from memory.

| Requirement | Needed | Found here (2026-11-19) | Action |
| --- | --- | --- | --- |
| JDK | 17 | Homebrew `openjdk@17` 17.0.17 at `/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home`. `JAVA_HOME` is not set in the shell | The build script sets `JAVA_HOME` |
| Android SDK | `ANDROID_HOME` | `~/Library/Android/sdk`. `ANDROID_HOME` is not set in the shell | The build script sets `ANDROID_HOME` |
| SDK Platform | API 37 (`compileSdk 37`), package `platforms;android-37.0` | `android-34`, `android-36`, `android-36.1`. **API 37 is missing** | §6.2 step 2 |
| Build-tools | 37.0.0 | 34.0.0, 35.0.0, 36.0.0, 36.1.0, 37.0.0 | none |
| NDK | 27.1.12297006 | 27.1.12297006 | none |
| CMake | 3.22.1 | 3.22.1 | none |
| SDK licences | accepted | `~/Library/Android/sdk/licenses/android-sdk-license` exists | none |
| Gradle | 9.4.1 (the template's wrapper) | 8.14.3 in `~/.gradle` | Downloaded by the wrapper on the first build |
| `adb` | any | `~/Library/Android/sdk/platform-tools/adb`, not on `PATH` | Use the full path, or add it to `PATH` |
| Android Studio, `sdkmanager`, an emulator | not required | Not installed. A system image exists but no virtual device | Test on a phone over USB (§6.8) |
| Free disk space | about 15 GB for the copy, the Gradle cache and the build output | Internal disk: **about 8 GB free**. External disk: 423 GB free, but every path on it contains a space | §6.2 step 1 |
| Memory | Gradle and Metro together use several GB | 16 GB (Apple M4, 10 cores). On 2026-11-19 macOS was already using 13 GB of swap, and its swap files (1 GB each) live on the internal disk | Close other applications before a build. The script refuses to start with less than 4 GB free on the internal disk |
| Target: `minSdk 24`, `targetSdk 36` | | | Phones with Android 7.0 or newer |

### 6.2 One-time setup

**Step 1. A build location without spaces.** The React Native Gradle build runs Node, CMake and the Hermes
compiler with paths it does not quote, so it fails when the project path contains a space. The repository's
path has three. The internal disk has no room for a copy. The answer is a disk image: a file on the external
disk that macOS mounts at `/Volumes/isbuild`, a path with no space. The file lives in the repository's
`.build/` folder, which git, ESLint, Prettier and `.railwayignore` all ignore.

```bash
REPO="/Volumes/Supriyo disk /supriyo project /instasupply"
IMAGE="$REPO/.build/android-build.sparseimage"
mkdir -p "$REPO/.build"
[ -f "$IMAGE" ] || hdiutil create -type SPARSE -fs APFS -size 60g -volname isbuild "$IMAGE"    # once
[ -d /Volumes/isbuild ] || hdiutil attach "$IMAGE" -nobrowse                                   # after every restart
touch /Volumes/isbuild/.metadata_never_index      # keeps Spotlight out of the build tree
ls -d /Volumes/isbuild
```

**The image already exists on this machine.** A build trial (§6.12) created it on 2026-11-19 with exactly
these commands and left it mounted, so only the `attach` line is needed after a restart of the Mac. The
image is sparse: it starts at a few megabytes and grows with what is written, up to 60 GB (1.4 GB after the
copy and `npm ci`). `-nobrowse` keeps the volume out of the Finder's sidebar. To unmount: `hdiutil detach
/Volumes/isbuild`. Deleting the file deletes the build cache and nothing else.

Inside the image the build script uses these folders:

| Folder | Content |
| --- | --- |
| `/Volumes/isbuild/instasupply` | The copy of the repository that is built (sources, its own `node_modules`, the generated `android/`) |
| `/Volumes/isbuild/gradle-home` | `GRADLE_USER_HOME`: the Gradle distribution and every downloaded Android library |
| `/Volumes/isbuild/android-user-home` | `ANDROID_USER_HOME`: what the Android tools would otherwise write to `~/.android` |
| `/Volumes/isbuild/tmp` | `TMPDIR` for Metro and the other Node tools |

This keeps the large files off the internal disk. What still lands there is small (npm's download cache in
`~/.npm`, a few state files) or outside the build's control (swap).

On a machine whose own disk has room, any folder without spaces works: `BUILD_ROOT="$HOME/isbuild"`.

**Step 2. Android SDK Platform 37.** Normally there is nothing to do: the SDK licence is already accepted on
this machine, so Gradle downloads the missing platform by itself on the first build. If that build stops
with a message about a licence or cannot download `platforms;android-37.0`, install it by hand:

```bash
brew install --cask android-commandlinetools
sdkmanager --sdk_root="$HOME/Library/Android/sdk" "platforms;android-37.0"
```

**Step 3. Release keystores**: §6.4.

### 6.3 Building

One command per app. The second argument is the API's origin; it must be the address the app is meant to
call for the rest of its life (§3.2).

```bash
REPO="/Volumes/Supriyo disk /supriyo project /instasupply"
export BUILD_ROOT=/Volumes/isbuild

bash "$REPO/scripts/android-release.sh" customer https://api.instasupply.ca
bash "$REPO/scripts/android-release.sh" driver   https://api.instasupply.ca
```

The APKs land in `REPO/.build/apk/`:

```
.build/apk/instasupply-customer-<versionCode>.apk
.build/apk/instasupply-driver-<versionCode>.apk
```

The first build downloads Gradle 9.4.1, the Android Gradle plugin, the React Native and Expo libraries and,
if needed, SDK Platform 37 (about 2 GB in all), and compiles the native code for two processor types. On a
fast connection allow 20 to 30 minutes. The download decides: on 2026-11-19 the Gradle wrapper received its
distribution (138 MB) at roughly 60 KB per second on this machine, and at that speed a first build takes
hours. Start it when the machine can be left alone. What has been downloaded stays in `gradle-home`, so an interrupted
build does not start from zero. Later builds take a few minutes.

What the script does, step by step. These are the commands to run by hand if the script is not used:

| # | Step | Command (for `customer`) |
| --- | --- | --- |
| 1 | Environment | `export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home`<br>`export ANDROID_HOME="$HOME/Library/Android/sdk"`<br>`export GRADLE_USER_HOME="$BUILD_ROOT/gradle-home" ANDROID_USER_HOME="$BUILD_ROOT/android-user-home" TMPDIR="$BUILD_ROOT/tmp"` (caches and temporary files stay off the nearly full internal disk)<br>`export PATH="$JAVA_HOME/bin:$PATH"` |
| 2 | Copy what the app needs to `$BUILD_ROOT/instasupply`: the root `package.json` and `package-lock.json`, `packages/` and `app/` in full, and of `backend` and `frontend` the `package.json` alone, so that npm finds every workspace the lockfile names. Not copied: `node_modules`, `.expo`, `dist`, generated `android/` and `ios/` folders, `.env.local` files, `legacy`, `docs` | `COPY="$BUILD_ROOT/instasupply"; mkdir -p "$COPY/backend" "$COPY/frontend"`<br>`cp "$REPO/package.json" "$REPO/package-lock.json" "$COPY/"`<br>`cp "$REPO/backend/package.json" "$COPY/backend/"; cp "$REPO/frontend/package.json" "$COPY/frontend/"`<br>`rsync -a --delete --exclude node_modules --exclude .expo --exclude dist --exclude web-build --exclude '/app/*/android' --exclude '/app/*/ios' --exclude '.env.local' --exclude '.env.*.local' "$REPO/packages" "$REPO/app" "$COPY/"` |
| 3 | Install the dependencies of the apps and the packages in the copy (skipped when `package-lock.json` has not changed): about 740 packages, 0.9 GB, two minutes | `cd "$COPY" && npm ci --ignore-scripts --workspace app --workspace packages` |
| 4 | Fix what is baked into the build (§6.7): write `app/customer/.env.local` and export the same values | `APP_VARIANT=production`, `EXPO_PUBLIC_API_URL=https://api.instasupply.ca` |
| 5 | Generate the native project (a few seconds) | `cd "$COPY/app/customer" && npx --no-install expo prebuild --platform android --clean --no-install` |
| 6 | Add the release signing configuration and the version code to the generated `android/app/build.gradle` | `node "$REPO/scripts/patch-android-release.mjs" android/app/build.gradle <versionCode> 1` |
| 7 | Build, with the keystore handed to Gradle through `ORG_GRADLE_PROJECT_…` environment variables | `cd android && ./gradlew --no-daemon :app:assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a` |
| 8 | The result | `android/app/build/outputs/apk/release/app-release.apk` |
| 9 | Check it: the JavaScript bundle inside the APK contains the API address, and the APK's signing certificate is the keystore's | `unzip -p app-release.apk assets/index.android.bundle \| grep -a -c -F https://api.instasupply.ca`<br>`apksigner verify --print-certs app-release.apk` |
| 10 | Copy it out | `cp … "$REPO/.build/apk/instasupply-customer-<versionCode>.apk"` |

Why a copy and not a symbolic link: the build resolves real paths (`node --print "require.resolve(…)"`), so a
link without spaces that points into the repository leads straight back to the path with spaces.

`-PreactNativeArchitectures=arm64-v8a,armeabi-v7a` builds for every ARM phone, 64-bit and 32-bit, and leaves
out the two Intel variants that only emulators on Intel machines use. It halves the build time and the size
of the APK.

`expo prebuild` rewrites `package.json` in the folder it runs in (it changes the `android` and `ios`
scripts to `expo run:android` and `expo run:ios`). That is one more reason to run it in the copy: the
repository itself is never touched by a build.

### 6.4 Release signing

**How it works.** Expo's Android template signs the `release` build type with the **debug** keystore that
ships with the template. Such an APK installs, but anyone can produce an APK with the same signature, and it
can never be updated by a properly signed one. The generated `android/` folder is thrown away by every
`expo prebuild --clean`, so the signing configuration cannot be edited in by hand. Step 6 of the script
(`scripts/patch-android-release.mjs`) adds it after every prebuild, and step 9 refuses the result unless the
APK carries the keystore's certificate. (§6.12 names an alternative that needs no patch.)

**Where the keystore and its password live.** Outside the repository, in the operator's home folder, one
pair of files per app:

```
~/.instasupply/android-signing/customer.keystore     PKCS12 keystore, key alias instasupply-customer
~/.instasupply/android-signing/customer.password     its password, one line
~/.instasupply/android-signing/driver.keystore       key alias instasupply-driver
~/.instasupply/android-signing/driver.password
```

**Generate them once.** The password is random and goes from `openssl` into a file that only this user can
read; it is never typed and never shown.

```bash
export PATH="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home/bin:$PATH"
mkdir -p ~/.instasupply/android-signing
chmod 700 ~/.instasupply ~/.instasupply/android-signing
cd ~/.instasupply/android-signing

for APP in customer driver; do
  ( umask 077 && openssl rand -hex 24 > "$APP.password" )
  keytool -genkeypair -v \
    -keystore "$APP.keystore" -storetype PKCS12 \
    -alias "instasupply-$APP" -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass:file "$APP.password" \
    -dname "CN=InstaSupply, O=InstaSupply, L=Toronto, ST=Ontario, C=CA"
  chmod 600 "$APP.keystore" "$APP.password"
done
```

The certificate is valid for 10,000 days. Its fingerprints, which Firebase and Google Play ask for later:

```bash
keytool -list -v -keystore customer.keystore -storepass:file customer.password -alias instasupply-customer \
  | grep -E 'SHA1:|SHA256:'
```

**Back them up today.** Store the four files in the company's password manager (as attachments) and on one
offline medium. They are not in the repository, not in any backup of it, and nobody can regenerate them.

**If a keystore is lost:**

- *APKs handed out directly.* Android only installs an update that is signed with the same key as the app it
  replaces. With a new key, every user must uninstall the app and install the new one. They lose what the
  app kept on the phone (the cart, the session); nothing on the server is lost.
- *Google Play, later.* With Play App Signing, this keystore is only the *upload* key; Google holds the
  real signing key. A lost upload key is replaced through Play Console support, and the new one becomes
  valid a few days later. Users notice nothing.

**If a keystore or its password may have leaked:** treat it as lost, generate a new one, and tell users of
directly installed APKs to reinstall from a link you control.

`.gitignore` already excludes `*.keystore`, `*.jks`, `*.apk`, `*.aab` and `credentials.json`, and
`.railwayignore` does the same for uploads to Railway.

### 6.5 `scripts/android-release.sh`

```bash
#!/usr/bin/env bash
#
# Builds a signed Android release (APK or AAB) of one Expo app.
#
#   BUILD_ROOT=/Volumes/isbuild bash scripts/android-release.sh customer https://api.instasupply.ca
#   BUILD_ROOT=/Volumes/isbuild bash scripts/android-release.sh driver   https://api.instasupply.ca aab
#
# The native build fails when a path contains spaces, so everything the app needs is copied to
# $BUILD_ROOT/instasupply and built there. See docs/DEPLOYMENT.md §6.
#
# Environment:
#   BUILD_ROOT             required: a directory whose path has no spaces
#   OUT_DIR                where the finished file is copied (default: <repository>/.build/apk)
#   SIGNING_DIR            holds <app>.keystore and <app>.password (default: ~/.instasupply/android-signing)
#   ANDROID_VERSION_CODE   default: minutes since 2026-01-01T00:00Z
#   EAS_PROJECT_ID         optional: needed for push notifications
#   ALLOW_DEBUG_SIGNING=1  build without the release keystore (never hand out the result)
#   SKIP_BUNDLE_CHECK=1    do not look for the API address in the JavaScript bundle
#   JAVA_HOME, ANDROID_HOME, GRADLE_USER_HOME, ANDROID_USER_HOME   defaults below
set -euo pipefail

usage() {
  echo "usage: BUILD_ROOT=/path/without/spaces bash $0 <customer|driver> <https://api-host> [apk|aab]" >&2
  exit 2
}

APP="${1:-}"
API_URL="${2:-}"
ARTIFACT="${3:-apk}"
case "$APP" in customer | driver) ;; *) usage ;; esac
case "$API_URL" in https://?*) ;; *) echo "The API address must start with https://" >&2; usage ;; esac
case "$ARTIFACT" in apk | aab) ;; *) usage ;; esac
API_URL="${API_URL%/}"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_ROOT="${BUILD_ROOT:?Set BUILD_ROOT to a directory whose path has no spaces}"
case "$BUILD_ROOT" in *[[:space:]]*) echo "BUILD_ROOT must not contain spaces: $BUILD_ROOT" >&2; exit 2 ;; esac
OUT_DIR="${OUT_DIR:-$REPO/.build/apk}"

SIGNING_DIR="${SIGNING_DIR:-$HOME/.instasupply/android-signing}"
KEYSTORE="$SIGNING_DIR/$APP.keystore"
PASSWORD_FILE="$SIGNING_DIR/$APP.password"
KEY_ALIAS="instasupply-$APP"
SIGNED=1
if [ ! -f "$KEYSTORE" ] || [ ! -f "$PASSWORD_FILE" ]; then
  if [ "${ALLOW_DEBUG_SIGNING:-0}" = 1 ]; then
    SIGNED=0
    echo "WARNING: no release keystore. This build is signed with the debug key: do not hand it out." >&2
  else
    echo "Release keystore not found: $KEYSTORE and $PASSWORD_FILE (docs/DEPLOYMENT.md §6.4)." >&2
    exit 1
  fi
fi

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$JAVA_HOME/bin:$PATH"
export CI=1 EXPO_NO_TELEMETRY=1 EXPO_NO_GIT_STATUS=1

JAVA_VERSION="$("$JAVA_HOME/bin/java" -version 2>&1 || true)"
case "$JAVA_VERSION" in
  *'version "17.'*) ;;
  *) echo "JAVA_HOME must point at a JDK 17: $JAVA_HOME" >&2; exit 1 ;;
esac
[ -d "$ANDROID_HOME/build-tools" ] || { echo "Android SDK not found: $ANDROID_HOME" >&2; exit 1; }

# The system disk also holds the swap files: a build on a machine that is short of memory can fill it.
FREE_KB="$(df -Pk "$HOME" | awk 'NR == 2 { print $4 }')"
if [ "${FREE_KB:-0}" -lt 4194304 ]; then
  echo "Less than 4 GB free on the disk of $HOME: free some space and close other applications first." >&2
  exit 1
fi

mkdir -p "$BUILD_ROOT" 2>/dev/null || {
  echo "BUILD_ROOT cannot be created: $BUILD_ROOT. Is the disk image attached (docs/DEPLOYMENT.md §6.2)?" >&2
  exit 1
}
# Caches and temporary files stay inside BUILD_ROOT, off the system disk.
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$BUILD_ROOT/gradle-home}"
export ANDROID_USER_HOME="${ANDROID_USER_HOME:-$BUILD_ROOT/android-user-home}"
export TMPDIR="$BUILD_ROOT/tmp"

COPY="$BUILD_ROOT/instasupply"
APP_DIR="$COPY/app/$APP"
mkdir -p "$COPY/backend" "$COPY/frontend" "$OUT_DIR" "$GRADLE_USER_HOME" "$ANDROID_USER_HOME" "$TMPDIR"

echo "==> Copying sources to $COPY"
# The apps and the packages in full. Of the other two workspaces only the manifest, so that npm finds
# every workspace the lockfile names.
cp "$REPO/package.json" "$REPO/package-lock.json" "$COPY/"
cp "$REPO/backend/package.json" "$COPY/backend/"
cp "$REPO/frontend/package.json" "$COPY/frontend/"
rsync -a --delete \
  --exclude node_modules --exclude .expo --exclude dist --exclude web-build \
  --exclude '/app/*/android' --exclude '/app/*/ios' \
  --exclude '.env.local' --exclude '.env.*.local' \
  "$REPO/packages" "$REPO/app" "$COPY/"

LOCK_HASH="$(shasum -a 256 "$COPY/package-lock.json" | cut -d ' ' -f 1)"
STAMP="$COPY/node_modules/.instasupply-lock-hash"
if [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$LOCK_HASH" ]; then
  echo "==> Installing dependencies"
  # Only what the apps and the packages need. Install scripts of dependencies are not run.
  (cd "$COPY" && npm ci --ignore-scripts --no-audit --no-fund --workspace app --workspace packages)
  echo "$LOCK_HASH" > "$STAMP"
fi

VERSION_CODE="${ANDROID_VERSION_CODE:-$(( ($(date -u +%s) - 1767225600) / 60 ))}"
echo "==> $APP for $API_URL, versionCode $VERSION_CODE"

# Only the values set here may reach the bundle: drop every EXPO_PUBLIC_* the calling shell had.
for name in $(env | sed -n 's/^\(EXPO_PUBLIC_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$name"; done
export APP_VARIANT=production
export EXPO_PUBLIC_API_URL="$API_URL"
# .env.local is read by `expo prebuild` (development mode) and by the release bundling (production mode),
# and wins over .env.development and .env.production in both.
{
  echo "APP_VARIANT=production"
  echo "EXPO_PUBLIC_API_URL=$API_URL"
} > "$APP_DIR/.env.local"
if [ -n "${EAS_PROJECT_ID:-}" ]; then
  export EAS_PROJECT_ID
  echo "EAS_PROJECT_ID=$EAS_PROJECT_ID" >> "$APP_DIR/.env.local"
else
  unset EAS_PROJECT_ID
fi
# GOOGLE_SERVICES_JSON may name the file anywhere (docs/CLIENTS.md §8.2); the build copy always uses its own copy.
if [ -n "${GOOGLE_SERVICES_JSON:-}" ] && [ "$GOOGLE_SERVICES_JSON" != "./google-services.json" ]; then
  if [ -r "$GOOGLE_SERVICES_JSON" ]; then
    cp "$GOOGLE_SERVICES_JSON" "$APP_DIR/google-services.json"
  else
    echo "ERROR: GOOGLE_SERVICES_JSON=$GOOGLE_SERVICES_JSON is not a readable file." >&2
    exit 1
  fi
fi
if [ -f "$APP_DIR/google-services.json" ]; then
  export GOOGLE_SERVICES_JSON=./google-services.json
  echo "GOOGLE_SERVICES_JSON=./google-services.json" >> "$APP_DIR/.env.local"
else
  unset GOOGLE_SERVICES_JSON
  echo "NOTE: app/$APP/google-services.json is missing: this build has no push notifications." >&2
fi

echo "==> Generating the native project"
(cd "$APP_DIR" && npx --no-install expo prebuild --platform android --clean --no-install)
node "$REPO/scripts/patch-android-release.mjs" "$APP_DIR/android/app/build.gradle" "$VERSION_CODE" "$SIGNED"

if [ "$ARTIFACT" = apk ]; then
  TASK=":app:assembleRelease"
  BUILT="$APP_DIR/android/app/build/outputs/apk/release/app-release.apk"
  BUNDLE_ENTRY="assets/index.android.bundle"
else
  TASK=":app:bundleRelease"
  BUILT="$APP_DIR/android/app/build/outputs/bundle/release/app-release.aab"
  BUNDLE_ENTRY="base/assets/index.android.bundle"
fi

echo "==> Building $TASK (the first build downloads Gradle and the Android libraries)"
(
  cd "$APP_DIR/android"
  if [ "$SIGNED" = 1 ]; then
    STORE_PASSWORD="$(cat "$PASSWORD_FILE")"
    export ORG_GRADLE_PROJECT_INSTASUPPLY_UPLOAD_STORE_FILE="$KEYSTORE"
    export ORG_GRADLE_PROJECT_INSTASUPPLY_UPLOAD_STORE_PASSWORD="$STORE_PASSWORD"
    export ORG_GRADLE_PROJECT_INSTASUPPLY_UPLOAD_KEY_ALIAS="$KEY_ALIAS"
    export ORG_GRADLE_PROJECT_INSTASUPPLY_UPLOAD_KEY_PASSWORD="$STORE_PASSWORD"
  fi
  ./gradlew --no-daemon "$TASK" -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
)
[ -f "$BUILT" ] || { echo "Build output not found: $BUILT" >&2; exit 1; }

echo "==> Checking the result"
FOUND="$(unzip -p "$BUILT" "$BUNDLE_ENTRY" | LC_ALL=C grep -a -c -F "$API_URL" || true)"
if [ "${FOUND:-0}" -lt 1 ] && [ "${SKIP_BUNDLE_CHECK:-0}" != 1 ]; then
  echo "The JavaScript bundle does not contain $API_URL: this build does not point at that API." >&2
  exit 1
fi

if [ "$SIGNED" = 1 ]; then
  # keytool prints "SHA256: AB:CD:…", apksigner prints "… certificate SHA-256 digest: abcd…".
  fingerprint() { awk '/SHA-?256( digest)?:/ && !seen { print $NF; seen = 1 }' | tr -d ':' | tr 'A-F' 'a-f'; }
  EXPECTED="$(keytool -list -v -keystore "$KEYSTORE" -storepass:file "$PASSWORD_FILE" -alias "$KEY_ALIAS" | fingerprint)"
  if [ "$ARTIFACT" = apk ]; then
    BUILD_TOOLS="$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -n 1)"
    ACTUAL="$("$BUILD_TOOLS/apksigner" verify --print-certs "$BUILT" | fingerprint)"
  else
    ACTUAL="$(keytool -printcert -jarfile "$BUILT" | fingerprint)"
  fi
  if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "The $ARTIFACT is not signed with $KEYSTORE (expected $EXPECTED, found ${ACTUAL:-nothing})." >&2
    exit 1
  fi
fi

OUT="$OUT_DIR/instasupply-$APP-$VERSION_CODE.$ARTIFACT"
cp "$BUILT" "$OUT"
echo "==> Done: $OUT"
shasum -a 256 "$OUT"
```

### 6.6 `scripts/patch-android-release.mjs`

```js
#!/usr/bin/env node
/**
 * Prepares a freshly generated Expo android/ project for a release build.
 *
 *   node scripts/patch-android-release.mjs <android/app/build.gradle> <versionCode> <1|0>
 *
 * 1. Sets versionCode.
 * 2. With the third argument 1: adds a `release` signing config that reads the keystore from the Gradle
 *    properties INSTASUPPLY_UPLOAD_STORE_FILE, _STORE_PASSWORD, _KEY_ALIAS and _KEY_PASSWORD, and makes the
 *    release build type use it. The Expo template signs release builds with the debug keystore.
 *
 * android/ is generated by `expo prebuild`, so this runs after every prebuild. It stops with an error when
 * the template no longer looks as expected: a release is never signed with the debug key by accident.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [file, versionCodeText, signed] = process.argv.slice(2);
const versionCode = Number(versionCodeText);
if (!file || !Number.isInteger(versionCode) || versionCode < 1 || versionCode > 2_100_000_000) {
  console.error(
    'usage: patch-android-release.mjs <android/app/build.gradle> <versionCode 1..2100000000> <1|0>',
  );
  process.exit(2);
}

let gradle = readFileSync(file, 'utf8');

function replaceOnce(pattern, replacer, what) {
  if (!pattern.test(gradle)) {
    console.error(
      `patch-android-release: "${what}" not found in ${file}. The Expo template changed: update this script.`,
    );
    process.exit(1);
  }
  gradle = gradle.replace(pattern, replacer);
}

replaceOnce(/(\bversionCode\s+)\d+/, (_match, keyword) => `${keyword}${versionCode}`, 'versionCode <number>');

if (signed === '1' && !gradle.includes('INSTASUPPLY_UPLOAD_STORE_FILE')) {
  replaceOnce(
    /signingConfigs\s*\{\s*debug\s*\{[^}]*\}/,
    (debugBlock) => `${debugBlock}
        release {
            storeFile file(project.property('INSTASUPPLY_UPLOAD_STORE_FILE'))
            storePassword project.property('INSTASUPPLY_UPLOAD_STORE_PASSWORD')
            keyAlias project.property('INSTASUPPLY_UPLOAD_KEY_ALIAS')
            keyPassword project.property('INSTASUPPLY_UPLOAD_KEY_PASSWORD')
        }`,
    'signingConfigs { debug { … } }',
  );
  replaceOnce(
    /(buildTypes\s*\{[\s\S]*?\brelease\s*\{[\s\S]*?signingConfig\s+)signingConfigs\.debug/,
    (_match, before) => `${before}signingConfigs.release`,
    'buildTypes { release { signingConfig signingConfigs.debug } }',
  );
}

writeFileSync(file, gradle);
console.log(
  `patch-android-release: versionCode ${versionCode}, ${signed === '1' ? 'release' : 'debug'} signing`,
);
```

### 6.7 Version codes, and what is baked into a build

**`versionCode`** is the number Android compares: a phone refuses an APK with a lower code than the one
installed, and Google Play refuses a code it has seen. The script sets it to the number of minutes since
2026-01-01 00:00 UTC (about 465,000 in November 2026; Google's maximum of 2,100,000,000 is thousands of
years away). It always grows, needs no counter file, and works on any machine and in CI. Override it with
`ANDROID_VERSION_CODE` when a specific number is needed.

**`versionName`**, the version people see ("1.0.0"), is `version` in `app/<app>/app.config.ts`. Change it by
hand when a release deserves a new number.

**Baked in at build time, fixed for the life of the APK:**

| Value | Set by | Used for |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | the script's second argument | Every request the app makes. Inlined into the JavaScript bundle; visible to anyone who unpacks the APK, so it is not a secret |
| `APP_VARIANT=production` | the script | Application id `com.instasupply.shop` / `com.instasupply.driver` and the app's name |
| `EAS_PROJECT_ID` | the caller's environment, optional | Expo push tokens (§6.10) |
| `GOOGLE_SERVICES_JSON` | the file named by `GOOGLE_SERVICES_JSON` in the shell (copied into the build copy), else `app/<app>/google-services.json` when it exists; an unreadable path stops the build | Firebase Cloud Messaging as the push transport (§6.10) |
| `versionCode`, the signing key | the script | Updates |

Everything else (payments mode, phone verification, support phone, HST number, map tiles) comes from
`GET /api/v1/config` when the app starts, so it changes without a new build.

The script writes these values to `app/<app>/.env.local` in the copy **and** exports them. Both are needed:
`expo prebuild` reads `app.config.ts` in development mode, the Gradle build bundles the JavaScript in
production mode, and `.env.local` is the one file Expo loads in both modes, ahead of `.env.development` and
`.env.production`. The script also removes every other `EXPO_PUBLIC_*` variable from its environment, so
nothing from the operator's shell leaks into a release.

### 6.8 Installing and testing against production

On the phone: Settings → About phone → tap "Build number" seven times, then Developer options → USB
debugging. Connect it by USB and accept the prompt.

```bash
export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"
APK="/Volumes/Supriyo disk /supriyo project /instasupply/.build/apk/instasupply-customer-<versionCode>.apk"

adb devices                                   # the phone must be listed as "device"
adb install -r "$APK"
adb shell monkey -p com.instasupply.shop -c android.intent.category.LAUNCHER 1     # start the app
adb logcat -s ReactNativeJS:V AndroidRuntime:E                                      # its log
```

- `INSTALL_FAILED_UPDATE_INCOMPATIBLE`: an app with the same id but another signature is installed (a debug
  build, an EAS build). Remove it: `adb uninstall com.instasupply.shop`.
- `INSTALL_FAILED_VERSION_DOWNGRADE`: the installed build has a higher version code. Uninstall it, or build
  again.

To give the APK to someone without a cable, send the file (a link in a shared drive). Their phone asks once
for permission to install apps from that source, and Play Protect may ask whether to scan the app.

**What to check, customer app** (pilot mode; with the demo data use `customer@instasupply.test` and the
password of §3.13, otherwise register a new account):

1. The app starts without a network error: it reached `GET /api/v1/config` on production.
2. Sign in. Close the app, open it again: still signed in.
3. Browse two stores, add items, add a jobsite, add the test card `4242 4242 4242 4242`, place the order.
4. In the console, as the supplier, accept and prepare the order. The app shows the change within seconds
   while it is open (WebSocket), and after pulling to refresh in any case.
5. Turn on flight mode, open the app: it shows the last data and a clear message, and recovers afterwards.

**Driver app**: sign in as a driver, go online, claim the job, check in at the store, have the PIN entered
in the portal, take the drop-off photo. The photo upload goes from the phone straight to the bucket.

To see the requests arrive, on this machine:

```bash
railway logs --service backend --http --lines 20 --filter "@path:/api/v1/me"
```

### 6.9 The EAS alternative

Expo's build service (EAS; Expo now calls it "Expo Build", the commands are still `eas`) builds the same
apps on Expo's servers. Use it when this machine is unavailable or for iOS later. It needs an Expo account,
one Expo project per app, and the profile `production-apk` that `docs/CLIENTS.md` §8.2 puts in each
`eas.json`:

```json
"production-apk": {
  "extends": "production",
  "distribution": "internal",
  "android": { "buildType": "apk" }
}
```

`android.buildType: "apk"` makes EAS run `:app:assembleRelease`; without it EAS produces an AAB, which
cannot be installed directly. `distribution: "internal"` gives a link testers can install from. The API
address comes from `app/<app>/.env.production`, which EAS uploads with the project.

```bash
cd "/Volumes/Supriyo disk /supriyo project /instasupply/app/customer"
npx eas-cli@latest login
npx eas-cli@latest init                      # once per app: creates the Expo project and prints its id

EAS_NO_VCS=1 \
EAS_PROJECT_ROOT="/Volumes/Supriyo disk /supriyo project /instasupply" \
EAS_PROJECT_ID="<the id printed by eas init>" \
  npx eas-cli@latest build --platform android --profile production-apk
```

- `EAS_NO_VCS=1` is required because the folder is not a git repository; `EAS_PROJECT_ROOT` makes EAS upload
  the whole workspace, not only `app/customer` (the app needs `packages/`). Unlike Railway, EAS does apply
  `.gitignore` in this mode, so `node_modules` and `.build/` stay here.
- `app.config.ts` reads the project id from `EAS_PROJECT_ID` and from nowhere else. Expo's servers evaluate
  the file again, so also store the id as the project's `EAS_PROJECT_ID` environment variable on expo.dev.
- **Signing.** Upload the keystore of §6.4 once (`npx eas-cli@latest credentials --platform android`, then
  Keystore, then the option to upload an existing one), so that both paths sign with the same key. If EAS
  generates its own, its builds cannot update a locally built app.
- **Version codes.** `eas.json` keeps the version on Expo's servers (`appVersionSource: "remote"`,
  `autoIncrement`), starting at 1; the local script uses minutes since 2026. A phone that has a local build
  refuses an EAS build with a lower code. Use one path for the builds you hand out. If you switch to EAS,
  first run `npx eas-cli@latest build:version:set --platform android` and enter a number above the last
  local code.
- The installed EAS CLI is 23.0.0 and the current one is 27.x; `npx eas-cli@latest` avoids the stale copy.

### 6.10 Push notifications

**What works without any of this:** everything except system notifications while the app is closed. The
in-app inbox, the live updates while the app is open, and SMS where enabled all work. An APK built without
`google-services.json` starts and runs normally (decision P11); it never asks for a push token. For the
pilot that is acceptable. For launch it is not: a driver with the app in the background would not learn of
a new job.

**What the owner must supply for Android push.** The server sends through Expo's push service, and on
Android Expo delivers through Firebase Cloud Messaging. Firebase is used as a transport only: no Firestore,
no Auth, no Functions.

| # | What | Where it goes |
| --- | --- | --- |
| 1 | An Expo account and one Expo project per app (`eas init` in each app folder). Free | The two project ids are passed to builds as `EAS_PROJECT_ID` |
| 2 | One Firebase project (no billing plan needed for messaging) with two Android apps registered: `com.instasupply.shop` and `com.instasupply.driver` | Firebase console |
| 3 | The `google-services.json` of each of those two apps | `app/customer/google-services.json` and `app/driver/google-services.json`. Git ignores them; the build script picks them up |
| 4 | A service account key of that Firebase project (Project settings → Service accounts → Generate new private key), uploaded to **each** Expo project: expo.dev → project → Credentials → Android → FCM V1 service account key | Expo's servers. Not the repository, not Railway. Delete the downloaded file afterwards |
| 5 | Only if the Expo account has "enhanced security for push" turned on: an Expo access token | `railway variable set EXPO_ACCESS_TOKEN --stdin --service backend` |

Then rebuild both apps with the project ids:

```bash
EAS_PROJECT_ID="<customer project id>" bash "$REPO/scripts/android-release.sh" customer https://api.instasupply.ca
EAS_PROJECT_ID="<driver project id>"   bash "$REPO/scripts/android-release.sh" driver   https://api.instasupply.ca
```

If the API key inside `google-services.json` is restricted in the Google Cloud console, it must allow the
FCM Registration API and the Firebase Installations API, and an application restriction must list the
SHA-1 of the certificate that signs the APK (§6.4, and later Google Play's signing certificate as well).
A mismatch shows as "Requests from this Android client application are blocked" and no push token.

Limits of Expo's push service: free, 600 notifications per second per project, no service-level agreement.
The server must read the receipts and drop dead tokens (decision P11).

### 6.11 Later: Google Play

Google Play takes an Android App Bundle (AAB), not an APK. The same script builds it:

```bash
bash "$REPO/scripts/android-release.sh" customer https://api.instasupply.ca aab
# → .build/apk/instasupply-customer-<versionCode>.aab
```

What is needed beyond the file:

- A Google Play developer account (a one-time US$25 fee). For a company, an organization account with a
  D-U-N-S number. A *personal* account created after 13 November 2023 must first run a closed test with at
  least 12 testers for 14 days before it may publish to production.
- **Play App Signing** (the default): Google keeps the app signing key; the keystore of §6.4 becomes the
  upload key. Keep using it for every upload.
- A higher `versionCode` for every upload: the script's default already guarantees it.
- For each app: a privacy policy URL, the Data safety form, a content rating, store listing texts and
  screenshots, and a test account for Google's reviewers.
- For the driver app: the declaration for background location and the foreground service, with a short
  video that shows why the app needs the location while it is not on screen.
- A target API level that Google currently accepts for new apps. This SDK targets API 36.

Uploading is done in Play Console, or with `npx eas-cli@latest submit --platform android --path <file.aab>`.

### 6.12 The build trial of 2026-11-19

While this document was written, a separate workstream ran a trial build of the driver app on this machine,
in the disk image of §6.2. Its Gradle build had started but not finished when this document was finished.
What its logs showed by then:

| Step of the trial | Result |
| --- | --- |
| `hdiutil create`, then `hdiutil attach -nobrowse` | The image mounts at `/Volumes/isbuild` (2 seconds) |
| Copy with `rsync` (on macOS that is openrsync) | Under a second; exclusion rules work |
| `npm ci --workspace app --workspace packages` in the copy, with the manifests of `backend` and `frontend` present | Exit 0: 741 packages, 113 seconds, 0.9 GB. The trial ran install scripts; `scripts/android-release.sh` adds `--ignore-scripts` |
| `expo prebuild --platform android --clean --no-install` with `APP_VARIANT=production` | Exit 0 in 3 seconds. Application id `com.instasupply.driver`. It reads `.env.development`, as §6.7 says, and rewrites two scripts in `package.json` |
| `scripts/patch-android-release.mjs`, run for this document on a copy of the `build.gradle` that prebuild generated | The intended result: the version code, a `release` signing config, and the `release` build type using it |
| `./gradlew` | Asks for `gradle-9.4.1-bin.zip` (138 MB). The wrapper's download ran at about 60 KB per second, so the trial fetched the file in parallel pieces instead; Gradle 9.4.1 then started with JDK 17.0.17 and was compiling the build plugins inside the image |
| Free space on the internal disk | Fell from 9.5 GiB to 8.1 GiB in ten minutes. The build wrote almost nothing there: macOS added a 1 GB swap file |

Not shown when this document was finished: the Gradle build itself, the download of SDK Platform 37, the
signature, the content of the bundle (Appendix B, B8 and B9).

The trial is to leave its own notes and a script in `.build/README.md` and `.build/build-apk.sh` (git-ignored
files). When they exist, they are the evidence for what works on this machine. `scripts/android-release.sh`
is the script that is kept in the repository: where the trial's notes contradict it, change the script and
this section, and delete the trial's copy.

One difference is known. The trial hands the keystore to Gradle through the Android Gradle plugin's
properties `android.injected.signing.store.file`, `.store.password`, `.key.alias` and `.key.password` (the
ones Android Studio uses for "Generate Signed APK"; the plugin's source lists them among its stable options).
That needs no change to `build.gradle`. If the trial shows that it works with this toolchain, the signing
half of the patch script can go. The version code still needs the patch, and the check of step 9 stays in
either case: it is what proves that an APK carries the release key.

The folder `/Volumes/isbuild/signing` holds the trial's throwaway key. It is not a release key.

---

## 7. CI on GitHub Actions

Nothing below has run yet: the folder has had a local `.git` with a first commit since 2026-11-20, but it is
not on GitHub. The workflows are ready for the day it is pushed.

### 7.1 Turning the folder into a repository

1. `git init` (already done on this machine on 2026-11-20), review `git status` (the `.gitignore` already excludes `node_modules`, `.build/`, keystores,
   `.env.local` files and `google-services.json`), commit, push to a private GitHub repository.
2. In GitHub: protect `main` (pull requests, the `CI` checks required); create the environment `production`
   with required reviewers.
3. In Railway: Project Settings → Tokens → create a **project token** for the environment `production`.
   Store it as the secret `RAILWAY_TOKEN` of the GitHub environment `production`. A project token can deploy
   to that one environment and nothing else.
4. Add the variables and secrets listed at the top of `deploy.yml` and `android.yml`.

From then on `railway up` on the laptop also applies `.gitignore` (the CLI does that inside a git
repository), on top of `.railwayignore`. Nothing else changes: the laptop procedure of §4.1 stays valid.

An alternative to `deploy.yml` is Railway's own GitHub integration: connect each service to the repository
(`railway service source connect --repo <owner>/<repo> --branch main --service backend`) and Railway deploys
on every push that touches the service's `watchPatterns`, which `.railway/railway.ts` already sets. If you do
that, declare the source in the file as well (`source: github('<owner>/<repo>', { branch: 'main' })`) and
turn on "Wait for CI" in the service settings. Do one or the other, not both.

### 7.2 Files to delete and files to add

| File | Action | Why |
| --- | --- | --- |
| `.github/workflows/ci.yml` | **replace** with §7.3 | It builds Cloud Functions, starts the Firebase emulators and uses the old folder names |
| `.github/workflows/deploy.yml` | **replace** with §7.4 | It deploys to Firebase through Google Cloud |
| `.github/workflows/customer-app.yml` | **delete** (done 2026-11-20) | EAS build trigger with Firebase variables; replaced by `android.yml` |
| `.github/workflows/driver-app.yml` | **delete** (done 2026-11-20) | Same |
| `.github/workflows/android.yml` | **add** (§7.5), by the `android` workstream (PLATFORM.md §15.3) | Signed APK or AAB of either app, with the script of §6 |
| `.github/scripts/deploy-preflight.sh` | **delete** | Checks Firebase deploy settings |
| `.github/scripts/check-storage-rules-access.sh` | **delete** | Checks Firebase Storage rules |
| `.github/scripts/selftest.sh` | **delete** | Tests the two scripts above |

The three `.github/scripts` files are not in any workstream's list in PLATFORM.md §15, so they were left in
place on 2026-11-20. Nothing calls them any more (the new `ci.yml` does not); whoever owns `.github/` deletes
them.
| `.github/dependabot.yml` | **replace** with §7.6 | It has a `firebase` group |

All actions are pinned to a commit, as before. `actions/checkout`, `actions/setup-node` and
`actions/setup-java` keep the commits the repository already used; `actions/upload-artifact` is new (v7.0.2,
commit checked on 2026-11-19).

### 7.3 `.github/workflows/ci.yml`

Four jobs: code quality (`quality`), backend tests against a PostgreSQL 17 service container (`backend`),
the console build and the app bundles (`clients`), and the two container images (`images`). That last job
migrates and starts the API image in production mode, exactly as Railway does, smoke-tests both images, and
then loads the demo data from the same image. The server refuses the local storage driver in production
mode (PLATFORM.md §11.1), so the demo data, which stores photos, is loaded in development mode.

On 2026-11-20 these steps would still fail, each on another workstream's missing piece and not on this file:
`lint`, `format:check` and `typecheck` (files of the console and other workstreams), the backend tests
(`backend/test/support/run.ts`, harness workstream), the console build in `clients` and `images` (the
console does not compile yet), check 4 of the smoke test (catalogue module) and the demo data (`seed.ts`,
seed workstream). CI deliberately does not use `CONSOLE_PLACEHOLDER` or `SMOKE_SKIP`: it must go green only
when the real pieces exist.

```yaml
name: CI

# Runs on every pull request and on every push to main. deploy.yml calls it before it ships anything.
on:
  pull_request:
  push:
    branches: [main]
  workflow_call:

# A newer push to a pull request replaces the run of the older push. Every other run has a group of its own.
concurrency:
  group: ci-${{ github.event.pull_request.number && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  quality:
    name: Lint, types, unit tests
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: npm
      # Install scripts of dependencies are not run. Nothing here needs one, and an install script is the
      # first place a hijacked package runs its code. The Dockerfiles install the same way.
      - run: npm ci --ignore-scripts
      - run: npm run lint
      - run: npm run format:check
      - run: npm run check:legacy
      - run: npm run typecheck
      - run: npm run test --workspace @instasupply/shared
      - run: npm run test --workspace @instasupply/api-client --if-present

  backend:
    name: Backend tests (PostgreSQL 17)
    runs-on: ubuntu-latest
    timeout-minutes: 20
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_PASSWORD: postgres
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready --username postgres"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 20
    env:
      # The test harness creates a throwaway database per run on this server and drops it afterwards.
      PGHOST: localhost
      PGPORT: '5432'
      PGUSER: postgres
      PGPASSWORD: postgres
      PGDATABASE: postgres
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci --ignore-scripts
      - name: Integration tests
        run: npm run test --workspace @instasupply/backend
      - name: Build the API server
        run: npm run build --workspace @instasupply/backend

  clients:
    name: Console build and app bundles
    runs-on: ubuntu-latest
    timeout-minutes: 25
    env:
      # Any valid origin: these builds are checked, not shipped.
      VITE_API_URL: https://api.example.invalid
      EXPO_PUBLIC_API_URL: https://api.example.invalid
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci --ignore-scripts
      - name: Build the console
        run: npm run build --workspace @instasupply/frontend
      # Bundling catches what the type checker cannot: a module Metro cannot resolve.
      - name: Bundle the customer app (Android, iOS and web)
        working-directory: app/customer
        run: npx expo export --platform android --platform ios --platform web --output-dir "$RUNNER_TEMP/customer-export"
      - name: Bundle the driver app (Android and iOS)
        working-directory: app/driver
        run: npx expo export --platform android --platform ios --output-dir "$RUNNER_TEMP/driver-export"

  images:
    name: Container images, smoke test, demo data
    runs-on: ubuntu-latest
    timeout-minutes: 30
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: instasupply_ci
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready --username postgres"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 20
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
      - name: Build the API image
        run: docker build --file backend/Dockerfile --tag instasupply-backend:ci .
      - name: Build the console image
        run: >
          docker build --file frontend/Dockerfile
          --build-arg VITE_API_URL=https://api.example.invalid
          --tag instasupply-frontend:ci .
      - name: Migrate, then start both images
        run: |
          # The variables .railway/railway.ts sets. The image runs with NODE_ENV=production, so the server's
          # production checks apply. The bucket values are stand-ins: nothing in the next two steps stores a
          # file. No outside service is called (no push, no geocoder, no router).
          printf '%s\n' \
            'PORT=4000' \
            'API_URL=http://localhost:4000' \
            'DATABASE_URL=postgres://postgres:postgres@localhost:5432/instasupply_ci' \
            'JWT_SECRET=ci-only-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' \
            'OTP_PEPPER=ci-only-0123456789abcdef0123456789abcdef0123456789abcdef' \
            'WEB_URL=https://console.example.invalid' \
            'CORS_ORIGINS=https://console.example.invalid' \
            'STORAGE_DRIVER=s3' \
            'S3_ENDPOINT=https://bucket.example.invalid' \
            'S3_REGION=auto' \
            'S3_BUCKET=ci' \
            'S3_ACCESS_KEY_ID=ci-only' \
            'S3_SECRET_ACCESS_KEY=ci-only' \
            'PAYMENTS_MODE=test' \
            'PHONE_VERIFICATION=optional' \
            'SMS_DRIVER=outbox' \
            'EMAIL_DRIVER=outbox' \
            'PUSH_ENABLED=false' \
            'GEOCODER=none' \
            'ROUTING_PROVIDER=estimate' \
            'ALLOW_TEST_JOBS=false' \
            > "$RUNNER_TEMP/backend.env"
          # The same command, in the same mode, that Railway runs before every deployment.
          docker run --rm --network host --env-file "$RUNNER_TEMP/backend.env" instasupply-backend:ci node dist/cli.js migrate
          docker run --detach --name api --network host --env-file "$RUNNER_TEMP/backend.env" instasupply-backend:ci
          docker run --detach --name console --publish 8080:8080 --env API_HOST=api.example.invalid instasupply-frontend:ci
          for attempt in $(seq 1 30); do
            if curl --fail --silent --output /dev/null http://localhost:4000/api/v1/health \
              && curl --fail --silent --output /dev/null http://localhost:8080/healthz; then
              exit 0
            fi
            sleep 2
          done
          echo "The containers did not become healthy." >&2
          exit 1
      - name: Smoke test
        run: node scripts/smoke.mjs
        env:
          API_URL: http://localhost:4000
          WEB_URL: http://localhost:8080
          EXPECT_API_URL: https://api.example.invalid
          SMOKE_CORS_ORIGIN: https://console.example.invalid
          EXPECT_PAYMENTS_MODE: test
      # The seed places every order, quote and issue through the real commands: an end-to-end test of the
      # bundle. It stores photos, so it runs in development mode with the local storage driver, in a
      # container of its own, after the server has stopped. --at fixes the clock at the reference time of
      # MARKETPLACE §4.8, so the end states and amounts are those of §11.5 whatever time CI runs.
      - name: Load the demo data
        run: |
          docker stop api
          docker run --rm --network host --env-file "$RUNNER_TEMP/backend.env" \
            --env NODE_ENV=development --env LOG_PRETTY=false \
            --env MIGRATE_ON_START=false --env DATABASE_AUTO_CREATE=false \
            --env STORAGE_DRIVER=local --env STORAGE_LOCAL_DIR=/app/backend/.data/files \
            --env SEED_PASSWORD=ci-only-Passw0rd-1 \
            instasupply-backend:ci node dist/cli.js seed --demo --at 2026-11-19T12:25:00-05:00
      - name: Container logs
        if: always()
        run: |
          docker logs api || true
          docker logs console || true
```

### 7.4 `.github/workflows/deploy.yml`

Optional. It does from GitHub what §4.1 does from the laptop: run CI, check that Railway matches
`.railway/railway.ts`, `railway up` with a project token, smoke test.

```yaml
name: Deploy

# Ships main to Railway. Started by hand: Actions → Deploy → Run workflow.
#
# Settings → Environments → production (add required reviewers there):
#   secret    RAILWAY_TOKEN   a Railway project token for the environment "production"
#   variable  API_URL         https://<API_HOST>
#   variable  WEB_URL         https://<WEB_HOST>
on:
  workflow_dispatch:
    inputs:
      service:
        description: What to deploy
        type: choice
        options: [both, backend, frontend]
        default: both

# One deployment at a time. A deployment that has started is never cancelled.
concurrency:
  group: deploy-production
  cancel-in-progress: false

permissions: {}

jobs:
  verify:
    name: Verify
    # Only main ships. From any other ref this job is skipped, and so is the deployment that needs it.
    if: github.ref == 'refs/heads/main'
    permissions:
      contents: read
    uses: ./.github/workflows/ci.yml

  deploy:
    name: Deploy to Railway
    needs: verify
    runs-on: ubuntu-latest
    timeout-minutes: 40
    environment: production
    permissions:
      contents: read
    env:
      RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
      # .railway/railway.ts imports the "railway" package from node_modules.
      - run: npm ci --ignore-scripts
      - name: Install the Railway CLI
        run: npm install --global @railway/cli@5.71.0
      # Exit code 2 means the file and Railway differ. Apply the file from the laptop first
      # (railway config plan, then railway config apply): infrastructure changes are reviewed by a person.
      - name: Railway must match .railway/railway.ts
        run: railway config plan --detailed-exit-code
      # The database must have no public TCP proxy (docs/DEPLOYMENT.md §3.5, §4.2).
      - name: Postgres has no public proxy
        run: |
          out="$(railway tcp-proxy list --service Postgres)"
          echo "$out"
          if echo "$out" | grep -q 'proxy.rlwy.net\|:5432'; then
            echo "Postgres has a public TCP proxy. Delete it (railway tcp-proxy delete 5432 --service Postgres)." >&2
            exit 1
          fi
      # Attached (no --ci): the exit code is the deployment's terminal status, 0 only on SUCCESS, so the smoke
      # test below runs against the new version. --ci would exit when the build completes.
      - name: Deploy the API
        if: inputs.service != 'frontend'
        run: railway up --service backend --message "GitHub ${GITHUB_SHA::7}"
      - name: Deploy the console
        if: inputs.service != 'backend'
        run: railway up --service frontend --message "GitHub ${GITHUB_SHA::7}"
      - name: Smoke test
        run: node scripts/smoke.mjs
        env:
          API_URL: ${{ vars.API_URL }}
          WEB_URL: ${{ vars.WEB_URL }}
```

Railway also publishes a GitHub Action, `railwayapp/config`, that posts the plan as a comment on every pull
request that touches `.railway/` and applies the reviewed plan when the pull request merges, with the same
project token. It is not used here: with one operator, `railway config plan` and `railway config apply` on
the laptop (§4.2) are simpler, and this workflow only checks that nothing is pending. Adopt the action when
more than one person changes the infrastructure.

### 7.5 `.github/workflows/android.yml`

The same script as on the laptop. A GitHub runner has no spaces in its paths, a JDK from `setup-java` and an
Android SDK with accepted licences, so no disk image is needed.

Put the keystores of §6.4 into the secrets once, from the laptop (`pbcopy` puts the value on the clipboard
without showing it):

```bash
base64 -i ~/.instasupply/android-signing/customer.keystore | pbcopy    # → ANDROID_KEYSTORE_CUSTOMER_BASE64
pbcopy < ~/.instasupply/android-signing/customer.password              # → ANDROID_KEYSTORE_CUSTOMER_PASSWORD
```

```yaml
name: Android release builds

# Builds a signed release of one app with scripts/android-release.sh (docs/DEPLOYMENT.md §6).
# Started by hand: Actions → Android release builds → Run workflow.
#
# Settings → Environments → production:
#   variable  API_URL                                   the address baked into the app, https://<API_HOST>
#   variable  CUSTOMER_EAS_PROJECT_ID, DRIVER_EAS_PROJECT_ID                   optional (push)
#   secret    ANDROID_KEYSTORE_CUSTOMER_BASE64, ANDROID_KEYSTORE_CUSTOMER_PASSWORD
#   secret    ANDROID_KEYSTORE_DRIVER_BASE64, ANDROID_KEYSTORE_DRIVER_PASSWORD
#   secret    GOOGLE_SERVICES_CUSTOMER_BASE64, GOOGLE_SERVICES_DRIVER_BASE64  optional (push)
on:
  workflow_dispatch:
    inputs:
      app:
        description: App
        type: choice
        options: [customer, driver]
      artifact:
        description: apk to install directly, aab for Google Play
        type: choice
        options: [apk, aab]
        default: apk

permissions:
  contents: read

jobs:
  build:
    name: ${{ inputs.app }} ${{ inputs.artifact }}
    runs-on: ubuntu-latest
    timeout-minutes: 60
    environment: production
    env:
      APP: ${{ inputs.app }}
      ARTIFACT: ${{ inputs.artifact }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      # No dependency cache in a job that holds signing keys.
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          package-manager-cache: false
      - uses: actions/setup-java@77dd5b2ce225ea11469928ac317850245a74ae78 # v6.2.0
        with:
          distribution: temurin
          java-version: '17'
      - name: Restore the signing key and the push configuration
        env:
          CUSTOMER_KEYSTORE: ${{ secrets.ANDROID_KEYSTORE_CUSTOMER_BASE64 }}
          CUSTOMER_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_CUSTOMER_PASSWORD }}
          CUSTOMER_GOOGLE_SERVICES: ${{ secrets.GOOGLE_SERVICES_CUSTOMER_BASE64 }}
          DRIVER_KEYSTORE: ${{ secrets.ANDROID_KEYSTORE_DRIVER_BASE64 }}
          DRIVER_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_DRIVER_PASSWORD }}
          DRIVER_GOOGLE_SERVICES: ${{ secrets.GOOGLE_SERVICES_DRIVER_BASE64 }}
        run: |
          if [ "$APP" = customer ]; then
            KEYSTORE="$CUSTOMER_KEYSTORE"; PASSWORD="$CUSTOMER_PASSWORD"; GOOGLE_SERVICES="$CUSTOMER_GOOGLE_SERVICES"
          else
            KEYSTORE="$DRIVER_KEYSTORE"; PASSWORD="$DRIVER_PASSWORD"; GOOGLE_SERVICES="$DRIVER_GOOGLE_SERVICES"
          fi
          if [ -z "$KEYSTORE" ] || [ -z "$PASSWORD" ]; then
            echo "::error title=No signing key::Add the keystore secrets of the $APP app to the production environment."
            exit 1
          fi
          umask 077
          mkdir -p "$RUNNER_TEMP/signing"
          printf '%s' "$KEYSTORE" | base64 --decode > "$RUNNER_TEMP/signing/$APP.keystore"
          printf '%s\n' "$PASSWORD" > "$RUNNER_TEMP/signing/$APP.password"
          if [ -n "$GOOGLE_SERVICES" ]; then
            printf '%s' "$GOOGLE_SERVICES" | base64 --decode > "app/$APP/google-services.json"
          fi
      - name: Build
        env:
          BUILD_ROOT: ${{ runner.temp }}/isbuild
          OUT_DIR: ${{ runner.temp }}/out
          SIGNING_DIR: ${{ runner.temp }}/signing
          API_URL: ${{ vars.API_URL }}
          CUSTOMER_EAS_PROJECT_ID: ${{ vars.CUSTOMER_EAS_PROJECT_ID }}
          DRIVER_EAS_PROJECT_ID: ${{ vars.DRIVER_EAS_PROJECT_ID }}
        run: |
          if [ "$APP" = customer ]; then export EAS_PROJECT_ID="$CUSTOMER_EAS_PROJECT_ID"; else export EAS_PROJECT_ID="$DRIVER_EAS_PROJECT_ID"; fi
          bash scripts/android-release.sh "$APP" "$API_URL" "$ARTIFACT"
      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: instasupply-${{ inputs.app }}-${{ inputs.artifact }}
          path: ${{ runner.temp }}/out/*
          if-no-files-found: error
          retention-days: 14
```

### 7.6 `.github/dependabot.yml`

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 8
    groups:
      tooling:
        patterns:
          [
            'eslint*',
            '@eslint/*',
            'typescript-eslint',
            'prettier',
            'tsx',
            'vite',
            '@vitejs/*',
            'tailwindcss',
            '@tailwindcss/*',
          ]
    ignore:
      # Expo SDK upgrades move these together; use `npx expo install --fix` instead.
      - dependency-name: 'expo*'
      - dependency-name: 'react-native*'
      - dependency-name: '@expo/*'
      - dependency-name: 'react'
      - dependency-name: 'react-dom'
      # Pinned on purpose (docs/DEPLOYMENT.md §2.7): upgrade it by hand and read `railway config plan`.
      - dependency-name: 'railway'
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: monthly
```

---

## 8. Costs, limits, and what the owner must provide or decide

### 8.1 Railway costs

Prices are in US dollars, from Railway's pricing page on 2026-11-19. Railway charges a plan fee plus what
the services actually use, per minute; the plan fee includes the same amount of usage.

| | Hobby | Pro |
| --- | --- | --- |
| Plan fee per month (includes that much usage) | $5 | $20 |
| Memory | $10 per GB per month | same |
| CPU | $20 per vCPU per month | same |
| Network egress | $0.05 per GB | same |
| Volume (the database's disk) | $0.15 per GB per month | same |
| Bucket | $0.015 per GB per month; requests and downloads are free | same |
| Builds | free | free |

A rough estimate for the pilot, with assumed average use (the real figures are in `railway usage`):

| Resource | Assumption | Per month |
| --- | --- | --- |
| `backend` | 256 MB, 0.05 vCPU | $2.56 + $1.00 |
| `frontend` | 32 MB, almost no CPU | $0.32 |
| `Postgres` | 256 MB, 0.03 vCPU, 1 GB on disk | $2.56 + $0.60 + $0.15 |
| `uploads` | under 1 GB | $0.02 |
| Egress | 5 GB | $0.25 |
| **Usage** | | **about $7.50** |

So about $7.50 a month on Hobby ($5 fee, the first $5 of usage included) and $20 on Pro (usage stays under
the included $20). A second backend instance adds about $3.50. Volume backups and the point-in-time archive
are billed as storage at the same rates.

What the plan changes for this system:

| | Hobby | Pro |
| --- | --- | --- |
| Rollback window (how long images of old deployments are kept) | 72 hours | 120 hours |
| Log retention | 7 days | 30 days |
| Custom domains per service | 2 | 20 |
| Database volume | 5 GB | 50 GB, can grow to 1 TB |
| Team members on the project | no | yes |
| Outbound SMTP | blocked | allowed |
| Static outbound IP addresses | no | yes |
| When Railway is short of capacity | builds may be queued | not affected |

**Recommendation:** Hobby is enough for the pilot. Move to Pro before real customers: the longer rollback
window, 30 days of logs, room for a second person and priority during capacity shortages are worth the
difference.

Other costs: an Expo account is free, and local builds cost nothing (Expo's cloud builds have a free
allowance and paid plans). Google Play is a one-time US$25. Twilio, Resend, a map provider and a payment
gateway charge by use: check their current prices when choosing.

### 8.2 Limits the owner should know

| Topic | The limit | What it means |
| --- | --- | --- |
| Location of data | Railway has no Canadian region. Everything is in US East (Virginia) | Personal information of Canadian customers is stored in the United States. Say so in the privacy policy. MARKETPLACE D13 assumed Toronto hosting; that is not available on Railway |
| Availability | Railway publishes no uptime guarantee for databases. It checks the health path only during a deployment, and it may restart a service to move it to another host | Add an external uptime check before launch. One database instance means a restart is a short outage; high availability is a paid option (`railway postgres ha`) |
| Rollback | Only within 72 or 120 hours, and only to an image Railway still has | Keep the source history (§7.1) |
| Config files | `railway.json` / `railway.toml` stop working on 2026-12-01 and cannot be used by new services | Only `.railway/railway.ts` configures Railway. What is not in that file gets deleted by `railway config apply` |
| Files | Buckets are private, have no backups, no versioning and no automatic expiry, and are reached over the public network | A deleted file is gone. Retention rules must be a job of our own |
| Email | Outbound SMTP is blocked below the Pro plan | Use an email provider with an HTTPS API (Resend). The `smtp` driver only works on Pro |
| Map tiles | OpenStreetMap's public tile server has no guarantee, forbids heavy use and bulk download, and may withdraw access "at any point", in particular from commercial services. Policy: <https://operations.osmfoundation.org/policies/tiles/> | Fine for the pilot. For launch, set `MAP_TILE_URL` to a paid tile provider. No client change is needed |
| Geocoding | The public Nominatim server allows **at most 1 request per second for the whole application**, requires a User-Agent that identifies the app, forbids autocomplete (search as you type) and bulk geocoding, and has no guarantee. Policy: <https://operations.osmfoundation.org/policies/nominatim/>. Read it before relying on this service | The apps search on submit only, the server caches results and rate-limits itself. For launch volume, use Google (`GOOGLE_MAPS_API_KEY`) or another paid geocoder |
| Routing | The public OSRM demo server allows 1 request per second, is for "reasonable, non-commercial use-cases", and gives no guarantee of uptime or data freshness | **Not acceptable for a commercial launch.** Road distance sets the delivery fee and the driver's pay. Before launch choose Google Routes (by key), another paid router, or run OSRM as a service of our own. `ROUTING_PROVIDER=estimate` is the fallback when no router answers |
| Outbound addresses | Requests to those public services leave from addresses shared with other Railway customers | A public service may throttle or block them because of someone else's traffic. Another reason not to depend on them at launch |
| Payments | `PAYMENTS_MODE=test` moves no money | Pilot only (§3.2) |
| SMS | No provider yet: messages go to the outbox shown in the console, and phone verification is optional | Twilio before launch (§8.3) |
| Push | Needs an Expo account and a Firebase project used for messaging only (§6.10). Expo's push service is free, limited to 600 notifications per second per project, with no guarantee | Without it the apps work but stay silent in the background |
| Android | The API address and the signing key are fixed inside every APK | Settle the host name before handing out APKs (§3.2). Back up the keystores (§6.4) |
| Google Play | A personal developer account created after 13 November 2023 needs a closed test with 12 testers for 14 days before production | Plan for it, or register as an organization |
| Logs | 500 lines per second per instance; more are dropped | Do not log every request body |
| This machine | The internal disk has about 8 GB free and also holds the swap files; the repository's path contains spaces | Android builds run on a disk image (§6.2). Database dumps go to the external disk. Close other applications before a build |

### 8.3 What the owner must provide or decide

| # | Item | Needed for | When | Where it goes |
| --- | --- | --- | --- | --- |
| 1 | Railway plan and a payment method; the amount of the spending alert | Everything | Before §3 | Railway dashboard; §3.14 |
| 2 | Confirmation that the first deployment runs in **pilot mode** (simulated payments, team and demo accounts only) | Placing any order at all | Before §3 | `PAYMENTS_MODE` in `.railway/railway.ts` |
| 3 | Host names: `api.instasupply.ca` and `app.instasupply.ca`, or others, or the Railway-provided ones for now. Access to the DNS of `instasupply.ca` | Stable addresses in the console and in every APK | Before the first APK leaves the team | §4.9; `app/<app>/.env.production` |
| 4 | The email address and name of the first administrator | §3.11 | First deployment | `create-admin` |
| 5 | Whether to load the demo data into production during the pilot | Demonstrations | First deployment | §3.13 |
| 6 | Support phone number, support email address and HST registration number (MARKETPLACE §15, questions 1 and 9) | Receipts, "Call support", the contact shown in the apps | Before launch | `SUPPORT_PHONE`, `SUPPORT_EMAIL`, `HST_NUMBER` (§3.7) |
| 7 | **SMS provider**: a Twilio account with a Canadian sender number, its account SID, auth token and number; in the Twilio console, SMS geo-permissions set to **Canada only** (the server also sends codes to Canadian area codes only, PLATFORM.md §6.3.9) | Phone verification, new-order alerts to stores, tracking links | Before launch | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` with `railway variable set … --stdin`; then `SMS_DRIVER: 'twilio'` and `PHONE_VERIFICATION: 'required'` in `.railway/railway.ts` |
| 8 | **Email provider**: a Resend account, the sending domain verified in DNS, an API key and a sender address | Password reset codes, invitations | Before launch | `RESEND_API_KEY`, `EMAIL_FROM`; then `EMAIL_DRIVER: 'resend'` |
| 9 | **Push, only if wanted on Android**: an Expo account and a Firebase project used as the messaging transport | Notifications while the app is closed | Before launch; optional for the pilot | §6.10 |
| 10 | Where the two Android keystores are backed up, and who can reach them | Every future update of the apps | The day they are generated | §6.4 |
| 11 | A Google Play developer account (organization) | Publishing on Google Play | Later | §6.11 |
| 12 | **A real payment gateway** (Stripe: account, Connect for supplier and driver payouts) and the accounting answers of MARKETPLACE §15 | Taking money | Later; out of scope of this release | `PAYMENTS_MODE: 'stripe'` once it is built |
| 13 | A map tile provider, a geocoder and a router for commercial use (§8.2) | Launch | Before launch | `MAP_TILE_URL`, `GOOGLE_MAPS_API_KEY`, `GEOCODER`, `ROUTING_PROVIDER` |
| 14 | Acceptance that data is stored in the United States, and the matching sentence in the privacy policy | Privacy compliance | Before launch | Legal |
| 15 | Whether the folder becomes a git repository on GitHub | Rollback beyond 5 days, CI, a second engineer | As soon as possible | §7.1 |
| 16 | Who restores a backup, and a date for the first restore drill | Knowing that backups work | Before launch | §4.6 |
| 17 | The fictional store and person names of the demo data checked against real businesses (MARKETPLACE §15, question 10) | Public demonstrations | Before any public demo | Seed data |

---

## Appendix A. What was verified, and where

Checked on 2026-11-19. "CLI source" is `github.com/railwayapp/cli` at tag `v5.71.0`, the version installed
here. "Installed packages" are files under this repository's `node_modules`.

| # | Fact | Source |
| --- | --- | --- |
| A1 | Config as Code (`railway.json`, `railway.toml`) is deprecated; new services cannot opt in; files stop being read on 2026-12-01. Its replacement is `.railway/railway.ts`, applied with `railway config plan` and `railway config apply`; one file per monorepo; a resource omitted from the file is deleted | docs.railway.com/config-as-code, /infrastructure-as-code, /infrastructure-as-code/reference, /cli/config; `railway config --help` |
| A2 | The file is evaluated on the operator's machine with `node --experimental-strip-types` and needs the npm package `railway` in the nearest `node_modules` | CLI source `src/iac/eval.rs`; npm registry (`railway` 3.17.0, export `railway/iac`) |
| A3 | Service settings the file accepts: `build.builder` (`DOCKERFILE`), `build.dockerfilePath`, `build.watchPatterns`, `preDeploy`, `healthcheck`, `healthcheckTimeout`, `replicas` per region, `deploy.restartPolicyType`, `restartPolicyMaxRetries`, `drainingSeconds`, `preDeployTimeoutSeconds`, `sleepApplication`; variables as literals, references (`db.env.X`, `ref(resource, 'X')`) or `preserve()` | Type definitions of `railway@3.17.0` (`dist/iac`); CLI source `src/iac/compiler.rs` |
| A4 | Variables are managed by default: a variable on Railway that the file does not declare is planned for deletion; `preserve()` entries are skipped; values are hidden in plans | CLI source `src/iac/graph.rs`, `change_set.rs`; docs.railway.com/infrastructure-as-code |
| A5 | The IaC reference documents custom domains on a service (`domains: ["app.example.com"]`, `domains: [{ domain, port }]`); generated Railway domains are not in the file. The first reading of the CLI 5.71 source (`src/iac/change_set.rs`, `diagnose_unsupported_custom_domains`) suggested the CLI may refuse some custom domains; §4.9 therefore tries the file first on a throwaway domain and has a fallback | docs.railway.com/infrastructure-as-code/reference ("Custom domains"), re-read 2026-11-20; CLI source |
| A6 | A PostgreSQL database declared in the file is created from the image named in it, with a volume at `/var/lib/postgresql/data`, generated credentials, `DATABASE_URL` on the private domain, **and a public TCP proxy on 5432**. A different image major in the file is planned as a change of image | CLI source `src/iac/compiler.rs` (`database_to_environment_config`), `change_set.rs` (`normalize_image_tag`) |
| A7 | Railway's PostgreSQL template deploys `ghcr.io/railwayapp-templates/postgres-ssl:18` today; tags `14` to `18` exist, including `17`; the SDK's `postgres()` helper defaults to `:18` | Railway template metadata (`postgres`); GHCR tag list; `railway@3.17.0` source |
| A8 | Major upgrades go through the dashboard flow with `pg_upgrade`; editing the image tag by hand does not migrate data. Backups and PITR need a major tag such as `:17` | docs.railway.com/databases/postgresql-major-upgrade, /volumes/point-in-time-recovery, /cli/postgres |
| A9 | `railway up` uploads the linked directory; it always skips `node_modules` and `.git`, applies `.railwayignore`, includes hidden files, follows symbolic links, and applies `.gitignore` only inside a git repository | CLI source `src/controllers/upload.rs`, `src/commands/up.rs`; `ignore` crate 0.4 (`require_git` defaults to true); docs.railway.com/cli/up |
| A10 | `railway up --ci` streams build logs only and exits when the build completes; attached (no flag) the exit code comes from the deployment's terminal status (0 on `SUCCESS`, 1 on failure or crash, even if the log stream ends early); `--detach` returns once the build is queued; `railway deployment list --json` lists newest first; `railway up` always builds | docs.railway.com/cli/up (re-read 2026-11-20); docs.railway.com/builds/skipped-builds |
| A11 | A custom Dockerfile path is `build.dockerfilePath` or the variable `RAILWAY_DOCKERFILE_PATH`; build-time variables must be declared with `ARG`; layer caching is on but not guaranteed | docs.railway.com/builds/dockerfiles, /builds/build-configuration |
| A12 | Pre-deploy command: runs between build and deploy in a separate container of the image, with the service's variables and the private network, without volumes; a failure stops the deployment; no time limit unless set (1 to 3600 s) | docs.railway.com/deployments/pre-deploy-command |
| A13 | Health check: called on the `PORT` of the new deployment until it answers 2xx, 300 s by default, from host `healthcheck.railway.app`; not monitored afterwards. Restart policy default: on failure, 10 retries. Old deployment: `SIGTERM`, then `SIGKILL` after the draining time (default 0) | docs.railway.com/deployments/healthchecks, /restart-policy, /deployment-teardown, /reference |
| A14 | Variables: `${{service.VAR}}` references; `RAILWAY_PUBLIC_DOMAIN` is the bare public host name, given by Railway to every build and deployment and described as "the public service or customer domain"; sealed variables cannot be read back; `railway variable set NAME --stdin` trims the final newline and redeploys unless `--skip-deploys` | docs.railway.com/variables, /variables/reference, /cli/variable; CLI source `src/commands/variable.rs` |
| A15 | Public networking: HTTP/1.1 and HTTP/2; WebSockets over HTTP/1.1 with no duration or idle limit; other requests up to 15 minutes; request bodies within 5 minutes; 32 KB of headers; `X-Real-IP`, `X-Forwarded-Proto`, `X-Railway-Request-Id` | docs.railway.com/networking/public-networking/specs-and-limits |
| A16 | One Railway-provided domain per service, created with `railway domain [--port]`, renamable; custom domains need a `CNAME` and a `TXT` record; 2 per service on Hobby, 20 on Pro; the CLI does not require a deployment to create a domain | docs.railway.com/networking/domains/working-with-domains, /cli/domain; CLI source `src/commands/domain.rs` |
| A17 | Private network: `<service>.railway.internal`, WireGuard, IPv4 and IPv6 in environments created after 2025-10-16, available at run time and in the pre-deploy command but not during the build. Fastify must listen on `::` | docs.railway.com/networking/private-networking/how-it-works, /guides/fastify |
| A18 | Regions: `us-west2`, `us-east4-eqdc4a`, `europe-west4-drams3a`, `asia-southeast1-eqsg3a`. Bucket regions: `sjc`, `iad`, `ams`, `sin`, fixed at creation | docs.railway.com/deployments/regions, /cli/bucket; `railway bucket create --help` |
| A19 | Buckets: private only, S3-compatible, virtual-hosted URLs on `https://t3.storageapi.dev`, variables `BUCKET`, `ENDPOINT`, `REGION`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`; presigned URLs up to 90 days; browser uploads need CORS set through the S3 API; no versioning, lifecycle rules or backups; not on the private network; $0.015 per GB per month; restorable for 52 hours after deletion | docs.railway.com/storage-buckets, /storage-buckets/uploading-serving, /storage-buckets/billing |
| A20 | Serverless (app sleeping) puts a service to sleep after 5 to 10 minutes without outbound traffic; the first request may get a 502 | docs.railway.com/deployments/serverless |
| A21 | Replicas: random distribution, no sticky sessions; a service with a volume cannot have replicas; volumes are mounted as root and are not available to the pre-deploy command | docs.railway.com/deployments/scaling, /volumes, /volumes/reference |
| A22 | Volume backups: daily kept 6 days, weekly 27 days, monthly 89 days; restore within the same project and environment. PITR: WAL archive to a bucket named `Postgres-PITR`, about 4 weeks, restore into a new service. `railway connect` tunnels over SSH when there is no TCP proxy | docs.railway.com/volumes/backups, /volumes/point-in-time-recovery, /guides/postgres-backups-restores, /cli/connect, /cli/postgres |
| A23 | Rollback only from the dashboard; images kept 72 hours (Hobby), 120 hours (Pro); `railway redeploy` reuses the existing build by default | docs.railway.com/guides/roll-back-bad-deploy, /pricing/plans; `railway redeploy --help` |
| A24 | `railway ssh -- <command>` runs a command in the running container and quotes each argument; it needs an SSH key registered with Railway. `railway run` runs locally with the service's variables | docs.railway.com/cli/ssh, /cli/run; CLI source `src/commands/ssh/native.rs` |
| A25 | Pricing, plan limits, log retention, the 500 lines per second log limit, usage limits (soft = email, hard = workloads offline), SMTP only on Pro, static outbound IPs only on Pro | docs.railway.com/pricing/plans, /pricing/cost-control, /observability/logs, /networking/outbound-networking, /networking/static-outbound-ips; `railway usage limit set --help` |
| A26 | Every `railway` command and flag used in this document | `railway <command> --help` of the installed CLI 5.71.0 |
| A27 | npm 10.9.8: `npm ci` works when only some workspace folders are present and installs those workspaces only (the Dockerfiles rely on it). `npm ci --workspace app --workspace packages` selects every workspace under those two folders and works with this repository's lockfile (the Android script relies on it) | Experiment in a scratch directory with a six-workspace project and no external dependencies; logs of the build trial of §6.12; the documentation shipped with npm 10.9.8 (`using-npm/config`, setting `workspace`) |
| A28 | Docker image tags `node:22-bookworm-slim`, `caddy:2.11-alpine` (2.11.9), `alpine:3.24`, `postgres:17` exist | Docker Hub API |
| A29 | Caddyfile: `{$VAR:default}` is substituted before parsing; `admin off`, `persist_config off`, `auto_https off`; `handle`, `respond`, `header`, `try_files`, `file_server`, `encode zstd gzip`. Railway's own guide for single-page apps uses Caddy with the same global options | caddyserver.com/docs (Caddyfile concepts, options, directives); docs.railway.com/guides/spa-routing-configuration |
| A30 | Android build requirements of this SDK: `compileSdk 37`, `targetSdk 36`, `minSdk 24`, build-tools 37.0.0, NDK 27.1.12297006, Android Gradle plugin 9.2.1, Gradle 9.4.1, four ABIs by default | Installed packages: `react-native/gradle/libs.versions.toml` (0.88.1), `expo/template.tgz` (template 58.0.35), `expo-modules-autolinking/…/ExpoRootProjectPlugin.kt` |
| A31 | The template's `release` build type is signed with the debug keystore, bundles with `expo export:embed`, and has `versionCode 1`. `scripts/patch-android-release.mjs` was run against that template file, and against the `build.gradle` that `expo prebuild` generated for the driver app in the build trial, and produced the intended file both times | `expo/template.tgz`: `android/app/build.gradle`; tests on copies in a scratch directory |
| A32 | What this machine has: §3.1 and §6.1. The SDK package for API 37 is named `platforms;android-37.0` | Commands run on this machine; Google's SDK repository index |
| A33 | Gradle downloads missing SDK packages when their licences are accepted in the SDK's `licenses` folder | developer.android.com/studio/intro/update |
| A34 | Expo env files: `.env.local` is loaded in development and production mode ahead of `.env.development` / `.env.production`; `expo prebuild` runs in development mode; only `process.env.EXPO_PUBLIC_NAME` written literally is inlined | docs.expo.dev/guides/environment-variables |
| A35 | Expo local release builds: `npx expo prebuild`, a signing config in `android/app/build.gradle`, `./gradlew app:bundleRelease` for an AAB (and `assembleRelease` for an APK); `prebuild --clean` regenerates `android/`; `--no-install` skips installing | docs.expo.dev/guides/local-app-production, /workflow/continuous-native-generation |
| A36 | EAS: `android.buildType: "apk"` runs `:app:assembleRelease`; the default is an AAB; `EAS_NO_VCS=1` and `EAS_PROJECT_ROOT` for a folder without git; `.gitignore` is applied; `appVersionSource` and `autoIncrement`; `eas build:version:set` | docs.expo.dev/build-reference/apk, /build-reference/project-upload, /build-reference/app-versions, /eas/json |
| A37 | Android push through Expo needs a Firebase project, `google-services.json` in the app and an FCM V1 service account key uploaded to the Expo project; the push service is free, 600 per second per project, no guarantee | docs.expo.dev/push-notifications/fcm-credentials, /push-notifications/faq, /push-notifications/sending-notifications |
| A38 | `keytool -genkeypair … -storepass:file` creates the PKCS12 keystore of §6.4, and the fingerprint comparison of the build script reads `keytool -list -v` and `keytool -printcert -jarfile` correctly | Run with the JDK 17 of this machine on throwaway files |
| A39 | `versionCode`: a positive integer, at most 2,100,000,000 on Google Play; a lower code than the installed one is refused. Personal Play accounts created after 2023-11-13: closed test, 12 testers, 14 days | developer.android.com/studio/publish/versioning; support.google.com/googleplay/android-developer/answer/14151465 |
| A40 | Usage policies of the public OpenStreetMap tile server, Nominatim and the OSRM demo server | operations.osmfoundation.org/policies/tiles, /policies/nominatim; github.com/Project-OSRM/osrm-backend/wiki/Demo-server |
| A41 | Pinned commits of `actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, `actions/upload-artifact` v7.0.2; `@railway/cli` 5.71.0 exists on npm (latest is 5.75.0) | GitHub API; npm registry |
| A42 | `ANDROID_HOME` names the SDK folder; `ANDROID_USER_HOME` moves the folder the Android tools otherwise create as `~/.android` | developer.android.com/tools/variables |
| A43 | The Android Gradle plugin has the options `android.injected.signing.store.file`, `.store.password`, `.key.alias` and `.key.password`, listed among its stable options | Plugin source on android.googlesource.com (`platform/tools/base`, branch `mirror-goog-studio-main`: `StringOption.kt`, `InjectedProperties.kt`). That is the current source, not the 9.2.1 release |
| A44 | The results in the table of §6.12 | Log files of the build trial on this machine, read between 21:55 and 22:12 on 2026-11-19 |
| A45 | `railway config plan` and `apply` accept an environment-scoped project token in `RAILWAY_TOKEN`; Railway's GitHub Action `railwayapp/config` plans on pull requests and applies on merge | docs.railway.com/infrastructure-as-code, /cli/config |

## Appendix B. What was not verified

Nothing was built, installed, deployed or created for this document (the build trial of §6.12 was another
workstream's). Confirm these on the first run, in this order, and correct the document where reality
differs.

| # | Not verified | How it shows | What to do |
| --- | --- | --- | --- |
| B1 | **Backend side checked on 2026-11-20 (§2.8)**: build, start, migrate, health, config, error envelope, CORS, WebSocket and SIGTERM behave as listed. Still open: `seed --demo`, `storage-cors` against a real bucket, `/api/v1/categories`, and the console's side. Originally: the names of §2.1 exist on paper only. `docs/PLATFORM.md` (§2.2, §2.7, §13.4) and `docs/CLIENTS.md` (§8) confirm them, including the start-up and demo-data guarantees, but the backend is not written yet | A failing image build, pre-deploy command, smoke test, or the `images` job of CI | Reconcile the documents; change one side only |
| B2 | **Mostly done on 2026-11-20 (§2.8)**: the backend image and the console image (placeholder build) were built and run, the Caddyfile validated and served. Still open: the console image with the real Vite build, and both builds on Railway's builder (linux/amd64; the local builds were linux/arm64) | `docker build` or the `images` job of CI fails | Start Docker Desktop and build both images locally before the first `railway up` (the commands are in the header of each Dockerfile). If `npm ci` stops over a workspace folder that is absent from the image build, copy that workspace's `package.json` in the same `COPY` block, as the Android script does |
| B3 | `.railway/railway.ts` was never planned or applied; it type-checks against the SDK and evaluates locally (§2.8) | `railway config plan` reports an error or an unexpected plan | `plan` is read-only: fix the file until the plan shows exactly the four additions |
| B4 | That the database really comes up as PostgreSQL 17 from the pinned image | `select version()` in §3.4 | Stop if it is not 17 |
| B5 | That `railway domain` works before a service's first deployment | An error in §3.6 | The fallback order is described there |
| B6 | That `railway ssh` starts in the image's environment (variables present) | `railway ssh --service backend -- printenv NODE_ENV` must print `production` | If variables are missing, run one-off commands as a temporary pre-deploy command instead |
| B7 | That a redeploy caused by `railway config apply` rebuilds the console with a changed `VITE_API_URL` | `/build-info.json` shows the old address | Always follow such a change with `railway up --service frontend` (§4.2) |
| B8 | No Android build was run for this document, and the build trial of §6.12 had not finished its Gradle build when it was finished. Not shown: the automatic download of `platforms;android-37.0`, the Gradle build inside the disk image, a native build after `npm ci --ignore-scripts`, and the check that finds the API address inside the Hermes bundle | The build script stops with a message | Read the trial's notes first (`.build/README.md`). §6.2 step 2 for the platform; remove `--ignore-scripts` from the script if a dependency turns out to need its install script; `SKIP_BUNDLE_CHECK=1` only after confirming the address on a phone |
| B9 | The output format of `apksigner verify --print-certs` for a real APK (it could not be tested without one) | "The apk is not signed with …" although the build used the keystore | Compare the two fingerprints by hand and adjust the `fingerprint` function |
| B10 | The EAS path with `EAS_NO_VCS=1` from this folder | Upload or build errors on Expo's servers | The local path is the primary one |
| B11 | The CI workflows were never run | Failing jobs on the first pull request | Fix forward; `ci.yml` is the place where §2.1 is checked automatically |
| B12 | The cost estimate of §8.1 uses assumed averages | `railway usage` after a week | Adjust the spending alert |
| B13 | The output of `railway tcp-proxy list` (the `deploy.yml` check greps for `proxy.rlwy.net` or `:5432`), and whether `railway config apply` really re-creates the proxy each time | The check passes while a proxy exists, or fails on an empty list | Run the list once with a proxy and once without after §3.5 and adjust the pattern |
| B14 | Whether CLI 5.71 accepts `domains` on a service in `.railway/railway.ts` | `railway config plan` reports custom domains as unsupported | §4.9 fallback: CLI-added domains and rule 1 of §4.2 |
| B15 | That attached `railway up` behaves the same in GitHub Actions (no terminal) as on the laptop | The deploy step returns before the deployment ends | Use the `railway deployment list --json` wait loop of §3.8 after `railway up --detach` |
