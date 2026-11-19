# InstaSupply

Grocery delivery platform with four parts:

- a **shopping app** for customers (iOS, Android and web)
- a **driver app** (iOS, Android and web)
- a **back office** for dispatch, orders and the product catalogue, with a public order-tracking page
- a secure **Firebase backend**

It is a ground-up rebuild of the original InstaDelivery prototype. It adds stronger auth, a real
messaging pipeline, live tracking, a better route optimizer, a full shopping experience, tests and
production infrastructure.

| Area | InstaDelivery (before) | InstaSupply (now) |
| --- | --- | --- |
| **Shopping** | — | A grocery app in the style of the "Big Cart" design: onboarding, categories, search and filters, product pages with reviews, favourites, cart with promo codes and a free-delivery meter, saved addresses, cash on delivery or test-mode cards, **live order tracking** with the driver on a map, order history and notifications |
| **Orders** | Deliveries typed in by hand | Checkout creates the delivery automatically. Prices, promo codes and stock are enforced on the server in one transaction. Order status follows the delivery. Shoppers can cancel before pickup, and stock is returned |
| **Auth** | Email + Firebase phone auth, no roles | Role claims (admin / dispatcher / driver / customer), driver approval workflow, rate-limited OTP phone verification, suspension that signs drivers out everywhere, staff invites |
| **Data security** | No security rules in the repo | Strict Firestore + Storage rules, all status changes server-validated, card numbers can never be stored, rules tests |
| **Notifications** | One function, one FCM token per user, push on create only | In-app inbox + push for every order and delivery event, multi-device FCM **and** Expo push, dead-token cleanup, idempotent triggers, per-user preferences |
| **Messaging** | — | Dispatch ↔ driver chat with quick replies, unread badges, push |
| **Live tracking** | Driver location every 30 s / 80 m | Adaptive streaming (5 s while on a trip), background tracking in native builds, live dispatch map, in-app tracking for shoppers and a **public tracking link** with live ETA and hand-off code |
| **Routing** | Greedy order, Google key shipped in the app | Nearest-neighbour + 2-opt + relocate with priorities and time windows, server-side Google Routes (key never in the app), OSRM / estimate fallback, plan shared with dispatch |
| **Driver app** | List + map | Today dashboard, accept/decline, one-tap status flow, proof of delivery (photo, recipient, hand-off code, COD), failure reasons, chat, inbox, history, dark mode, onboarding |
| **Back office** | Basic list | KPIs, store summary, live fleet map, deliveries with filters, create with geocoding + map pin, CSV import, smart driver suggestions, timelines, **orders** with packing slips, **catalogue** with stock control, driver approvals, team management, dev SMS outbox |
| **Infra** | Manual | Environments (local / staging / prod), CI (lint, types, unit, integration, bundles), CD with Workload Identity, EAS builds for both apps, Secret Manager, App Check ready, backups, TTL, security headers |

## Repository layout

```
apps/customer          Expo SDK 58 shopping app (Expo Router, Big Cart design system)
apps/driver            Expo SDK 58 driver app
apps/backoffice        Vite + React 19 dispatch console, orders, catalogue and /track/:token page
packages/shared        Domain model, status machines, pricing, route optimizer, validation (unit tested)
packages/art           Vector illustrations (products, categories, scenes) shared by every app
packages/expo-firebase Firebase client, emulator wiring and hooks shared by the Expo apps
firebase/              Cloud Functions (functions/src/modules/*), rules, indexes, integration tests
scripts/               Emulator launcher, seed data, driver simulator, create-admin, import-catalog
infra/                 One-time project bootstrap (APIs, Firestore, backups, secrets, CI account)
docs/                  ARCHITECTURE.md (design + data model), DEPLOYMENT.md (production guide)
```

## Run it locally (no Firebase account needed)

Requirements: **Node 22+** and **Java 21+** (`brew install openjdk` on macOS). The scripts find
a suitable JDK automatically.

```bash
npm install
```

```bash
npm run emulators          # terminal 1 — Auth, Firestore, Functions, Storage + UI on :4000
```

```bash
npm run seed               # terminal 2 — Bengaluru demo data and grocery catalogue (wipes emulator data first)
```

```bash
npm run dev:backoffice     # http://localhost:5173
```

```bash
npm run dev:customer       # shopping app on port 8082: press w for web, or scan the QR code with Expo Go
```

```bash
npm run dev:driver         # driver app on port 8081: press w for web, or scan the QR code with Expo Go
```

Demo accounts (password `Instasupply@123`):

| Who | Email |
| --- | --- |
| Shopper | `customer@instasupply.test` |
| Admin | `admin@instasupply.test` |
| Dispatcher | `dispatch@instasupply.test` |
| Drivers | `ravi@instasupply.test`, `meera@instasupply.test`, `arjun@instasupply.test` |
| Driver awaiting approval | `new.driver@instasupply.test` |

Phone verification in the emulator shows the code on screen. Test numbers
`+91 99999 99999`, `88888 88888` and `77777 77777` always accept `123456`.

Shopping in the emulator:

- **Promo codes**: `FIRST20` (20% off your first order, up to ₹100, on baskets of ₹199 or more) and
  `FRESH10` (10% off baskets of ₹799 or more, up to ₹150). Delivery is free from ₹499.
- **Card payments run in test mode**: save any valid test number such as `4242 4242 4242 4242`
  with a future expiry. Only the brand, last 4 digits and expiry are stored, and no money moves.
  Production allows cash on delivery only until a payment gateway is connected (see
  [DEPLOYMENT.md](docs/DEPLOYMENT.md#8-payments)).
- An order you place shows up in the back office under **Orders** and **Deliveries**. Assign a
  driver there, then follow it live in the app as the driver moves.

Watch live tracking without a phone. This drives Meera along her optimized route; open the back office
**Live map** and the tracking link printed by `npm run seed`:

```bash
npm run simulate -- --driver meera@instasupply.test --speed 60
```

To use a real phone with Expo Go, keep the phone on the same Wi-Fi network. The apps find the
emulators through the Expo dev server's address. System push notifications and background location
need a development build (`eas build --profile development`). In Expo Go, the in-app inbox, live
banners and foreground tracking still work.

## Quality checks

```bash
npm run lint && npm run format:check && npm run typecheck
```

```bash
npm test                   # unit tests (pricing, route optimizer, status machine, validation, formatting)
```

```bash
npm run test:integration   # throwaway emulators: checkout + delivery workflows and security rules
```

CI runs all of the above on every pull request. It also bundles both Expo apps to catch Metro
errors.

## Deploying

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). In short: run `infra/bootstrap-project.sh` once per
project, add the GitHub environment variables, load the catalogue with `npm run import-catalog`, and
merge to `main` to deploy staging. Tag `v*` to deploy production. App binaries are built by EAS
(`.github/workflows/driver-app.yml` and `customer-app.yml`).

## How it fits together

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data model, the order and delivery
lifecycles, roles, the notification pipeline, routing, and live tracking.
