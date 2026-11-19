# InstaSupply

The construction-supply marketplace for the Greater Toronto Area. Contractors, renovators,
builders and homeowners order building supplies from several local supplier stores in one
checkout, and get them delivered to the jobsite by gig drivers or ready for pickup.

- **Customers** search materials across nearby stores, check out once, track each delivery live,
  send a material list for a quote, report problems and chat with support.
- **Suppliers** get new-order alerts, accept or short-ship, prepare, and confirm every collection
  with a 4-digit PIN. They are paid daily.
- **Drivers** claim jobs that fit their city and vehicle, collect at the store, deliver to the site
  and confirm with a photo. They are paid per delivery.
- **InstaSupply staff** onboard stores, answer quotes, resolve issues, oversee jobs and run payouts.

Money is CAD in integer cents, tax is Ontario HST 13 %, time is America/Toronto, payments are by
card (test mode until a gateway is connected).

> **Status:** being rebuilt from a Firebase prototype onto a Node API with PostgreSQL, deployed on
> Railway. The shared domain package is done; the backend foundation and the client library are
> being built; the three clients still contain Firebase code until they are moved onto the API.

## Repository layout

```
backend/            API server: Node 22, Fastify, PostgreSQL (migrations in backend/migrations)
frontend/           Web console (Vite + React): ops back office, supplier portal at /portal,
                    public tracking page at /track/:token
app/customer/       Customer app (Expo, Android / iOS / web)
app/driver/         Driver app (Expo, Android / iOS / web)
packages/shared/    Domain rules shared by everything: pricing, tax, Toronto time, vehicle
                    classes, state machines, validation, API contracts (unit tested)
packages/api-client/ Client library for the API (auth, typed calls, live updates, React hooks)
packages/art/       Construction illustrations, category icons, scenes and storefronts (SVG)
scripts/            Repository checks (legacy grep, smoke test)
docs/               Specifications and runbooks (see below)
legacy/             The old Firebase backend, kept as reference while it is ported; deleted later
```

The backend imports only `packages/shared`. The clients never import `backend/`.

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/MARKETPLACE.md](docs/MARKETPLACE.md) | The product and domain: data shapes, state machines, money, time, every screen |
| [docs/PLATFORM.md](docs/PLATFORM.md) | The backend: PostgreSQL schema, API, auth, live updates, jobs, configuration |
| [docs/CLIENTS.md](docs/CLIENTS.md) | The client library and how the three clients use the API |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deploying to Railway and building Android APKs |

## Run it locally

Requirements: **Node 22** and **PostgreSQL 17** running locally (on macOS:
`brew install postgresql@17 && brew services start postgresql@17`). No Docker needed.

```bash
npm install
```

```bash
npm run dev:backend        # API on http://localhost:4000 (creates and migrates the dev database)
```

```bash
npm --workspace @instasupply/backend run seed     # demo stores, products and accounts
```

```bash
npm run dev:frontend       # web console on http://localhost:5173
```

```bash
npm run dev:customer       # customer app (press w for web, or scan with Expo Go)
```

```bash
npm run dev:driver         # driver app
```

Configuration lives in `.env` files next to each package (templates: `.env.example`). Real `.env`
files are never committed.

## Checks

```bash
npm run lint && npm run format:check && npm run typecheck
```

```bash
npm test                   # shared domain unit tests
```

```bash
npm run test:backend       # backend tests (each run uses its own throwaway database)
```

```bash
npm run check:legacy       # fails if grocery-prototype leftovers remain
```

## Deploying

Production runs on Railway: the API, a managed PostgreSQL database, a storage bucket for photos,
and the web console. Android APKs are built locally against the production API. Step-by-step
instructions: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

```bash
npm run deploy:backend     # railway up --service backend
```

```bash
npm run deploy:frontend    # railway up --service frontend
```

```bash
npm run smoke              # check a deployment end to end
```
